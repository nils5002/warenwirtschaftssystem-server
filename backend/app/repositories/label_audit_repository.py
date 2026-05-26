"""DB-Zugriff für die Label-Prüfung (Audit-Prüfrunden + Scans).

Schreibt ausschließlich die eigenen Tabellen ``label_audit_sessions`` und
``label_audit_scans``. Es werden keine Asset-/Planungs-/Defekt-/Reservierungs-
Datensätze verändert.
"""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database.models import LabelAuditScanRecord, LabelAuditSessionRecord


def list_sessions(db: Session) -> list[LabelAuditSessionRecord]:
    return list(
        db.scalars(
            select(LabelAuditSessionRecord).order_by(LabelAuditSessionRecord.created_at.desc())
        ).all()
    )


def get_session(db: Session, external_id: str) -> LabelAuditSessionRecord | None:
    return db.scalar(
        select(LabelAuditSessionRecord).where(LabelAuditSessionRecord.external_id == external_id)
    )


def get_active_session(db: Session) -> LabelAuditSessionRecord | None:
    return db.scalar(
        select(LabelAuditSessionRecord)
        .where(LabelAuditSessionRecord.status == "active")
        .order_by(LabelAuditSessionRecord.created_at.desc())
    )


def _archive_active(db: Session) -> None:
    """Setzt alle aktiven Runden auf ``archived`` (max. eine aktive Runde)."""
    for record in db.scalars(
        select(LabelAuditSessionRecord).where(LabelAuditSessionRecord.status == "active")
    ).all():
        record.status = "archived"


def create_session(
    db: Session, *, name: str, note: str | None, user_id: str | None
) -> LabelAuditSessionRecord:
    # Beim Start einer neuen Runde bestehende aktive Runden archivieren, damit
    # es höchstens eine laufende Prüfrunde gibt.
    _archive_active(db)
    record = LabelAuditSessionRecord(
        external_id=f"las-{uuid4().hex[:12]}",
        name=name,
        status="active",
        note=note,
        created_by_user_id=user_id,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def archive_session(db: Session, external_id: str) -> LabelAuditSessionRecord | None:
    record = get_session(db, external_id)
    if record is None:
        return None
    record.status = "archived"
    db.commit()
    db.refresh(record)
    return record


def add_scan(
    db: Session,
    *,
    session_id: int,
    scan_value: str,
    scan_kind: str,
    asset_id: str | None,
    asset_stable_key: str | None,
    asset_label: str | None,
    category: str | None,
    serial_number: str | None,
    tag_number: str | None,
    user_id: str | None,
) -> LabelAuditScanRecord:
    record = LabelAuditScanRecord(
        external_id=f"lac-{uuid4().hex[:12]}",
        session_id=session_id,
        scan_value=scan_value,
        scan_kind=scan_kind,
        asset_id=asset_id,
        asset_stable_key=asset_stable_key,
        asset_label=asset_label,
        category=category,
        serial_number=serial_number,
        tag_number=tag_number,
        scanned_by_user_id=user_id,
    )
    db.add(record)
    # Sicht-Update der Runde (updated_at) anstoßen, ohne Asset-Daten zu berühren.
    session = db.get(LabelAuditSessionRecord, session_id)
    if session is not None:
        session.updated_at = func.now()
    db.commit()
    db.refresh(record)
    return record


def get_recent_scans(db: Session, session_id: int, limit: int) -> list[LabelAuditScanRecord]:
    return list(
        db.scalars(
            select(LabelAuditScanRecord)
            .where(LabelAuditScanRecord.session_id == session_id)
            .order_by(LabelAuditScanRecord.scanned_at.desc(), LabelAuditScanRecord.id.desc())
            .limit(limit)
        ).all()
    )


def get_matched_stable_keys(db: Session, session_id: int) -> set[str]:
    rows = db.scalars(
        select(LabelAuditScanRecord.asset_stable_key)
        .where(LabelAuditScanRecord.session_id == session_id)
        .where(LabelAuditScanRecord.scan_kind == "matched")
        .where(LabelAuditScanRecord.asset_stable_key.is_not(None))
    ).all()
    return {value for value in rows if value}


def has_matched_stable_key(db: Session, session_id: int, stable_key: str) -> bool:
    return (
        db.scalar(
            select(LabelAuditScanRecord.id)
            .where(LabelAuditScanRecord.session_id == session_id)
            .where(LabelAuditScanRecord.scan_kind == "matched")
            .where(LabelAuditScanRecord.asset_stable_key == stable_key)
            .limit(1)
        )
        is not None
    )


def count_by_kind(db: Session, session_id: int) -> dict[str, int]:
    rows = db.execute(
        select(LabelAuditScanRecord.scan_kind, func.count())
        .where(LabelAuditScanRecord.session_id == session_id)
        .group_by(LabelAuditScanRecord.scan_kind)
    ).all()
    return {str(kind): int(count) for kind, count in rows}
