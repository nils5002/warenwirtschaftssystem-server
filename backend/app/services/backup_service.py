from __future__ import annotations

from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database.models import (
    ActivityRecord,
    AssetRecord,
    CategoryRecord,
    LocationRecord,
    MaintenanceRecord,
    PlanningDayRecord,
    PlanningItemRecord,
    PlanningRecord,
    ReservationRecord,
    UserRecord,
)
from ..schemas.backup import BackupImportResponse, WarehouseBackupPayload
from .auth_service import hash_password


def export_backup(db: Session) -> WarehouseBackupPayload:
    categories = db.scalars(select(CategoryRecord).order_by(CategoryRecord.name.asc())).all()
    users = db.scalars(select(UserRecord).order_by(UserRecord.external_id.asc())).all()
    assets = db.scalars(select(AssetRecord).order_by(AssetRecord.external_id.asc())).all()
    activities = db.scalars(select(ActivityRecord).order_by(ActivityRecord.created_at.asc())).all()
    reservations = db.scalars(select(ReservationRecord).order_by(ReservationRecord.created_at.asc())).all()
    maintenance_items = db.scalars(select(MaintenanceRecord).order_by(MaintenanceRecord.created_at.asc())).all()
    locations = db.scalars(select(LocationRecord).order_by(LocationRecord.name.asc())).all()
    plannings = db.scalars(select(PlanningRecord).order_by(PlanningRecord.created_at.asc())).all()

    planning_days = db.scalars(select(PlanningDayRecord).order_by(PlanningDayRecord.planning_date.asc())).all()
    day_map: dict[int, list[PlanningDayRecord]] = {}
    for day in planning_days:
        day_map.setdefault(day.planning_id, []).append(day)

    planning_items = db.scalars(select(PlanningItemRecord).order_by(PlanningItemRecord.id.asc())).all()
    item_map: dict[int, list[PlanningItemRecord]] = {}
    for item in planning_items:
        item_map.setdefault(item.planning_day_id, []).append(item)

    return WarehouseBackupPayload.model_validate(
        {
            "version": 1,
            "exportedAt": datetime.now(UTC),
            "categories": [
                {
                    "name": item.name,
                    "normalizedName": item.normalized_name,
                    "isStandard": item.is_standard,
                    "isActive": item.is_active,
                }
                for item in categories
            ],
            "users": [
                {
                    "id": item.external_id,
                    "name": item.name,
                    "email": item.email,
                    "role": item.role,
                    "lastActive": item.last_active,
                    "status": item.status,
                    "department": item.department,
                    "location": item.location,
                    "passwordHash": item.password_hash,
                }
                for item in users
            ],
            "assets": [
                {
                    "id": item.external_id,
                    "name": item.name,
                    "category": item.category,
                    "location": item.location,
                    "status": item.status,
                    "assignedTo": item.assigned_to,
                    "nextReturn": item.next_return,
                    "tagNumber": item.tag_number,
                    "serialNumber": item.serial_number,
                    "model": item.device_model,
                    "ipAddress": item.ip_address,
                    "macLan": item.mac_lan,
                    "macWlan": item.mac_wlan,
                    "qrCode": item.qr_code,
                    "maintenanceState": item.maintenance_state,
                    "notes": item.notes,
                    "lastCheckout": item.last_checkout,
                    "nextReservation": item.next_reservation,
                    "sourceFile": item.source_file,
                }
                for item in assets
            ],
            "activities": [
                {
                    "id": item.external_id,
                    "title": item.title,
                    "detail": item.detail,
                    "timestamp": item.timestamp_text,
                    "assetId": item.asset_external_id,
                }
                for item in activities
            ],
            "reservations": [
                {
                    "id": item.external_id,
                    "requestedBy": item.requested_by,
                    "team": item.team,
                    "period": item.period,
                    "assets": list(item.assets or []),
                    "status": item.status,
                    "location": item.location,
                }
                for item in reservations
            ],
            "maintenanceItems": [
                {
                    "id": item.external_id,
                    "assetName": item.asset_name,
                    "issue": item.issue,
                    "reportedAt": item.reported_at,
                    "dueDate": item.due_date,
                    "priority": item.priority,
                    "status": item.status,
                    "comment": item.comment,
                    "location": item.location,
                }
                for item in maintenance_items
            ],
            "locations": [
                {
                    "name": item.name,
                    "capacity": item.capacity,
                    "assignedAssets": item.assigned_assets,
                    "availableAssets": item.available_assets,
                    "manager": item.manager,
                }
                for item in locations
            ],
            "plannings": [
                {
                    "id": planning.external_id,
                    "customerName": planning.customer_name,
                    "projectName": planning.project_name,
                    "eventName": planning.event_name,
                    "projectManagerUserId": planning.project_manager_user_id,
                    "calendarWeek": planning.calendar_week,
                    "startDate": planning.start_date,
                    "endDate": planning.end_date,
                    "notes": planning.notes,
                    "status": planning.status,
                    "templateSourcePlanningId": planning.template_source_planning_id,
                    "days": [
                        {
                            "planningDate": day.planning_date,
                            "weekday": day.weekday,
                            "items": [
                                {
                                    "categoryKey": detail.category_key,
                                    "qty": detail.qty,
                                    "notes": detail.notes,
                                    "handoverEnabled": bool(detail.handover_enabled),
                                    "linkedPlanningId": detail.linked_planning_external_id,
                                    "handoverNote": detail.handover_note,
                                }
                                for detail in item_map.get(day.id, [])
                            ],
                        }
                        for day in day_map.get(planning.id, [])
                    ],
                }
                for planning in plannings
            ],
        }
    )


def import_backup(db: Session, payload: WarehouseBackupPayload) -> BackupImportResponse:
    if payload.version != 1:
        raise HTTPException(status_code=400, detail=f"Nicht unterstützte Backup-Version: {payload.version}")

    try:
        db.execute(delete(PlanningItemRecord))
        db.execute(delete(PlanningDayRecord))
        db.execute(delete(PlanningRecord))
        db.execute(delete(MaintenanceRecord))
        db.execute(delete(ReservationRecord))
        db.execute(delete(ActivityRecord))
        db.execute(delete(AssetRecord))
        db.execute(delete(LocationRecord))
        db.execute(delete(CategoryRecord))
        db.execute(delete(UserRecord))

        for item in payload.categories:
            db.add(
                CategoryRecord(
                    name=item.name,
                    normalized_name=item.normalizedName,
                    is_standard=item.isStandard,
                    is_active=item.isActive,
                )
            )

        for item in payload.users:
            db.add(
                UserRecord(
                    external_id=item.id,
                    name=item.name,
                    email=item.email,
                    role=item.role,
                    last_active=item.lastActive,
                    status=item.status,
                    department=item.department,
                    location=item.location,
                    password_hash=item.passwordHash or hash_password(f"restore-{item.id}"),
                )
            )

        for item in payload.assets:
            db.add(
                AssetRecord(
                    external_id=item.id,
                    name=item.name,
                    category=item.category,
                    location=item.location,
                    status=item.status,
                    assigned_to=item.assignedTo,
                    next_return=item.nextReturn,
                    tag_number=item.tagNumber,
                    serial_number=item.serialNumber,
                    device_model=item.model,
                    ip_address=item.ipAddress,
                    mac_lan=item.macLan,
                    mac_wlan=item.macWlan,
                    qr_code=item.qrCode,
                    maintenance_state=item.maintenanceState,
                    notes=item.notes,
                    last_checkout=item.lastCheckout,
                    next_reservation=item.nextReservation,
                    source_file=item.sourceFile,
                )
            )

        for item in payload.activities:
            db.add(
                ActivityRecord(
                    external_id=item.id,
                    title=item.title,
                    detail=item.detail,
                    timestamp_text=item.timestamp,
                    asset_external_id=item.assetId,
                )
            )

        for item in payload.reservations:
            db.add(
                ReservationRecord(
                    external_id=item.id,
                    requested_by=item.requestedBy,
                    team=item.team,
                    period=item.period,
                    assets=item.assets,
                    status=item.status,
                    location=item.location,
                )
            )

        for item in payload.maintenanceItems:
            db.add(
                MaintenanceRecord(
                    external_id=item.id,
                    asset_name=item.assetName,
                    issue=item.issue,
                    reported_at=item.reportedAt,
                    due_date=item.dueDate,
                    priority=item.priority,
                    status=item.status,
                    comment=item.comment,
                    location=item.location,
                )
            )

        for item in payload.locations:
            db.add(
                LocationRecord(
                    name=item.name,
                    capacity=item.capacity,
                    assigned_assets=item.assignedAssets,
                    available_assets=item.availableAssets,
                    manager=item.manager,
                )
            )

        for item in payload.plannings:
            planning = PlanningRecord(
                external_id=item.id,
                customer_name=item.customerName,
                project_name=item.projectName,
                event_name=item.eventName,
                project_manager_user_id=item.projectManagerUserId,
                calendar_week=item.calendarWeek,
                start_date=item.startDate,
                end_date=item.endDate,
                notes=item.notes,
                status=item.status,
                template_source_planning_id=item.templateSourcePlanningId,
            )
            db.add(planning)
            db.flush()

            for day in item.days:
                day_record = PlanningDayRecord(
                    planning_id=planning.id,
                    planning_date=day.planningDate,
                    weekday=day.weekday,
                )
                db.add(day_record)
                db.flush()
                for planning_item in day.items:
                    db.add(
                        PlanningItemRecord(
                            planning_day_id=day_record.id,
                            category_key=planning_item.categoryKey,
                            qty=planning_item.qty,
                            notes=planning_item.notes,
                            handover_enabled=bool(planning_item.handoverEnabled),
                            linked_planning_external_id=(planning_item.linkedPlanningId or None),
                            handover_note=(planning_item.handoverNote or None),
                        )
                    )

        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="Backup konnte wegen inkonsistenter Daten nicht importiert werden.") from exc
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        raise HTTPException(status_code=400, detail="Backup konnte nicht importiert werden.") from exc

    return BackupImportResponse(
        imported={
            "categories": len(payload.categories),
            "users": len(payload.users),
            "assets": len(payload.assets),
            "activities": len(payload.activities),
            "reservations": len(payload.reservations),
            "maintenanceItems": len(payload.maintenanceItems),
            "locations": len(payload.locations),
            "plannings": len(payload.plannings),
        }
    )
