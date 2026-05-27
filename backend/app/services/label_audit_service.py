"""Fachlogik für die Admin-Seite "Label-Prüfung".

Reines Audit-/Lese-Werkzeug. Die einzige Schreiboperation gegen die Datenbank
betrifft die eigenen Tabellen ``label_audit_sessions`` / ``label_audit_scans``.
Assets werden ausschließlich GELESEN (Scan-Auflösung, Summary) — niemals
mutiert. Es werden keine Status-, Planungs-, Defekt-, Reservierungs- oder
Aktivitätsdaten geändert.
"""

from __future__ import annotations

from datetime import datetime
from urllib.parse import parse_qs, unquote, urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database.models import AssetRecord, LabelAuditScanRecord, LabelAuditSessionRecord
from ..repositories import label_audit_repository as repo
from ..schemas.label_audit import (
    LabelAuditScanResponse,
    LabelAuditScanResult,
    LabelAuditSessionListItem,
    LabelAuditSessionResponse,
    LabelAuditSummary,
)

# Obergrenze für das "Zuletzt gescannt"-Protokoll (analog zum bisherigen
# Frontend-Verhalten). Die Counts werden separat aggregiert, sind also
# unabhängig von dieser Kappung korrekt.
RECENT_LIMIT = 60


class LabelAuditArchivedError(Exception):
    """In eine archivierte Prüfrunde darf nicht mehr gescannt werden."""


class LabelAuditActiveConflictError(Exception):
    """Reaktivieren abgelehnt: es gibt bereits eine andere aktive Prüfrunde."""


class LabelAuditAssetNotFoundError(Exception):
    """Das beim Zuordnen angegebene Asset existiert nicht."""


# ---------------------------------------------------------------------------
# Stabile Asset-Identität + Scan-Auflösung (serverseitiger Port von qr.ts)
# ---------------------------------------------------------------------------

def asset_stable_key(asset: AssetRecord) -> str:
    """Stabile, physische Identität: Seriennummer → Inventarnummer → id.

    Normalisiert (trim + lowercase). Übersteht Reimport/Reseed, weil Serien-/
    Inventarnummer am Gerät bzw. gedruckten Label haften, während die interne
    external_id neu vergeben wird.
    """
    serial = (asset.serial_number or "").strip()
    tag = (asset.tag_number or "").strip()
    return (serial or tag or asset.external_id).strip().lower()


def _asset_qr(asset: AssetRecord) -> str:
    existing = (asset.qr_code or "").strip()
    if existing:
        return existing
    return f"WMS|{asset.external_id}|{asset.tag_number}"


def _safe_decode(value: str) -> str:
    try:
        return unquote(value)
    except Exception:
        return value


def _scan_lookup(raw: str) -> set[str]:
    """Erzeugt die normalisierte Kandidatenmenge eines Scan-Rohwerts."""
    variants: set[str] = set()
    decoded = _safe_decode(raw)
    variants.add(raw)
    variants.add(decoded)

    for value in (raw, decoded):
        marker = value.find("WMS|")
        if marker >= 0:
            variants.add(value[marker:].strip())
        if "|" in value:
            parts = value.split("|")
            if len(parts) > 1:
                variants.add(parts[1])
        parsed = urlparse(value)
        if parsed.scheme and parsed.netloc:
            variants.add(parsed.path.lstrip("/"))
            for values in parse_qs(parsed.query).values():
                for item in values:
                    variants.add(item)

    return {entry.strip().lower() for entry in variants if entry and entry.strip()}


def resolve_asset_by_scan(assets: list[AssetRecord], raw_value: str) -> AssetRecord | None:
    """Löst einen Scan-Rohwert gegen den Bestand auf (qr_code/id/tag/serial)."""
    raw = (raw_value or "").strip()
    if not raw:
        return None
    lookup = _scan_lookup(raw)
    for asset in assets:
        qr = _asset_qr(asset)
        candidates = {
            entry.strip().lower()
            for entry in (qr, asset.external_id, asset.tag_number, asset.serial_number)
            if entry and entry.strip()
        }
        if candidates & lookup:
            return asset
        if qr.startswith("WMS|"):
            qr_parts = qr.split("|")
            if len(qr_parts) > 1:
                qr_asset_id = qr_parts[1].strip().lower()
                if qr_asset_id and qr_asset_id in lookup:
                    return asset
    return None


# ---------------------------------------------------------------------------
# Mapping + Response-Aufbau
# ---------------------------------------------------------------------------

def _scan_to_schema(record: LabelAuditScanRecord) -> LabelAuditScanResponse:
    scanned_at = record.scanned_at or datetime.utcnow()
    return LabelAuditScanResponse(
        id=record.external_id,
        scanValue=record.scan_value,
        scanKind=record.scan_kind,  # type: ignore[arg-type]
        assetId=record.asset_id,
        assetStableKey=record.asset_stable_key,
        assetLabel=record.asset_label,
        category=record.category,
        serialNumber=record.serial_number,
        tagNumber=record.tag_number,
        scannedAt=scanned_at,
        scannedByUserId=record.scanned_by_user_id,
        note=record.note,
        ignored=record.ignored_at is not None,
        ignoreReason=record.ignore_reason,
    )


def _load_assets(db: Session) -> list[AssetRecord]:
    return list(db.scalars(select(AssetRecord)).all())


def _build_summary(
    db: Session, session: LabelAuditSessionRecord, assets: list[AssetRecord]
) -> tuple[LabelAuditSummary, list[str]]:
    # Geprüft = nicht-ignorierte matched/corrected Scans, gegen den aktuellen
    # Bestand über den stabilen Key aufgelöst. Da hier über die Asset-Liste
    # eindeutig aufgelöst wird, zählt jeder Key höchstens einmal (robust gegen
    # mehrfache matched/corrected-Scans desselben Geräts).
    checked_keys = repo.get_checked_stable_keys(db, session.id)
    checked_asset_ids = [
        asset.external_id for asset in assets if asset_stable_key(asset) in checked_keys
    ]
    counts = repo.count_by_kind(db, session.id)
    total = len(assets)
    checked = len(checked_asset_ids)
    summary = LabelAuditSummary(
        total=total,
        checked=checked,
        open=max(0, total - checked),
        duplicates=int(counts.get("duplicate", 0)),
        unknown=int(counts.get("unknown", 0)),
        ignored=repo.count_ignored(db, session.id),
    )
    return summary, checked_asset_ids


def _build_session_response(
    db: Session, session: LabelAuditSessionRecord, assets: list[AssetRecord]
) -> LabelAuditSessionResponse:
    summary, checked_asset_ids = _build_summary(db, session, assets)
    recent = repo.get_recent_scans(db, session.id, RECENT_LIMIT)
    return LabelAuditSessionResponse(
        id=session.external_id,
        name=session.name,
        status=session.status,  # type: ignore[arg-type]
        note=session.note,
        createdAt=session.created_at,
        updatedAt=session.updated_at,
        createdByUserId=session.created_by_user_id,
        summary=summary,
        recentScans=[_scan_to_schema(record) for record in recent],
        checkedAssetIds=checked_asset_ids,
    )


def _build_list_item(
    db: Session, session: LabelAuditSessionRecord, assets: list[AssetRecord]
) -> LabelAuditSessionListItem:
    summary, _ = _build_summary(db, session, assets)
    return LabelAuditSessionListItem(
        id=session.external_id,
        name=session.name,
        status=session.status,  # type: ignore[arg-type]
        note=session.note,
        createdAt=session.created_at,
        updatedAt=session.updated_at,
        summary=summary,
    )


# ---------------------------------------------------------------------------
# Service-API
# ---------------------------------------------------------------------------

class LabelAuditService:
    @staticmethod
    def list_sessions(db: Session) -> list[LabelAuditSessionListItem]:
        assets = _load_assets(db)
        return [_build_list_item(db, record, assets) for record in repo.list_sessions(db)]

    @staticmethod
    def create_session(
        db: Session, *, name: str, note: str | None, user_id: str | None
    ) -> LabelAuditSessionResponse:
        record = repo.create_session(db, name=name, note=note, user_id=user_id)
        return _build_session_response(db, record, _load_assets(db))

    @staticmethod
    def get_or_create_active(db: Session, *, user_id: str | None) -> LabelAuditSessionResponse:
        record = repo.get_active_session(db)
        if record is None:
            record = repo.create_session(
                db, name=_default_session_name(), note=None, user_id=user_id
            )
        return _build_session_response(db, record, _load_assets(db))

    @staticmethod
    def get_session(db: Session, external_id: str) -> LabelAuditSessionResponse | None:
        record = repo.get_session(db, external_id)
        if record is None:
            return None
        return _build_session_response(db, record, _load_assets(db))

    @staticmethod
    def archive_session(db: Session, external_id: str) -> LabelAuditSessionResponse | None:
        record = repo.archive_session(db, external_id)
        if record is None:
            return None
        return _build_session_response(db, record, _load_assets(db))

    @staticmethod
    def update_session(
        db: Session, external_id: str, *, fields: dict
    ) -> LabelAuditSessionResponse | None:
        """Bearbeitet Name/Notiz/Status einer Prüfrunde (nur gesetzte Felder).

        Reaktivierung (archived → active) ist die risikoärmere Variante: Sie
        wird ABGELEHNT, wenn bereits eine andere aktive Runde existiert
        (statt diese still zu archivieren). So überrascht die Aktion den Admin
        nicht damit, eine möglicherweise gerade laufende Runde zu beenden — er
        archiviert die aktive Runde bewusst selbst und reaktiviert dann.
        """
        record = repo.get_session(db, external_id)
        if record is None:
            return None
        new_status = fields.get("status")
        if (
            "status" in fields
            and new_status == "active"
            and record.status != "active"
        ):
            other = repo.get_active_session(db)
            if other is not None and other.id != record.id:
                raise LabelAuditActiveConflictError(other.external_id)
        if "name" in fields and fields["name"] is not None:
            record.name = fields["name"]
        if "note" in fields:
            record.note = fields["note"]
        if "status" in fields and new_status is not None:
            record.status = new_status
        repo.save_session(db, record)
        return _build_session_response(db, record, _load_assets(db))

    @staticmethod
    def update_scan(
        db: Session,
        session_external_id: str,
        scan_external_id: str,
        *,
        fields: dict,
        user_id: str | None,
    ) -> LabelAuditScanResult | None:
        """Korrigiert einen einzelnen Scan (Notiz, Ignorieren, Asset-Zuordnung).

        Verändert ausschließlich den Audit-Scan — niemals echte Hardwaredaten.
        """
        session = repo.get_session(db, session_external_id)
        if session is None:
            return None
        scan = repo.get_scan(db, session.id, scan_external_id)
        if scan is None:
            return None

        now = datetime.utcnow()

        # 1) Asset-Zuordnung (unknown/falsch zugeordnet → einem Asset zuweisen).
        if fields.get("assetId"):
            asset = db.scalar(
                select(AssetRecord).where(AssetRecord.external_id == fields["assetId"])
            )
            if asset is None:
                raise LabelAuditAssetNotFoundError(fields["assetId"])
            stable_key = asset_stable_key(asset)
            # Robust gegen Doppelzählung: ist der Key in dieser Runde bereits
            # (nicht-ignoriert) geprüft, wird der korrigierte Scan als
            # ``duplicate`` markiert; sonst als ``corrected``. Zusätzlich zählt
            # die Summary nur eindeutige Keys — doppelte Sicherheit.
            already = repo.has_checked_stable_key(
                db, session.id, stable_key, exclude_scan_id=scan.id
            )
            scan.scan_kind = "duplicate" if already else "corrected"
            scan.asset_id = asset.external_id
            scan.asset_stable_key = stable_key
            scan.asset_label = asset.name
            scan.category = asset.category
            scan.serial_number = asset.serial_number
            scan.tag_number = asset.tag_number
            scan.corrected_at = now
            scan.corrected_by_user_id = user_id
            # scan_value (Rohwert) bleibt bewusst unverändert erhalten.
            if "correctionNote" in fields:
                scan.correction_note = fields["correctionNote"]

        # 2) Ignorieren / Ignorierung aufheben (Soft-Delete).
        if "ignored" in fields and fields["ignored"] is not None:
            if fields["ignored"]:
                scan.ignored_at = now
                scan.ignored_by_user_id = user_id
                if "ignoreReason" in fields:
                    scan.ignore_reason = fields["ignoreReason"]
            else:
                scan.ignored_at = None
                scan.ignored_by_user_id = None
                scan.ignore_reason = None
        elif "ignoreReason" in fields:
            # Grund nachpflegen ohne den Ignoriert-Status zu ändern.
            scan.ignore_reason = fields["ignoreReason"]

        # 3) Freie Notiz.
        if "note" in fields:
            scan.note = fields["note"]

        repo.save_scan(db, scan, session)
        session_response = _build_session_response(db, session, _load_assets(db))
        return LabelAuditScanResult(scan=_scan_to_schema(scan), session=session_response)

    @staticmethod
    def scan(
        db: Session, external_id: str, scan_value: str, *, user_id: str | None
    ) -> LabelAuditScanResult | None:
        session = repo.get_session(db, external_id)
        if session is None:
            return None
        if session.status != "active":
            raise LabelAuditArchivedError(session.external_id)
        assets = _load_assets(db)
        match = resolve_asset_by_scan(assets, scan_value)

        if match is not None:
            stable_key = asset_stable_key(match)
            is_duplicate = repo.has_checked_stable_key(db, session.id, stable_key)
            scan = repo.add_scan(
                db,
                session_id=session.id,
                scan_value=scan_value,
                scan_kind="duplicate" if is_duplicate else "matched",
                asset_id=match.external_id,
                asset_stable_key=stable_key,
                asset_label=match.name,
                category=match.category,
                serial_number=match.serial_number,
                tag_number=match.tag_number,
                user_id=user_id,
            )
        else:
            scan = repo.add_scan(
                db,
                session_id=session.id,
                scan_value=scan_value,
                scan_kind="unknown",
                asset_id=None,
                asset_stable_key=None,
                asset_label=None,
                category=None,
                serial_number=None,
                tag_number=None,
                user_id=user_id,
            )

        # Bestand erneut laden ist nicht nötig — Assets sind unverändert (reines
        # Audit), wir verwenden dieselbe Liste für die aktualisierte Summary.
        db.refresh(session)
        session_response = _build_session_response(db, session, assets)
        return LabelAuditScanResult(scan=_scan_to_schema(scan), session=session_response)


def _default_session_name() -> str:
    now = datetime.now()
    months = [
        "Januar", "Februar", "März", "April", "Mai", "Juni",
        "Juli", "August", "September", "Oktober", "November", "Dezember",
    ]
    return f"Label-Prüfung {months[now.month - 1]} {now.year}"
