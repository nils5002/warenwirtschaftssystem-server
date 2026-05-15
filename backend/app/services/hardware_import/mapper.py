from __future__ import annotations

import hashlib
import uuid
from pathlib import Path
from typing import Any, Iterable

from .categorizer import (
    CATEGORY_HANDHELDS,
    CATEGORY_IPADS,
    CATEGORY_LTE_ROUTERS,
    CATEGORY_NOTEBOOKS,
    CATEGORY_PRINTERS,
    CATEGORY_QR_SCANNERS,
    CATEGORY_ROUTERS,
    infer_category_with_source,
)
from .types import HardwareImportMappedRow, ParsedExcelRow
from .validator import clean_text, is_valid_ip, is_valid_mac


def map_excel_row_to_asset(
    row: ParsedExcelRow,
    *,
    known_extra_categories: Iterable[str] | None = None,
) -> HardwareImportMappedRow:
    raw_name = clean_text(row.data.get("name"))
    inventory_number = clean_text(row.data.get("inventory_number"))
    device_model = clean_text(row.data.get("model")) or None
    description = clean_text(row.data.get("description")) or None
    serial_candidate = clean_text(row.data.get("serial_number"))
    sim_number = clean_text(row.data.get("sim_number"))
    phone_number = clean_text(row.data.get("phone_number"))
    power_supply = clean_text(row.data.get("power_supply"))
    language = clean_text(row.data.get("language"))

    card_printer_compatible = _parse_optional_bool(row.data.get("card_printer_compatible"))

    explicit_category = clean_text(row.data.get("category"))
    category_from_header = clean_text(row.data.get("category_source"))
    sheet_name = clean_text(row.data.get("_sheet_name")) or row.sheet_name
    title_hint = clean_text(row.data.get("_title_hint"))
    category, category_source, category_source_label = infer_category_with_source(
        explicit_category=explicit_category or None,
        header_category=category_from_header or None,
        sheet_name=sheet_name or None,
        file_name=Path(row.file_name).stem,
        title_hint=title_hint or None,
        name=raw_name or inventory_number,
        model=device_model,
        description=description,
        known_extra_categories=known_extra_categories,
    )

    ip_address = clean_text(row.data.get("ip_address")) or None
    if ip_address and not is_valid_ip(ip_address):
        ip_address = None

    mac_lan = normalize_mac(clean_text(row.data.get("mac_lan"))) or None
    if mac_lan and not is_valid_mac(mac_lan):
        mac_lan = None

    mac_wlan = normalize_mac(clean_text(row.data.get("mac_wlan"))) or None
    if mac_wlan and not is_valid_mac(mac_wlan):
        mac_wlan = None

    mac_generic = normalize_mac(clean_text(row.data.get("mac_generic"))) or None
    if mac_generic and not is_valid_mac(mac_generic):
        mac_generic = None
    if mac_generic:
        if not mac_wlan and _prefers_wlan_mac(category):
            mac_wlan = mac_generic
        elif not mac_lan:
            mac_lan = mac_generic
        elif not mac_wlan:
            mac_wlan = mac_generic

    name, auto_generated_name = derive_device_name(
        category=category,
        file_name=row.file_name,
        row_number=row.row_number,
        raw_name=raw_name,
        inventory_number=inventory_number,
        model=device_model,
        serial_candidate=serial_candidate or sim_number,
    )

    serial = normalize_serial(serial_candidate or sim_number)
    auto_generated_serial = False
    if not serial:
        serial = build_auto_serial(
            category=category,
            name=name,
            mac_lan=mac_lan,
            mac_wlan=mac_wlan,
            ip_address=ip_address,
        )
        auto_generated_serial = True

    external_id = f"asset-{uuid.uuid5(uuid.NAMESPACE_DNS, serial).hex[:12]}"
    tag_number = build_tag_number(serial, inventory_number=inventory_number)
    import_status = clean_text(row.data.get("status")) or None
    location = infer_location(row.file_name)
    qr_code = f"WMS|{external_id}|{tag_number}"

    row_warnings_raw = row.data.get("_row_warnings")
    row_warnings = []
    if isinstance(row_warnings_raw, list):
        row_warnings = [clean_text(item) for item in row_warnings_raw if clean_text(item)]
    notes = build_notes(
        file_name=row.file_name,
        description=description,
        explicit_category=explicit_category or None,
        normalized_category=category if category != "Zuordnung erforderlich" else None,
        import_status=import_status,
        sim_number=sim_number or None,
        phone_number=phone_number or None,
        power_supply=power_supply or None,
        language=language or None,
        row_warnings=row_warnings,
        category_source=category_source,
        category_source_label=category_source_label,
    )

    payload: dict[str, Any] = {
        "external_id": external_id,
        "name": name,
        "category": category,
        "location": location,
        "status": "Verfuegbar",
        "assigned_to": "-",
        "next_return": "-",
        "tag_number": tag_number,
        "serial_number": serial,
        "device_model": device_model,
        "ip_address": ip_address,
        "mac_lan": mac_lan,
        "mac_wlan": mac_wlan,
        "qr_code": qr_code,
        "maintenance_state": "Importiert",
        "notes": notes,
        "last_checkout": "-",
        "next_reservation": "-",
        "source_file": row.file_name,
        # Default True (= keine Einschränkung). Nur bei explizit "nein"/"false"
        # in der Excel-Spalte wird der Laptop für Projekte mit Kartendrucker
        # ausgeschlossen (z. B. MacBook Neo).
        "card_printer_compatible": True if card_printer_compatible is None else card_printer_compatible,
    }
    return HardwareImportMappedRow(
        file_name=row.file_name,
        sheet_name=row.sheet_name,
        row_number=row.row_number,
        serial_number=serial,
        payload=payload,
        auto_generated_name=auto_generated_name,
        auto_generated_serial=auto_generated_serial,
        category_source=category_source,
    )


def derive_device_name(
    *,
    category: str,
    file_name: str,
    row_number: int,
    raw_name: str,
    inventory_number: str,
    model: str | None,
    serial_candidate: str,
) -> tuple[str, bool]:
    fallback_id = inventory_number or serial_candidate or str(row_number)
    stem = Path(file_name).stem.lower()
    synthetic_name = raw_name.lower().startswith(f"{stem}-")
    usable_name = "" if synthetic_name else raw_name
    is_numeric_name = usable_name.isdigit()

    if category == CATEGORY_IPADS:
        if usable_name and not is_numeric_name:
            return usable_name, False
        return f"iPad {fallback_id}", True

    if category == CATEGORY_HANDHELDS:
        if usable_name and not is_numeric_name:
            return usable_name, False
        return f"Handheld {fallback_id}", True

    if category == CATEGORY_QR_SCANNERS:
        if usable_name and not is_numeric_name:
            return usable_name, False
        return f"QR-Code-Scanner {fallback_id}", True

    if category == CATEGORY_PRINTERS:
        if usable_name and not is_numeric_name:
            return usable_name, False
        if usable_name and is_numeric_name:
            return f"Drucker {usable_name}", True
        if model:
            return f"Drucker {model}", True
        return f"Drucker {fallback_id}", True

    if category in {CATEGORY_LTE_ROUTERS, CATEGORY_ROUTERS, CATEGORY_NOTEBOOKS}:
        if usable_name and not is_numeric_name:
            return usable_name, False
        return f"{category} {fallback_id}", True

    if usable_name and not is_numeric_name:
        return usable_name, False

    if model:
        return f"{model} {fallback_id}", True

    return f"{Path(file_name).stem[:30]} {fallback_id}".strip(), True


def normalize_serial(serial: str) -> str:
    return " ".join(serial.strip().split())


def build_auto_serial(
    *,
    category: str,
    name: str,
    mac_lan: str | None,
    mac_wlan: str | None,
    ip_address: str | None,
) -> str:
    slug = "".join(ch for ch in category.upper() if ch.isalnum())
    if not slug:
        slug = "ASSET"
    seed = "|".join([category, name, mac_lan or "", mac_wlan or "", ip_address or ""])
    digest = hashlib.sha1(seed.encode("utf-8")).hexdigest()[:12].upper()
    return f"AUTO-{slug}-{digest}"


def normalize_mac(value: str) -> str:
    compact = "".join(ch for ch in value.strip().upper() if ch in "0123456789ABCDEF")
    if len(compact) == 12:
        return ":".join(compact[i : i + 2] for i in range(0, 12, 2))
    return value.strip().upper()


def build_tag_number(serial: str, *, inventory_number: str) -> str:
    seed = serial or inventory_number
    clean = "".join(ch for ch in seed.upper() if ch.isalnum())
    if not clean:
        clean = uuid.uuid4().hex[:10].upper()
    return f"IMP-{clean[:20]}"


def build_notes(
    *,
    file_name: str,
    description: str | None = None,
    explicit_category: str | None = None,
    normalized_category: str | None = None,
    import_status: str | None = None,
    sim_number: str | None = None,
    phone_number: str | None = None,
    power_supply: str | None = None,
    language: str | None = None,
    row_warnings: list[str] | None = None,
    category_source: str | None = None,
    category_source_label: str | None = None,
) -> str:
    lines = [f"Importiert aus Excel-Datei: {file_name}"]
    if category_source:
        lines.append(f"Kategoriequelle: {category_source}{f' ({category_source_label})' if category_source_label else ''}")
    if description:
        lines.append(f"Beschreibung: {description}")
    if explicit_category and not normalized_category:
        lines.append(f"Kategorie-Zuordnung erforderlich: {explicit_category}")
    if import_status:
        lines.append(f"Import-Status (Legacy): {import_status}")
    if sim_number:
        lines.append(f"SIM-Kartennummer: {sim_number}")
    if phone_number:
        lines.append(f"Rufnummer: {phone_number}")
    if power_supply:
        lines.append(f"Netzteil: {power_supply}")
    if language:
        lines.append(f"Sprache: {language}")
    if row_warnings:
        lines.append(f"Import-Hinweise: {'; '.join(row_warnings)}")
    return "\n".join(lines)


def infer_location(file_name: str) -> str:
    normalized = file_name.lower()
    if normalized.startswith("event_"):
        return "Eventlager"
    if "genolive" in normalized:
        return "Genolive Lager"
    return "Hauptlager"


def _prefers_wlan_mac(category: str) -> bool:
    return category in {CATEGORY_IPADS, "Smartphone", CATEGORY_HANDHELDS}


_TRUTHY_BOOL_TOKENS = {"ja", "yes", "true", "wahr", "x", "1", "kompatibel", "compatible"}
_FALSY_BOOL_TOKENS = {"nein", "no", "false", "falsch", "0", "inkompatibel", "incompatible"}


def _parse_optional_bool(value: Any) -> bool | None:
    """Liest einen optionalen Bool-Wert aus einer Excel-Zelle.

    Leere/unbekannte Werte → ``None`` (= "nicht gesetzt", Aufrufer entscheidet
    über den Default). Vermeidet stilles Ja/Nein bei Tippfehlern.
    """
    text = clean_text(value).strip().lower()
    if not text:
        return None
    if text in _TRUTHY_BOOL_TOKENS:
        return True
    if text in _FALSY_BOOL_TOKENS:
        return False
    return None
