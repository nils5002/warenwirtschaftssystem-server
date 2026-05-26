"""Endpoints für die Admin-Seite "Label-Prüfung" (serverseitige Prüfrunden).

ALLE Endpunkte sind ausschließlich für die Rolle ``admin`` zugänglich
(Backend-seitig erzwungen, nicht nur im Frontend versteckt). Die Endpunkte
schreiben nur eigene Audit-Tabellen — keine Asset-/Planungs-/Defekt-/
Reservierungs-/Aktivitäts-Mutation, keine Ausgabe/Rücknahme, keine
Status-Änderung an Hardware.

- GET    /api/wms/label-audit/sessions                 → Runden auflisten
- POST   /api/wms/label-audit/sessions                 → neue Runde starten
- GET    /api/wms/label-audit/sessions/active          → aktive Runde (ggf. anlegen)
- GET    /api/wms/label-audit/sessions/{session_id}    → Runde inkl. Scans/Summary
- POST   /api/wms/label-audit/sessions/{session_id}/scan    → Scan erfassen
- POST   /api/wms/label-audit/sessions/{session_id}/archive → Runde archivieren
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database.session import get_db
from ..routes.dependencies import AccessContext, get_access_context, require_roles
from ..schemas.label_audit import (
    LabelAuditScanPayload,
    LabelAuditScanResult,
    LabelAuditSessionCreatePayload,
    LabelAuditSessionListItem,
    LabelAuditSessionResponse,
)
from ..services.label_audit_service import LabelAuditArchivedError, LabelAuditService

router = APIRouter(prefix="/api/wms/label-audit", tags=["WMS Label Audit"])


@router.get("/sessions", response_model=list[LabelAuditSessionListItem])
def list_sessions(
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> list[LabelAuditSessionListItem]:
    require_roles(context, "admin")
    return LabelAuditService.list_sessions(db)


@router.post("/sessions", response_model=LabelAuditSessionResponse)
def create_session(
    payload: LabelAuditSessionCreatePayload,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> LabelAuditSessionResponse:
    require_roles(context, "admin")
    return LabelAuditService.create_session(
        db, name=payload.name, note=payload.note, user_id=context.user_id
    )


@router.get("/sessions/active", response_model=LabelAuditSessionResponse)
def get_active_session(
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> LabelAuditSessionResponse:
    require_roles(context, "admin")
    return LabelAuditService.get_or_create_active(db, user_id=context.user_id)


@router.get("/sessions/{session_id}", response_model=LabelAuditSessionResponse)
def get_session(
    session_id: str,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> LabelAuditSessionResponse:
    require_roles(context, "admin")
    result = LabelAuditService.get_session(db, session_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Prüfrunde nicht gefunden.")
    return result


@router.post("/sessions/{session_id}/scan", response_model=LabelAuditScanResult)
def scan_session(
    session_id: str,
    payload: LabelAuditScanPayload,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> LabelAuditScanResult:
    require_roles(context, "admin")
    try:
        result = LabelAuditService.scan(
            db, session_id, payload.scanValue, user_id=context.user_id
        )
    except LabelAuditArchivedError as exc:
        raise HTTPException(
            status_code=409,
            detail="Prüfrunde ist archiviert. Bitte eine neue Prüfrunde starten.",
        ) from exc
    if result is None:
        raise HTTPException(status_code=404, detail="Prüfrunde nicht gefunden.")
    return result


@router.post("/sessions/{session_id}/archive", response_model=LabelAuditSessionResponse)
def archive_session(
    session_id: str,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> LabelAuditSessionResponse:
    require_roles(context, "admin")
    result = LabelAuditService.archive_session(db, session_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Prüfrunde nicht gefunden.")
    return result
