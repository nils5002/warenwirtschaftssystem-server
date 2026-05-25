"""Schritt E: dünne Service-Schicht für Update-Notes (Delegation an Repository)."""

from __future__ import annotations

from sqlalchemy.orm import Session

from ..repositories import update_notes_repository
from ..schemas.update_notes import (
    UpdateNoteCreatePayload,
    UpdateNoteResponse,
    UpdateNoteUpdatePayload,
)


class UpdateNotesService:
    @staticmethod
    def list_all(db: Session) -> list[UpdateNoteResponse]:
        return update_notes_repository.list_all(db)

    @staticmethod
    def get_latest_published(db: Session) -> UpdateNoteResponse | None:
        return update_notes_repository.get_latest_published(db)

    @staticmethod
    def create(db: Session, payload: UpdateNoteCreatePayload) -> UpdateNoteResponse:
        return update_notes_repository.create(db, payload)

    @staticmethod
    def update(db: Session, external_id: str, payload: UpdateNoteUpdatePayload) -> UpdateNoteResponse | None:
        return update_notes_repository.update(db, external_id, payload)

    @staticmethod
    def publish(db: Session, external_id: str) -> UpdateNoteResponse | None:
        return update_notes_repository.publish(db, external_id)

    @staticmethod
    def delete(db: Session, external_id: str) -> bool:
        return update_notes_repository.delete(db, external_id)
