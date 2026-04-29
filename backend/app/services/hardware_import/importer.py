from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ...database.models import AssetRecord


@dataclass(slots=True)
class ImporterAction:
    action: str
    record: AssetRecord | None = None
    reason: str | None = None


def upsert_asset_by_serial(
    db: Session,
    payload: dict[str, Any],
    *,
    dry_run: bool = False,
) -> ImporterAction:
    serial = str(payload.get("serial_number") or "")
    is_auto_serial = serial.startswith("AUTO-")

    candidate = _find_duplicate_candidate(db, payload, is_auto_serial=is_auto_serial)
    if candidate:
        if dry_run:
            updated = would_update(candidate, payload)
            return ImporterAction(action="updated" if updated else "skipped", record=candidate)
        updated = apply_update(candidate, payload)
        if updated:
            db.add(candidate)
            return ImporterAction(action="updated", record=candidate)
        return ImporterAction(action="skipped", record=candidate, reason="No changes")

    candidate_tag = str(payload.get("tag_number") or "")
    if candidate_tag and db.scalar(select(AssetRecord.id).where(AssetRecord.tag_number == candidate_tag)):
        suffix = (serial[-6:] if serial else "IMPORT").upper().replace(" ", "")
        payload["tag_number"] = f"{candidate_tag[:24]}-{suffix}"[:32]

    if dry_run:
        return ImporterAction(action="created")

    record = AssetRecord(**payload)
    db.add(record)
    return ImporterAction(action="created", record=record)


def _find_duplicate_candidate(db: Session, payload: dict[str, Any], *, is_auto_serial: bool) -> AssetRecord | None:
    serial = str(payload.get("serial_number") or "")
    if serial and not is_auto_serial:
        existing = db.scalar(select(AssetRecord).where(AssetRecord.serial_number == serial))
        if existing:
            return existing

    mac_lan = str(payload.get("mac_lan") or "").strip()
    mac_wlan = str(payload.get("mac_wlan") or "").strip()
    if mac_lan or mac_wlan:
        clauses = []
        if mac_lan:
            clauses.append(AssetRecord.mac_lan == mac_lan)
        if mac_wlan:
            clauses.append(AssetRecord.mac_wlan == mac_wlan)
        candidate = db.scalar(select(AssetRecord).where(or_(*clauses)))
        if candidate:
            return candidate

    name = str(payload.get("name") or "").strip()
    category = str(payload.get("category") or "").strip()
    if name and category:
        candidate = db.scalar(select(AssetRecord).where(AssetRecord.name == name, AssetRecord.category == category))
        if candidate:
            return candidate

    ip_address = str(payload.get("ip_address") or "").strip()
    if ip_address and category:
        candidate = db.scalar(
            select(AssetRecord).where(AssetRecord.ip_address == ip_address, AssetRecord.category == category)
        )
        if candidate:
            return candidate

    if serial and is_auto_serial:
        candidate = db.scalar(select(AssetRecord).where(AssetRecord.serial_number == serial))
        if candidate:
            return candidate

    return None


def apply_update(record: AssetRecord, payload: dict[str, Any]) -> bool:
    changed = False
    for field in (
        "serial_number",
        "category",
        "location",
        "name",
        "device_model",
        "ip_address",
        "mac_lan",
        "mac_wlan",
        "status",
        "source_file",
    ):
        new_value = payload.get(field)
        if new_value and getattr(record, field) != new_value:
            setattr(record, field, new_value)
            changed = True

    if payload.get("notes") and payload["notes"] not in (record.notes or ""):
        merged_notes = (record.notes + "\n" + payload["notes"]).strip() if record.notes else payload["notes"]
        record.notes = merged_notes
        changed = True
    return changed


def would_update(record: AssetRecord, payload: dict[str, Any]) -> bool:
    for field in (
        "serial_number",
        "category",
        "location",
        "name",
        "device_model",
        "ip_address",
        "mac_lan",
        "mac_wlan",
        "status",
        "source_file",
    ):
        new_value = payload.get(field)
        if new_value and getattr(record, field) != new_value:
            return True
    if payload.get("notes") and payload["notes"] not in (record.notes or ""):
        return True
    return False
