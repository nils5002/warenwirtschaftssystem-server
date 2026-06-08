from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database.session import get_db
from ..repositories import telecom_pass_repository
from ..routes.dependencies import (
    AccessContext,
    get_access_context,
    require_permission,
    require_roles,
)
from ..schemas.telecom_pass import (
    TelecomPassBookingItem,
    TelecomPassBookingPayload,
    TelecomPassBookingResult,
    TelecomPassCountCorrectionPayload,
    TelecomPassSettings,
    TelecomPassSettingsUpdatePayload,
)

logger = logging.getLogger("cloud_web.wms")

router = APIRouter(prefix="/api/wms", tags=["Telekompass"])


@router.get("/telecom-pass/settings", response_model=TelecomPassSettings)
def get_telecom_pass_settings(
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> TelecomPassSettings:
    # Jeder eingeloggte Nutzer darf den Preis lesen (Anzeige im Rückgabe-Dialog).
    _ = context
    return TelecomPassSettings(unitPrice=float(telecom_pass_repository.get_unit_price(db)))


@router.put("/telecom-pass/settings", response_model=TelecomPassSettings)
def update_telecom_pass_settings(
    payload: TelecomPassSettingsUpdatePayload,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> TelecomPassSettings:
    # Preis ändern: nur Admin/Techniker.
    require_roles(context, "admin")
    price = telecom_pass_repository.set_unit_price(db, payload.unitPrice)
    logger.info("Telekompass-Preis aktualisiert (user_id=%s, unitPrice=%s)", context.user_id, price)
    return TelecomPassSettings(unitPrice=float(price))


@router.post(
    "/assets/{asset_id}/telecom-pass-booking",
    response_model=TelecomPassBookingResult,
)
def record_telecom_pass_booking(
    asset_id: str,
    payload: TelecomPassBookingPayload,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> TelecomPassBookingResult:
    # Anzahl erfassen darf jede Rolle, die Ausgabe/Rücknahme nutzen darf.
    require_permission(context, db, "checkinout.use")
    asset, booking, duplicate = telecom_pass_repository.record_booking(
        db,
        asset_id,
        payload.quantity,
        idempotency_key=payload.idempotencyKey,
        planning_id=payload.planningId,
        actor_user_id=context.user_id,
    )
    return TelecomPassBookingResult(asset=asset, booking=booking, duplicate=duplicate)


@router.get(
    "/assets/{asset_id}/telecom-pass-bookings",
    response_model=list[TelecomPassBookingItem],
)
def list_telecom_pass_bookings(
    asset_id: str,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> list[TelecomPassBookingItem]:
    _ = context
    return telecom_pass_repository.list_bookings(db, asset_id)


@router.put(
    "/assets/{asset_id}/telecom-pass-count",
    response_model=TelecomPassBookingResult,
)
def correct_telecom_pass_count(
    asset_id: str,
    payload: TelecomPassCountCorrectionPayload,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> TelecomPassBookingResult:
    # Zähler-Korrektur: nur Admin/Techniker, klar als Korrektur protokolliert.
    require_roles(context, "admin")
    asset, booking = telecom_pass_repository.correct_count(
        db, asset_id, payload.total, actor_user_id=context.user_id
    )
    logger.info(
        "Telekompass-Zähler korrigiert (user_id=%s, asset_id=%s, total=%s)",
        context.user_id,
        asset_id,
        payload.total,
    )
    return TelecomPassBookingResult(asset=asset, booking=booking, duplicate=False)
