"""Schemas für die Admin-Seite "Label-Prüfung" (serverseitige Prüfrunden).

Reines Audit-/Lese-Werkzeug: Diese Schemas beschreiben ausschließlich die
eigenen Label-Audit-Daten. Es werden keinerlei echte Hardwaredaten (Asset,
Planung, Defekt, Reservierung) modelliert oder mutiert.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, field_validator

ScanKind = Literal["matched", "duplicate", "unknown", "corrected"]
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
    # Admin-Korrektur-Felder (Soft-Delete / Notiz).
    note: str | None = None
    ignored: bool = False
    ignoreReason: str | None = None


class LabelAuditSummary(BaseModel):
    total: int
    checked: int
    open: int
    duplicates: int
    unknown: int
    # Anzahl ignorierter (soft-deleteter) Scans — zählt NICHT in checked/open.
    ignored: int = 0


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


class LabelAuditSessionUpdatePayload(BaseModel):
    """Admin-Bearbeitung einer Prüfrunde. Nur gesetzte Felder werden geändert.

    Verändert ausschließlich ``label_audit_sessions`` (Name/Notiz/Status) —
    keine echten Hardwaredaten.
    """

    name: str | None = None
    note: str | None = None
    status: SessionStatus | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, value: str | None) -> str | None:
        if value is None:
            return None
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


class LabelAuditScanUpdatePayload(BaseModel):
    """Admin-Korrektur eines einzelnen Scans. Nur gesetzte Felder wirken.

    - ``note`` / ``correctionNote``: freie Audit-Notiz.
    - ``ignored`` (+ ``ignoreReason``): Scan aus der Auswertung nehmen / wieder
      aufnehmen (Soft-Delete, kein Hard-Delete).
    - ``assetId``: einen unbekannten/falsch zugeordneten Scan einem Asset
      zuordnen (Snapshot wird aktualisiert, ``scanValue`` bleibt erhalten).

    Verändert ausschließlich ``label_audit_scans`` — keine echten Hardwaredaten.
    """

    note: str | None = None
    ignored: bool | None = None
    ignoreReason: str | None = None
    assetId: str | None = None
    correctionNote: str | None = None

    @field_validator("note", "ignoreReason", "correctionNote")
    @classmethod
    def _trim(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = str(value).strip()
        return cleaned[:256] or None

    @field_validator("assetId")
    @classmethod
    def _asset_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = str(value).strip()
        return cleaned or None
