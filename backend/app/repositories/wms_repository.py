from __future__ import annotations

import json
import logging
import secrets
import time
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import delete, func, or_, select
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
    QrCodeGroupMemberRecord,
    QrCodeGroupRecord,
)
from ..domain.categories import normalize_category
from ..domain.user_colors import (
    SIGNATURE_COLOR_SOURCE_AUTO,
    SIGNATURE_COLOR_SOURCE_MANUAL,
    normalize_signature_color,
    pick_signature_color,
)
from . import category_repository, planning_repository
from ..schemas.security import UserSecurityInfo
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
from ..services import planning_event_service, product_image_service, security_event_service

logger = logging.getLogger("cloud_web.wms")

# Overview-Aufbau, der laenger als dieser Schwellwert dauert, wird als WARNING
# samt Abschnitts-Breakdown geloggt — darunter nur DEBUG, damit der
# Normalbetrieb die Logs nicht flutet. Macht Performance-Regressionen sichtbar.
_OVERVIEW_SLOW_THRESHOLD_MS = 800.0


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
    # Security-Paket „supman": eigene Endzustände statt Kollaps auf "Inaktiv" —
    # wichtig auch für den Backup-Roundtrip (Status übersteht Export/Import).
    if raw in {"abgelehnt", "rejected"}:
        return "Abgelehnt"
    if raw in {"gesperrt", "locked"}:
        return "Gesperrt"
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
        productImageUrl=product_image_service.build_public_image_url(
            getattr(record, "product_image_cached_path", None)
        ),
        productImageSourceUrl=getattr(record, "product_image_source_url", None),
        productImageStatus=getattr(record, "product_image_fetch_status", "none"),
        productImageFetchError=getattr(record, "product_image_fetch_error", None),
        ownershipType=_normalize_ownership_type(record.ownership_type),
        sourceName=record.source_name,
        availableFrom=record.available_from,
        availableUntil=record.available_until,
        returnDueDate=record.return_due_date,
        returnedAt=record.returned_at,
        externalNote=record.external_note,
        cardPrinterCompatible=bool(getattr(record, "card_printer_compatible", True)),
        availableForPlanning=bool(getattr(record, "available_for_planning", True)),
        expectedReturnDate=getattr(record, "expected_return_date", None),
        assignedPlanningId=getattr(record, "assigned_planning_id", None),
        telecomPassBookingCountTotal=int(
            getattr(record, "telecom_pass_booking_count_total", 0) or 0
        ),
    )


def _normalize_ownership_type(value: str | None) -> str:
    """Mappt eingehende Ownership-Werte auf die kanonischen Literale.

    Bestehende Daten ohne ownership_type-Spalte (Legacy-Restore, Backups vor
    diesem Feature) werden als ``owned`` interpretiert. Damit verhalten sich
    alle vorhandenen Geräte unverändert wie Eigenbestand.
    """
    raw = (value or "").strip().lower()
    if raw in {"rented", "miete", "mietgerät", "mietgeraet"}:
        return "rented"
    if raw in {"borrowed", "leihe", "leihgerät", "leihgeraet"}:
        return "borrowed"
    if raw in {"external", "extern", "externes gerät", "externes geraet"}:
        return "external"
    return "owned"


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
    elif normalized_status in {"Wartet auf Freigabe", "Abgelehnt", "Gesperrt"}:
        # Nicht-aktive Sonderzustände sichtbar lassen (statt Kollaps auf
        # "Inaktiv") — der supman-Fall soll in der UI als das erkennbar
        # sein, was er ist.
        status = normalized_status
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
        lastLoginAt=record.last_login_at.strftime("%d.%m.%Y %H:%M") if record.last_login_at else None,
        department=record.department,
        location=record.location,
        # Gespeicherte Farbe bevorzugen; fehlt sie (Altdaten vor dem Backfill),
        # deterministischer Fallback - identisch zu dem Wert, den der Backfill
        # persistieren wuerde (kein Farbwechsel beim Nachtragen).
        signatureColor=record.signature_color or pick_signature_color(record.external_id),
        signatureColorSource=record.signature_color_source
        or (None if record.signature_color is None else SIGNATURE_COLOR_SOURCE_AUTO),
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


def refresh_asset_product_image(db: Session, external_id: str) -> AssetItem:
    """Laedt das Produktbild eines Assets erneut aus der Quell-URL.

    Erzwingt den Download auch bei vorhandener Cache-Datei ("Bild neu laden"),
    damit sich sowohl fehlende Dateien (Deploy/Restore) als auch inhaltlich
    geaenderte Quellbilder reparieren lassen.
    """
    record = db.scalar(select(AssetRecord).where(AssetRecord.external_id == external_id))
    if record is None:
        raise HTTPException(status_code=404, detail="Asset nicht gefunden.")
    source_url = (getattr(record, "product_image_source_url", None) or "").strip()
    if not source_url:
        raise HTTPException(status_code=400, detail="Für dieses Asset ist keine Bild-URL gespeichert.")
    image_payload = product_image_service.try_sync_product_image(source_url, force=True)
    record.product_image_source_url = image_payload["source_url"]
    record.product_image_cached_path = image_payload["cached_path"]
    record.product_image_mime_type = image_payload["mime_type"]
    record.product_image_fetch_status = image_payload["fetch_status"] or "none"
    record.product_image_fetch_error = image_payload["fetch_error"]
    record.product_image_last_fetched_at = datetime.now(UTC) if image_payload["cached_path"] else None
    db.commit()
    db.refresh(record)
    return _asset_to_schema(record, category_repository.active_category_names(db))


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

    # Vorfilter direkt in SQL: nur Maintenance-Sätze mit aktivem Status
    # und passender Asset-Zuordnung holen, statt die komplette Tabelle zu
    # laden und in Python zu filtern. Der zusätzliche Substring-Match auf
    # tag_number bleibt in Python, weil er kein simples Equals ist.
    asset_match_clauses = [MaintenanceRecord.asset_name == asset.name]
    if asset.tag_number:
        asset_match_clauses.append(MaintenanceRecord.asset_name.contains(asset.tag_number))
    candidate_stmt = (
        select(MaintenanceRecord)
        .where(MaintenanceRecord.external_id != maintenance.external_id)
        .where(or_(*asset_match_clauses))
    )
    active_items = [
        item
        for item in db.scalars(candidate_stmt).all()
        if _maintenance_matches_asset(item, asset)
        and _normalize_maintenance_status(item.status)
        in {"Offen", "In Bearbeitung", "In Arbeit", "Wartet auf Teile"}
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
    # Planungsbezug VOR dem Überschreiben sichern: beim Checkin wird
    # assigned_planning_id unten geleert — für das Rückgabe-Event der Planung
    # brauchen wir den Vorzustand.
    previous_assigned_planning_id = (
        getattr(record, "assigned_planning_id", None) if record else None
    )
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
        # Fremdbestand-Felder. Bei fehlenden Werten bleibt das Default greifen
        # (ownership_type='owned'), so dass bestehende Updates ohne diese
        # Felder weiter wie bisher funktionieren.
        "ownership_type": _normalize_ownership_type(item.ownershipType),
        "source_name": item.sourceName,
        "available_from": item.availableFrom,
        "available_until": item.availableUntil,
        "return_due_date": item.returnDueDate,
        "returned_at": item.returnedAt,
        "external_note": item.externalNote,
        "card_printer_compatible": bool(item.cardPrinterCompatible),
        "available_for_planning": bool(item.availableForPlanning),
        "expected_return_date": item.expectedReturnDate,
        "assigned_planning_id": item.assignedPlanningId,
        # Bewusst NICHT enthalten: telecom_pass_booking_count_total. Der
        # Telekompass-Zähler wird ausschließlich über telecom_pass_repository
        # gepflegt — so kann ein Bearbeiten/Checkout den Wert nie überschreiben.
    }
    normalized_image_source_url = (item.productImageSourceUrl or "").strip()
    image_payload: dict[str, str | None] | None = None
    if normalized_image_source_url:
        previous_source_url = (getattr(record, "product_image_source_url", None) or "").strip() if record else ""
        previous_cached_path = (getattr(record, "product_image_cached_path", None) or "").strip() if record else ""
        if (
            normalized_image_source_url == previous_source_url
            and previous_cached_path
            and product_image_service.cached_file_exists(previous_cached_path)
        ):
            image_payload = {
                "source_url": previous_source_url,
                "cached_path": previous_cached_path,
                "mime_type": getattr(record, "product_image_mime_type", None),
                "fetch_status": getattr(record, "product_image_fetch_status", "ready"),
                "fetch_error": getattr(record, "product_image_fetch_error", None),
            }
        else:
            # try_sync: ein nicht (mehr) ladbares Bild darf den Asset-Save
            # (inkl. Checkout/Checkin ueber denselben Upsert) nie blockieren —
            # stattdessen Status failed + fetch_error persistieren.
            image_payload = product_image_service.try_sync_product_image(normalized_image_source_url)
    elif record and (
        getattr(record, "product_image_source_url", None)
        or getattr(record, "product_image_cached_path", None)
    ):
        image_payload = product_image_service.clear_product_image()
    # Schritt A: erwartetes Rückgabedatum eines Eigengeräts strukturiert pflegen.
    # Beim Checkout (-> Verliehen) wird, falls die UI noch kein strukturiertes
    # Datum liefert, defensiv das eingegebene next_return interpretiert. Beim
    # Checkin (-> Verfuegbar) wird die Sperre wieder aufgehoben. So bleibt die
    # Planungs-Verfügbarkeit konsistent, ohne dass die UI angepasst werden muss.
    if payload["status"] == "Verliehen" and payload["ownership_type"] == "owned":
        # F1: Ausgabe AUF EINE PLANUNG bindet das Rückgabedatum an die Planung
        # (Parität zum Handover-Pfad) statt an den Frontend-Default "heute+2".
        # Greift nur beim Checkout-ÜBERGANG (nicht bei späteren Edits eines
        # bereits verliehenen Geräts) und nur, wenn die UI KEIN strukturiertes
        # expectedReturnDate mitgeschickt hat — ein explizit gesendetes Datum
        # ist eine bewusste manuelle Wahl und hat Vorrang.
        if (
            previous_status != "Verliehen"
            and payload["expected_return_date"] is None
            and payload["assigned_planning_id"]
        ):
            planning_dates = planning_repository.planning_loan_return_dates(
                db, payload["assigned_planning_id"]
            )
            if planning_dates is not None:
                planning_expected_return, planning_display_return = planning_dates
                payload["expected_return_date"] = planning_expected_return
                payload["next_return"] = planning_display_return.isoformat()
        if payload["expected_return_date"] is None:
            payload["expected_return_date"] = planning_repository._parse_loose_date(
                item.nextReturn
            )
    elif payload["status"] == "Verfuegbar":
        payload["expected_return_date"] = None
        # Schritt B: Rücknahme beendet die Planungs-Zuordnung (Fall 3). Damit
        # zählt das Gerät wieder als freier Bestand, nicht als erfüllter Bedarf.
        payload["assigned_planning_id"] = None
    if record:
        for key, value in payload.items():
            setattr(record, key, value)
    else:
        record = AssetRecord(external_id=item.id, **payload)
        db.add(record)
    if image_payload is not None:
        record.product_image_source_url = image_payload["source_url"]
        record.product_image_cached_path = image_payload["cached_path"]
        record.product_image_mime_type = image_payload["mime_type"]
        record.product_image_fetch_status = image_payload["fetch_status"] or "none"
        record.product_image_fetch_error = image_payload["fetch_error"]
        record.product_image_last_fetched_at = datetime.now(UTC) if image_payload["cached_path"] else None
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
        # Planungs-Historie (Detailseite): Ausgabe/Rückgabe je Planung
        # protokollieren. Beim Checkout steht die Ziel-Planung im Payload,
        # beim Checkin nur noch im Vorzustand (oben gesichert). Event hängt
        # sich an den Fach-Commit unten an (commit=False).
        event_planning_id = (
            payload.get("assigned_planning_id")
            if next_status == "Verliehen"
            else previous_assigned_planning_id
        )
        if event_planning_id:
            planning_event_service.add_event(
                db,
                event_planning_id,
                planning_event_service.EVENT_ISSUE_RECORDED
                if next_status == "Verliehen"
                else planning_event_service.EVENT_RETURN_RECORDED,
                actor_id=operator_user_id,
                payload={
                    "assetId": record.external_id,
                    "assetName": record.name,
                    "tagNumber": record.tag_number,
                    "categoryKey": payload.get("category") or record.category,
                },
            )
    db.commit()
    db.refresh(record)
    return _asset_to_schema(record, category_repository.active_category_names(db))


def delete_asset(db: Session, external_id: str) -> bool:
    stmt = select(AssetRecord).where(AssetRecord.external_id == external_id)
    record = db.scalar(stmt)
    if not record:
        return False
    affected_group_ids = list(
        db.scalars(
            select(QrCodeGroupMemberRecord.group_id).where(
                QrCodeGroupMemberRecord.asset_external_id == external_id
            )
        ).all()
    )
    if affected_group_ids:
        db.execute(
            delete(QrCodeGroupMemberRecord).where(
                QrCodeGroupMemberRecord.asset_external_id == external_id
            )
        )
        empty_group_ids: list[int] = []
        for group_id in sorted(set(affected_group_ids)):
            remaining = db.scalar(
                select(func.count())
                .select_from(QrCodeGroupMemberRecord)
                .where(QrCodeGroupMemberRecord.group_id == group_id)
            )
            if not remaining:
                empty_group_ids.append(group_id)
        if empty_group_ids:
            db.execute(
                delete(QrCodeGroupRecord).where(QrCodeGroupRecord.id.in_(empty_group_ids))
            )
    db.delete(record)
    db.commit()
    return True


def create_external_pool(
    db: Session,
    *,
    category: str,
    ownership_type: str,
    count: int,
    name_prefix: str,
    location: str,
    available_from: date | None,
    available_until: date | None,
    return_due_date: date | None,
    source_name: str | None,
    external_note: str | None,
) -> list[str]:
    """Legt mehrere Fremdbestand-Geräte in einem Aufruf an.

    Erzeugt nummerierte Assets ("Miet-iPad 01", "Miet-iPad 02", ...) mit
    eindeutigen tag_number / serial_number / qr_code je Stück. Damit
    funktionieren sie im bestehenden Inventar-, QR-, Ausgabe- und
    Rücknahme-Pfad ohne Sonderlogik.
    """
    if count < 1 or count > 200:
        raise HTTPException(status_code=400, detail="count muss zwischen 1 und 200 liegen.")
    normalized_ownership = _normalize_ownership_type(ownership_type)
    if normalized_ownership == "owned":
        raise HTTPException(
            status_code=400,
            detail="Fremdbestand erfordert ownershipType rented, borrowed oder external.",
        )
    canonical_category = category_repository.normalize_category_for_db(db, category)
    prefix = (name_prefix or canonical_category).strip() or "Fremdbestand"
    pad = max(2, len(str(count)))
    suffix_base = secrets.token_hex(4)
    created_ids: list[str] = []
    for index in range(1, count + 1):
        number = str(index).zfill(pad)
        # Asset-ID, Tag und Seriennummer werden mit gemeinsamem Suffix
        # generiert, damit alle Stück eines Anlage-Vorgangs zusammenhängen,
        # aber jeder QR-Code unverwechselbar bleibt.
        external_id = f"asset-ext-{suffix_base}-{number}"
        tag_number = f"EXT-{suffix_base.upper()}-{number}"
        serial_number = f"EXT-{suffix_base.upper()}-SN-{number}"
        record = AssetRecord(
            external_id=external_id,
            name=f"{prefix} {number}",
            category=canonical_category,
            location=location.strip() or "Fremdbestand",
            status="Verfuegbar",
            assigned_to="-",
            next_return="-",
            tag_number=tag_number,
            serial_number=serial_number,
            device_model=None,
            ip_address=None,
            mac_lan=None,
            mac_wlan=None,
            qr_code=_build_qr_code(external_id, tag_number),
            maintenance_state="",
            notes="",
            last_checkout="-",
            next_reservation="-",
            source_file=None,
            ownership_type=normalized_ownership,
            source_name=source_name,
            available_from=available_from,
            available_until=available_until,
            return_due_date=return_due_date,
            returned_at=None,
            external_note=external_note,
        )
        db.add(record)
        created_ids.append(external_id)
    db.commit()
    return created_ids


def mark_asset_returned(
    db: Session,
    external_id: str,
    *,
    returned_at: date | None = None,
) -> AssetItem:
    """Markiert ein Fremdbestand-Gerät als zurückgegeben.

    Verweigert die Aktion, wenn das Gerät aktuell verliehen ist — der
    Workflow muss erst regulär per Check-in zurückgenommen werden.
    """
    record = db.scalar(select(AssetRecord).where(AssetRecord.external_id == external_id))
    if not record:
        raise HTTPException(status_code=404, detail="Asset nicht gefunden.")
    if _normalize_ownership_type(record.ownership_type) == "owned":
        raise HTTPException(
            status_code=400,
            detail="Eigenbestand kann nicht als zurückgegeben markiert werden.",
        )
    if _normalize_asset_status(record.status) == "Verliehen":
        raise HTTPException(
            status_code=400,
            detail=(
                "Dieses Gerät ist aktuell noch ausgegeben und kann erst nach "
                "Rücknahme als zurückgegeben markiert werden."
            ),
        )
    record.returned_at = returned_at or date.today()
    db.commit()
    db.refresh(record)
    return _asset_to_schema(record, category_repository.active_category_names(db))


def list_activities(db: Session) -> list[ActivityItem]:
    # Activities wachsen monoton (jeder Checkout/Checkin/Defekt erzeugt einen
    # Eintrag) und werden im Overview-Endpoint bei jedem 15-s-Polling voll
    # serialisiert. Wir liefern deshalb nur die juengsten 200 — das ist
    # ausreichend fuer die Aktivitaeten-Anzeige im Dashboard und haelt das
    # Payload klein. Es findet KEINE Datenmutation statt — der Backup-Export
    # geht weiterhin direkt ueber das Repository / Schema, nicht ueber diese
    # Sicht.
    stmt = (
        select(ActivityRecord)
        .order_by(ActivityRecord.created_at.desc())
        .limit(200)
    )
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


def _normalize_location_name(name: str | None, *, fallback: str = "Hauptlager") -> str:
    normalized = (name or "").strip()
    return normalized or fallback


def _upsert_location_record(
    db: Session,
    *,
    name: str,
    assigned_assets: int,
    available_assets: int,
) -> LocationRecord:
    record = db.scalar(select(LocationRecord).where(LocationRecord.name == name))
    if record is None:
        record = LocationRecord(
            name=name,
            capacity=str(assigned_assets),
            assigned_assets=assigned_assets,
            available_assets=available_assets,
            manager="System",
        )
        db.add(record)
        db.flush()
        return record
    record.assigned_assets = assigned_assets
    record.available_assets = available_assets
    if not (record.capacity or "").strip():
        record.capacity = str(assigned_assets)
    if not (record.manager or "").strip():
        record.manager = "System"
    return record


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
    normalized_name = _normalize_location_name(name)
    if normalized_name == "Hauptlager":
        raise HTTPException(status_code=409, detail="Hauptlager kann nicht gelöscht werden.")
    referenced_assets = db.scalar(
        select(func.count()).select_from(AssetRecord).where(AssetRecord.location == normalized_name)
    )
    if int(referenced_assets or 0) > 0:
        raise HTTPException(
            status_code=409,
            detail="Standort wird noch von Assets verwendet. Bitte Geräte zuerst umziehen.",
        )
    stmt = select(LocationRecord).where(LocationRecord.name == normalized_name)
    record = db.scalar(stmt)
    if not record:
        return False
    db.delete(record)
    db.commit()
    return True


def cleanup_unused_locations(db: Session, *, keep_name: str = "Hauptlager") -> tuple[str, list[str], list[str]]:
    kept_location = _normalize_location_name(keep_name)
    asset_rows = db.execute(select(AssetRecord.location, AssetRecord.status)).all()
    assigned_counts: dict[str, int] = {}
    available_counts: dict[str, int] = {}
    active_locations: set[str] = set()
    for location, status in asset_rows:
        normalized_location = _normalize_location_name(location)
        active_locations.add(normalized_location)
        assigned_counts[normalized_location] = assigned_counts.get(normalized_location, 0) + 1
        if _normalize_asset_status(status) == "Verfuegbar":
            available_counts[normalized_location] = available_counts.get(normalized_location, 0) + 1

    _upsert_location_record(
        db,
        name=kept_location,
        assigned_assets=assigned_counts.get(kept_location, 0),
        available_assets=available_counts.get(kept_location, 0),
    )

    deleted_locations: list[str] = []
    skipped_locations: list[str] = []
    for record in db.scalars(select(LocationRecord).order_by(LocationRecord.name.asc())).all():
        if record.name == kept_location:
            continue
        if record.name in active_locations:
            record.assigned_assets = assigned_counts.get(record.name, 0)
            record.available_assets = available_counts.get(record.name, 0)
            skipped_locations.append(record.name)
            continue
        deleted_locations.append(record.name)
        db.delete(record)

    db.commit()
    return kept_location, deleted_locations, skipped_locations


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
        previous_role = record.role
        previous_is_active = record.is_active
        for key, value in payload.items():
            setattr(record, key, value)
        # Security-Audit Paket B2: Rollen- oder Aktiv-Status-Aenderung
        # invalidiert alle bestehenden Tokens dieses Benutzers.
        if record.role != previous_role or record.is_active != previous_is_active:
            record.token_version = int(record.token_version or 0) + 1
    else:
        record = UserRecord(
            external_id=item.id,
            password_hash=hash_password(secrets.token_urlsafe(24)),
            # Signaturfarbe automatisch vergeben (deterministisch aus der ID).
            signature_color=pick_signature_color(item.id),
            signature_color_source=SIGNATURE_COLOR_SOURCE_AUTO,
            **payload,
        )
        db.add(record)
    db.commit()
    db.refresh(record)
    return _user_to_schema(record)


def ensure_signature_colors(db: Session) -> int:
    """Startup-Backfill: vergibt Signaturfarben an Benutzer ohne Farbe.

    Idempotent - befuellt AUSSCHLIESSLICH leere Werte (deterministisch aus der
    User-ID, daher stabil ueber Neustarts und unabhaengig von geloeschten
    Benutzern). Manuell oder frueher automatisch gesetzte Farben bleiben
    unangetastet. Liefert die Anzahl nachgetragener Benutzer.
    """
    records = db.scalars(
        select(UserRecord).where(
            or_(UserRecord.signature_color.is_(None), UserRecord.signature_color == "")
        )
    ).all()
    for record in records:
        record.signature_color = pick_signature_color(record.external_id)
        record.signature_color_source = SIGNATURE_COLOR_SOURCE_AUTO
    if records:
        db.commit()
    return len(records)


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
    signature_color: str | None = None,
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

    previous_role = record.role
    previous_is_active = record.is_active

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
    if signature_color is not None:
        # Nur Farben aus der festen Palette zulassen; manuell gesetzte Farben
        # werden als 'manual' markiert und von der Automatik nie ueberschrieben.
        normalized_color = normalize_signature_color(signature_color)
        if normalized_color is None:
            raise HTTPException(
                status_code=422,
                detail="Ungueltige Signaturfarbe - bitte eine Farbe aus der Palette waehlen.",
            )
        record.signature_color = normalized_color
        record.signature_color_source = SIGNATURE_COLOR_SOURCE_MANUAL

    # Security-Audit Paket B2: Rollenwechsel oder (De-)Aktivierung
    # invalidiert alle bestehenden Tokens dieses Benutzers. Reine
    # Stammdaten-Aenderungen (Name, E-Mail, Abteilung, Standort) nicht.
    if record.role != previous_role or record.is_active != previous_is_active:
        record.token_version = int(record.token_version or 0) + 1

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
    # Security-Audit Paket B2: Passwortwechsel invalidiert alle bestehenden
    # Tokens dieses Benutzers.
    record.token_version = int(record.token_version or 0) + 1
    db.commit()
    return temporary_password


def _get_user_or_404(db: Session, external_id: str) -> UserRecord:
    record = db.scalar(select(UserRecord).where(UserRecord.external_id == external_id))
    if not record:
        raise HTTPException(status_code=404, detail="Benutzer nicht gefunden.")
    return record


def approve_user(db: Session, external_id: str, *, actor_user_id: str | None = None) -> UserItem:
    """Freigeben: Status auf Aktiv + Freigabe-Spur (wer/wann)."""
    record = _get_user_or_404(db, external_id)
    item = update_user(db, external_id, status="Aktiv", actor_user_id=actor_user_id)
    record.approved_at = datetime.now(UTC)
    record.approved_by = (actor_user_id or "").strip() or None
    record.rejected_at = None
    db.commit()
    return item


def reject_user(db: Session, external_id: str, *, actor_user_id: str | None = None) -> UserItem:
    """Ablehnen: nur aus "Wartet auf Freigabe" heraus erlaubt (409 sonst),
    damit die Aktion nicht als Abkürzung zum Stilllegen aktiver Konten dient.
    Bewusst kein Hard-Delete: Der Datensatz bleibt als Beleg erhalten und
    eine erneute Registrierung derselben E-Mail fällt als Duplikat auf.
    """
    record = _get_user_or_404(db, external_id)
    if _normalize_user_status(record.status) != "Wartet auf Freigabe":
        raise HTTPException(
            status_code=409,
            detail="Nur Benutzer mit Status 'Wartet auf Freigabe' können abgelehnt werden.",
        )
    item = update_user(db, external_id, status="Abgelehnt", actor_user_id=actor_user_id)
    record.rejected_at = datetime.now(UTC)
    db.commit()
    return item


def lock_user(db: Session, external_id: str, *, actor_user_id: str | None = None) -> UserItem:
    """Administratives Sperren (Status "Gesperrt", bis zum manuellen Entsperren).

    ``update_user`` setzt is_active=False und bumpt die token_version —
    laufende Sitzungen des Benutzers sind damit sofort ungültig.
    """
    _get_user_or_404(db, external_id)
    return update_user(db, external_id, status="Gesperrt", actor_user_id=actor_user_id)


def unlock_user(db: Session, external_id: str, *, actor_user_id: str | None = None) -> UserItem:
    """Entsperren: zurück auf Aktiv + temporäre Brute-Force-Sperre aufheben."""
    record = _get_user_or_404(db, external_id)
    item = update_user(db, external_id, status="Aktiv", actor_user_id=actor_user_id)
    record.failed_login_count = 0
    record.locked_until = None
    db.commit()
    return item


def get_user_security_info(db: Session, external_id: str) -> UserSecurityInfo:
    """Sicherheitsdetails eines Benutzers für das Admin-Modal.

    IP und User-Agent werden nur gekürzt ausgeliefert (Datenschutz) — die
    vollständigen Werte bleiben in der DB.
    """
    record = _get_user_or_404(db, external_id)

    def _fmt(value):
        return value.strftime("%d.%m.%Y %H:%M") if value else None

    return UserSecurityInfo(
        userId=record.external_id,
        status=_user_to_schema(record).status,
        createdAt=_fmt(record.created_at),
        lastLoginAt=_fmt(record.last_login_at),
        lastLoginAttemptAt=_fmt(record.last_login_attempt_at),
        lastLoginIp=security_event_service.shorten_ip(record.last_login_ip),
        lastLoginUserAgent=security_event_service.shorten_user_agent(record.last_login_user_agent),
        failedLoginCount=int(record.failed_login_count or 0),
        lockedUntil=_fmt(record.locked_until),
        approvedAt=_fmt(record.approved_at),
        approvedBy=record.approved_by,
        rejectedAt=_fmt(record.rejected_at),
    )


def get_overview(db: Session) -> WmsOverviewResponse:
    # Abschnitts-Timing: macht im Log sichtbar, welcher Teil des Overview-
    # Aufbaus teuer ist. Im Normalfall nur DEBUG; wird der Gesamtaufbau
    # spuerbar langsam, als WARNING inkl. Breakdown — so fallen Performance-
    # Regressionen auf, ohne die Logs im Normalbetrieb zu fluten.
    timings: dict[str, float] = {}

    def _timed(label, fn):
        start = time.perf_counter()
        try:
            return fn()
        finally:
            timings[label] = (time.perf_counter() - start) * 1000.0

    response = WmsOverviewResponse(
        assets=_timed("assets", lambda: list_assets(db)),
        activities=_timed("activities", lambda: list_activities(db)),
        reservations=_timed("reservations", lambda: list_reservations(db)),
        maintenanceItems=_timed("maintenance", lambda: list_maintenance(db)),
        locations=_timed("locations", lambda: list_locations(db)),
        categories=_timed("categories", lambda: category_repository.list_categories(db)),
        users=_timed("users", lambda: list_users(db)),
        planningSummary=_timed("planningSummary", lambda: _build_planning_summary(db)),
    )
    total_ms = sum(timings.values())
    breakdown = " ".join(f"{label}={ms:.0f}ms" for label, ms in timings.items())
    if total_ms >= _OVERVIEW_SLOW_THRESHOLD_MS:
        logger.warning("Overview-Aufbau langsam: gesamt=%.0fms | %s", total_ms, breakdown)
    else:
        logger.debug("Overview-Aufbau: gesamt=%.0fms | %s", total_ms, breakdown)
    return response


def _build_planning_summary(db: Session) -> PlanningSummaryItem:
    planning_statuses = ("Entwurf", "Geplant", "Bestaetigt", "Bestätigt")
    today = date.today()
    upcoming_end = today + timedelta(days=7)

    planning_rows = db.scalars(
        select(PlanningRecord)
        .where(PlanningRecord.status.in_(planning_statuses))
    ).all()
    if not planning_rows:
        return PlanningSummaryItem(
            todayPlannedQty=0,
            todayShortageCount=0,
            todayShortageItems=[],
            upcomingPlannedQty=0,
            upcomingShortageCount=0,
            openConflictCount=0,
            categorySummaries=[],
            conflictGroups=[],
            conflictCauseCount=0,
        )

    planning_external_ids = [row.external_id for row in planning_rows if row.external_id]
    # Globale offene Konflikte über die Batch-Funktion berechnen. So teilen sich
    # Overview (planningSummary.openConflictCount) und PlanungsListe
    # (PlanningListItem.openConflictCount) eine einzige, performante Berechnung
    # ohne wiederholte Verfügbarkeits-Joins pro Planung. Aus derselben
    # Berechnung wird zusätzlich die Konfliktursachen-Gruppierung abgeleitet —
    # ohne zweiten Durchlauf, additiv, ohne Einfluss auf openConflictCount.
    conflict_summaries = (
        planning_repository.get_open_conflict_summaries_for_plannings(db, planning_external_ids)
        if planning_external_ids
        else {}
    )
    open_conflict_count = sum(
        int(summary.get("count", 0) or 0) for summary in conflict_summaries.values()
    )
    planning_labels = {
        row.external_id: f"{row.customer_name} / {row.project_name}"
        for row in planning_rows
        if row.external_id
    }
    # Planungsstatus je Planung — Eingabe für die Entwurf-Empfehlungsregel.
    planning_status_map = {
        row.external_id: row.status
        for row in planning_rows
        if row.external_id
    }
    conflict_groups = planning_repository.group_conflict_causes(
        conflict_summaries, planning_labels, planning_status_map
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
            openConflictCount=open_conflict_count,
            categorySummaries=[],
            conflictGroups=conflict_groups,
            conflictCauseCount=len(conflict_groups),
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
            openConflictCount=open_conflict_count,
            categorySummaries=[],
            conflictGroups=conflict_groups,
            conflictCauseCount=len(conflict_groups),
        )

    # Bestand für die "heute"-Ansicht: nur Geräte mitzählen, die HEUTE
    # tatsächlich verfügbar sind (Eigenbestand immer, Fremdbestand nur wenn
    # innerhalb available_from / available_until und nicht returned_at).
    active_names = category_repository.active_category_names(db)
    usable_by_category: dict[str, int] = defaultdict(int)
    for asset in db.scalars(select(AssetRecord)).all():
        category = category_repository.normalize_category_value(asset.category, active_names)
        if planning_repository._is_asset_usable_on_date(asset, today):
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
        category = category_repository.normalize_category_value(item.category_key, active_names)
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
        openConflictCount=open_conflict_count,
        categorySummaries=category_summaries,
        conflictGroups=conflict_groups,
        conflictCauseCount=len(conflict_groups),
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
