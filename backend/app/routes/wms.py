from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database.session import get_db
from ..routes.dependencies import AccessContext, get_access_context, require_roles
from ..schemas.wms import (
    ActivityItem,
    AssetItem,
    AssetMarkReturnedPayload,
    BulkUserDeletePayload,
    BulkUserDeleteResponse,
    CategoryCreatePayload,
    CategoryItem,
    ExternalPoolCreatePayload,
    ExternalPoolCreateResponse,
    LocationItem,
    MaintenanceItem,
    ReservationItem,
    UserPasswordResetPayload,
    UserPasswordResetResponse,
    UserUpdatePayload,
    UserItem,
    WmsOverviewResponse,
)
from ..services.wms_service import WmsService

router = APIRouter(prefix="/api/wms", tags=["WMS"])


@router.get("/overview", response_model=WmsOverviewResponse)
def wms_overview(
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> WmsOverviewResponse:
    _ = context
    return WmsService.overview(db)


@router.get("/assets", response_model=list[AssetItem])
def list_assets(
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> list[AssetItem]:
    _ = context
    return WmsService.list_assets(db)


@router.get("/assets/{asset_id}", response_model=AssetItem)
def get_asset(
    asset_id: str,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> AssetItem:
    _ = context
    item = WmsService.get_asset(db, asset_id)
    if not item:
        raise HTTPException(status_code=404, detail="Asset nicht gefunden")
    return item


def _movement_only_allowed(previous: AssetItem | None, next_item: AssetItem) -> bool:
    if previous is None:
        return False
    transition = (previous.status, next_item.status)
    if transition not in {("Verfuegbar", "Verliehen"), ("Verliehen", "Verfuegbar")}:
        return False
    immutable_fields = [
        "id",
        "name",
        "category",
        "location",
        "tagNumber",
        "serialNumber",
        "model",
        "ipAddress",
        "macLan",
        "macWlan",
        "sourceFile",
        "maintenanceState",
    ]
    for field in immutable_fields:
        if getattr(previous, field) != getattr(next_item, field):
            return False
    return True


def _is_external_asset_edit(previous: AssetItem | None, next_item: AssetItem) -> bool:
    """True, wenn Vorzustand UND Zielzustand Fremdbestand sind.

    Damit dürfen Projektmanager Fremdbestand-Metadaten (sourceName, Daten,
    externalNote etc.) korrigieren, ohne dass das Verfuegbar↔Verliehen-Gate
    (``_movement_only_allowed``) sie blockiert. Eigenbestand bleibt für PMs
    weiterhin ausschließlich auf reine Status-Flips beschränkt.
    """
    if previous is None or next_item is None:
        return False
    fremdbestand = {"rented", "borrowed", "external"}
    return (previous.ownershipType in fremdbestand) and (next_item.ownershipType in fremdbestand)


@router.post("/assets", response_model=AssetItem)
def upsert_asset(
    asset: AssetItem,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> AssetItem:
    if context.role in {"mitarbeiter", "projektmanager"}:
        existing = WmsService.get_asset(db, asset.id)
        movement_ok = _movement_only_allowed(existing, asset)
        # Projektmanager dürfen zusätzlich Fremdbestand-Felder pflegen.
        external_edit_ok = (
            context.role == "projektmanager" and _is_external_asset_edit(existing, asset)
        )
        if not (movement_ok or external_edit_ok):
            raise HTTPException(
                status_code=403,
                detail="Nur Ausgabe/Rückgabe-Statuswechsel sind in dieser Rolle erlaubt.",
            )
    return WmsService.upsert_asset(db, asset, actor_user_id=context.user_id)


@router.delete("/assets/{asset_id}")
def delete_asset(
    asset_id: str,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> dict[str, bool]:
    require_roles(context, "admin")
    return {"deleted": WmsService.delete_asset(db, asset_id)}


@router.post("/assets/external-pool", response_model=ExternalPoolCreateResponse)
def create_external_pool(
    payload: ExternalPoolCreatePayload,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> ExternalPoolCreateResponse:
    """Legt mehrere Fremdbestand-Geräte (Miet-/Leih-/Externe Geräte) an.

    Erlaubt für Admin/Techniker (intern auf admin gemappt) UND Projektmanager,
    da Fremdbestand fachlich Teil der Projektplanung ist und PMs eigenständig
    Mietgeräte für ihre Projekte einbuchen können müssen. Mitarbeiter/Junior
    bleiben ausgeschlossen. Die erzeugten Assets nutzen den vorhandenen
    Inventar-/QR-/Checkout-Pfad — es entsteht kein paralleles Modell.
    """
    require_roles(context, "admin", "projektmanager")
    created_ids = WmsService.create_external_pool(db, payload)
    return ExternalPoolCreateResponse(createdAssetIds=created_ids)


@router.post("/assets/{asset_id}/mark-returned", response_model=AssetItem)
def mark_asset_returned(
    asset_id: str,
    payload: AssetMarkReturnedPayload | None = None,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> AssetItem:
    """Markiert ein Fremdbestand-Gerät als zurückgegeben.

    Erlaubt für Admin/Techniker UND Projektmanager — PMs verwalten den von
    ihnen angelegten Fremdbestand auch wieder zurück. Schlägt weiterhin fehl,
    wenn das Gerät aktuell verliehen ist.
    """
    require_roles(context, "admin", "projektmanager")
    returned_at = payload.returnedAt if payload else None
    return WmsService.mark_asset_returned(db, asset_id, returned_at=returned_at)


@router.get("/reservations", response_model=list[ReservationItem])
def list_reservations(
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> list[ReservationItem]:
    _ = context
    return WmsService.list_reservations(db)


@router.post("/reservations", response_model=ReservationItem)
def upsert_reservation(
    reservation: ReservationItem,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> ReservationItem:
    require_roles(context, "admin", "projektmanager")
    return WmsService.upsert_reservation(db, reservation)


@router.delete("/reservations/{reservation_id}")
def delete_reservation(
    reservation_id: str,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> dict[str, bool]:
    require_roles(context, "admin", "projektmanager")
    return {"deleted": WmsService.delete_reservation(db, reservation_id)}


@router.get("/maintenance", response_model=list[MaintenanceItem])
def list_maintenance(
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> list[MaintenanceItem]:
    _ = context
    return WmsService.list_maintenance(db)


@router.post("/maintenance", response_model=MaintenanceItem)
def upsert_maintenance(
    maintenance: MaintenanceItem,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> MaintenanceItem:
    if context.role == "mitarbeiter":
        maintenance.status = "Offen"
    elif context.role not in {"admin", "projektmanager"}:
        raise HTTPException(status_code=403, detail="Keine Berechtigung für Wartungsaktionen.")
    return WmsService.upsert_maintenance(db, maintenance)


@router.delete("/maintenance/{maintenance_id}")
def delete_maintenance(
    maintenance_id: str,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> dict[str, bool]:
    require_roles(context, "admin")
    return {"deleted": WmsService.delete_maintenance(db, maintenance_id)}


@router.get("/locations", response_model=list[LocationItem])
def list_locations(
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> list[LocationItem]:
    _ = context
    return WmsService.list_locations(db)


@router.get("/categories", response_model=list[CategoryItem])
def list_categories(
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> list[CategoryItem]:
    _ = context
    return WmsService.list_categories(db)


@router.post("/categories", response_model=CategoryItem)
def create_category(
    payload: CategoryCreatePayload,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> CategoryItem:
    require_roles(context, "admin")
    return WmsService.create_category(db, payload.name)


@router.post("/locations", response_model=LocationItem)
def upsert_location(
    location: LocationItem,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> LocationItem:
    require_roles(context, "admin")
    return WmsService.upsert_location(db, location)


@router.delete("/locations/{name}")
def delete_location(
    name: str,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> dict[str, bool]:
    require_roles(context, "admin")
    return {"deleted": WmsService.delete_location(db, name)}


@router.get("/users", response_model=list[UserItem])
def list_users(
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> list[UserItem]:
    require_roles(context, "admin")
    return WmsService.list_users(db)


@router.post("/users", response_model=UserItem)
def upsert_user(
    user: UserItem,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> UserItem:
    require_roles(context, "admin")
    return WmsService.upsert_user(db, user)


@router.patch("/users/{user_id}", response_model=UserItem)
def update_user(
    user_id: str,
    payload: UserUpdatePayload,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> UserItem:
    require_roles(context, "admin")
    return WmsService.update_user(db, user_id, payload, actor_user_id=context.user_id)


@router.post("/users/{user_id}/reset-password", response_model=UserPasswordResetResponse)
def reset_user_password(
    user_id: str,
    payload: UserPasswordResetPayload,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> UserPasswordResetResponse:
    require_roles(context, "admin")
    return WmsService.reset_user_password(
        db,
        user_id,
        new_password=payload.newPassword,
        generate_temporary=payload.generateTemporary,
    )


@router.post("/users/bulk-delete", response_model=BulkUserDeleteResponse)
def bulk_delete_users(
    payload: BulkUserDeletePayload,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> BulkUserDeleteResponse:
    require_roles(context, "admin")
    return WmsService.bulk_delete_users(db, payload.userIds, actor_user_id=context.user_id)


@router.delete("/users/{user_id}")
def delete_user(
    user_id: str,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> dict[str, bool]:
    require_roles(context, "admin")
    return {"deleted": WmsService.delete_user(db, user_id, actor_user_id=context.user_id)}


@router.get("/activities", response_model=list[ActivityItem])
def list_activities(
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> list[ActivityItem]:
    _ = context
    return WmsService.list_activities(db)


@router.post("/activities", response_model=ActivityItem)
def upsert_activity(
    activity: ActivityItem,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> ActivityItem:
    _ = context
    return WmsService.upsert_activity(db, activity)


@router.delete("/activities/{activity_id}")
def delete_activity(
    activity_id: str,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> dict[str, bool]:
    require_roles(context, "admin")
    return {"deleted": WmsService.delete_activity(db, activity_id)}
