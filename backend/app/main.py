from __future__ import annotations

import logging
import sys
import uuid
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from sqlalchemy import text

from .config.settings import get_settings
from .database.session import SessionLocal, init_db
from .errors import register_error_handlers
from .logging_setup import (
    bind_request_context,
    clear_request_context,
    set_response_status,
    setup_logging,
)
from .repositories import category_repository
from .routes import api_router
from .services.auth_service import decode_access_token, ensure_user_passwords
from .services.auth_service import ensure_initial_admin, verify_auth_secret
from .services.job_manager import JobManager
from .services.wms_service import WmsService

setup_logging()
logger = logging.getLogger("cloud_web.main")


def _ensure_cloud_package_on_path() -> None:
    current_file = Path(__file__).resolve()
    cloud_package = None
    for base in current_file.parents:
        candidate = base / "cloud"
        if candidate.exists() and (candidate / "__init__.py").exists():
            cloud_package = candidate
            break
    if cloud_package:
        package_root = str(cloud_package.parent)
        if package_root not in sys.path:
            sys.path.append(package_root)


def create_app() -> FastAPI:
    _ensure_cloud_package_on_path()
    settings = get_settings()

    # Security-Audit Paket A: Start außerhalb der Entwicklung mit dem
    # unsicheren Default-Auth-Secret hart abbrechen, statt unsicher online
    # zu gehen. In Dev-Umgebungen wird nur gewarnt.
    verify_auth_secret(settings)

    app = FastAPI(title=settings.app_name, version=settings.app_version)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.job_manager = JobManager()
    app.include_router(api_router)
    register_error_handlers(app)

    @app.middleware("http")
    async def request_logging(request: Request, call_next):  # type: ignore[override]
        # Eingehende Request-ID übernehmen, sonst eine neue generieren. So
        # lässt sich ein einzelner Vorfall vom Cloudflare-Edge bis ins
        # App-Log nachvollziehen.
        incoming = request.headers.get("x-request-id", "").strip()
        request_id = incoming if incoming else uuid.uuid4().hex[:16]

        # Auth NICHT aus dem Header in den Log schreiben — nur die abgeleitete
        # User-ID / Rolle. Das vermeidet Token-Leaks in der Logdatei.
        user_id: str | None = None
        role: str | None = None
        auth_header = request.headers.get("authorization", "").strip()
        if auth_header.lower().startswith("bearer "):
            token = auth_header[7:].strip()
            if token:
                try:
                    info = decode_access_token(token)
                    user_id = info.userId or None
                    role = info.role or None
                except Exception:  # noqa: BLE001
                    user_id = None
                    role = None

        bind_request_context(
            request_id=request_id,
            user_id=user_id,
            role=role,
            method=request.method,
            path=request.url.path,
        )
        try:
            response: Response = await call_next(request)
        except Exception:
            # Unerwartete Exceptions werden im Error-Handler geloggt; hier
            # nur Kontext freigeben.
            clear_request_context()
            raise
        set_response_status(response.status_code)
        try:
            response.headers.setdefault("X-Request-ID", request_id)
            if 500 <= response.status_code < 600:
                logger.error("Request fehlgeschlagen (server)")
            elif response.status_code in (401, 403):
                logger.warning("Zugriff verweigert")
            elif response.status_code >= 400:
                logger.info("Request mit Fehlerstatus")
        finally:
            clear_request_context()
        return response

    @app.middleware("http")
    async def add_security_headers(request: Request, call_next):  # type: ignore[override]
        response: Response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault(
            "Permissions-Policy",
            "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
        )
        # Keep CSP pragmatic to avoid breaking API docs and existing frontend delivery.
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; "
            "base-uri 'self'; "
            "frame-ancestors 'none'; "
            "img-src 'self' data: blob: https:; "
            "style-src 'self' 'unsafe-inline' https:; "
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; "
            "connect-src 'self' https: http: ws: wss:; "
            "form-action 'self'",
        )
        if request.url.scheme == "https":
            response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return response

    @app.on_event("startup")
    def on_startup() -> None:
        logger.info("App-Startup: %s v%s (env=%s)", settings.app_name, settings.app_version, settings.app_env)
        if settings.db_auto_create_schema:
            init_db()
        with SessionLocal() as db:
            # Backward-compatible schema patch for existing SQLite DBs without migration.
            existing_columns = [
                row[1]
                for row in db.execute(text("PRAGMA table_info(users)")).fetchall()
            ]
            if "password_hash" not in existing_columns:
                db.execute(text("ALTER TABLE users ADD COLUMN password_hash VARCHAR(255)"))
                db.commit()
            if "is_active" not in existing_columns:
                db.execute(text("ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT 1"))
                db.execute(text("UPDATE users SET is_active = CASE WHEN lower(status) = 'inaktiv' THEN 0 ELSE 1 END"))
                db.commit()
            planning_item_columns = [
                row[1]
                for row in db.execute(text("PRAGMA table_info(planning_items)")).fetchall()
            ]
            if "handover_enabled" not in planning_item_columns:
                db.execute(text("ALTER TABLE planning_items ADD COLUMN handover_enabled BOOLEAN DEFAULT 0"))
                db.commit()
            if "linked_planning_external_id" not in planning_item_columns:
                db.execute(text("ALTER TABLE planning_items ADD COLUMN linked_planning_external_id VARCHAR(64)"))
                db.commit()
            if "handover_note" not in planning_item_columns:
                db.execute(text("ALTER TABLE planning_items ADD COLUMN handover_note TEXT"))
                db.commit()
        with SessionLocal() as db:
            category_repository.seed_standard_categories(db)
        if settings.wms_seed_legacy_on_startup:
            base_dir = Path(__file__).resolve().parents[1]
            legacy_path = settings.resolve_legacy_json_path(base_dir)
            with SessionLocal() as db:
                WmsService.seed_from_legacy_json_if_needed(db, legacy_path)
            logger.info("Startup complete, DB initialized.")
        with SessionLocal() as db:
            try:
                ensure_initial_admin(db)
                ensure_user_passwords(db)
            except Exception:  # noqa: BLE001
                # Bewusst KEIN re-raise mehr: ein Fehlschlag der
                # Passwort-Initialisierung darf den Server-Start nicht
                # verhindern. Sonst stirbt der Worker beim Boot und der
                # Reverse-Proxy (Cloudflare) liefert minutenlang 502 statt
                # einer kontrollierten 401/403 vom Login-Endpoint. Fehler
                # wird ausführlich geloggt; Operator kann nachsteuern.
                logger.exception("Passwort-Initialisierung fehlgeschlagen — App startet trotzdem")

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
