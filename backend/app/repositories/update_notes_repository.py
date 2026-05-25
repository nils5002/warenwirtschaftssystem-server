"""Schritt E: DB-Zugriff für admin-pflegbare Update-Notes."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database.models import UpdateNoteRecord
from ..schemas.update_notes import (
    UpdateNoteCreatePayload,
    UpdateNoteResponse,
    UpdateNoteUpdatePayload,
)


def _to_schema(record: UpdateNoteRecord) -> UpdateNoteResponse:
    return UpdateNoteResponse(
        id=record.external_id,
        version=record.version,
        date=record.note_date,
        title=record.title,
        items=list(record.items_json or []),
        isPublished=bool(record.is_published),
        publishedAt=record.published_at,
        createdAt=record.created_at,
        updatedAt=record.updated_at,
    )


def list_all(db: Session) -> list[UpdateNoteResponse]:
    records = db.scalars(
        select(UpdateNoteRecord).order_by(UpdateNoteRecord.created_at.desc())
    ).all()
    return [_to_schema(r) for r in records]


def get_latest_published(db: Session) -> UpdateNoteResponse | None:
    record = db.scalar(
        select(UpdateNoteRecord)
        .where(UpdateNoteRecord.is_published.is_(True))
        .order_by(
            UpdateNoteRecord.published_at.desc().nullslast(),
            UpdateNoteRecord.created_at.desc(),
        )
    )
    return _to_schema(record) if record else None


def _get(db: Session, external_id: str) -> UpdateNoteRecord | None:
    return db.scalar(select(UpdateNoteRecord).where(UpdateNoteRecord.external_id == external_id))


def create(db: Session, payload: UpdateNoteCreatePayload) -> UpdateNoteResponse:
    record = UpdateNoteRecord(
        external_id=f"upd-{uuid4().hex[:12]}",
        version=payload.version,
        note_date=payload.date,
        title=payload.title,
        items_json=list(payload.items),
        is_published=False,
        published_at=None,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return _to_schema(record)


def update(db: Session, external_id: str, payload: UpdateNoteUpdatePayload) -> UpdateNoteResponse | None:
    record = _get(db, external_id)
    if record is None:
        return None
    if payload.version is not None:
        record.version = payload.version
    if payload.items is not None:
        record.items_json = list(payload.items)
    # date/title sind optional und dürfen auch geleert werden, daher per
    # model_fields_set unterscheiden (None = explizit löschen vs. nicht gesetzt).
    fields_set = payload.model_fields_set
    if "date" in fields_set:
        record.note_date = payload.date
    if "title" in fields_set:
        record.title = payload.title
    db.commit()
    db.refresh(record)
    return _to_schema(record)


def publish(db: Session, external_id: str) -> UpdateNoteResponse | None:
    record = _get(db, external_id)
    if record is None:
        return None
    record.is_published = True
    record.published_at = datetime.now(UTC)
    db.commit()
    db.refresh(record)
    return _to_schema(record)


def delete(db: Session, external_id: str) -> bool:
    record = _get(db, external_id)
    if record is None:
        return False
    db.delete(record)
    db.commit()
    return True
