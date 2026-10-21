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
    # Companion-Geraetesitzung (``sid``), sonst None (Browser-Anmeldung).
    device_id: str | None = None


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
            device_id=user.deviceId,
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


CSRF_HEADER = "x-requested-with"
CSRF_HEADER_VALUE = "xmlhttprequest"


def require_csrf_header(request: Request) -> None:
    """Zusaetzlicher CSRF-Schutz fuer schreibende Admin-Endpunkte.

    Das Auth-Cookie ist bereits ``SameSite=Lax``. Zusaetzlich muss eine
    cookie-authentifizierte Anfrage den Header ``X-Requested-With:
    XMLHttpRequest`` tragen: Ein Formular einer fremden Seite kann keine
    eigenen Header setzen, und ein fremdes ``fetch`` mit diesem Header scheitert
    am CORS-Preflight. Anfragen mit explizitem ``Authorization: Bearer``-Header
    sind nicht CSRF-faehig (der Browser haengt den Header nie selbst an) und
    brauchen ihn nicht.
    """
    if request.headers.get("authorization", "").strip().lower().startswith("bearer "):
        return
    if request.headers.get(CSRF_HEADER, "").strip().lower() == CSRF_HEADER_VALUE:
        return
    raise HTTPException(
        status_code=403,
        detail="Anfrage abgelehnt: Sicherheits-Header fehlt. Bitte die Seite neu laden.",
    )


def _origin_of(url: str | None) -> str | None:
    from urllib.parse import urlsplit

    raw = (url or "").strip()
    if not raw:
        return None
    try:
        parts = urlsplit(raw)
    except ValueError:
        return None
    if not parts.scheme or not parts.netloc:
        return None
    return f"{parts.scheme.lower()}://{parts.netloc.lower()}"


def trusted_origins(request: Request, extra: tuple[str | None, ...] = ()) -> set[str]:
    """Origins, von denen schreibende Cookie-Anfragen kommen duerfen.

    Konfigurierte Adressen (FRONTEND_URL, BASE_URL, CORS_ORIGINS, oeffentliche
    WWS-Adresse) plus die eigene Adresse laut Host-/Forwarded-Headern. Ein
    fremder Browser-Kontext kann seinen ``Origin`` nicht faelschen und keine
    eigenen Host-Header setzen, ohne am CORS-Preflight zu scheitern.
    """
    settings = get_settings()
    candidates: list[str | None] = [settings.frontend_url, settings.base_url, *extra]
    candidates.extend(item for item in settings.cors_origins_list if item != "*")
    forwarded_proto = request.headers.get("x-forwarded-proto", "").split(",")[0].strip()
    scheme = forwarded_proto or request.url.scheme
    for host in (request.headers.get("x-forwarded-host"), request.headers.get("host")):
        if host:
            candidates.append(f"{scheme}://{host.split(',')[0].strip()}")
    return {origin for origin in (_origin_of(item) for item in candidates) if origin}


def require_trusted_origin(request: Request, extra: tuple[str | None, ...] = ()) -> None:
    """Prueft den ``Origin``-Header schreibender Browser-Anfragen.

    Fehlt der Header (Nicht-Browser-Client), entscheidet allein der
    CSRF-Header; Bearer-Anfragen sind ohnehin nicht CSRF-faehig.
    """
    if request.headers.get("authorization", "").strip().lower().startswith("bearer "):
        return
    origin = _origin_of(request.headers.get("origin"))
    if origin is None:
        return
    if origin not in trusted_origins(request, extra):
        raise HTTPException(status_code=403, detail="Anfrage von einer fremden Herkunft abgelehnt.")


def require_roles(context: AccessContext, *allowed: RoleName) -> None:
    if context.role not in allowed:
        raise HTTPException(status_code=403, detail="Keine Berechtigung für diese Aktion.")


def require_permission(context: AccessContext, db: Session, permission_key: str) -> None:
    """Rechte-basierte Zugriffsprüfung (admin-editierbar, Feature „Rollen & Rechte").

    ``role_key`` ist die bereits normalisierte ``context.role``. Die gewährten
    Rechte der Rolle werden pro Request über einen indizierten SELECT geladen
    (kleine Tabelle, vernachlässigbar). Gleiche 403-Message wie ``require_roles``,
    damit bestehende UX/Tests unverändert bleiben.
    """
    # Lazy-Import vermeidet jeden potentiellen Import-Zyklus beim Modul-Load.
    from ..repositories import role_permission_repository

    granted = role_permission_repository.permissions_for_role(db, context.role)
    if permission_key not in granted:
        # Audit (Security-Paket „supman"): abgelehnte Admin-/Rechte-Zugriffe
        # nachvollziehbar machen. Ohne Request-Objekt hier — Benutzer, Rolle
        # und angefragtes Recht reichen für die Bewertung.
        from ..services import security_event_service as sec

        sec.record_event(
            db, sec.ADMIN_ACTION_DENIED, severity="warning",
            user_id=context.user_id, reason="missing_permission",
            meta={"permission": permission_key, "role": context.role},
        )
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
