from __future__ import annotations

import secrets
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database.models import AssetRecord, SystemSettingRecord, TelecomPassBookingRecord
from ..domain.categories import normalize_category
from ..schemas.telecom_pass import TelecomPassBookingItem
from ..schemas.wms import AssetItem
from . import category_repository
from .wms_repository import _asset_to_schema

# Key der globalen Telekompass-Preis-Einstellung im Key/Value-Store.
TELECOM_PASS_UNIT_PRICE_KEY = "telecom_pass_unit_price"


# --- Key/Value-Systemeinstellungen -----------------------------------------

def _get_setting(db: Session, key: str) -> str | None:
    record = db.scalar(select(SystemSettingRecord).where(SystemSettingRecord.key == key))
    return record.value if record else None


def _set_setting(db: Session, key: str, value: str) -> None:
    record = db.scalar(select(SystemSettingRecord).where(SystemSettingRecord.key == key))
    if record:
        record.value = value
    else:
        db.add(SystemSettingRecord(key=key, value=value))


def _parse_decimal(raw: str | None) -> Decimal:
    """Liest einen gespeicherten Preis robust als Decimal (Default 0)."""
    if raw is None:
        return Decimal("0")
    text = raw.strip().replace(",", ".")
    if not text:
        return Decimal("0")
    try:
        value = Decimal(text)
    except (InvalidOperation, ValueError):
        return Decimal("0")
    return value if value >= 0 else Decimal("0")


def get_unit_price(db: Session) -> Decimal:
    return _parse_decimal(_get_setting(db, TELECOM_PASS_UNIT_PRICE_KEY))


def set_unit_price(db: Session, value: float | Decimal) -> Decimal:
    price = Decimal(str(value))
    if price < 0:
        raise HTTPException(status_code=400, detail="Preis darf nicht negativ sein.")
    # Auf 2 Nachkommastellen normalisieren und als String ablegen.
    normalized = price.quantize(Decimal("0.01"))
    _set_setting(db, TELECOM_PASS_UNIT_PRICE_KEY, str(normalized))
    db.commit()
    return normalized


# --- LTE-Router-Erkennung & Telekompass-Buchungen --------------------------

def is_lte_router(category: str | None) -> bool:
    """Robuste Erkennung über die kanonische Kategorienormalisierung."""
    return normalize_category(category) == "LTE-Router"


def _require_lte_router(record: AssetRecord) -> None:
    if not is_lte_router(record.category):
        raise HTTPException(
            status_code=400,
            detail="Telekompass-Erfassung ist nur für LTE-Router möglich.",
        )


def _booking_to_schema(record: TelecomPassBookingRecord) -> TelecomPassBookingItem:
    return TelecomPassBookingItem(
        id=record.external_id,
        assetId=record.asset_external_id,
        planningId=record.planning_id,
        quantity=record.quantity,
        unitPriceSnapshot=float(_parse_decimal(record.unit_price_snapshot)),
        totalPriceSnapshot=float(_parse_decimal(record.total_price_snapshot)),
        kind="correction" if record.kind == "correction" else "booking",
        createdAt=record.created_at.isoformat() if record.created_at else None,
        createdByUserId=record.created_by_user_id,
    )


def _asset_schema(db: Session, record: AssetRecord) -> AssetItem:
    return _asset_to_schema(record, category_repository.active_category_names(db))


def record_booking(
    db: Session,
    asset_id: str,
    quantity: int,
    *,
    idempotency_key: str | None = None,
    planning_id: str | None = None,
    actor_user_id: str | None = None,
) -> tuple[AssetItem, TelecomPassBookingItem | None, bool]:
    """Erhöht den Telekompass-Zähler eines LTE-Routers um ``quantity``.

    Schreibt einen Verlaufseintrag mit Preis-Snapshot. Liefert
    (Asset, Buchung, duplicate). Bei bereits bekanntem ``idempotency_key`` wird
    der Zähler NICHT erneut erhöht (duplicate=True). ``quantity`` == 0 schließt
    die Rückgabe ohne Buchung/Verlaufseintrag ab.
    """
    if quantity < 0:
        raise HTTPException(status_code=400, detail="Anzahl darf nicht negativ sein.")

    record = db.scalar(select(AssetRecord).where(AssetRecord.external_id == asset_id))
    if not record:
        raise HTTPException(status_code=404, detail="Asset nicht gefunden.")
    _require_lte_router(record)

    # Idempotenz: bereits verbuchter Schlüssel → keine erneute Erhöhung.
    if idempotency_key:
        existing = db.scalar(
            select(TelecomPassBookingRecord).where(
                TelecomPassBookingRecord.idempotency_key == idempotency_key
            )
        )
        if existing:
            return _asset_schema(db, record), _booking_to_schema(existing), True

    if quantity == 0:
        # Rückgabe ohne Telekompass — kein Verlaufseintrag, Zähler unverändert.
        return _asset_schema(db, record), None, False

    unit_price = get_unit_price(db)
    total_price = (unit_price * Decimal(quantity)).quantize(Decimal("0.01"))

    record.telecom_pass_booking_count_total = int(
        record.telecom_pass_booking_count_total or 0
    ) + quantity

    booking = TelecomPassBookingRecord(
        external_id=f"tpb-{secrets.token_hex(8)}",
        asset_external_id=record.external_id,
        planning_id=(planning_id or None),
        quantity=quantity,
        unit_price_snapshot=str(unit_price.quantize(Decimal("0.01"))),
        total_price_snapshot=str(total_price),
        kind="booking",
        idempotency_key=(idempotency_key or None),
        created_by_user_id=(actor_user_id or None),
    )
    db.add(booking)
    try:
        db.commit()
    except IntegrityError:
        # Race: paralleler Request mit gleichem idempotency_key war schneller.
        db.rollback()
        record = db.scalar(select(AssetRecord).where(AssetRecord.external_id == asset_id))
        existing = (
            db.scalar(
                select(TelecomPassBookingRecord).where(
                    TelecomPassBookingRecord.idempotency_key == idempotency_key
                )
            )
            if idempotency_key
            else None
        )
        booking_item = _booking_to_schema(existing) if existing else None
        return _asset_schema(db, record), booking_item, True

    db.refresh(record)
    db.refresh(booking)
    return _asset_schema(db, record), _booking_to_schema(booking), False


def correct_count(
    db: Session,
    asset_id: str,
    total: int,
    *,
    actor_user_id: str | None = None,
) -> tuple[AssetItem, TelecomPassBookingItem]:
    """Setzt den absoluten Telekompass-Zähler (Admin-Korrektur)."""
    if total < 0:
        raise HTTPException(status_code=400, detail="Anzahl darf nicht negativ sein.")
    record = db.scalar(select(AssetRecord).where(AssetRecord.external_id == asset_id))
    if not record:
        raise HTTPException(status_code=404, detail="Asset nicht gefunden.")
    _require_lte_router(record)

    previous = int(record.telecom_pass_booking_count_total or 0)
    delta = total - previous
    record.telecom_pass_booking_count_total = total
    unit_price = get_unit_price(db)
    booking = TelecomPassBookingRecord(
        external_id=f"tpb-{secrets.token_hex(8)}",
        asset_external_id=record.external_id,
        planning_id=None,
        quantity=delta,
        unit_price_snapshot=str(unit_price.quantize(Decimal("0.01"))),
        total_price_snapshot=str((unit_price * Decimal(delta)).quantize(Decimal("0.01"))),
        kind="correction",
        idempotency_key=None,
        created_by_user_id=(actor_user_id or None),
    )
    db.add(booking)
    db.commit()
    db.refresh(record)
    db.refresh(booking)
    return _asset_schema(db, record), _booking_to_schema(booking)


def list_bookings(db: Session, asset_id: str) -> list[TelecomPassBookingItem]:
    rows = db.scalars(
        select(TelecomPassBookingRecord)
        .where(TelecomPassBookingRecord.asset_external_id == asset_id)
        .order_by(TelecomPassBookingRecord.created_at.desc())
    ).all()
    return [_booking_to_schema(row) for row in rows]
