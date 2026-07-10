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
    HandoverExecutionRecord,
    QrCodeGroupMemberRecord,
    QrCodeGroupRecord,
    ReservationRecord,
    RolePermissionRecord,
    SystemSettingRecord,
    LoginBackgroundRecord,
    TelecomPassBookingRecord,
    UpdateNoteRecord,
    UserRecord,
    HardwareImportRunRecord,
    HardwareImportRowErrorRecord,
)
from ..domain.permissions import ALL_PERMISSION_KEYS, is_valid_role_key
from ..repositories import category_repository, role_permission_repository
from ..repositories.wms_repository import (
    _normalize_asset_status,
    _normalize_maintenance_status,
    _normalize_user_status,
)
from ..repositories.planning_repository import _normalize_status as _normalize_planning_status
from ..schemas.backup import BackupClearDataResponse, BackupImportResponse, WarehouseBackupPayload
from .auth_service import ROLE_ADMIN, hash_password, normalize_role_for_db


def export_backup(db: Session) -> WarehouseBackupPayload:
    categories = db.scalars(select(CategoryRecord).order_by(CategoryRecord.name.asc())).all()
    users = db.scalars(select(UserRecord).order_by(UserRecord.external_id.asc())).all()
    assets = db.scalars(select(AssetRecord).order_by(AssetRecord.external_id.asc())).all()
    activities = db.scalars(select(ActivityRecord).order_by(ActivityRecord.created_at.asc())).all()
    reservations = db.scalars(select(ReservationRecord).order_by(ReservationRecord.created_at.asc())).all()
    maintenance_items = db.scalars(select(MaintenanceRecord).order_by(MaintenanceRecord.created_at.asc())).all()
    locations = db.scalars(select(LocationRecord).order_by(LocationRecord.name.asc())).all()
    plannings = db.scalars(select(PlanningRecord).order_by(PlanningRecord.created_at.asc())).all()
    update_notes = db.scalars(select(UpdateNoteRecord).order_by(UpdateNoteRecord.created_at.asc())).all()

    planning_days = db.scalars(select(PlanningDayRecord).order_by(PlanningDayRecord.planning_date.asc())).all()
    day_map: dict[int, list[PlanningDayRecord]] = {}
    for day in planning_days:
        day_map.setdefault(day.planning_id, []).append(day)

    planning_items = db.scalars(select(PlanningItemRecord).order_by(PlanningItemRecord.id.asc())).all()
    item_map: dict[int, list[PlanningItemRecord]] = {}
    for item in planning_items:
        item_map.setdefault(item.planning_day_id, []).append(item)

    qr_groups = db.scalars(
        select(QrCodeGroupRecord).order_by(QrCodeGroupRecord.created_at.asc())
    ).all()
    qr_members = db.scalars(select(QrCodeGroupMemberRecord)).all()
    qr_member_map: dict[int, list[str]] = {}
    for member in qr_members:
        qr_member_map.setdefault(member.group_id, []).append(member.asset_external_id)

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
                    "defaultImageSourceUrl": item.default_image_source_url,
                    "defaultImageCachedPath": item.default_image_cached_path,
                    "defaultImageMimeType": item.default_image_mime_type,
                    "defaultImageLastFetchedAt": item.default_image_last_fetched_at,
                    "defaultImageStatus": item.default_image_fetch_status,
                    "defaultImageFetchError": item.default_image_fetch_error,
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
                    # Security-Paket „supman": Login-/Freigabe-Metadaten mitnehmen,
                    # damit sie einen Restore überleben. (Security-Events selbst
                    # werden bewusst NICHT exportiert — das Forensik-Log soll vom
                    # destruktiven Import unberührt bleiben.)
                    "failedLoginCount": int(item.failed_login_count or 0),
                    "lockedUntil": item.locked_until,
                    "lastLoginAt": item.last_login_at,
                    "lastLoginAttemptAt": item.last_login_attempt_at,
                    "lastLoginIp": item.last_login_ip,
                    "lastLoginUserAgent": item.last_login_user_agent,
                    "approvedAt": item.approved_at,
                    "approvedBy": item.approved_by,
                    "rejectedAt": item.rejected_at,
                    # Signaturfarbe mitsichern, damit sie einen Restore ueberlebt
                    # (insbesondere manuell gesetzte Farben).
                    "signatureColor": item.signature_color,
                    "signatureColorSource": item.signature_color_source,
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
                    "productImageSourceUrl": item.product_image_source_url,
                    "productImageCachedPath": item.product_image_cached_path,
                    "productImageMimeType": item.product_image_mime_type,
                    "productImageLastFetchedAt": item.product_image_last_fetched_at,
                    "productImageStatus": item.product_image_fetch_status,
                    "productImageFetchError": item.product_image_fetch_error,
                    # Fremdbestand-Felder mit ausgeben, damit Mietgeräte
                    # nach Restore weiter im richtigen Zeitraum verfügbar
                    # sind und das Bestandsart-Badge erhalten bleibt.
                    "ownershipType": (item.ownership_type or "owned"),
                    "sourceName": item.source_name,
                    "availableFrom": item.available_from,
                    "availableUntil": item.available_until,
                    "returnDueDate": item.return_due_date,
                    "returnedAt": item.returned_at,
                    "externalNote": item.external_note,
                    # Planungsrelevante Flags mit ausgeben, damit Restores die
                    # Verfügbarkeits-/Konfliktberechnung 1:1 reproduzieren und
                    # nicht auf DB-Default True zurückfallen.
                    "availableForPlanning": bool(item.available_for_planning),
                    "cardPrinterCompatible": bool(item.card_printer_compatible),
                    # Schritt A: erwartetes Rückgabedatum mit ausgeben, damit
                    # Restores die Availability-/Konfliktberechnung 1:1
                    # reproduzieren.
                    "expectedReturnDate": item.expected_return_date,
                    # Schritt B: Planungs-Zuordnung mit ausgeben.
                    "assignedPlanningId": item.assigned_planning_id,
                    # Telekompass-Zähler mit ausgeben.
                    "telecomPassBookingCountTotal": int(
                        item.telecom_pass_booking_count_total or 0
                    ),
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
                    "onSiteResponsibleUserId": getattr(planning, "on_site_responsible_user_id", None),
                    "calendarWeek": planning.calendar_week,
                    "startDate": planning.start_date,
                    "endDate": planning.end_date,
                    "notes": planning.notes,
                    "status": planning.status,
                    "templateSourcePlanningId": planning.template_source_planning_id,
                    "returnBufferDays": int(planning.return_buffer_days or 0),
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
            "updateNotes": [
                {
                    "id": note.external_id,
                    "version": note.version,
                    "date": note.note_date,
                    "title": note.title,
                    "items": list(note.items_json or []),
                    "isPublished": bool(note.is_published),
                    "publishedAt": note.published_at,
                }
                for note in update_notes
            ],
            "rolePermissions": [
                {"roleKey": record.role_key, "permissionKey": record.permission_key}
                for record in db.scalars(
                    select(RolePermissionRecord).order_by(
                        RolePermissionRecord.role_key.asc(),
                        RolePermissionRecord.permission_key.asc(),
                    )
                ).all()
            ],
            # Sammel-QR-Gruppen mit ihren referenzierten Asset-external_ids. Es
            # werden nur Verweise gesichert — kein eigener Bestand.
            "qrCodeGroups": [
                {
                    "id": group.external_id,
                    "name": group.name,
                    "qrToken": group.qr_token,
                    "category": group.category,
                    "stockType": group.stock_type,
                    "sourceName": group.source_name,
                    "createdByUserId": group.created_by_user_id,
                    "isActive": bool(group.is_active),
                    "members": list(qr_member_map.get(group.id, [])),
                }
                for group in qr_groups
            ],
            "handoverExecutions": [
                {
                    "id": row.external_id,
                    "batchId": row.batch_id,
                    "assetId": row.asset_external_id,
                    "category": row.category,
                    "sourcePlanningId": row.source_planning_id,
                    "targetPlanningId": row.target_planning_id,
                    "prevAssignedPlanningId": row.prev_assigned_planning_id,
                    "prevExpectedReturnDate": row.prev_expected_return_date,
                    "prevAssignedTo": row.prev_assigned_to,
                    "prevNextReturn": row.prev_next_return,
                    "executedByUserId": row.executed_by_user_id,
                    "status": row.status,
                }
                for row in db.scalars(
                    select(HandoverExecutionRecord).order_by(HandoverExecutionRecord.executed_at.asc())
                ).all()
            ],
            "systemSettings": [
                {"key": row.key, "value": row.value}
                for row in db.scalars(
                    select(SystemSettingRecord).order_by(SystemSettingRecord.key.asc())
                ).all()
            ],
            "telecomPassBookings": [
                {
                    "id": row.external_id,
                    "assetId": row.asset_external_id,
                    "planningId": row.planning_id,
                    "quantity": int(row.quantity or 0),
                    "unitPriceSnapshot": row.unit_price_snapshot,
                    "totalPriceSnapshot": row.total_price_snapshot,
                    "kind": row.kind,
                    "idempotencyKey": row.idempotency_key,
                    "createdByUserId": row.created_by_user_id,
                }
                for row in db.scalars(
                    select(TelecomPassBookingRecord).order_by(
                        TelecomPassBookingRecord.created_at.asc()
                    )
                ).all()
            ],
            "loginBackgrounds": [
                {
                    "id": row.external_id,
                    "fileName": row.file_name,
                    "originalName": row.original_name or "",
                    "mimeType": row.mime_type or "image/webp",
                    "sizeBytes": int(row.size_bytes or 0),
                    "width": int(row.width or 0),
                    "height": int(row.height or 0),
                    "uploadedByUserId": row.uploaded_by_user_id,
                    "uploadedByName": row.uploaded_by_name,
                    "isActive": bool(row.is_active),
                }
                for row in db.scalars(
                    select(LoginBackgroundRecord).order_by(LoginBackgroundRecord.created_at.asc())
                ).all()
            ],
        }
    )


def import_backup(db: Session, payload: WarehouseBackupPayload) -> BackupImportResponse:
    if payload.version != 1:
        raise HTTPException(status_code=400, detail=f"Nicht unterstützte Backup-Version: {payload.version}")

    try:
        db.execute(delete(TelecomPassBookingRecord))
        db.execute(delete(LoginBackgroundRecord))
        db.execute(delete(SystemSettingRecord))
        db.execute(delete(HandoverExecutionRecord))
        db.execute(delete(QrCodeGroupMemberRecord))
        db.execute(delete(QrCodeGroupRecord))
        db.execute(delete(PlanningItemRecord))
        db.execute(delete(PlanningDayRecord))
        db.execute(delete(PlanningRecord))
        db.execute(delete(UpdateNoteRecord))
        db.execute(delete(MaintenanceRecord))
        db.execute(delete(ReservationRecord))
        db.execute(delete(ActivityRecord))
        db.execute(delete(AssetRecord))
        db.execute(delete(LocationRecord))
        db.execute(delete(CategoryRecord))
        db.execute(delete(RolePermissionRecord))
        db.execute(delete(UserRecord))

        for item in payload.categories:
            db.add(
                CategoryRecord(
                    name=item.name,
                    normalized_name=item.normalizedName,
                    is_standard=item.isStandard,
                    is_active=item.isActive,
                    default_image_source_url=item.defaultImageSourceUrl,
                    default_image_cached_path=item.defaultImageCachedPath,
                    default_image_mime_type=item.defaultImageMimeType,
                    default_image_last_fetched_at=item.defaultImageLastFetchedAt,
                    default_image_fetch_status=item.defaultImageStatus or "none",
                    default_image_fetch_error=item.defaultImageFetchError,
                )
            )

        for item in payload.users:
            # Status normalisieren und is_active daraus ableiten. Ohne das
            # würde der Model-Default (is_active=True) greifen und ein
            # Restore hätte wartende/gesperrte Konten stillschweigend
            # AKTIVIERT (Login möglich) — genau der supman-Fall.
            normalized_status = _normalize_user_status(item.status)
            db.add(
                UserRecord(
                    external_id=item.id,
                    name=item.name,
                    email=item.email,
                    role=item.role,
                    last_active=item.lastActive,
                    status=normalized_status,
                    is_active=normalized_status == "Aktiv",
                    department=item.department,
                    location=item.location,
                    password_hash=item.passwordHash or hash_password(f"restore-{item.id}"),
                    failed_login_count=int(item.failedLoginCount or 0),
                    locked_until=item.lockedUntil,
                    last_login_at=item.lastLoginAt,
                    last_login_attempt_at=item.lastLoginAttemptAt,
                    last_login_ip=item.lastLoginIp,
                    last_login_user_agent=item.lastLoginUserAgent,
                    approved_at=item.approvedAt,
                    approved_by=item.approvedBy,
                    rejected_at=item.rejectedAt,
                    signature_color=item.signatureColor,
                    signature_color_source=item.signatureColorSource,
                )
            )

        for item in payload.assets:
            db.add(
                AssetRecord(
                    external_id=item.id,
                    name=item.name,
                    category=item.category,
                    location=item.location,
                    # Status auf die kanonische Form normalisieren, damit
                    # ältere Backups (z. B. "Verfügbar" mit Umlaut) nach
                    # Restore identisch zu neu erstellten Assets gespeichert
                    # sind und Availability-/Konflikt-Berechnungen
                    # konsistent funktionieren.
                    status=_normalize_asset_status(item.status),
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
                    product_image_source_url=item.productImageSourceUrl,
                    product_image_cached_path=item.productImageCachedPath,
                    product_image_mime_type=item.productImageMimeType,
                    product_image_last_fetched_at=item.productImageLastFetchedAt,
                    product_image_fetch_status=item.productImageStatus or "none",
                    product_image_fetch_error=item.productImageFetchError,
                    # Fremdbestand-Felder beim Restore weitergeben.
                    # Defaults im BackupAsset-Schema (ownershipType="owned",
                    # rest = None) sorgen dafür, dass alte Backups OHNE
                    # diese Felder weiter problemlos importierbar bleiben.
                    ownership_type=(item.ownershipType or "owned"),
                    source_name=item.sourceName,
                    available_from=item.availableFrom,
                    available_until=item.availableUntil,
                    return_due_date=item.returnDueDate,
                    returned_at=item.returnedAt,
                    external_note=item.externalNote,
                    # Planungsrelevante Flags beim Restore weitergeben. Der
                    # BackupAsset-Default True greift bei alten Backups OHNE
                    # diese Felder — sie bleiben damit importierbar.
                    available_for_planning=bool(item.availableForPlanning),
                    card_printer_compatible=bool(item.cardPrinterCompatible),
                    # Schritt A: erwartetes Rückgabedatum beim Restore
                    # weitergeben. Default None im BackupAsset-Schema hält ältere
                    # Backups OHNE dieses Feld importierbar (Fallback nextReturn).
                    expected_return_date=item.expectedReturnDate,
                    # Schritt B: Planungs-Zuordnung beim Restore weitergeben.
                    # Default None hält Altbackups OHNE dieses Feld importierbar.
                    assigned_planning_id=item.assignedPlanningId,
                    # Telekompass-Zähler beim Restore weitergeben. Default 0 hält
                    # Altbackups OHNE dieses Feld importierbar.
                    telecom_pass_booking_count_total=int(
                        item.telecomPassBookingCountTotal or 0
                    ),
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
                    status=_normalize_maintenance_status(item.status),
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
                on_site_responsible_user_id=item.onSiteResponsibleUserId,
                calendar_week=item.calendarWeek,
                start_date=item.startDate,
                end_date=item.endDate,
                notes=item.notes,
                status=_normalize_planning_status(item.status),
                template_source_planning_id=item.templateSourcePlanningId,
                return_buffer_days=int(item.returnBufferDays or 0),
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

        for note in payload.updateNotes:
            db.add(
                UpdateNoteRecord(
                    external_id=note.id,
                    version=note.version,
                    note_date=note.date,
                    title=note.title,
                    items_json=list(note.items or []),
                    is_published=bool(note.isPublished),
                    published_at=note.publishedAt,
                )
            )

        # Rollenrechte: gültige Zeilen übernehmen (bekannter role_key +
        # permission_key, dedupliziert). Fehlt die Sektion (Altbackup) oder ist
        # sie komplett ungültig, werden die Default-Rechte geseedet — so ist nie
        # ein leerer/ausgesperrter Zustand möglich.
        seen_role_perms: set[tuple[str, str]] = set()
        for item in payload.rolePermissions:
            key = (item.roleKey, item.permissionKey)
            if (
                is_valid_role_key(item.roleKey)
                and item.permissionKey in ALL_PERMISSION_KEYS
                and key not in seen_role_perms
            ):
                seen_role_perms.add(key)
                db.add(
                    RolePermissionRecord(
                        role_key=item.roleKey, permission_key=item.permissionKey
                    )
                )
        if not seen_role_perms:
            role_permission_repository.seed_default_role_permissions(db)

        # Sammel-QR-Gruppen + Mitgliedsverweise wiederherstellen. Verweisen nur
        # auf bereits eingespielte Asset-external_ids; kein FK-Zwang.
        for group_item in payload.qrCodeGroups:
            group = QrCodeGroupRecord(
                external_id=group_item.id,
                name=group_item.name,
                qr_token=group_item.qrToken,
                category=group_item.category,
                stock_type=group_item.stockType,
                source_name=group_item.sourceName,
                created_by_user_id=group_item.createdByUserId,
                is_active=bool(group_item.isActive),
            )
            db.add(group)
            db.flush()
            for asset_external_id in group_item.members:
                db.add(
                    QrCodeGroupMemberRecord(
                        group_id=group.id,
                        asset_external_id=asset_external_id,
                    )
                )

        for item in payload.handoverExecutions:
            db.add(
                HandoverExecutionRecord(
                    external_id=item.id,
                    batch_id=item.batchId,
                    asset_external_id=item.assetId,
                    category=item.category,
                    source_planning_id=item.sourcePlanningId,
                    target_planning_id=item.targetPlanningId,
                    prev_assigned_planning_id=item.prevAssignedPlanningId,
                    prev_expected_return_date=item.prevExpectedReturnDate,
                    prev_assigned_to=item.prevAssignedTo,
                    prev_next_return=item.prevNextReturn,
                    executed_by_user_id=item.executedByUserId,
                    status=item.status,
                )
            )

        for item in payload.systemSettings:
            db.add(SystemSettingRecord(key=item.key, value=item.value))

        # Telekompass-Verlauf wiederherstellen. idempotency_key dedupliziert, damit
        # ein doppelt vorhandener Key beim Restore keinen IntegrityError auslöst.
        seen_idempotency_keys: set[str] = set()
        for item in payload.telecomPassBookings:
            key = item.idempotencyKey or None
            if key is not None:
                if key in seen_idempotency_keys:
                    key = None
                else:
                    seen_idempotency_keys.add(key)
            db.add(
                TelecomPassBookingRecord(
                    external_id=item.id,
                    asset_external_id=item.assetId,
                    planning_id=item.planningId,
                    quantity=int(item.quantity or 0),
                    unit_price_snapshot=item.unitPriceSnapshot or "0",
                    total_price_snapshot=item.totalPriceSnapshot or "0",
                    kind=item.kind or "booking",
                    idempotency_key=key,
                    created_by_user_id=item.createdByUserId,
                )
            )

        for item in payload.loginBackgrounds:
            db.add(
                LoginBackgroundRecord(
                    external_id=item.id,
                    file_name=item.fileName,
                    original_name=item.originalName or "",
                    mime_type=item.mimeType or "image/webp",
                    size_bytes=int(item.sizeBytes or 0),
                    width=int(item.width or 0),
                    height=int(item.height or 0),
                    uploaded_by_user_id=item.uploadedByUserId,
                    uploaded_by_name=item.uploadedByName,
                    is_active=bool(item.isActive),
                )
            )

        db.commit()

        # Alte Backups kennen neu eingeführte Permission-Keys (z. B.
        # qrcode.manage) nicht. Nach dem Import additiv mit Defaults ergänzen,
        # ohne aus dem Backup übernommene Rechte zu überschreiben.
        role_permission_repository.ensure_default_permissions_present(db)
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
            "updateNotes": len(payload.updateNotes),
            "rolePermissions": len(payload.rolePermissions),
            "qrCodeGroups": len(payload.qrCodeGroups),
            "handoverExecutions": len(payload.handoverExecutions),
            "systemSettings": len(payload.systemSettings),
            "telecomPassBookings": len(payload.telecomPassBookings),
            "loginBackgrounds": len(payload.loginBackgrounds),
        }
    )


def clear_data_for_import(db: Session, *, keep_user_id: str | None = None) -> BackupClearDataResponse:
    try:
        users = db.scalars(select(UserRecord).order_by(UserRecord.id.asc())).all()
        preserved_admin_ids: set[int] = {
            user.id for user in users if normalize_role_for_db(user.role) == ROLE_ADMIN and bool(user.is_active)
        }

        keep_user = None
        if keep_user_id:
            keep_user = db.scalar(select(UserRecord).where(UserRecord.external_id == keep_user_id))
            if keep_user is not None:
                keep_user.role = ROLE_ADMIN
                keep_user.is_active = True
                keep_user.status = "Aktiv"
                preserved_admin_ids.add(keep_user.id)

        if not preserved_admin_ids:
            fallback = keep_user or (users[0] if users else None)
            if fallback is None:
                raise HTTPException(
                    status_code=409,
                    detail="Bereinigung nicht möglich: Es gibt keinen Benutzer, der als Admin erhalten werden kann.",
                )
            fallback.role = ROLE_ADMIN
            fallback.is_active = True
            fallback.status = "Aktiv"
            preserved_admin_ids.add(fallback.id)

        # Telekompass-Verlauf hängt an Assets, die gleich geleert werden →
        # mitlöschen. Die globale Preis-Einstellung (system_settings) bleibt als
        # Konfiguration bewusst erhalten.
        db.execute(delete(TelecomPassBookingRecord))
        db.execute(delete(LoginBackgroundRecord))
        db.execute(delete(HandoverExecutionRecord))
        db.execute(delete(QrCodeGroupMemberRecord))
        db.execute(delete(QrCodeGroupRecord))
        db.execute(delete(PlanningItemRecord))
        db.execute(delete(PlanningDayRecord))
        db.execute(delete(PlanningRecord))
        db.execute(delete(UpdateNoteRecord))
        db.execute(delete(MaintenanceRecord))
        db.execute(delete(ReservationRecord))
        db.execute(delete(ActivityRecord))
        db.execute(delete(AssetRecord))
        db.execute(delete(LocationRecord))
        db.execute(delete(CategoryRecord))
        db.execute(delete(HardwareImportRowErrorRecord))
        db.execute(delete(HardwareImportRunRecord))
        db.execute(delete(RolePermissionRecord))

        db.execute(delete(UserRecord).where(UserRecord.id.notin_(preserved_admin_ids)))

        # Re-seed standard categories so the app keeps a usable category set
        # after a wipe (without this, the lazy-seed from older code paths was
        # the only thing restoring them).
        category_repository.seed_standard_categories(db)
        # Default-Rollenrechte wiederherstellen (Parität zu den Kategorien).
        role_permission_repository.seed_default_role_permissions(db)

        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        raise HTTPException(status_code=500, detail="Systemdaten konnten nicht bereinigt werden.") from exc

    return BackupClearDataResponse(
        success=True,
        message="Systemdaten wurden bereinigt. Der Admin-Zugang wurde beibehalten.",
    )
