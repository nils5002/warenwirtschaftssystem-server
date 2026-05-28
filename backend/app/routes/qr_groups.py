"""Endpoints für Sammel-QR (Gruppen-QR über vorhandene Fremdbestand-Assets).

Eine Gruppe referenziert nur vorhandene Asset-IDs und erzeugt keinen eigenen
Bestand. Gebucht wird über den bestehenden Ausgabe-/Rücknahme-Pfad
(``wms_repository.upsert_asset``), daher entsteht keine doppelte Zählung in der
Einsatzplanung.

Rollen-/Rechte-Gate (das Route-Gate ``_movement_only_allowed`` aus routes/wms.py
greift hier NICHT, daher hier explizit absichern):
  - Erstellen / Deaktivieren: Admin/Techniker + Projektmanager.
  - Auflösen (Scan) / Buchen: Recht ``checkinout.use`` (inkl. Mitarbeiter) —
    mobiler Feldeinsatz.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database.session import get_db
from ..repositories import qr_group_repository
from ..routes.dependencies import (
    AccessContext,
    get_access_context,
    require_permission,
    require_roles,
)
from ..schemas.wms import (
    QrGroupBookingResult,
    QrGroupCheckinPayload,
    QrGroupCheckoutPayload,
    QrGroupCreatePayload,
    QrGroupItem,
    QrGroupResolveResponse,
)

router = APIRouter(prefix="/api/wms/qr-groups", tags=["WMS Sammel-QR"])


@router.get("", response_model=list[QrGroupItem])
def list_groups(
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> list[QrGroupItem]:
    require_permission(context, db, "checkinout.use")
    return qr_group_repository.list_groups(db)


@router.post("", response_model=QrGroupItem)
def create_group(
    payload: QrGroupCreatePayload,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> QrGroupItem:
    require_roles(context, "admin", "projektmanager")
    return qr_group_repository.create_group(db, payload, actor_user_id=context.user_id)


@router.get("/resolve/{token}", response_model=QrGroupResolveResponse)
def resolve_group(
    token: str,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> QrGroupResolveResponse:
    require_permission(context, db, "checkinout.use")
    return QrGroupResolveResponse(group=qr_group_repository.resolve_by_token(db, token))


@router.post("/{external_id}/checkout", response_model=QrGroupBookingResult)
def checkout_group(
    external_id: str,
    payload: QrGroupCheckoutPayload,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> QrGroupBookingResult:
    require_permission(context, db, "checkinout.use")
    return qr_group_repository.bulk_checkout(
        db, external_id, payload, actor_user_id=context.user_id
    )


@router.post("/{external_id}/checkin", response_model=QrGroupBookingResult)
def checkin_group(
    external_id: str,
    payload: QrGroupCheckinPayload,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> QrGroupBookingResult:
    require_permission(context, db, "checkinout.use")
    return qr_group_repository.bulk_checkin(
        db, external_id, payload, actor_user_id=context.user_id
    )


@router.post("/{external_id}/deactivate", response_model=QrGroupItem)
def deactivate_group(
    external_id: str,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> QrGroupItem:
    require_roles(context, "admin", "projektmanager")
    return qr_group_repository.deactivate_group(db, external_id)
