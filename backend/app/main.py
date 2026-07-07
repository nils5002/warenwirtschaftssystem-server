from __future__ import annotations

import asyncio
import contextlib
import logging
import sys
import time
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
from .repositories import category_repository, role_permission_repository
from .routes import api_router
from .routes.dependencies import extract_request_token
from .services.auth_service import decode_access_token, ensure_user_passwords
from .services.auth_service import ensure_initial_admin, verify_auth_secret
from .services.job_manager import JobManager
from .services.wms_service import WmsService

setup_logging()
logger = logging.getLogger("cloud_web.main")

# Requests, die laenger als dieser Schwellwert dauern, werden als WARNING
# markiert. So fallen Performance-Ausreisser (z. B. eine Overview-Regression
# oder ein DB-Lock-Stau) im Log auf, ohne dass der schnelle Normalbetrieb
# (Lasttest p95 ~0,7 s) die Logs flutet.
_SLOW_REQUEST_THRESHOLD_MS = 1000.0


# Content-Security-Policy (Security-Audit Paket B3 — gehaertet).
#
# Diese CSP setzt das Backend auf alle EIGENEN Antworten — also JSON-API-
# Antworten sowie die interaktive API-Doku (/docs, /redoc). Die ausgelieferte
# SPA wird NICHT vom Backend bedient; deren CSP gehoert auf die statische
# Ausliefer-/Reverse-Proxy-Schicht und ist bewusst nicht Teil dieses Schritts
# (keine Nginx-/Cloudflare-Aenderung).
#
# Gehaertet gegenueber dem Vorzustand:
#   * 'unsafe-eval' aus script-src ENTFERNT — weder Swagger UI / ReDoc noch
#     eine JSON-API-Antwort benoetigt eval / new Function.
#   * connect-src: Klartext-Schema 'http:' und WebSocket-Schemata 'ws:'/'wss:'
#     ENTFERNT — kein Downgrade auf unverschluesselte Verbindungen mehr.
#   * img-src: 'blob:' entfernt (auf der Backend-Oberflaeche nicht benoetigt).
#   * object-src 'none' ERGAENZT — blockiert Plugins / <object> / <embed>.
#
# Bewusst beibehalten: 'unsafe-inline' (script-src/style-src) und 'https:' —
# die von FastAPI generierte API-Doku nutzt einen Inline-Bootstrap-Script und
# laedt Swagger-/ReDoc-Assets vom CDN. Ohne Nonce-Injektion in dieses
# FastAPI-HTML laesst sich 'unsafe-inline' nicht entfernen, ohne /docs zu
# zerstoeren.
_CONTENT_SECURITY_POLICY = (
    "default-src 'self'; "
    "base-uri 'self'; "
    "frame-ancestors 'none'; "
    "object-src 'none'; "
    "img-src 'self' data: https:; "
    "style-src 'self' 'unsafe-inline' https:; "
    "script-src 'self' 'unsafe-inline' https:; "
    "connect-src 'self' https:; "
    "form-action 'self'"
)


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

        # Auth NICHT roh in den Log schreiben — nur die abgeleitete User-ID /
        # Rolle. Das vermeidet Token-Leaks in der Logdatei. Der Token kommt
        # je nach Client aus dem Authorization-Header oder dem HttpOnly-Cookie
        # (Security-Audit Paket B4).
        user_id: str | None = None
        role: str | None = None
        token = extract_request_token(request)
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
        started_at = time.perf_counter()
        try:
            response: Response = await call_next(request)
        except Exception:
            # Unerwartete Exceptions werden im Error-Handler geloggt; hier
            # nur Kontext freigeben.
            clear_request_context()
            raise
        elapsed_ms = (time.perf_counter() - started_at) * 1000.0
        set_response_status(response.status_code)
        try:
            response.headers.setdefault("X-Request-ID", request_id)
            # Slow-Request-Marker: nur Requests oberhalb der Schwelle, damit
            # der Normalbetrieb die Logs nicht flutet. Request-ID/Pfad/Status
            # liefert der Logging-Filter bereits mit.
            if elapsed_ms >= _SLOW_REQUEST_THRESHOLD_MS:
                logger.warning("Langsamer Request: %.0f ms", elapsed_ms)
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
        # Gehaertete CSP (Paket B3) — Definition + Begruendung siehe
        # _CONTENT_SECURITY_POLICY am Modulanfang.
        response.headers.setdefault("Content-Security-Policy", _CONTENT_SECURITY_POLICY)
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
            # Default-Rollenrechte seeden (nur wenn leer) — bildet das bisherige
            # hartkodierte Verhalten ab, sodass bestehende Installationen
            # unverändert funktionieren.
            role_permission_repository.seed_default_role_permissions(db)
            # Additiv: in bereits befüllten Tabellen fehlende (neu eingeführte)
            # Permission-Keys mit ihren Defaults nachtragen, ohne bestehende,
            # manuell gepflegte Rechte zu überschreiben.
            role_permission_repository.ensure_default_permissions_present(db)
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
        # Security-Event-Retention: personenbezogene Daten (IP/User-Agent)
        # zeitlich begrenzen. Einmalig beim Start — kein eigener Scheduler.
        with SessionLocal() as db:
            try:
                from .services import security_event_service

                security_event_service.cleanup_old_events(
                    db, settings.security_event_retention_days
                )
            except Exception:  # noqa: BLE001
                logger.exception("Security-Event-Cleanup fehlgeschlagen — App startet trotzdem")

    def _recache_product_images_once() -> None:
        # Lazy-Import vermeidet Import-Zyklen beim Modul-Load.
        from .services import product_image_service

        with SessionLocal() as db:
            report = product_image_service.recache_missing_images(db, apply=True)
            if report["refetched"] or report["failed"]:
                logger.info(
                    "Produktbild-Selbstheilung: %s geprüft, %s intakt, %s neu geladen, %s fehlgeschlagen",
                    report["checked"],
                    report["intact"],
                    report["refetched"],
                    report["failed"],
                )

    @app.on_event("startup")
    async def _start_product_image_recache() -> None:
        """Einmalige Bild-Selbstheilung nach dem Start (nicht blockierend).

        Nach einem Redeploy (Container-Filesystem frisch) oder Backup-Restore
        koennen Datensaetze auf Cache-Dateien zeigen, die nicht existieren —
        die UI zeigt dann kaputte Bilder trotz Status "ready". Der Task laedt
        solche Bilder aus der gespeicherten Quell-URL nach; Fehler einzelner
        Bilder landen als Status "failed" am Datensatz und crashen nie den
        Start. Per Setting abschaltbar (Tests/Dev).
        """
        if not settings.product_image_recache_on_startup:
            return

        async def _run() -> None:
            try:
                await asyncio.to_thread(_recache_product_images_once)
            except Exception:  # noqa: BLE001
                logger.exception("Produktbild-Selbstheilung fehlgeschlagen — App läuft normal weiter")

        app.state.product_image_recache_task = asyncio.create_task(_run())

    def _run_due_handovers_once() -> None:
        # Lazy-Import vermeidet Import-Zyklen beim Modul-Load.
        from .services import handover_service

        with SessionLocal() as db:
            result = handover_service.run_due_handovers(db)
            if result.transferredCount:
                logger.info(
                    "Handover-Autorun: %s Asset(s) automatisch übergeben (batch %s)",
                    result.transferredCount,
                    result.batchId,
                )

    @app.on_event("startup")
    async def _start_handover_scheduler() -> None:
        """Kleiner, idempotenter Background-Scheduler für automatische Übergaben.

        Mutiert NIE in einem Request-/Read-Pfad — er läuft als eigener
        Background-Task. Per Setting abschaltbar (Tests/Dev). Crasht nie: jeder
        Durchlauf ist in try/except gekapselt; die Idempotenz schützt vor
        Doppelläufen (Restart/mehrere Worker).
        """
        if not settings.handover_autorun_enabled:
            logger.info("Handover-Autorun deaktiviert (handover_autorun_enabled=False).")
            return
        interval = max(60, int(settings.handover_autorun_interval_seconds))

        async def _loop() -> None:
            while True:
                try:
                    await asyncio.sleep(interval)
                    await asyncio.to_thread(_run_due_handovers_once)
                except asyncio.CancelledError:
                    break
                except Exception:  # noqa: BLE001
                    logger.exception("Handover-Autorun-Durchlauf fehlgeschlagen — Scheduler läuft weiter")

        app.state.handover_task = asyncio.create_task(_loop())
        logger.info("Handover-Autorun aktiv (Intervall %ss).", interval)

    @app.on_event("shutdown")
    async def _stop_handover_scheduler() -> None:
        for attr in ("handover_task", "product_image_recache_task"):
            task = getattr(app.state, attr, None)
            if task is not None:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await task

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
