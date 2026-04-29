from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


CANONICAL_COLUMNS = (
    "name",
    "category",
    "category_source",
    "inventory_number",
    "model",
    "description",
    "serial_number",
    "sim_number",
    "phone_number",
    "power_supply",
    "language",
    "ip_address",
    "mac_lan",
    "mac_wlan",
    "mac_generic",
    "status",
)
REQUIRED_COLUMNS: tuple[()] = ()


@dataclass(slots=True)
class ParsedExcelRow:
    file_name: str
    sheet_name: str
    row_number: int
    data: dict[str, Any]


@dataclass(slots=True)
class ParsedExcelFile:
    path: Path
    file_name: str
    sheet_name: str
    missing_required_columns: list[str] = field(default_factory=list)
    missing_optional_columns: list[str] = field(default_factory=list)
    recognized_columns: list[str] = field(default_factory=list)
    column_mapping: dict[str, str] = field(default_factory=dict)
    title_hint: str | None = None
    inferred_category: str | None = None
    inferred_category_source: str | None = None
    inferred_category_source_label: str | None = None
    rows: list[ParsedExcelRow] = field(default_factory=list)


@dataclass(slots=True)
class HardwareImportMappedRow:
    file_name: str
    sheet_name: str
    row_number: int
    serial_number: str
    payload: dict[str, Any]
    auto_generated_name: bool = False
    auto_generated_serial: bool = False
    category_source: str = ""


@dataclass(slots=True)
class HardwareImportError:
    file_name: str
    sheet_name: str
    row_number: int
    reason: str
    serial_number: str | None = None
    raw_data: dict[str, Any] = field(default_factory=dict)
