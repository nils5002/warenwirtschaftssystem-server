"""Sammel-QR (Gruppen-QR) für bereits vorhandene Assets.

Eine Gruppe bündelt mehrere echte Einzel-Assets (typisch Fremdbestand) hinter
einem QR-Code. Sie erzeugt KEINEN eigenen Bestand: gebucht werden immer die
echten Assets über ``wms_repository.upsert_asset`` — derselbe Status-Flip,
dieselbe Activity- und Planungslogik wie beim Einzelscan. Die Einsatzplanung
liest ausschließlich ``AssetRecord`` und sieht diese Tabellen nie, daher kann
durch eine Gruppe weder doppelter Bestand noch doppelte Planungszählung
entstehen.
"""

from __future__ import annotations

import secrets
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database.models import (
    AssetRecord,
    QrCodeGroupMemberRecord,
    QrCodeGroupRecord,
    UserRecord,
)
from ..schemas.wms import (
    QrGroupBookingResult,
    QrGroupCheckinPayload,
    QrGroupCheckoutPayload,
    QrGroupCreatePayload,
    QrGroupItem,
)
from . import category_repository, wms_repository

_FREMDBESTAND = {"rented", "borrowed", "external"}


def qr_code_for_token(qr_token: str) -> str:
    """Der im QR-Code kodierte Scan-Wert einer Gruppe."""
    return f"GROUP:{qr_token}"


def _operator_name(db: Session, actor_user_id: str | None) -> str:
    """Anzeigename des buchenden Benutzers für die Notiz-Zeilen.

    Spiegelt ``useWmsController.currentOperatorName``. Fällt auf einen neutralen
    Label zurück, wenn der Benutzer nicht auflösbar ist.
    """
    if isinstance(actor_user_id, str) and actor_user_id.strip():
        record = db.scalar(
            select(UserRecord).where(UserRecord.external_id == actor_user_id.strip())
        )
        if record:
            name = (record.name or "").strip()
            if name:
                return name
            email = (record.email or "").strip()
            if email:
                return email
    return "System"


def _member_asset_records(db: Session, group: QrCodeGroupRecord) -> list[AssetRecord]:
    """Live-Join der Gruppe auf vorhandene Assets.

    Mitglieder, deren Asset gelöscht wurde, fallen automatisch heraus.
    Deterministisch nach external_id sortiert (stabile Auswahl-Reihenfolge).
    """
    member_ids = [
        member.asset_external_id
        for member in db.scalars(
            select(QrCodeGroupMemberRecord).where(
                QrCodeGroupMemberRecord.group_id == group.id
            )
        ).all()
    ]
    if not member_ids:
        return []
    return list(
        db.scalars(
            select(AssetRecord)
            .where(AssetRecord.external_id.in_(member_ids))
            .order_by(AssetRecord.external_id.asc())
        ).all()
    )


def _available_records(records: list[AssetRecord]) -> list[AssetRecord]:
    """Verfügbar = Status Verfuegbar UND nicht an Vermieter zurückgegeben.

    Schließt Defekt/In Wartung (Status != Verfuegbar) sowie bereits verliehene
    Geräte automatisch aus.
    """
    out: list[AssetRecord] = []
    for record in records:
        if wms_repository._normalize_asset_status(record.status) != "Verfuegbar":
            continue
        if record.returned_at is not None:
            continue
        out.append(record)
    return out


def _loaned_records(records: list[AssetRecord]) -> list[AssetRecord]:
    return [
        record
        for record in records
        if wms_repository._normalize_asset_status(record.status) == "Verliehen"
    ]


def _to_item(db: Session, group: QrCodeGroupRecord) -> QrGroupItem:
    records = _member_asset_records(db, group)
    available = _available_records(records)
    loaned = _loaned_records(records)
    created_at = group.created_at.isoformat() if group.created_at else None
    return QrGroupItem(
        id=group.external_id,
        name=group.name,
        qrToken=group.qr_token,
        qrCode=qr_code_for_token(group.qr_token),
        category=group.category,
        stockType=group.stock_type,
        sourceName=group.source_name,
        isActive=bool(group.is_active),
        memberCount=len(records),
        availableCount=len(available),
        loanedCount=len(loaned),
        createdAt=created_at,
    )


def list_groups(db: Session) -> list[QrGroupItem]:
    groups = db.scalars(
        select(QrCodeGroupRecord).order_by(QrCodeGroupRecord.created_at.desc())
    ).all()
    return [_to_item(db, group) for group in groups]


def get_group(db: Session, external_id: str) -> QrCodeGroupRecord | None:
    return db.scalar(
        select(QrCodeGroupRecord).where(QrCodeGroupRecord.external_id == external_id)
    )


def resolve_by_token(db: Session, token: str) -> QrGroupItem:
    clean = (token or "").strip()
    group = db.scalar(select(QrCodeGroupRecord).where(QrCodeGroupRecord.qr_token == clean))
    if group is None:
        raise HTTPException(status_code=404, detail="Sammel-QR nicht gefunden.")
    if not bool(group.is_active):
        raise HTTPException(status_code=410, detail="Dieser Sammel-QR ist deaktiviert.")
    return _to_item(db, group)


def create_group(
    db: Session,
    payload: QrGroupCreatePayload,
    *,
    actor_user_id: str | None = None,
) -> QrGroupItem:
    asset_ids = [aid.strip() for aid in payload.assetIds if aid and aid.strip()]
    # Duplikate entfernen, Reihenfolge beibehalten.
    seen: set[str] = set()
    unique_ids: list[str] = []
    for aid in asset_ids:
        if aid not in seen:
            seen.add(aid)
            unique_ids.append(aid)
    if not unique_ids:
        raise HTTPException(status_code=400, detail="Bitte mindestens ein Gerät auswählen.")

    records = list(
        db.scalars(select(AssetRecord).where(AssetRecord.external_id.in_(unique_ids))).all()
    )
    found_ids = {record.external_id for record in records}
    missing = [aid for aid in unique_ids if aid not in found_ids]
    if missing:
        raise HTTPException(
            status_code=400,
            detail="Mindestens ein ausgewähltes Gerät existiert nicht mehr.",
        )

    # Nur Fremdbestand: Eigenbestand darf nicht in eine Sammelbuchung.
    non_external = [
        record
        for record in records
        if wms_repository._normalize_ownership_type(record.ownership_type) not in _FREMDBESTAND
    ]
    if non_external:
        raise HTTPException(
            status_code=400,
            detail="Sammel-QR ist nur für Fremdbestand (Miet-/Leih-/externe Geräte) möglich.",
        )

    # Einkategorig: alle Mitglieder müssen dieselbe Kategorie wie die Gruppe haben.
    canonical_category = category_repository.normalize_category_for_db(db, payload.category)
    mismatched = [
        record
        for record in records
        if category_repository.normalize_category_for_db(db, record.category) != canonical_category
    ]
    if mismatched:
        raise HTTPException(
            status_code=400,
            detail="Alle Geräte einer Sammel-QR müssen dieselbe Kategorie haben.",
        )

    # Bestandsart ableiten, falls nicht explizit gesetzt.
    stock_type = payload.stockType or wms_repository._normalize_ownership_type(
        records[0].ownership_type
    )

    suffix = secrets.token_hex(4)
    group = QrCodeGroupRecord(
        external_id=f"qrg-{suffix}",
        name=payload.name.strip(),
        qr_token=secrets.token_hex(16),
        category=canonical_category,
        stock_type=stock_type,
        source_name=(payload.sourceName or None),
        created_by_user_id=(actor_user_id or None),
        is_active=True,
    )
    db.add(group)
    db.flush()  # group.id für Member nötig

    for record in records:
        db.add(
            QrCodeGroupMemberRecord(
                group_id=group.id,
                asset_external_id=record.external_id,
            )
        )
    db.commit()
    db.refresh(group)
    return _to_item(db, group)


def deactivate_group(db: Session, external_id: str) -> QrGroupItem:
    group = get_group(db, external_id)
    if group is None:
        raise HTTPException(status_code=404, detail="Sammel-QR nicht gefunden.")
    group.is_active = False
    db.commit()
    db.refresh(group)
    return _to_item(db, group)


def _format_checkout_assigned_to(recipient: str, project: str) -> str:
    """Spiegelt useWmsController.checkoutAsset → assignedToValue."""
    if project and recipient == "-":
        return f"- · {project}"
    if recipient != "-" and project:
        return f"{recipient} · {project}"
    return recipient


def bulk_checkout(
    db: Session,
    external_id: str,
    payload: QrGroupCheckoutPayload,
    *,
    actor_user_id: str | None = None,
) -> QrGroupBookingResult:
    group = get_group(db, external_id)
    if group is None:
        raise HTTPException(status_code=404, detail="Sammel-QR nicht gefunden.")
    if not bool(group.is_active):
        raise HTTPException(status_code=410, detail="Dieser Sammel-QR ist deaktiviert.")

    records = _member_asset_records(db, group)
    available = _available_records(records)
    if payload.quantity > len(available):
        raise HTTPException(
            status_code=400,
            detail=f"Nur {len(available)} Gerät(e) in dieser Gruppe verfügbar.",
        )

    operator = _operator_name(db, actor_user_id)
    project = (payload.projectName or "").strip()
    recipient = (payload.assignee or "").strip() or "-"
    note = (payload.note or "").strip()
    due = (payload.dueDate or "").strip()
    planning_id = (payload.planningId or "").strip() or None
    known_categories = category_repository.active_category_names(db)

    metadata_lines = [
        f"Projekt: {project}" if project else "",
        f"Ausgabe durch: {operator}",
        f"Notiz: {note}" if note else "",
    ]
    metadata_lines = [line for line in metadata_lines if line]
    today_de = datetime.now().strftime("%d.%m.%Y")

    booked: list[str] = []
    for record in available[: payload.quantity]:
        item = wms_repository._asset_to_schema(record, known_categories)
        item.status = "Verliehen"
        item.assignedTo = _format_checkout_assigned_to(recipient, project)
        item.nextReturn = due or item.nextReturn
        item.lastCheckout = today_de
        existing_notes = item.notes or ""
        item.notes = (
            f"{existing_notes}\n{chr(10).join(metadata_lines)}".strip()
            if metadata_lines
            else existing_notes
        )
        item.assignedPlanningId = planning_id
        wms_repository.upsert_asset(db, item, actor_user_id=actor_user_id)
        booked.append(record.external_id)

    return QrGroupBookingResult(
        groupId=group.external_id,
        requestedCount=payload.quantity,
        bookedCount=len(booked),
        bookedAssetIds=booked,
        message=(
            "Ein Gerät wurde ausgegeben."
            if len(booked) == 1
            else f"{len(booked)} Geräte wurden ausgegeben."
        ),
    )


def bulk_checkin(
    db: Session,
    external_id: str,
    payload: QrGroupCheckinPayload,
    *,
    actor_user_id: str | None = None,
) -> QrGroupBookingResult:
    group = get_group(db, external_id)
    if group is None:
        raise HTTPException(status_code=404, detail="Sammel-QR nicht gefunden.")

    records = _member_asset_records(db, group)
    loaned = _loaned_records(records)
    if payload.quantity > len(loaned):
        raise HTTPException(
            status_code=400,
            detail=f"Nur {len(loaned)} Gerät(e) aus dieser Gruppe aktuell verliehen.",
        )

    operator = _operator_name(db, actor_user_id)
    project = (payload.projectName or "").strip()
    note = (payload.condition or "").strip() or "Zustand geprüft."
    known_categories = category_repository.active_category_names(db)

    return_lines = [
        f"Rücknahme: {note}",
        f"Rücknahme durch: {operator}",
        f"Projektkontext: {project}" if project else "",
    ]
    return_lines = [line for line in return_lines if line]

    booked: list[str] = []
    for record in loaned[: payload.quantity]:
        item = wms_repository._asset_to_schema(record, known_categories)
        item.status = "Verfuegbar"
        item.assignedTo = "-"
        item.nextReturn = "-"
        item.nextReservation = "-"
        existing_notes = item.notes or ""
        item.notes = f"{existing_notes}\n{chr(10).join(return_lines)}".strip()
        wms_repository.upsert_asset(db, item, actor_user_id=actor_user_id)
        booked.append(record.external_id)

    return QrGroupBookingResult(
        groupId=group.external_id,
        requestedCount=payload.quantity,
        bookedCount=len(booked),
        bookedAssetIds=booked,
        message=(
            "Ein Gerät wurde zurückgenommen."
            if len(booked) == 1
            else f"{len(booked)} Geräte wurden zurückgenommen."
        ),
    )
