from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database.models import AssetRecord
from ..schemas.asset import AssetCreate, AssetUpdate


def list_assets(db: Session) -> list[AssetRecord]:
    stmt = select(AssetRecord).order_by(AssetRecord.created_at.desc())
    return list(db.scalars(stmt).all())


def get_asset(db: Session, asset_id: int) -> AssetRecord | None:
    return db.get(AssetRecord, asset_id)


def create_asset(db: Session, payload: AssetCreate) -> AssetRecord:
    data = payload.model_dump()
    data["external_id"] = data.get("external_id") or f"asset-{uuid.uuid4().hex[:8]}"
    record = AssetRecord(**data)
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def update_asset(db: Session, record: AssetRecord, payload: AssetUpdate) -> AssetRecord:
    patch = payload.model_dump(exclude_unset=True)
    for field, value in patch.items():
        setattr(record, field, value)
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def delete_asset(db: Session, record: AssetRecord) -> None:
    db.delete(record)
    db.commit()
