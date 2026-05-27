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
- PATCH  /api/wms/label-audit/sessions/{session_id}    → Runde bearbeiten (Name/Notiz/Status)
- PATCH  /api/wms/label-audit/sessions/{session_id}/scans/{scan_id} → Scan korrigieren
- POST   /api/wms/label-audit/sessions/{session_id}/scan    → Scan erfassen
- POST   /api/wms/label-audit/sessions/{session_id}/archive → Runde archivieren

Die beiden PATCH-Endpunkte erlauben Admins die nachträgliche Korrektur einer
Prüfrunde bzw. einzelner Scans (Soft-Delete statt Hard-Delete). Sie schreiben
weiterhin ausschließlich die Audit-Tabellen.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database.session import get_db
from ..routes.dependencies import AccessContext, get_access_context, require_roles
from ..schemas.label_audit import (
    LabelAuditScanPayload,
    LabelAuditScanResult,
    LabelAuditScanUpdatePayload,
    LabelAuditSessionCreatePayload,
    LabelAuditSessionListItem,
    LabelAuditSessionResponse,
    LabelAuditSessionUpdatePayload,
)
from ..services.label_audit_service import (
    LabelAuditActiveConflictError,
    LabelAuditArchivedError,
    LabelAuditAssetNotFoundError,
    LabelAuditService,
)

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


@router.patch("/sessions/{session_id}", response_model=LabelAuditSessionResponse)
def update_session(
    session_id: str,
    payload: LabelAuditSessionUpdatePayload,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> LabelAuditSessionResponse:
    require_roles(context, "admin")
    fields = payload.model_dump(exclude_unset=True)
    try:
        result = LabelAuditService.update_session(db, session_id, fields=fields)
    except LabelAuditActiveConflictError as exc:
        raise HTTPException(
            status_code=409,
            detail="Es gibt bereits eine aktive Prüfrunde. Bitte diese zuerst archivieren.",
        ) from exc
    if result is None:
        raise HTTPException(status_code=404, detail="Prüfrunde nicht gefunden.")
    return result


@router.patch(
    "/sessions/{session_id}/scans/{scan_id}", response_model=LabelAuditScanResult
)
def update_scan(
    session_id: str,
    scan_id: str,
    payload: LabelAuditScanUpdatePayload,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> LabelAuditScanResult:
    require_roles(context, "admin")
    fields = payload.model_dump(exclude_unset=True)
    try:
        result = LabelAuditService.update_scan(
            db, session_id, scan_id, fields=fields, user_id=context.user_id
        )
    except LabelAuditAssetNotFoundError as exc:
        raise HTTPException(
            status_code=404, detail="Das angegebene Asset wurde nicht gefunden."
        ) from exc
    if result is None:
        raise HTTPException(
            status_code=404, detail="Prüfrunde oder Scan nicht gefunden."
        )
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
