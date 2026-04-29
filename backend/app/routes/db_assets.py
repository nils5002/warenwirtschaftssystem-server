from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database.session import get_db
from ..repositories import asset_repository
from ..schemas.asset import AssetCreate, AssetRead, AssetUpdate

router = APIRouter(prefix="/api/db/assets", tags=["DB Assets"])


@router.get("", response_model=list[AssetRead])
def list_db_assets(db: Session = Depends(get_db)) -> list[AssetRead]:
    return asset_repository.list_assets(db)


@router.get("/{asset_id}", response_model=AssetRead)
def get_db_asset(asset_id: int, db: Session = Depends(get_db)) -> AssetRead:
    item = asset_repository.get_asset(db, asset_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    return item


@router.post("", response_model=AssetRead, status_code=status.HTTP_201_CREATED)
def create_db_asset(payload: AssetCreate, db: Session = Depends(get_db)) -> AssetRead:
    try:
        return asset_repository.create_asset(db, payload)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Asset violates a unique constraint (tag_number/serial_number/external_id).",
        ) from exc


@router.put("/{asset_id}", response_model=AssetRead)
def update_db_asset(
    asset_id: int,
    payload: AssetUpdate,
    db: Session = Depends(get_db),
) -> AssetRead:
    item = asset_repository.get_asset(db, asset_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    try:
        return asset_repository.update_asset(db, item, payload)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Asset violates a unique constraint.",
        ) from exc


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_db_asset(asset_id: int, db: Session = Depends(get_db)) -> None:
    item = asset_repository.get_asset(db, asset_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    asset_repository.delete_asset(db, item)
