from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

from .wms import AssetItem


class TelecomPassSettings(BaseModel):
    """Globale Telekompass-Einstellung (admin-pflegbar)."""

    # Preis pro Telekompass-Buchung. Default 0.0, wenn (noch) kein Wert gesetzt
    # ist — Altinstallationen/Backups ohne diesen Wert funktionieren so weiter.
    unitPrice: float = 0.0


class TelecomPassSettingsUpdatePayload(BaseModel):
    unitPrice: float = Field(ge=0)


class TelecomPassBookingPayload(BaseModel):
    """Erfassung der Telekompass-Buchungen bei einer LTE-Router-Rückgabe."""

    # Leeres Feld behandelt das Frontend als 0; serverseitig wird >= 0 erzwungen.
    quantity: int = Field(ge=0, le=100_000)
    # Eindeutiger Schlüssel der Rückgabe-Erfassung (Schutz gegen Doppel-Submits/
    # Retries). Optional — fehlt er, wird ohne Idempotenz-Schutz gebucht.
    idempotencyKey: Optional[str] = Field(default=None, max_length=64)
    # Optionaler Planungsbezug der Rückgabe.
    planningId: Optional[str] = None


class TelecomPassCountCorrectionPayload(BaseModel):
    """Admin-Korrektur des absoluten Zählers eines LTE-Routers."""

    total: int = Field(ge=0, le=100_000)


class TelecomPassBookingItem(BaseModel):
    id: str
    assetId: str
    planningId: Optional[str] = None
    quantity: int
    unitPriceSnapshot: float
    totalPriceSnapshot: float
    kind: Literal["booking", "correction"] = "booking"
    createdAt: Optional[str] = None
    createdByUserId: Optional[str] = None


class TelecomPassBookingResult(BaseModel):
    asset: AssetItem
    booking: Optional[TelecomPassBookingItem] = None
    # True, wenn der Request per Idempotenz-Schlüssel als Wiederholung erkannt
    # und der Zähler daher NICHT erneut erhöht wurde.
    duplicate: bool = False
