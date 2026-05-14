from __future__ import annotations

import tempfile
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from openpyxl import Workbook
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..database.models import AssetRecord
from ..repositories import category_repository
from ..schemas.hardware_import import (
    HardwareImportConfirmResponse,
    HardwareImportPreviewResponse,
    HardwareImportRowError,
)
from .excel_import_service import _is_effectively_empty_row, _prepare_row_data
from .hardware_import.categorizer import categorize_hardware
from .hardware_import.importer import upsert_asset_by_serial
from .hardware_import.mapper import map_excel_row_to_asset
from .hardware_import.parser import parse_excel_file
from .hardware_import.types import ParsedExcelRow
from .hardware_import.validator import clean_text, validate_mapped_payload

_ALLOWED_IMPORT_SUFFIXES = {".xlsx", ".xlsm"}
_PREVIEW_TTL = timedelta(minutes=30)


@dataclass(slots=True)
class ImportPreviewState:
    preview_id: str
    file_name: str
    created_at: datetime
    mapped_payloads: list[dict[str, Any]] = field(default_factory=list)
    errors: list[HardwareImportRowError] = field(default_factory=list)


class UploadImportService:
    _preview_cache: dict[str, ImportPreviewState] = {}

    @classmethod
    def preview_upload(
        cls,
        db: Session,
        *,
        file_name: str,
        file_bytes: bytes,
    ) -> HardwareImportPreviewResponse:
        cls._cleanup_expired()
        suffix = Path(file_name).suffix.lower()
        if suffix not in _ALLOWED_IMPORT_SUFFIXES:
            raise ValueError("Nur .xlsx oder .xlsm sind erlaubt.")

        temp_path = cls._write_temp_file(file_name=file_name, file_bytes=file_bytes)
        try:
            parsed_file = parse_excel_file(temp_path, original_file_name=file_name)
        finally:
            temp_path.unlink(missing_ok=True)

        # Eigene (DB-)Kategorien aus dem Kategorien-Modul mitgeben, damit der
        # Importer sie genauso akzeptiert wie die hartcodierten Standards.
        # Sonst wuerde z. B. "DYMO" als "Zuordnung erforderlich" abgewiesen,
        # obwohl der Operator die Kategorie zuvor sauber im UI angelegt hat.
        known_extra_categories = category_repository.active_category_names(db)

        seen_serials: set[str] = set()
        mapped_payloads: list[dict[str, Any]] = []
        errors: list[HardwareImportRowError] = []
        warnings: list[str] = []
        rows_total = 0
        rows_valid = 0
        new_assets = 0
        duplicate_candidates = 0
        unresolved_category_rows = 0
        auto_generated_names = 0
        auto_generated_serials = 0

        for row in parsed_file.rows:
            if _is_effectively_empty_row(row.data):
                continue
            rows_total += 1
            row_data = _prepare_row_data(row.data, row.file_name, row.row_number)
            mapped = map_excel_row_to_asset(
                ParsedExcelRow(
                    file_name=parsed_file.file_name,
                    sheet_name=parsed_file.sheet_name,
                    row_number=row.row_number,
                    data=row_data,
                ),
                known_extra_categories=known_extra_categories,
            )
            validation_errors = validate_mapped_payload(mapped.payload)
            if validation_errors:
                if any("Kategorie-Zuordnung erforderlich" in msg for msg in validation_errors):
                    unresolved_category_rows += 1
                errors.append(
                    HardwareImportRowError(
                        file_name=row.file_name,
                        sheet_name=row.sheet_name,
                        row_number=row.row_number,
                        serial_number=mapped.serial_number or None,
                        reason="; ".join(validation_errors),
                        raw_data={k: cls._to_json_safe(v) for k, v in row_data.items() if not k.startswith("_")},
                    )
                )
                continue

            if mapped.serial_number in seen_serials:
                duplicate_candidates += 1
                errors.append(
                    HardwareImportRowError(
                        file_name=row.file_name,
                        sheet_name=row.sheet_name,
                        row_number=row.row_number,
                        serial_number=mapped.serial_number,
                        reason="Duplikat in hochgeladener Datei (Seriennummer mehrfach).",
                        raw_data={k: cls._to_json_safe(v) for k, v in row_data.items() if not k.startswith("_")},
                    )
                )
                continue

            seen_serials.add(mapped.serial_number)
            rows_valid += 1
            if mapped.payload.get("category") == "Zuordnung erforderlich":
                unresolved_category_rows += 1
            if mapped.auto_generated_name:
                auto_generated_names += 1
            if mapped.auto_generated_serial:
                auto_generated_serials += 1

            if cls._would_match_existing_asset(db, mapped.payload):
                duplicate_candidates += 1
            else:
                new_assets += 1
            mapped_payloads.append(mapped.payload)

        if parsed_file.missing_required_columns:
            warnings.append(f"Fehlende Pflichtspalten: {', '.join(parsed_file.missing_required_columns)}")
        if "serial_number" not in (parsed_file.column_mapping or {}):
            warnings.append(
                "Seriennummer-Spalte nicht gefunden – Seriennummern werden automatisch und deterministisch generiert."
            )
        other_optional = [c for c in parsed_file.missing_optional_columns if c != "serial_number"]
        if other_optional:
            warnings.append(f"Nicht erkannte optionale Spalten: {', '.join(other_optional)}")
        if auto_generated_names:
            warnings.append(
                f"{auto_generated_names} Gerätenamen wurden automatisch aus Kategorie + Nummer erzeugt."
            )
        if auto_generated_serials:
            warnings.append(f"{auto_generated_serials} AUTO-Seriennummern wurden deterministisch erzeugt.")

        inferred_category = parsed_file.inferred_category or categorize_hardware(
            file_name=parsed_file.file_name,
            name=Path(parsed_file.file_name).stem,
            model=None,
            description=None,
        )
        preview_id = uuid4().hex
        cls._preview_cache[preview_id] = ImportPreviewState(
            preview_id=preview_id,
            file_name=parsed_file.file_name,
            created_at=datetime.now(timezone.utc),
            mapped_payloads=mapped_payloads,
            errors=errors,
        )

        return HardwareImportPreviewResponse(
            preview_id=preview_id,
            file_name=parsed_file.file_name,
            recognized_columns=parsed_file.recognized_columns,
            column_mapping=parsed_file.column_mapping,
            inferred_category=inferred_category,
            inferred_category_source=parsed_file.inferred_category_source,
            rows_total=rows_total,
            rows_valid=rows_valid,
            new_assets=new_assets,
            duplicate_candidates=duplicate_candidates,
            unresolved_category_rows=unresolved_category_rows,
            auto_generated_names=auto_generated_names,
            auto_generated_serials=auto_generated_serials,
            missing_columns=parsed_file.missing_required_columns + parsed_file.missing_optional_columns,
            warnings=warnings,
            errors=errors,
        )

    @classmethod
    def confirm_preview(cls, db: Session, preview_id: str) -> HardwareImportConfirmResponse:
        cls._cleanup_expired()
        state = cls._preview_cache.get(preview_id)
        if not state:
            raise ValueError("Import-Vorschau nicht gefunden oder abgelaufen.")

        imported = 0
        updated = 0
        skipped = 0
        runtime_errors: list[HardwareImportRowError] = []
        for payload in state.mapped_payloads:
            try:
                action = upsert_asset_by_serial(db, payload, dry_run=False)
            except Exception as exc:  # noqa: BLE001
                runtime_errors.append(
                    HardwareImportRowError(
                        file_name=state.file_name,
                        sheet_name="",
                        row_number=0,
                        serial_number=payload.get("serial_number"),
                        reason=f"Import fehlgeschlagen: {exc}",
                        raw_data={k: cls._to_json_safe(v) for k, v in payload.items()},
                    )
                )
                continue
            if action.action == "created":
                imported += 1
            elif action.action == "updated":
                updated += 1
            else:
                skipped += 1

        db.commit()
        cls._preview_cache.pop(preview_id, None)
        all_errors = [*state.errors, *runtime_errors]
        return HardwareImportConfirmResponse(
            preview_id=preview_id,
            imported_count=imported,
            updated_count=updated,
            skipped_count=skipped,
            error_count=len(all_errors),
            errors=all_errors,
        )

    @staticmethod
    def build_template_workbook() -> bytes:
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "Import"
        sheet.append(["Event Laptops"])
        sheet.append(
            [
                "Name",
                "Modell",
                "Seriennummer",
                "IP-Adresse",
                "Mac-Adresse LAN",
                "Mac-Adresse WLAN",
                "Kategorie",
                "Notizen",
            ]
        )
        sheet.append(
            [
                "CX-EVENT-01",
                "Lenovo T14",
                "PF-2YA4ZY",
                "192.168.10.141",
                "90-2E-16-19-CF-24",
                "F4-4E-E3-96-DC-E6",
                "Laptop",
                "Import-Beispiel",
            ]
        )
        sheet.append(
            [
                "CX-EVENT-02",
                "Lenovo T14",
                "PF-2YA500",
                "192.168.10.142",
                "90-2E-16-19-CF-25",
                "F4-4E-E3-96-DC-E7",
                "Laptop",
                "Import-Beispiel",
            ]
        )

        with tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx") as handle:
            temp_path = Path(handle.name)
        try:
            workbook.save(temp_path)
            return temp_path.read_bytes()
        finally:
            temp_path.unlink(missing_ok=True)

    @staticmethod
    def _write_temp_file(*, file_name: str, file_bytes: bytes) -> Path:
        suffix = Path(file_name).suffix or ".xlsx"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as handle:
            handle.write(file_bytes)
            return Path(handle.name)

    @classmethod
    def _cleanup_expired(cls) -> None:
        now = datetime.now(timezone.utc)
        expired = [
            preview_id
            for preview_id, state in cls._preview_cache.items()
            if now - state.created_at > _PREVIEW_TTL
        ]
        for preview_id in expired:
            cls._preview_cache.pop(preview_id, None)

    @staticmethod
    def _would_match_existing_asset(db: Session, payload: dict[str, Any]) -> bool:
        serial_number = str(payload.get("serial_number") or "")
        is_auto_serial = serial_number.startswith("AUTO-")
        if serial_number and not is_auto_serial:
            if db.scalar(select(AssetRecord.id).where(AssetRecord.serial_number == serial_number)):
                return True

        mac_lan = str(payload.get("mac_lan") or "").strip()
        mac_wlan = str(payload.get("mac_wlan") or "").strip()
        if mac_lan or mac_wlan:
            clauses = []
            if mac_lan:
                clauses.append(AssetRecord.mac_lan == mac_lan)
            if mac_wlan:
                clauses.append(AssetRecord.mac_wlan == mac_wlan)
            if db.scalar(select(AssetRecord.id).where(or_(*clauses))):
                return True

        name = str(payload.get("name") or "").strip()
        category = str(payload.get("category") or "").strip()
        if name and category:
            if db.scalar(select(AssetRecord.id).where(AssetRecord.name == name, AssetRecord.category == category)):
                return True

        ip_address = str(payload.get("ip_address") or "").strip()
        if ip_address and category:
            if db.scalar(
                select(AssetRecord.id).where(AssetRecord.ip_address == ip_address, AssetRecord.category == category)
            ):
                return True

        if serial_number and is_auto_serial:
            if db.scalar(select(AssetRecord.id).where(AssetRecord.serial_number == serial_number)):
                return True
        return False

    @staticmethod
    def _to_json_safe(value: Any) -> Any:
        if value is None:
            return None
        if isinstance(value, (int, float, bool, str)):
            return value
        return str(value)
