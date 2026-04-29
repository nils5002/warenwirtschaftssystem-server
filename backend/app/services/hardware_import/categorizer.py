from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable


CATEGORY_IPADS = "iPad"
CATEGORY_NOTEBOOKS = "Laptop"
CATEGORY_SMARTPHONES = "Smartphone"
CATEGORY_QR_SCANNERS = "QR-Code-Scanner"
CATEGORY_HANDHELDS = "Handheld"
CATEGORY_PRINTERS = "Drucker"
CATEGORY_CARD_PRINTERS = "Kartendrucker"
CATEGORY_SWITCHES = "Switch"
CATEGORY_ROUTERS = "Router"
CATEGORY_LTE_ROUTERS = "LTE-Router"
CATEGORY_MISC = "Zuordnung erforderlich"


@dataclass(frozen=True, slots=True)
class CategoryRule:
    category: str
    keywords: tuple[str, ...]


FILE_HINT_RULES: tuple[CategoryRule, ...] = (
    CategoryRule(CATEGORY_SWITCHES, ("switch",)),
    CategoryRule(CATEGORY_LTE_ROUTERS, ("lte",)),
    CategoryRule(CATEGORY_NOTEBOOKS, ("event laptops", "notebook", "laptop")),
    CategoryRule(CATEGORY_IPADS, ("ipad",)),
    CategoryRule(CATEGORY_QR_SCANNERS, ("qrcode", "qr codescan", "qr")),
    CategoryRule(CATEGORY_CARD_PRINTERS, ("kartendrucker", "cardprinter")),
    CategoryRule(CATEGORY_HANDHELDS, ("handheld",)),
    CategoryRule(CATEGORY_PRINTERS, ("laserdrucker", "drucker", "printer")),
)

RULES: tuple[CategoryRule, ...] = (
    CategoryRule(
        category=CATEGORY_CARD_PRINTERS,
        keywords=("kartendrucker", "card printer", "datacard", "entrust sigma", "entrust", "sd260"),
    ),
    CategoryRule(
        category=CATEGORY_QR_SCANNERS,
        keywords=(
            "qr-code-scanner",
            "qr scanner",
            "barcode-scanner",
            "barcode scanner",
            "mk-7000",
            "albasca",
            "sumeber",
            "zebra ds",
        ),
    ),
    CategoryRule(
        category=CATEGORY_HANDHELDS,
        keywords=("handheld", "handhelden", "mobile computer", "ct30", "honeywell ct", "m3 mobile"),
    ),
    CategoryRule(category=CATEGORY_IPADS, keywords=("ipad", "tablet", "apple tablet")),
    CategoryRule(
        category=CATEGORY_NOTEBOOKS,
        keywords=(
            "notebook",
            "laptop",
            "macbook",
            "thinkpad",
            "lenovo t",
            "lenovo e",
            "latitude",
            "elitebook",
        ),
    ),
    CategoryRule(
        category=CATEGORY_SMARTPHONES,
        keywords=("smartphone", "iphone", "samsung galaxy", "pixel", "moto", "android phone"),
    ),
    CategoryRule(
        category=CATEGORY_SWITCHES,
        keywords=("switch", "switches", "dgs-", "dlink dgs", "netgear gs"),
    ),
    CategoryRule(
        category=CATEGORY_LTE_ROUTERS,
        keywords=("lte", "speedbox", "archer mr", "rutx", "teltonika", "4g router", "5g router"),
    ),
    CategoryRule(
        category=CATEGORY_ROUTERS,
        keywords=("router", "fritzbox", "edge router", "tp-link archer", "gateway"),
    ),
    CategoryRule(
        category=CATEGORY_PRINTERS,
        keywords=("drucker", "laserdrucker", "laserjet", "brother hl", "kyocera pa", "printer"),
    ),
)


def categorize_hardware(
    *,
    file_name: str,
    name: str,
    model: str | None,
    description: str | None = None,
) -> str:
    normalized_name = normalize_category_label(name)
    if normalized_name:
        return normalized_name
    normalized_model = normalize_category_label(model)
    if normalized_model:
        return normalized_model

    file_hint = _categorize_by_file_name(file_name)
    if file_hint:
        return file_hint

    haystack = _build_haystack(file_name=file_name, name=name, model=model, description=description)
    for rule in RULES:
        if _matches_any(haystack, rule.keywords):
            return rule.category
    return CATEGORY_MISC


def infer_category_with_source(
    *,
    explicit_category: str | None,
    header_category: str | None,
    sheet_name: str | None,
    file_name: str | None,
    title_hint: str | None,
    name: str | None,
    model: str | None,
    description: str | None,
) -> tuple[str, str, str]:
    normalized_explicit = normalize_category_label(explicit_category)
    if normalized_explicit:
        return normalized_explicit, "category_column", (explicit_category or "").strip()
    if explicit_category:
        return CATEGORY_MISC, "category_column", explicit_category.strip()

    normalized_header = normalize_category_label(header_category)
    if normalized_header:
        return normalized_header, "header", (header_category or "").strip()

    normalized_sheet = normalize_category_label(sheet_name)
    if normalized_sheet:
        return normalized_sheet, "sheet_name", (sheet_name or "").strip()

    normalized_file = normalize_category_label(file_name)
    if normalized_file:
        return normalized_file, "file_name", (file_name or "").strip()

    normalized_title = normalize_category_label(title_hint)
    if normalized_title:
        return normalized_title, "title_row", (title_hint or "").strip()

    category = categorize_hardware(
        file_name=file_name or "",
        name=name or "",
        model=model,
        description=description,
    )
    return category, "content_heuristic", ""


def normalize_category_label(value: str | None) -> str | None:
    normalized = (value or "").strip().lower().replace("_", " ").replace("-", " ")
    normalized = " ".join(normalized.split())
    if not normalized:
        return None
    if normalized in {"notebook", "notebooks", "laptop", "laptops", "event laptops", "event notebook"}:
        return CATEGORY_NOTEBOOKS
    if normalized in {"ipad", "ipads"}:
        return CATEGORY_IPADS
    if normalized in {
        "handheld",
        "handhelds",
        "event handheld",
        "event handhelden",
        "mobile computer",
        "mde",
        "scanner handheld",
        "scanner handhelds",
    }:
        return CATEGORY_HANDHELDS
    if normalized in {"smartphone", "smartphones"}:
        return CATEGORY_SMARTPHONES
    if normalized in {"switch", "switches"}:
        return CATEGORY_SWITCHES
    if normalized in {"router", "wlan router", "wlan-router"}:
        return CATEGORY_ROUTERS
    if normalized in {"lte router", "lte-router"}:
        return CATEGORY_LTE_ROUTERS
    if normalized in {
        "qr scanner",
        "qr code scanner",
        "qr-code-scanner",
        "qr codescan",
        "qrcodescan",
        "event qrcodescan",
        "barcode scanner",
        "barcode-scanner",
    }:
        return CATEGORY_QR_SCANNERS
    if normalized in {
        "drucker",
        "laserdrucker",
        "laser drucker",
        "genolive laserdrucker",
        "printer",
        "laser printer",
    }:
        return CATEGORY_PRINTERS
    if normalized in {"kartendrucker", "card printer"}:
        return CATEGORY_CARD_PRINTERS
    if normalized in {"zubehör", "zubehoer", "zubehörteile", "accessory", "accessories"}:
        return "Zubehör"
    if normalized in {"sonstiges", "misc", "other"}:
        return "Sonstiges"
    return None


def _categorize_by_file_name(file_name: str) -> str | None:
    normalized = file_name.lower().replace("_", " ").replace("-", " ")
    for rule in FILE_HINT_RULES:
        if _matches_any(normalized, rule.keywords):
            return rule.category
    return None


def _build_haystack(
    *,
    file_name: str,
    name: str,
    model: str | None,
    description: str | None,
) -> str:
    parts = [file_name, name, model or "", description or ""]
    normalized = " | ".join(parts).lower()
    return normalized.replace("_", " ").replace("-", " ")


def _matches_any(haystack: str, keywords: Iterable[str]) -> bool:
    for raw in keywords:
        keyword = raw.strip().lower()
        if keyword and keyword in haystack:
            return True
    return False

