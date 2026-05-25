"""Schritt E: Endpoints für admin-pflegbare Update-Notes.

- GET  /api/wms/update-notes/latest        → jeder eingeloggte Nutzer (lesen)
- GET  /api/wms/admin/update-notes          → nur Admin (Liste)
- POST /api/wms/admin/update-notes          → nur Admin (Entwurf anlegen)
- PUT  /api/wms/admin/update-notes/{id}     → nur Admin (bearbeiten)
- POST /api/wms/admin/update-notes/{id}/publish → nur Admin (veröffentlichen)
- DELETE /api/wms/admin/update-notes/{id}   → nur Admin (löschen)
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database.session import get_db
from ..routes.dependencies import AccessContext, get_access_context, require_roles
from ..schemas.update_notes import (
    UpdateNoteCreatePayload,
    UpdateNoteResponse,
    UpdateNoteUpdatePayload,
)
from ..services.update_notes_service import UpdateNotesService

router = APIRouter(prefix="/api/wms", tags=["WMS Update Notes"])


@router.get("/update-notes/latest", response_model=UpdateNoteResponse | None)
def get_latest_update_note(
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> UpdateNoteResponse | None:
    _ = context  # jeder eingeloggte Nutzer darf lesen
    return UpdateNotesService.get_latest_published(db)


@router.get("/admin/update-notes", response_model=list[UpdateNoteResponse])
def list_update_notes(
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> list[UpdateNoteResponse]:
    require_roles(context, "admin")
    return UpdateNotesService.list_all(db)


@router.post("/admin/update-notes", response_model=UpdateNoteResponse)
def create_update_note(
    payload: UpdateNoteCreatePayload,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> UpdateNoteResponse:
    require_roles(context, "admin")
    return UpdateNotesService.create(db, payload)


@router.put("/admin/update-notes/{note_id}", response_model=UpdateNoteResponse)
def update_update_note(
    note_id: str,
    payload: UpdateNoteUpdatePayload,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> UpdateNoteResponse:
    require_roles(context, "admin")
    result = UpdateNotesService.update(db, note_id, payload)
    if result is None:
        raise HTTPException(status_code=404, detail="Update-Note nicht gefunden")
    return result


@router.post("/admin/update-notes/{note_id}/publish", response_model=UpdateNoteResponse)
def publish_update_note(
    note_id: str,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> UpdateNoteResponse:
    require_roles(context, "admin")
    result = UpdateNotesService.publish(db, note_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Update-Note nicht gefunden")
    return result


@router.delete("/admin/update-notes/{note_id}")
def delete_update_note(
    note_id: str,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> dict[str, bool]:
    require_roles(context, "admin")
    if not UpdateNotesService.delete(db, note_id):
        raise HTTPException(status_code=404, detail="Update-Note nicht gefunden")
    return {"deleted": True}
