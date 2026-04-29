from __future__ import annotations

from app.domain.categories import normalize_category
from app.services.hardware_import.categorizer import categorize_hardware


def test_category_synonyms_normalize_to_canonical_values() -> None:
    assert normalize_category("Notebooks") == "Laptop"
    assert normalize_category("iPads") == "iPad"
    assert normalize_category("Handhelds") == "Handheld"
    assert normalize_category("QR Scanner") == "QR-Code-Scanner"
    assert normalize_category("Switches") == "Switch"
    assert normalize_category("WLAN-Router") == "Router"
    assert normalize_category("LTE Router") == "LTE-Router"


def test_import_categorizer_returns_canonical_categories() -> None:
    assert categorize_hardware(file_name="notebooks.xlsx", name="Lenovo ThinkPad", model=None) == "Laptop"
    assert categorize_hardware(file_name="ipads.xlsx", name="iPad Air", model=None) == "iPad"
    assert categorize_hardware(file_name="switches.xlsx", name="Netgear GS108", model=None) == "Switch"
    assert categorize_hardware(file_name="bestand.xlsx", name="Unbekanntes Geraet", model=None) == "Zuordnung erforderlich"
