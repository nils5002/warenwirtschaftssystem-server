from __future__ import annotations

import logging
from pathlib import Path

from sqlalchemy.orm import Session

from ..repositories import hardware_import_repository
from ..schemas.hardware_import import (
    HardwareImportFileSummary,
    HardwareImportRowError,
    HardwareImportRunResponse,
)
from .hardware_import.categorizer import categorize_hardware
from .hardware_import.importer import upsert_asset_by_serial
from .hardware_import.mapper import map_excel_row_to_asset
from .hardware_import.parser import list_excel_files, parse_excel_file
from .hardware_import.types import HardwareImportError, ParsedExcelRow
from .hardware_import.validator import clean_text, is_valid_ip, is_valid_mac, validate_mapped_payload

logger = logging.getLogger("cloud_web.hardware_import")


class ExcelImportService:
    """Orchestrates parser -> validator -> mapper -> importer pipeline."""

    @staticmethod
    def run_hardware_import(
        db: Session,
        import_dir: Path,
        *,
        dry_run: bool = False,
    ) -> HardwareImportRunResponse:
        if not import_dir.exists() or not import_dir.is_dir():
            raise FileNotFoundError(f"Import path not found or not a directory: {import_dir}")

        files, skipped_non_excel = list_excel_files(import_dir)
        run = hardware_import_repository.create_run(db, str(import_dir), len(files))

        created_count = 0
        updated_count = 0
        skipped_count = 0
        error_count = 0
        rows_total = 0
        files_processed = 0
        file_summaries: list[HardwareImportFileSummary] = []
        row_errors: list[HardwareImportError] = []
        seen_serials: set[str] = set()
        try:
            for file_path in files:
                try:
                    parsed_file = parse_excel_file(file_path)
                except Exception as exc:
                    logger.exception("Failed to parse Excel file: %s", file_path)
                    files_processed += 1
                    error_count += 1
                    summary = HardwareImportFileSummary(
                        file_name=file_path.name,
                        status="failed",
                        errors=1,
                        warnings=[f"Datei konnte nicht gelesen werden: {exc}"],
                    )
                    file_summaries.append(summary)
                    row_errors.append(
                        HardwareImportError(
                            file_name=file_path.name,
                            sheet_name="",
                            row_number=1,
                            reason=summary.warnings[0],
                            raw_data={},
                        )
                    )
                    continue

                summary = HardwareImportFileSummary(
                    file_name=parsed_file.file_name,
                    status="processed",
                    recognized_columns=parsed_file.recognized_columns,
                    inferred_category=categorize_hardware(
                        file_name=parsed_file.file_name,
                        name=Path(parsed_file.file_name).stem,
                        model=None,
                        description=None,
                    ),
                    missing_columns=parsed_file.missing_required_columns + parsed_file.missing_optional_columns,
                )
                files_processed += 1

                if "serial_number" not in (parsed_file.column_mapping or {}):
                    summary.warnings.append(
                        "Seriennummer-Spalte nicht gefunden – Seriennummern werden automatisch generiert."
                    )

                generated_serial_count = 0
                auto_name_count = 0
                for row in parsed_file.rows:
                    if _is_effectively_empty_row(row.data):
                        continue
                    rows_total += 1
                    summary.rows_seen += 1
                    row_data = _prepare_row_data(row.data, row.file_name, row.row_number)

                    mapped = map_excel_row_to_asset(
                        ParsedExcelRow(
                            file_name=parsed_file.file_name,
                            sheet_name=parsed_file.sheet_name,
                            row_number=row.row_number,
                            data=row_data,
                        )
                    )
                    validation_errors = validate_mapped_payload(mapped.payload)
                    if validation_errors:
                        if any("Kategorie-Zuordnung erforderlich" in msg for msg in validation_errors):
                            summary.unresolved_category_rows += 1
                        reason = "; ".join(validation_errors)
                        err = HardwareImportError(
                            file_name=row.file_name,
                            sheet_name=row.sheet_name,
                            row_number=row.row_number,
                            reason=reason,
                            serial_number=mapped.serial_number or None,
                            raw_data={k: _to_json_safe(v) for k, v in row_data.items() if not k.startswith("_")},
                        )
                        row_errors.append(err)
                        error_count += 1
                        summary.errors += 1
                        continue

                    if mapped.serial_number in seen_serials:
                        err = HardwareImportError(
                            file_name=row.file_name,
                            sheet_name=row.sheet_name,
                            row_number=row.row_number,
                            serial_number=mapped.serial_number,
                            reason="Duplikat in Importlauf (Seriennummer mehrfach in Dateien).",
                            raw_data={k: _to_json_safe(v) for k, v in row_data.items() if not k.startswith("_")},
                        )
                        row_errors.append(err)
                        error_count += 1
                        skipped_count += 1
                        summary.errors += 1
                        summary.skipped += 1
                        summary.duplicate_candidates += 1
                        continue

                    seen_serials.add(mapped.serial_number)
                    summary.rows_valid += 1
                    action = upsert_asset_by_serial(db, mapped.payload, dry_run=dry_run)
                    if action.action == "created":
                        created_count += 1
                        summary.created += 1
                    elif action.action == "updated":
                        updated_count += 1
                        summary.updated += 1
                        summary.duplicate_candidates += 1
                    else:
                        skipped_count += 1
                        summary.skipped += 1
                        if action.reason and "No changes" in action.reason:
                            summary.duplicate_candidates += 1

                    if mapped.payload.get("category") == "Zuordnung erforderlich":
                        summary.unresolved_category_rows += 1
                    if mapped.auto_generated_name:
                        auto_name_count += 1
                    if mapped.auto_generated_serial:
                        generated_serial_count += 1
                if generated_serial_count:
                    summary.warnings.append(
                        f"{generated_serial_count} Datensaetze ohne Seriennummer haben eine stabile AUTO-Seriennummer erhalten."
                    )
                if auto_name_count:
                    summary.warnings.append(
                        f"{auto_name_count} Gerätenamen wurden automatisch erzeugt."
                    )
                file_summaries.append(summary)

            for err in row_errors:
                hardware_import_repository.append_error(
                    db,
                    run.id,
                    file_name=err.file_name,
                    sheet_name=err.sheet_name,
                    row_number=err.row_number,
                    serial_number=err.serial_number,
                    reason=err.reason,
                    raw_data=err.raw_data,
                )

            status = "completed"
            if error_count > 0:
                if created_count + updated_count + skipped_count > 0:
                    status = "completed_with_errors"
                else:
                    status = "failed"

            details = {
                "dry_run": dry_run,
                "skipped_non_excel_files": skipped_non_excel,
                "file_summaries": [item.model_dump() for item in file_summaries],
            }
            run = hardware_import_repository.finalize_run(
                db,
                run,
                status=status,
                files_processed=files_processed,
                rows_total=rows_total,
                created_count=created_count,
                updated_count=updated_count,
                skipped_count=skipped_count,
                error_count=error_count,
                details=details,
            )
            logger.info(
                "Hardware import finished (run_id=%s, status=%s, created=%s, updated=%s, skipped=%s, errors=%s)",
                run.id,
                status,
                created_count,
                updated_count,
                skipped_count,
                error_count,
            )
            return ExcelImportService._to_response(db, run.id, error_limit=200)
        except Exception as exc:
            logger.exception("Hardware import failed unexpectedly (run_id=%s)", run.id)
            details = {
                "dry_run": dry_run,
                "skipped_non_excel_files": skipped_non_excel,
                "file_summaries": [item.model_dump() for item in file_summaries],
                "fatal_error": str(exc),
            }
            hardware_import_repository.finalize_run(
                db,
                run,
                status="failed",
                files_processed=files_processed,
                rows_total=rows_total,
                created_count=created_count,
                updated_count=updated_count,
                skipped_count=skipped_count,
                error_count=error_count + 1,
                details=details,
            )
            raise

    @staticmethod
    def get_run_status(db: Session, run_id: int, error_limit: int = 200) -> HardwareImportRunResponse | None:
        run = hardware_import_repository.get_run(db, run_id)
        if not run:
            return None
        return ExcelImportService._to_response(db, run_id, error_limit=error_limit)

    @staticmethod
    def _to_response(db: Session, run_id: int, error_limit: int = 200) -> HardwareImportRunResponse:
        run = hardware_import_repository.get_run(db, run_id)
        if not run:
            raise ValueError(f"Import run {run_id} not found")
        error_rows = hardware_import_repository.list_errors(db, run_id, limit=error_limit)
        return HardwareImportRunResponse(
            run_id=run.id,
            status=run.status,
            started_at=run.started_at,
            finished_at=run.finished_at,
            import_path=run.import_path,
            files_total=run.files_total,
            files_processed=run.files_processed,
            rows_total=run.rows_total,
            created_count=run.created_count,
            updated_count=run.updated_count,
            skipped_count=run.skipped_count,
            error_count=run.error_count,
            details=run.details_json or {},
            errors=[
                HardwareImportRowError(
                    file_name=item.file_name,
                    sheet_name=item.sheet_name,
                    row_number=item.row_number,
                    serial_number=item.serial_number,
                    reason=item.reason,
                    raw_data=item.raw_data or {},
                )
                for item in error_rows
            ],
        )


def _to_json_safe(value: object) -> object:
    if value is None:
        return None
    if isinstance(value, (int, float, bool, str)):
        return value
    return str(value)


def _prepare_row_data(raw_data: dict[str, object], file_name: str, row_number: int) -> dict[str, object]:
    data = dict(raw_data)
    _sanitize_network_columns(data)
    serial = clean_text(data.get("serial_number"))
    sim_number = clean_text(data.get("sim_number"))

    if not serial and sim_number:
        data["serial_number"] = sim_number

    if not clean_text(data.get("status")):
        data["status"] = "Verfuegbar"

    return data


def _is_effectively_empty_row(data: dict[str, object]) -> bool:
    return all(clean_text(value) == "" for value in data.values())


def _sanitize_network_columns(data: dict[str, object]) -> None:
    warnings: list[str] = []

    ip_addr = clean_text(data.get("ip_address"))
    if ip_addr and not is_valid_ip(ip_addr):
        data["ip_address"] = ""
        warnings.append(f"IP-Adresse ungültig und ignoriert: {ip_addr}")

    mac_lan = clean_text(data.get("mac_lan"))
    if mac_lan and not is_valid_mac(mac_lan):
        data["mac_lan"] = ""
        warnings.append(f"MAC LAN ungültig und ignoriert: {mac_lan}")

    mac_wlan = clean_text(data.get("mac_wlan"))
    if mac_wlan and not is_valid_mac(mac_wlan):
        data["mac_wlan"] = ""
        warnings.append(f"MAC WLAN ungültig und ignoriert: {mac_wlan}")

    if warnings:
        existing = data.get("_row_warnings")
        if isinstance(existing, list):
            existing.extend(warnings)
        else:
            data["_row_warnings"] = warnings
