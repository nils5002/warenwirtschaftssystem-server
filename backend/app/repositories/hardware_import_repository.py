from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database.models import HardwareImportRowErrorRecord, HardwareImportRunRecord


def create_run(db: Session, import_path: str, files_total: int) -> HardwareImportRunRecord:
    run = HardwareImportRunRecord(
        status="running",
        import_path=import_path,
        files_total=files_total,
        files_processed=0,
        rows_total=0,
        created_count=0,
        updated_count=0,
        skipped_count=0,
        error_count=0,
        details_json={},
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def append_error(
    db: Session,
    run_id: int,
    *,
    file_name: str,
    sheet_name: str,
    row_number: int,
    serial_number: str | None,
    reason: str,
    raw_data: dict[str, Any] | None,
) -> HardwareImportRowErrorRecord:
    record = HardwareImportRowErrorRecord(
        run_id=run_id,
        file_name=file_name,
        sheet_name=sheet_name,
        row_number=row_number,
        serial_number=serial_number,
        reason=reason,
        raw_data=raw_data or {},
    )
    db.add(record)
    db.flush()
    return record


def finalize_run(
    db: Session,
    run: HardwareImportRunRecord,
    *,
    status: str,
    files_processed: int,
    rows_total: int,
    created_count: int,
    updated_count: int,
    skipped_count: int,
    error_count: int,
    details: dict[str, Any],
) -> HardwareImportRunRecord:
    run.status = status
    run.files_processed = files_processed
    run.rows_total = rows_total
    run.created_count = created_count
    run.updated_count = updated_count
    run.skipped_count = skipped_count
    run.error_count = error_count
    run.details_json = details
    run.finished_at = datetime.now(timezone.utc)
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def get_run(db: Session, run_id: int) -> HardwareImportRunRecord | None:
    return db.get(HardwareImportRunRecord, run_id)


def list_errors(
    db: Session,
    run_id: int,
    limit: int = 200,
) -> list[HardwareImportRowErrorRecord]:
    stmt = (
        select(HardwareImportRowErrorRecord)
        .where(HardwareImportRowErrorRecord.run_id == run_id)
        .order_by(HardwareImportRowErrorRecord.id.asc())
        .limit(limit)
    )
    return list(db.scalars(stmt).all())

