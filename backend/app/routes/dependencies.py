from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..config.settings import get_settings
from ..database.session import get_db
from ..services.auth_service import authenticate_token
from ..services.job_manager import JobManager

RoleName = Literal["admin", "projektmanager", "mitarbeiter"]

# Name des HttpOnly-Auth-Cookies (Security-Audit Paket B4).
#
# Die Browser-SPA legt den Auth-Token nicht mehr im localStorage ab, sondern
# bekommt ihn vom Backend als HttpOnly-Cookie gesetzt. Dieser Name wird sowohl
# beim Setzen/Loeschen (routes/auth.py) als auch beim Lesen (hier sowie in der
# Logging-Middleware) verwendet.
AUTH_COOKIE_NAME = "wms_auth"


@dataclass(frozen=True)
class AccessContext:
    role: RoleName
    user_id: str | None
    project_contexts: tuple[str, ...]


def extract_request_token(request: Request) -> str | None:
    """Liefert den Auth-Token aus dem Request — Header hat Vorrang vor Cookie.

    Reihenfolge:
      1. ``Authorization: Bearer <token>`` — fuer API-/Test-Clients, die
         bewusst einen Token mitschicken.
      2. HttpOnly-Cookie ``wms_auth`` — der Weg der Browser-SPA
         (Security-Audit Paket B4: Token nicht mehr im localStorage).

    Der Header hat bewusst Vorrang: schickt ein Client explizit einen
    Bearer-Token, darf ein nebenher gesetztes Cookie ihn nicht ueberstimmen.
    Liefert ``None``, wenn weder Header noch Cookie einen nutzbaren Token
    enthalten.
    """
    header = request.headers.get("authorization", "").strip()
    if header.lower().startswith("bearer "):
        token = header[7:].strip()
        if token:
            return token
    cookie_token = (request.cookies.get(AUTH_COOKIE_NAME) or "").strip()
    return cookie_token or None


def _normalize_role(value: str | None) -> RoleName:
    normalized = (value or "").strip().lower()
    if normalized in {"admin", "techniker", "administrator"}:
        return "admin"
    if normalized in {"projektmanager", "projectmanager", "project_manager"}:
        return "projektmanager"
    if normalized in {"mitarbeiter", "junior", "lager", "lager / logistik", "event-team", "event team"}:
        return "mitarbeiter"
    return "mitarbeiter"


def _parse_project_contexts(value: str | None) -> tuple[str, ...]:
    if not value:
        return tuple()
    parts = [item.strip() for item in value.split(",")]
    return tuple(item for item in parts if item)


def get_access_context(
    request: Request,
    db: Session = Depends(get_db),
) -> AccessContext:
    project_contexts = _parse_project_contexts(request.headers.get("x-project-context"))
    # Token aus Authorization-Header ODER HttpOnly-Cookie (Paket B4).
    token = extract_request_token(request)
    if token:
        # authenticate_token prueft zusaetzlich serverseitig die token_version
        # — abgemeldete/invalidierte Tokens werden hier mit 401 abgewiesen.
        user = authenticate_token(db, token)
        return AccessContext(
            role=_normalize_role(user.role),
            user_id=user.userId,
            project_contexts=project_contexts,
        )
    settings = get_settings()
    if not settings.allow_legacy_header_auth:
        raise HTTPException(status_code=401, detail="Nicht authentifiziert.")
    role_header = request.headers.get("x-user-role")
    role = _normalize_role(role_header)
    user_id = (request.headers.get("x-user-id") or "").strip() or None
    if not role_header or not role:
        raise HTTPException(status_code=401, detail="Nicht authentifiziert.")
    return AccessContext(role=role, user_id=user_id, project_contexts=project_contexts)


def require_roles(context: AccessContext, *allowed: RoleName) -> None:
    if context.role not in allowed:
        raise HTTPException(status_code=403, detail="Keine Berechtigung für diese Aktion.")


def require_project_scope(context: AccessContext) -> None:
    if context.role == "admin":
        return
    if context.role == "projektmanager" and context.user_id:
        return
    if context.project_contexts:
        return
    raise HTTPException(
        status_code=403,
        detail="Kein Projektkontext vorhanden. Bitte Projektkontext auswählen.",
    )


def get_job_manager(request: Request) -> JobManager:
    manager = getattr(request.app.state, "job_manager", None)
    if manager is None:
        raise HTTPException(status_code=500, detail="Job manager is not initialized")
    return manager
