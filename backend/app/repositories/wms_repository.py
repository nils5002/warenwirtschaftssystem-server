from __future__ import annotations

import json
import secrets
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database.models import (
    ActivityRecord,
    AssetRecord,
    LocationRecord,
    MaintenanceRecord,
    ReservationRecord,
    UserRecord,
    PlanningRecord,
    PlanningDayRecord,
    PlanningItemRecord,
)
from ..domain.categories import normalize_category
from . import category_repository
from ..schemas.wms import (
    ActivityItem,
    AssetItem,
    LocationItem,
    MaintenanceItem,
    ReservationItem,
    UserItem,
    WmsOverviewResponse,
    PlanningSummaryItem,
    PlanningSummaryCategoryItem,
)
from ..services.auth_service import (
    generate_temporary_password,
    hash_password,
    normalize_role_for_db,
    role_to_app_role,
)


def _build_qr_code(asset_id: str, tag_number: str) -> str:
    return f"WMS|{asset_id}|{tag_number}"


def _normalize_asset_status(value: str | None) -> str:
    allowed = {
        "Verfuegbar",
        "Verliehen",
        "In Wartung",
        "Defekt",
        "Reserviert",
        "Ausgegeben",
        "Unterwegs",
        "Verloren",
    }
    if value in allowed:
        if value in {"Reserviert", "Ausgegeben", "Unterwegs"}:
            return "Verliehen"
        if value == "Verloren":
            return "Defekt"
        return value
    raw = (value or "").strip().lower()
    if raw in {"ok", "verfuegbar", "verfügbar", "frei", "available", "einsatzbereit"}:
        return "Verfuegbar"
    if "reserv" in raw or raw in {"ausgegeben", "entliehen", "in use", "checked out", "verliehen"}:
        return "Verliehen"
    if "unterwegs" in raw:
        return "Verliehen"
    if "wartung" in raw or "service" in raw:
        return "In Wartung"
    if "defekt" in raw or "kaputt" in raw or "verlor" in raw:
        return "Defekt"
    return "Verfuegbar"


def _normalize_user_role(value: str | None) -> str:
    return role_to_app_role(value)


def _normalize_user_role_for_db(value: str | None) -> str:
    return normalize_role_for_db(value)


def _normalize_user_status(value: str | None) -> str:
    raw = (value or "").strip().lower()
    if raw in {"aktiv", "active"}:
        return "Aktiv"
    if raw in {"wartet auf freigabe", "pending", "freigabe ausstehend"}:
        return "Wartet auf Freigabe"
    return "Inaktiv"


def _is_active_user(record: UserRecord) -> bool:
    return bool(record.is_active) and _normalize_user_status(record.status) == "Aktiv"


def _is_admin_user(record: UserRecord) -> bool:
    return _normalize_user_role_for_db(record.role) == "admin"


def _normalize_maintenance_status(value: str | None) -> str:
    raw = (value or "").strip().lower()
    if raw in {"offen", "open"}:
        return "Offen"
    if raw in {"in bearbeitung", "in arbeit", "wartet auf teile", "in progress"}:
        return "In Bearbeitung"
    if raw in {"erledigt", "abgeschlossen", "done", "closed"}:
        return "Erledigt"
    return "Offen"


def _extract_checkout_assignee_and_project(assigned_to: str | None) -> tuple[str | None, str | None]:
    raw = (assigned_to or "").strip()
    if not raw or raw == "-":
        return None, None
    parts = [part.strip() for part in raw.split("·") if part.strip()]
    if len(parts) >= 2:
        assignee = parts[0] if parts[0] != "-" else None
        return assignee, parts[-1]
    assignee = parts[0] if parts[0] != "-" else None
    return assignee, None


def _asset_to_schema(record: AssetRecord, known_categories: set[str] | None = None) -> AssetItem:
    qr_code = record.qr_code.strip() or _build_qr_code(record.external_id, record.tag_number)
    category = (
        category_repository.normalize_known_category(record.category, known_categories)
        if known_categories is not None
        else normalize_category(record.category)
    )
    return AssetItem(
        id=record.external_id,
        name=record.name,
        category=category,
        location=record.location,
        status=_normalize_asset_status(record.status),
        assignedTo=record.assigned_to,
        nextReturn=record.next_return,
        tagNumber=record.tag_number,
        serialNumber=record.serial_number,
        model=record.device_model,
        ipAddress=record.ip_address,
        macLan=record.mac_lan,
        macWlan=record.mac_wlan,
        qrCode=qr_code,
        maintenanceState=record.maintenance_state,
        notes=record.notes,
        lastCheckout=record.last_checkout,
        nextReservation=record.next_reservation,
        sourceFile=record.source_file,
    )


def _activity_to_schema(record: ActivityRecord) -> ActivityItem:
    return ActivityItem(
        id=record.external_id,
        title=record.title,
        detail=record.detail,
        timestamp=record.timestamp_text,
        assetId=record.asset_external_id,
    )


def _reservation_to_schema(record: ReservationRecord) -> ReservationItem:
    return ReservationItem(
        id=record.external_id,
        requestedBy=record.requested_by,
        team=record.team,
        period=record.period,
        assets=list(record.assets or []),
        status=record.status,
        location=record.location,
    )


def _maintenance_to_schema(record: MaintenanceRecord) -> MaintenanceItem:
    return MaintenanceItem(
        id=record.external_id,
        assetName=record.asset_name,
        issue=record.issue,
        reportedAt=record.reported_at,
        dueDate=record.due_date,
        priority=record.priority,
        status=_normalize_maintenance_status(record.status),
        comment=record.comment,
        location=record.location,
    )


def _location_to_schema(record: LocationRecord) -> LocationItem:
    return LocationItem(
        name=record.name,
        capacity=record.capacity,
        assignedAssets=record.assigned_assets,
        availableAssets=record.available_assets,
        manager=record.manager,
    )


def _user_to_schema(record: UserRecord) -> UserItem:
    normalized_status = _normalize_user_status(record.status)
    if record.is_active:
        status = "Aktiv"
    elif normalized_status == "Wartet auf Freigabe":
        status = "Wartet auf Freigabe"
    else:
        status = "Inaktiv"
    return UserItem(
        id=record.external_id,
        name=record.name,
        email=record.email,
        role=_normalize_user_role(record.role),
        lastActive=record.last_active,
        status=status,
        createdAt=record.created_at.strftime("%d.%m.%Y %H:%M") if record.created_at else None,
        department=record.department,
        location=record.location,
    )


def list_assets(db: Session) -> list[AssetItem]:
    stmt = select(AssetRecord).order_by(
        func.lower(AssetRecord.category).asc(),
        func.lower(AssetRecord.name).asc(),
        AssetRecord.external_id.asc(),
    )
    known_categories = category_repository.active_category_names(db)
    return [_asset_to_schema(item, known_categories) for item in db.scalars(stmt).all()]


def get_asset(db: Session, external_id: str) -> AssetItem | None:
    stmt = select(AssetRecord).where(AssetRecord.external_id == external_id)
    record = db.scalar(stmt)
    return _asset_to_schema(record, category_repository.active_category_names(db)) if record else None


def _find_asset_for_maintenance(db: Session, asset_name: str) -> AssetRecord | None:
    normalized_asset_name = asset_name.strip()
    if not normalized_asset_name:
        return None
    exact = db.scalar(select(AssetRecord).where(AssetRecord.name == normalized_asset_name))
    if exact:
        return exact
    assets = db.scalars(select(AssetRecord)).all()
    return next(
        (
            asset
            for asset in assets
            if asset.tag_number and asset.tag_number in normalized_asset_name
        ),
        None,
    )


def _maintenance_matches_asset(item: MaintenanceRecord, asset: AssetRecord) -> bool:
    return item.asset_name == asset.name or bool(asset.tag_number and asset.tag_number in item.asset_name)


def _sync_asset_maintenance_status(db: Session, maintenance: MaintenanceRecord) -> None:
    asset = _find_asset_for_maintenance(db, maintenance.asset_name)
    if not asset:
        return

    status = _normalize_maintenance_status(maintenance.status)
    if status == "Offen":
        asset.status = "Defekt"
        asset.maintenance_state = "Defekt gemeldet"
        return

    if status in {"In Bearbeitung", "In Arbeit", "Wartet auf Teile"}:
        asset.status = "In Wartung"
        asset.maintenance_state = "Reparatur in Bearbeitung"
        return

    if status not in {"Erledigt", "Abgeschlossen"}:
        return

    active_items = [
        item
        for item in db.scalars(select(MaintenanceRecord)).all()
        if item.external_id != maintenance.external_id
        and _maintenance_matches_asset(item, asset)
        and _normalize_maintenance_status(item.status) in {"Offen", "In Bearbeitung", "In Arbeit", "Wartet auf Teile"}
    ]
    active_statuses = {_normalize_maintenance_status(item.status) for item in active_items}
    if active_statuses & {"In Bearbeitung", "In Arbeit", "Wartet auf Teile"}:
        asset.status = "In Wartung"
        asset.maintenance_state = "Reparatur in Bearbeitung"
    elif active_statuses:
        asset.status = "Defekt"
        asset.maintenance_state = "Defekt gemeldet"
    elif _normalize_asset_status(asset.status) in {"Defekt", "In Wartung"}:
        asset.status = "Verfuegbar"
        asset.maintenance_state = "Wartung erledigt"


def upsert_asset(db: Session, item: AssetItem, *, actor_user_id: str | None = None) -> AssetItem:
    stmt = select(AssetRecord).where(AssetRecord.external_id == item.id)
    record = db.scalar(stmt)
    previous_status = _normalize_asset_status(record.status) if record else None
    payload = {
        "name": item.name,
        "category": category_repository.normalize_category_for_db(db, item.category),
        "location": item.location,
        "status": _normalize_asset_status(item.status),
        "assigned_to": item.assignedTo,
        "next_return": item.nextReturn,
        "tag_number": item.tagNumber,
        "serial_number": item.serialNumber,
        "device_model": item.model,
        "ip_address": item.ipAddress,
        "mac_lan": item.macLan,
        "mac_wlan": item.macWlan,
        "qr_code": item.qrCode or _build_qr_code(item.id, item.tagNumber),
        "maintenance_state": item.maintenanceState,
        "notes": item.notes,
        "last_checkout": item.lastCheckout,
        "next_reservation": item.nextReservation,
        "source_file": item.sourceFile,
    }
    if record:
        for key, value in payload.items():
            setattr(record, key, value)
    else:
        record = AssetRecord(external_id=item.id, **payload)
        db.add(record)
    next_status = _normalize_asset_status(payload["status"])
    if record and previous_status != next_status and previous_status in {"Verfuegbar", "Verliehen"} and next_status in {"Verfuegbar", "Verliehen"}:
        operator_user_id = None
        operator_name = None
        if isinstance(actor_user_id, str) and actor_user_id.strip():
            operator_user_id = actor_user_id.strip()
            operator_record = db.scalar(select(UserRecord).where(UserRecord.external_id == operator_user_id))
            if operator_record:
                operator_name = operator_record.name.strip() or None
                operator_email = operator_record.email.strip() or None
            else:
                operator_email = None
        else:
            operator_email = None
        if operator_name:
            operator_label = operator_name
        elif operator_email:
            operator_label = operator_email
        else:
            operator_label = "Unbekannter Benutzer"
        if previous_status == "Verfuegbar" and next_status == "Verliehen":
            title = "Checkout gebucht"
            assignee, project = _extract_checkout_assignee_and_project(payload["assigned_to"])
            if assignee and project:
                detail = (
                    f"{record.name} wurde an {assignee} für Projekt {project} ausgegeben. "
                    f"Ausgeführt durch: {operator_label}."
                )
            elif project:
                detail = (
                    f"{record.name} wurde für Projekt {project} ausgegeben. "
                    f"Ausgeführt durch: {operator_label}."
                )
            elif assignee:
                detail = f"{record.name} wurde an {assignee} ausgegeben. Ausgeführt durch: {operator_label}."
            else:
                detail = (
                    f"{record.name} wurde für Allgemeinen Einsatz ausgegeben. "
                    f"Ausgeführt durch: {operator_label}."
                )
        else:
            title = "Checkin gebucht"
            detail = f"{record.name} wurde zurückgenommen. Ausgeführt durch: {operator_label}."
        db.add(
            ActivityRecord(
                external_id=f"act-srv-{secrets.token_hex(8)}",
                title=title,
                detail=detail,
                timestamp_text=datetime.now(UTC).strftime("%d.%m.%Y %H:%M"),
                asset_external_id=record.external_id,
            )
        )
    db.commit()
    db.refresh(record)
    return _asset_to_schema(record, category_repository.active_category_names(db))


def delete_asset(db: Session, external_id: str) -> bool:
    stmt = select(AssetRecord).where(AssetRecord.external_id == external_id)
    record = db.scalar(stmt)
    if not record:
        return False
    db.delete(record)
    db.commit()
    return True


def list_activities(db: Session) -> list[ActivityItem]:
    stmt = select(ActivityRecord).order_by(ActivityRecord.created_at.desc())
    return [_activity_to_schema(item) for item in db.scalars(stmt).all()]


def upsert_activity(db: Session, item: ActivityItem) -> ActivityItem:
    stmt = select(ActivityRecord).where(ActivityRecord.external_id == item.id)
    record = db.scalar(stmt)
    payload = {
        "title": item.title,
        "detail": item.detail,
        "timestamp_text": item.timestamp,
        "asset_external_id": item.assetId,
    }
    if record:
        for key, value in payload.items():
            setattr(record, key, value)
    else:
        record = ActivityRecord(external_id=item.id, **payload)
        db.add(record)
    db.commit()
    db.refresh(record)
    return _activity_to_schema(record)


def delete_activity(db: Session, external_id: str) -> bool:
    stmt = select(ActivityRecord).where(ActivityRecord.external_id == external_id)
    record = db.scalar(stmt)
    if not record:
        return False
    db.delete(record)
    db.commit()
    return True


def list_reservations(db: Session) -> list[ReservationItem]:
    stmt = select(ReservationRecord).order_by(ReservationRecord.created_at.desc())
    return [_reservation_to_schema(item) for item in db.scalars(stmt).all()]


def upsert_reservation(db: Session, item: ReservationItem) -> ReservationItem:
    stmt = select(ReservationRecord).where(ReservationRecord.external_id == item.id)
    record = db.scalar(stmt)
    payload = {
        "requested_by": item.requestedBy,
        "team": item.team,
        "period": item.period,
        "assets": item.assets,
        "status": item.status,
        "location": item.location,
    }
    if record:
        for key, value in payload.items():
            setattr(record, key, value)
    else:
        record = ReservationRecord(external_id=item.id, **payload)
        db.add(record)
    db.commit()
    db.refresh(record)
    return _reservation_to_schema(record)


def delete_reservation(db: Session, external_id: str) -> bool:
    stmt = select(ReservationRecord).where(ReservationRecord.external_id == external_id)
    record = db.scalar(stmt)
    if not record:
        return False
    db.delete(record)
    db.commit()
    return True


def list_maintenance(db: Session) -> list[MaintenanceItem]:
    stmt = select(MaintenanceRecord).order_by(MaintenanceRecord.created_at.desc())
    return [_maintenance_to_schema(item) for item in db.scalars(stmt).all()]


def upsert_maintenance(db: Session, item: MaintenanceItem) -> MaintenanceItem:
    stmt = select(MaintenanceRecord).where(MaintenanceRecord.external_id == item.id)
    record = db.scalar(stmt)
    payload = {
        "asset_name": item.assetName,
        "issue": item.issue,
        "reported_at": item.reportedAt,
        "due_date": item.dueDate,
        "priority": item.priority,
        "status": _normalize_maintenance_status(item.status),
        "comment": item.comment,
        "location": item.location,
    }
    if record:
        for key, value in payload.items():
            setattr(record, key, value)
    else:
        record = MaintenanceRecord(external_id=item.id, **payload)
        db.add(record)
    db.flush()
    _sync_asset_maintenance_status(db, record)
    db.commit()
    db.refresh(record)
    return _maintenance_to_schema(record)


def delete_maintenance(db: Session, external_id: str) -> bool:
    stmt = select(MaintenanceRecord).where(MaintenanceRecord.external_id == external_id)
    record = db.scalar(stmt)
    if not record:
        return False
    db.delete(record)
    db.commit()
    return True


def list_locations(db: Session) -> list[LocationItem]:
    stmt = select(LocationRecord).order_by(LocationRecord.name.asc())
    return [_location_to_schema(item) for item in db.scalars(stmt).all()]


def upsert_location(db: Session, item: LocationItem) -> LocationItem:
    stmt = select(LocationRecord).where(LocationRecord.name == item.name)
    record = db.scalar(stmt)
    payload = {
        "capacity": item.capacity,
        "assigned_assets": item.assignedAssets,
        "available_assets": item.availableAssets,
        "manager": item.manager,
    }
    if record:
        for key, value in payload.items():
            setattr(record, key, value)
    else:
        record = LocationRecord(name=item.name, **payload)
        db.add(record)
    db.commit()
    db.refresh(record)
    return _location_to_schema(record)


def delete_location(db: Session, name: str) -> bool:
    stmt = select(LocationRecord).where(LocationRecord.name == name)
    record = db.scalar(stmt)
    if not record:
        return False
    db.delete(record)
    db.commit()
    return True


def list_users(db: Session) -> list[UserItem]:
    stmt = select(UserRecord).order_by(UserRecord.created_at.desc())
    records = db.scalars(stmt).all()
    return [_user_to_schema(item) for item in records]


def _assert_admin_integrity_on_update(
    db: Session,
    target: UserRecord,
    *,
    next_role: str,
    next_is_active: bool,
    actor_user_id: str | None,
) -> None:
    actor_id = (actor_user_id or "").strip()
    if actor_id and actor_id == target.external_id and not next_is_active:
        raise HTTPException(status_code=409, detail="Admin kann den eigenen Benutzer nicht deaktivieren.")

    currently_active_admin = _is_admin_user(target) and _is_active_user(target)
    remains_active_admin = next_role == "admin" and next_is_active
    if currently_active_admin and not remains_active_admin:
        active_admins = [
            user
            for user in db.scalars(select(UserRecord)).all()
            if _is_admin_user(user) and _is_active_user(user)
        ]
        if len(active_admins) <= 1:
            raise HTTPException(status_code=409, detail="Der letzte aktive Admin muss aktiv bleiben.")


def upsert_user(db: Session, item: UserItem, *, actor_user_id: str | None = None) -> UserItem:
    stmt = select(UserRecord).where(UserRecord.external_id == item.id)
    record = db.scalar(stmt)
    status = _normalize_user_status(item.status)
    next_is_active = status == "Aktiv"
    role_db = _normalize_user_role_for_db(item.role)
    payload = {
        "name": item.name,
        "email": item.email,
        "role": role_db,
        "last_active": item.lastActive,
        "status": status,
        "is_active": next_is_active,
        "department": item.department,
        "location": item.location,
    }
    if record:
        _assert_admin_integrity_on_update(
            db,
            record,
            next_role=role_db,
            next_is_active=next_is_active,
            actor_user_id=actor_user_id,
        )
        for key, value in payload.items():
            setattr(record, key, value)
    else:
        record = UserRecord(
            external_id=item.id,
            password_hash=hash_password(secrets.token_urlsafe(24)),
            **payload,
        )
        db.add(record)
    db.commit()
    db.refresh(record)
    return _user_to_schema(record)


def delete_user(db: Session, external_id: str, *, actor_user_id: str | None = None) -> bool:
    stmt = select(UserRecord).where(UserRecord.external_id == external_id)
    record = db.scalar(stmt)
    if not record:
        return False

    actor_id = (actor_user_id or "").strip()
    if actor_id and actor_id == external_id:
        raise HTTPException(status_code=409, detail="Admin kann den eigenen Benutzer nicht löschen.")

    if _is_admin_user(record):
        active_admins = [
            user
            for user in db.scalars(select(UserRecord)).all()
            if _is_admin_user(user) and _is_active_user(user)
        ]
        if len(active_admins) <= 1 and any(user.external_id == external_id for user in active_admins):
            raise HTTPException(status_code=409, detail="Der letzte aktive Admin kann nicht gelöscht werden.")

    db.delete(record)
    db.commit()
    return True


def update_user(
    db: Session,
    external_id: str,
    *,
    name: str | None = None,
    email: str | None = None,
    role: str | None = None,
    status: str | None = None,
    department: str | None = None,
    location: str | None = None,
    actor_user_id: str | None = None,
) -> UserItem:
    record = db.scalar(select(UserRecord).where(UserRecord.external_id == external_id))
    if not record:
        raise HTTPException(status_code=404, detail="Benutzer nicht gefunden.")

    next_role = _normalize_user_role_for_db(role or record.role)
    next_status = _normalize_user_status(status or record.status)
    next_is_active = next_status == "Aktiv"
    _assert_admin_integrity_on_update(
        db,
        record,
        next_role=next_role,
        next_is_active=next_is_active,
        actor_user_id=actor_user_id,
    )

    if name is not None:
        record.name = name.strip()
    if email is not None:
        record.email = email.strip().lower()
    if role is not None:
        record.role = next_role
    if status is not None:
        record.status = next_status
        record.is_active = next_is_active
    if department is not None:
        record.department = department.strip() or None
    if location is not None:
        record.location = location.strip() or None
    db.commit()
    db.refresh(record)
    return _user_to_schema(record)


def reset_user_password(
    db: Session,
    external_id: str,
    *,
    new_password: str | None = None,
    generate_temporary: bool = False,
) -> str | None:
    record = db.scalar(select(UserRecord).where(UserRecord.external_id == external_id))
    if not record:
        raise HTTPException(status_code=404, detail="Benutzer nicht gefunden.")

    temporary_password: str | None = None
    if generate_temporary or not new_password:
        temporary_password = generate_temporary_password()
        record.password_hash = hash_password(temporary_password)
    else:
        password = new_password.strip()
        if len(password) < 8:
            raise HTTPException(status_code=400, detail="Passwort muss mindestens 8 Zeichen lang sein.")
        record.password_hash = hash_password(password)
    db.commit()
    return temporary_password


def get_overview(db: Session) -> WmsOverviewResponse:
    return WmsOverviewResponse(
        assets=list_assets(db),
        activities=list_activities(db),
        reservations=list_reservations(db),
        maintenanceItems=list_maintenance(db),
        locations=list_locations(db),
        categories=category_repository.list_categories(db),
        users=list_users(db),
        planningSummary=_build_planning_summary(db),
    )


def _build_planning_summary(db: Session) -> PlanningSummaryItem:
    planning_statuses = ("Entwurf", "Geplant", "Bestaetigt")
    today = date.today()
    upcoming_end = today + timedelta(days=7)

    planning_rows = db.scalars(
        select(PlanningRecord)
        .where(PlanningRecord.status.in_(planning_statuses))
        .where(PlanningRecord.end_date >= today)
    ).all()
    if not planning_rows:
        return PlanningSummaryItem(
            todayPlannedQty=0,
            todayShortageCount=0,
            todayShortageItems=[],
            upcomingPlannedQty=0,
            upcomingShortageCount=0,
            categorySummaries=[],
        )

    planning_ids = [row.id for row in planning_rows]
    day_rows = db.scalars(
        select(PlanningDayRecord).where(PlanningDayRecord.planning_id.in_(planning_ids))
    ).all()
    if not day_rows:
        return PlanningSummaryItem(
            todayPlannedQty=0,
            todayShortageCount=0,
            todayShortageItems=[],
            upcomingPlannedQty=0,
            upcomingShortageCount=0,
            categorySummaries=[],
        )
    day_by_id = {row.id: row for row in day_rows}
    item_rows = db.scalars(
        select(PlanningItemRecord).where(PlanningItemRecord.planning_day_id.in_(tuple(day_by_id.keys())))
    ).all()
    if not item_rows:
        return PlanningSummaryItem(
            todayPlannedQty=0,
            todayShortageCount=0,
            todayShortageItems=[],
            upcomingPlannedQty=0,
            upcomingShortageCount=0,
            categorySummaries=[],
        )

    usable_by_category: dict[str, int] = defaultdict(int)
    for asset in db.scalars(select(AssetRecord)).all():
        category = category_repository.normalize_category_for_db(db, asset.category)
        if _normalize_asset_status(asset.status) == "Verfuegbar":
            usable_by_category[category] += 1

    demand_today: dict[str, int] = defaultdict(int)
    demand_upcoming: dict[str, int] = defaultdict(int)
    explicit_qty_map: dict[tuple[int, date, str], int] = defaultdict(int)
    max_qty_map: dict[tuple[int, str], int] = defaultdict(int)
    categories_by_planning_id: dict[int, set[str]] = defaultdict(set)

    for item in item_rows:
        day = day_by_id.get(item.planning_day_id)
        if day is None:
            continue
        category = category_repository.normalize_category_for_db(db, item.category_key)
        qty = int(item.qty or 0)
        planning_id = int(day.planning_id)
        key = (planning_id, day.planning_date, category)
        explicit_qty_map[key] += qty
        max_qty_map[(planning_id, category)] = max(max_qty_map[(planning_id, category)], explicit_qty_map[key])
        categories_by_planning_id[planning_id].add(category)

    def period_end_exclusive(start_date: date, end_date: date) -> date:
        if end_date > start_date:
            return end_date
        return start_date + timedelta(days=1)

    def iter_bound_dates(start_date: date, end_date: date) -> list[date]:
        dates: list[date] = []
        cursor = start_date
        end_exclusive = period_end_exclusive(start_date, end_date)
        while cursor < end_exclusive:
            dates.append(cursor)
            cursor += timedelta(days=1)
        return dates

    for planning in planning_rows:
        bound_dates = [day for day in iter_bound_dates(planning.start_date, planning.end_date) if today <= day <= upcoming_end]
        if not bound_dates:
            continue
        for category in categories_by_planning_id.get(planning.id, set()):
            default_qty = int(max_qty_map.get((planning.id, category), 0))
            if default_qty <= 0:
                continue
            for planning_date in bound_dates:
                planned_qty = int(explicit_qty_map.get((planning.id, planning_date, category), default_qty))
                if planned_qty <= 0:
                    continue
                demand_upcoming[category] += planned_qty
                if planning_date == today:
                    demand_today[category] += planned_qty

    category_keys = sorted(set(demand_today) | set(demand_upcoming))
    category_summaries: list[PlanningSummaryCategoryItem] = []
    today_shortage_items: list[PlanningSummaryCategoryItem] = []
    for category in category_keys:
        usable = usable_by_category.get(category, 0)
        planned_today = demand_today.get(category, 0)
        remaining_today = usable - planned_today
        shortage_today = max(0, planned_today - usable)
        item = PlanningSummaryCategoryItem(
            categoryKey=category,
            usableStock=usable,
            plannedQtyToday=planned_today,
            remainingAfterPlanning=remaining_today,
            shortageQty=shortage_today,
        )
        category_summaries.append(item)
        if shortage_today > 0:
            today_shortage_items.append(item)

    upcoming_shortage_count = 0
    for category, planned_qty in demand_upcoming.items():
        usable = usable_by_category.get(category, 0)
        if planned_qty > usable:
            upcoming_shortage_count += 1

    return PlanningSummaryItem(
        todayPlannedQty=sum(demand_today.values()),
        todayShortageCount=len(today_shortage_items),
        todayShortageItems=today_shortage_items,
        upcomingPlannedQty=sum(demand_upcoming.values()),
        upcomingShortageCount=upcoming_shortage_count,
        categorySummaries=category_summaries,
    )


def has_wms_data(db: Session) -> bool:
    return db.scalar(select(AssetRecord.id).limit(1)) is not None


def _map_legacy_user_role(value: str | None) -> str:
    raw = (value or "").strip().lower()
    if raw in {"admin", "administrator"}:
        return "Admin"
    if raw in {"projektmanager", "project manager", "projectmanager"}:
        return "Projektmanager"
    if raw in {"lager / logistik", "lager/logistik", "mitarbeiter", "employee"}:
        return "Mitarbeiter"
    return "Mitarbeiter"


def seed_from_legacy_json(db: Session, legacy_path: Path) -> dict[str, int]:
    if not legacy_path.exists():
        return {"created": 0}
    payload = json.loads(legacy_path.read_text(encoding="utf-8"))
    users_payload = payload.get("users")
    if isinstance(users_payload, list):
        for user in users_payload:
            if isinstance(user, dict):
                user["role"] = _map_legacy_user_role(user.get("role"))

    skipped_users = 0
    try:
        overview = WmsOverviewResponse.model_validate(payload)
    except ValidationError:
        fallback_payload = dict(payload)
        fallback_payload["users"] = []
        overview = WmsOverviewResponse.model_validate(fallback_payload)

    created = 0
    for item in overview.assets:
        upsert_asset(db, item)
        created += 1
    for item in overview.activities:
        upsert_activity(db, item)
        created += 1
    for item in overview.reservations:
        upsert_reservation(db, item)
        created += 1
    for item in overview.maintenanceItems:
        upsert_maintenance(db, item)
        created += 1
    for item in overview.locations:
        upsert_location(db, item)
        created += 1
    for raw_user in users_payload or []:
        if not isinstance(raw_user, dict):
            skipped_users += 1
            continue
        try:
            item = UserItem.model_validate(raw_user)
            upsert_user(db, item)
            created += 1
        except ValidationError:
            skipped_users += 1
            continue
    if skipped_users > 0:
        # Seed should stay startup-safe even with malformed legacy user records.
        pass
    return {"created": created}
