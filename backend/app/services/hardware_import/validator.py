from __future__ import annotations

import ipaddress
import re
from typing import Any

MAC_PATTERN = re.compile(r"^[0-9A-F]{12}$", re.IGNORECASE)


def validate_row(data: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    # Backward-compatible pre-check. Final validation happens after mapping.
    if not any(
        clean_text(data.get(field))
        for field in ("name", "serial_number", "model", "ip_address", "mac_lan", "mac_wlan", "mac_generic")
    ):
        errors.append("Keine verwertbaren Felder erkannt (Name/Seriennummer/Modell/IP/MAC fehlen).")
    return errors


def validate_mapped_payload(payload: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    category = clean_text(payload.get("category"))
    name = clean_text(payload.get("name"))
    serial = clean_text(payload.get("serial_number"))
    ip_address = clean_text(payload.get("ip_address"))
    mac_lan = clean_text(payload.get("mac_lan"))
    mac_wlan = clean_text(payload.get("mac_wlan"))

    if not category or category == "Zuordnung erforderlich":
        errors.append("Kategorie-Zuordnung erforderlich.")
    if not any([serial, name, mac_lan, mac_wlan, ip_address]):
        errors.append("Mindestens eine Identifikation erforderlich (Seriennummer/Name/MAC/IP).")
    return errors


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, int):
        text = str(value)
    elif isinstance(value, float):
        if value.is_integer():
            text = str(int(value))
        else:
            text = format(value, "f").rstrip("0").rstrip(".")
    else:
        text = str(value)
    normalized = text.strip()
    if normalized.lower() in {"-", "--", "n/a", "na", "none", "null", "usb"}:
        return ""
    return normalized


def is_valid_ip(value: str) -> bool:
    try:
        ipaddress.ip_address(value)
        return True
    except ValueError:
        return False


def is_valid_mac(value: str) -> bool:
    compact = re.sub(r"[^0-9A-Fa-f]", "", value)
    return bool(MAC_PATTERN.fullmatch(compact))
