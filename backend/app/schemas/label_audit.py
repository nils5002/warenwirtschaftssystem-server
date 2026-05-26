"""Schemas für die Admin-Seite "Label-Prüfung" (serverseitige Prüfrunden).

Reines Audit-/Lese-Werkzeug: Diese Schemas beschreiben ausschließlich die
eigenen Label-Audit-Daten. Es werden keinerlei echte Hardwaredaten (Asset,
Planung, Defekt, Reservierung) modelliert oder mutiert.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, field_validator

ScanKind = Literal["matched", "duplicate", "unknown"]
SessionStatus = Literal["active", "archived"]


class LabelAuditScanResponse(BaseModel):
    id: str
    scanValue: str
    scanKind: ScanKind
    assetId: str | None = None
    assetStableKey: str | None = None
    assetLabel: str | None = None
    category: str | None = None
    serialNumber: str | None = None
    tagNumber: str | None = None
    scannedAt: datetime
    scannedByUserId: str | None = None


class LabelAuditSummary(BaseModel):
    total: int
    checked: int
    open: int
    duplicates: int
    unknown: int


class LabelAuditSessionResponse(BaseModel):
    id: str
    name: str
    status: SessionStatus
    note: str | None = None
    createdAt: datetime
    updatedAt: datetime
    createdByUserId: str | None = None
    summary: LabelAuditSummary
    # Neueste-zuerst-Protokoll (gekappt). Trägt Banner + "Zuletzt gescannt".
    recentScans: list[LabelAuditScanResponse]
    # Aktuelle Asset-IDs (external_id), die in dieser Runde als geprüft gelten —
    # über den stabilen Key gegen den aktuellen Bestand aufgelöst. Das Frontend
    # bildet darüber "Noch nicht geprüft" = assets ohne diese IDs.
    checkedAssetIds: list[str]


class LabelAuditSessionListItem(BaseModel):
    """Leichte Variante für die Runden-Liste (ohne Scan-Protokoll)."""

    id: str
    name: str
    status: SessionStatus
    note: str | None = None
    createdAt: datetime
    updatedAt: datetime
    summary: LabelAuditSummary


class LabelAuditSessionCreatePayload(BaseModel):
    name: str
    note: str | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        cleaned = str(value).strip()
        if not cleaned:
            raise ValueError("Name der Prüfrunde darf nicht leer sein.")
        return cleaned[:180]

    @field_validator("note")
    @classmethod
    def _note(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = str(value).strip()
        return cleaned or None


class LabelAuditScanPayload(BaseModel):
    scanValue: str

    @field_validator("scanValue")
    @classmethod
    def _scan(cls, value: str) -> str:
        cleaned = str(value).strip()
        if not cleaned:
            raise ValueError("scanValue darf nicht leer sein.")
        return cleaned[:512]


class LabelAuditScanResult(BaseModel):
    """Antwort eines einzelnen Scans: das erfasste Event + aktualisierte Runde."""

    scan: LabelAuditScanResponse
    session: LabelAuditSessionResponse
