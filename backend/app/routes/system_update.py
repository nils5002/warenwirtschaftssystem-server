"""Admin-Endpunkte „Systemupdate" (Redeploy über den Portainer-Stack-Webhook).

Alle Endpunkte sind ausschliesslich fuer Admins erreichbar: geprueft wird
serverseitig sowohl die normalisierte Rolle als auch das Recht
``system.update`` — der UI-Filter im Frontend ist reiner Komfort.

Antworten enthalten NIEMALS die Portainer-Webhook-URL oder das GitHub-Token.
Dass ein Webhook hinterlegt ist, wird nur als Boolean mitgeteilt.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database.models import UserRecord
from ..database.session import get_db
from ..routes.dependencies import AccessContext, get_access_context, require_permission, require_roles
from ..schemas.system_update import (
    SystemUpdateCheckResponse,
    SystemUpdateHistoryResponse,
    SystemUpdateStartResponse,
    SystemUpdateStatusResponse,
    SystemVersionResponse,
)
from ..services import security_event_service as sec
from ..services import system_update_service
from ..services.rate_limiter import (
    client_ip,
    system_update_check_rate_limiter,
    system_update_rate_limiter,
    too_many_requests,
)

router = APIRouter(prefix="/api/admin/system", tags=["System Update"])
logger = logging.getLogger("cloud_web.system_update")


def _require_system_admin(context: AccessContext, db: Session) -> None:
    """Serverseitige Rechtepruefung: Rolle *und* Recht muessen stimmen."""
    require_roles(context, "admin")
    require_permission(context, db, "system.update")


def _rate_limit_key(request: Request, context: AccessContext) -> str:
    """Limiter-Schluessel: Benutzer + IP (ein Konto pro Client)."""
    return f"{context.user_id or 'unknown'}|{client_ip(request)}"


def _actor_name(db: Session, context: AccessContext) -> str | None:
    if not context.user_id:
        return None
    user = db.scalar(select(UserRecord).where(UserRecord.external_id == context.user_id))
    return user.name if user is not None else None


@router.get("/version", response_model=SystemVersionResponse)
def get_version(
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> SystemVersionResponse:
    _require_system_admin(context, db)
    return system_update_service.version_info()


@router.get("/update/check", response_model=SystemUpdateCheckResponse)
def check_for_update(
    request: Request,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> SystemUpdateCheckResponse:
    _require_system_admin(context, db)
    status = system_update_check_rate_limiter.record_attempt(_rate_limit_key(request, context))
    if status.limited:
        raise too_many_requests(status.retry_after)
    # Fehler bei GitHub kommen als normale Antwort mit state="check_failed"
    # zurueck — eine gestoerte Pruefung darf die App nicht beeintraechtigen.
    return system_update_service.check_update()


@router.post("/update", response_model=SystemUpdateStartResponse, status_code=202)
def start_update(
    request: Request,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> SystemUpdateStartResponse:
    """Startet den Redeploy. Uebernimmt bewusst KEINE Werte aus dem Request.

    Ziel-Repository, Branch und Webhook-URL stammen ausschliesslich aus der
    Serverkonfiguration; der Request hat keinen Body.
    """
    _require_system_admin(context, db)
    limit_status = system_update_rate_limiter.record_attempt(_rate_limit_key(request, context))
    if limit_status.limited:
        raise too_many_requests(limit_status.retry_after)

    try:
        result = system_update_service.start_update(
            db,
            actor_id=context.user_id,
            actor_name=_actor_name(db, context),
        )
    except Exception as exc:  # noqa: BLE001 — Audit auch im Fehlerfall.
        detail = getattr(exc, "detail", None)
        sec.record_event(
            db,
            sec.SYSTEM_UPDATE_FAILED,
            request=request,
            success=False,
            actor_id=context.user_id,
            severity="warning",
            meta={"reason": str(detail) if detail else type(exc).__name__},
        )
        raise

    sec.record_event(
        db,
        sec.SYSTEM_UPDATE_REQUESTED,
        request=request,
        success=True,
        actor_id=context.user_id,
        severity="critical",
        meta={
            "runId": result.run.id if result.run else None,
            "sourceCommit": result.run.sourceCommit if result.run else None,
            "targetCommit": result.targetCommit,
            "backup": result.run.backupReference if result.run else None,
        },
    )
    logger.warning(
        "Systemupdate durch Admin ausgelöst (user_id=%s, Ziel=%s)",
        context.user_id,
        system_update_service.short_sha(result.targetCommit),
    )
    return result


@router.get("/update/status", response_model=SystemUpdateStatusResponse)
def get_update_status(
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> SystemUpdateStatusResponse:
    _require_system_admin(context, db)
    return system_update_service.current_status(db)


@router.get("/update/history", response_model=SystemUpdateHistoryResponse)
def get_update_history(
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> SystemUpdateHistoryResponse:
    _require_system_admin(context, db)
    return system_update_service.history(db, limit=limit, offset=offset)
