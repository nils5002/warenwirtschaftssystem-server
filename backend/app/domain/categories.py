from __future__ import annotations

import re
import unicodedata


CANONICAL_CATEGORIES: tuple[str, ...] = (
    "Laptop",
    "iPad",
    "Handheld",
    "Smartphone",
    "QR-Code-Scanner",
    "Drucker",
    "Kartendrucker",
    "Switch",
    "Router",
    "LTE-Router",
    "Zubehör",
    "Sonstiges",
)

DEFAULT_CATEGORY = "Sonstiges"
UNASSIGNED_CATEGORY = "Zuordnung erforderlich"


def _category_key(value: str | None) -> str:
    raw = (value or "").strip().casefold()
    normalized = unicodedata.normalize("NFKD", raw)
    ascii_value = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", "", ascii_value)


_CATEGORY_ALIASES: dict[str, str] = {
    "laptop": "Laptop",
    "laptops": "Laptop",
    "notebook": "Laptop",
    "notebooks": "Laptop",
    "macbook": "Laptop",
    "thinkpad": "Laptop",
    "ipad": "iPad",
    "ipads": "iPad",
    "tablet": "iPad",
    "tablets": "iPad",
    "handheld": "Handheld",
    "handhelds": "Handheld",
    "handhelden": "Handheld",
    "smartphone": "Smartphone",
    "smartphones": "Smartphone",
    "phone": "Smartphone",
    "phones": "Smartphone",
    "iphone": "Smartphone",
    "qrcodescanner": "QR-Code-Scanner",
    "qrcodescanners": "QR-Code-Scanner",
    "qrcode": "QR-Code-Scanner",
    "qrscanner": "QR-Code-Scanner",
    "qrscanners": "QR-Code-Scanner",
    "scanner": "QR-Code-Scanner",
    "scanners": "QR-Code-Scanner",
    "handscanner": "QR-Code-Scanner",
    "handscanners": "QR-Code-Scanner",
    "barcodescanner": "QR-Code-Scanner",
    "barcodescanners": "QR-Code-Scanner",
    "drucker": "Drucker",
    "printer": "Drucker",
    "printers": "Drucker",
    "laserdrucker": "Drucker",
    "kartendrucker": "Kartendrucker",
    "cardprinter": "Kartendrucker",
    "cardprinters": "Kartendrucker",
    "switch": "Switch",
    "switches": "Switch",
    "router": "Router",
    "routers": "Router",
    "wlanrouter": "Router",
    "wifirouter": "Router",
    "gateway": "Router",
    "lterouter": "LTE-Router",
    "lterouters": "LTE-Router",
    "4grouter": "LTE-Router",
    "5grouter": "LTE-Router",
    "zubehoer": "Zubehör",
    "zubehör": "Zubehör",
    "accessory": "Zubehör",
    "accessories": "Zubehör",
    "sonstiges": "Sonstiges",
    "misc": "Sonstiges",
    "miscellaneous": "Sonstiges",
    "other": "Sonstiges",
}

_CATEGORY_ALIASES.update({_category_key(category): category for category in CANONICAL_CATEGORIES})


def normalize_category(value: str | None) -> str:
    return _CATEGORY_ALIASES.get(_category_key(value), DEFAULT_CATEGORY)


def normalize_category_or_self(value: str | None) -> str:
    raw = (value or "").strip()
    return _CATEGORY_ALIASES.get(_category_key(raw), raw or DEFAULT_CATEGORY)


def normalize_known_category(value: str | None, known_categories: set[str]) -> str:
    raw = (value or "").strip()
    if raw in known_categories:
        return raw
    normalized = _CATEGORY_ALIASES.get(_category_key(raw))
    if normalized and normalized in known_categories:
        return normalized
    return UNASSIGNED_CATEGORY


def is_canonical_category(value: str | None) -> bool:
    return (value or "").strip() in CANONICAL_CATEGORIES


def category_hint(value: str | None) -> str | None:
    category = normalize_category(value)
    if category == DEFAULT_CATEGORY and _category_key(value) != _category_key(DEFAULT_CATEGORY):
        return None
    if (value or "").strip() != category:
        return category
    return None
