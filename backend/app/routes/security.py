"""Admin-Endpunkte „Sicherheit & Protokolle" (Security-Paket „supman").

Alle Lese-Endpunkte sind über das bestehende Recht ``logs.read`` geschützt,
der Registrierungs-Schalter über ``users.manage`` (Benutzerverwaltung).
Pfadschema konsistent zu den übrigen Admin-Routen unter ``/api/wms/admin``.

Antworten enthalten niemals Passwörter/Hashes/Tokens; IP-Adressen werden
serverseitig gekürzt ausgeliefert.
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..database.session import get_db
from ..routes.dependencies import AccessContext, get_access_context, require_permission
from ..schemas.security import (
    RegistrationSettingPayload,
    RegistrationSettingResponse,
    SecurityEventListResponse,
    SecuritySummaryResponse,
)
from ..services import security_event_service as sec

router = APIRouter(prefix="/api/wms/admin", tags=["WMS Security"])
logger = logging.getLogger("cloud_web.security")


def _parse_dt(value: str | None, field: str) -> datetime | None:
    """ISO-Datum/Zeit aus dem Query-Param — naiv wird als UTC interpretiert."""
    if not value or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Ungültiges Datum für '{field}'.") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed


def _parse_success(value: str | None) -> bool | None:
    if value is None or not value.strip():
        return None
    return value.strip().lower() in {"1", "true", "ja", "yes"}


@router.get("/security-events", response_model=SecurityEventListResponse)
def list_security_events(
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
    type: str | None = Query(default=None, max_length=64),
    user: str | None = Query(default=None, max_length=255),
    ip: str | None = Query(default=None, max_length=64),
    severity: str | None = Query(default=None, max_length=16),
    success: str | None = Query(default=None, max_length=8),
    from_: str | None = Query(default=None, alias="from", max_length=40),
    to: str | None = Query(default=None, max_length=40),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> SecurityEventListResponse:
    require_permission(context, db, "logs.read")
    return sec.list_events(
        db,
        event_type=(type or "").strip() or None,
        user=(user or "").strip() or None,
        ip=(ip or "").strip() or None,
        severity=(severity or "").strip() or None,
        success=_parse_success(success),
        since=_parse_dt(from_, "from"),
        until=_parse_dt(to, "to"),
        limit=limit,
        offset=offset,
    )


@router.get("/security-events/summary", response_model=SecuritySummaryResponse)
def security_summary(
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
    since: str | None = Query(default=None, max_length=40),
) -> SecuritySummaryResponse:
    require_permission(context, db, "logs.read")
    return sec.summary(db, suspicious_since=_parse_dt(since, "since"))


@router.get("/security-events/export")
def export_security_events(
    request: Request,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
    type: str | None = Query(default=None, max_length=64),
    user: str | None = Query(default=None, max_length=255),
    ip: str | None = Query(default=None, max_length=64),
    severity: str | None = Query(default=None, max_length=16),
    success: str | None = Query(default=None, max_length=8),
    from_: str | None = Query(default=None, alias="from", max_length=40),
    to: str | None = Query(default=None, max_length=40),
) -> Response:
    require_permission(context, db, "logs.read")
    csv_text = sec.export_csv(
        db,
        event_type=(type or "").strip() or None,
        user=(user or "").strip() or None,
        ip=(ip or "").strip() or None,
        severity=(severity or "").strip() or None,
        success=_parse_success(success),
        since=_parse_dt(from_, "from"),
        until=_parse_dt(to, "to"),
    )
    # Der Export selbst ist ein auditierbares Ereignis (wer hat wann was gezogen).
    sec.record_event(
        db, sec.SECURITY_EXPORT_CREATED, request=request, success=True,
        actor_id=context.user_id,
        meta={"filter": {"type": type, "user": user, "ip": ip, "severity": severity}},
    )
    filename = f"sicherheitsprotokoll-{datetime.now(UTC).strftime('%Y-%m-%d_%H-%M')}.csv"
    return Response(
        # BOM, damit Excel deutsche Umlaute im CSV korrekt öffnet.
        content="﻿" + csv_text,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


@router.get("/settings/registration", response_model=RegistrationSettingResponse)
def get_registration_setting(
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> RegistrationSettingResponse:
    require_permission(context, db, "users.manage")
    return RegistrationSettingResponse(enabled=sec.registration_enabled(db))


@router.put("/settings/registration", response_model=RegistrationSettingResponse)
def update_registration_setting(
    payload: RegistrationSettingPayload,
    request: Request,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> RegistrationSettingResponse:
    require_permission(context, db, "users.manage")
    enabled = sec.set_registration_enabled(db, payload.enabled)
    sec.record_event(
        db, sec.PERMISSION_CHANGED, request=request, success=True,
        actor_id=context.user_id,
        meta={"setting": "registration_enabled", "enabled": enabled},
    )
    logger.info("Registrierung per Admin-Setting %s (actor=%s)", "aktiviert" if enabled else "deaktiviert", context.user_id)
    return RegistrationSettingResponse(enabled=enabled)
