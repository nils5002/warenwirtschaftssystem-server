"""Pydantic-Schemas der Mobile-API (`/api/mobile`) für die iPhone-App.

Bewusst klein und stabil gehalten: nur Request-/Response-Formen, **keine**
Fach- oder Router-Logik. Feldnamen sind camelCase (wie der Rest der API) und so
gewählt, dass die native App eine saubere, langfristig stabile Schnittstelle
bekommt. Wo es passt, werden bestehende Schemas wiederverwendet
(``AuthUserInfo`` für den Nutzer, ``QrGroupItem`` für Sammel-QR), damit die
Mobile-API keine Felddefinitionen dupliziert.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

from .auth import AuthUserInfo
from .wms import QrGroupItem


# --- Auth -----------------------------------------------------------------

class MobileLoginRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=255, description="E-Mail")
    password: str = Field(..., min_length=1, max_length=256, description="Klartext-Passwort")


class MobileTokenResponse(BaseModel):
    """Antwort auf Login/Refresh: Access- + Refresh-Token plus Lebensdauern."""

    accessToken: str
    refreshToken: str
    tokenType: Literal["bearer"] = "bearer"
    # Lebensdauer in Sekunden — die App kann daraus den Erneuerungszeitpunkt ableiten.
    expiresIn: int
    refreshExpiresIn: int
    user: AuthUserInfo


class MobileRefreshRequest(BaseModel):
    refreshToken: str = Field(..., min_length=1)


class MobileLogoutResponse(BaseModel):
    ok: bool = True


# --- Projekte -------------------------------------------------------------

class MobileProject(BaseModel):
    """Schlanke Projekt-/Planungsdarstellung für die Auswahl bei der Ausgabe."""

    id: str
    name: str
    customerName: Optional[str] = None
    status: str
    startDate: Optional[str] = None
    endDate: Optional[str] = None


# --- Scan -----------------------------------------------------------------

class MobileAsset(BaseModel):
    """Mobile-freundliche Asset-Sicht (Teilmenge des vollen AssetItem)."""

    id: str
    name: str
    category: str
    # Status als String — die kanonischen Werte stammen aus dem Backend
    # (Verfuegbar/Verliehen/Defekt/In Wartung); hier bewusst nicht erneut
    # als Literal eingeschränkt, damit die App tolerant bleibt.
    status: str
    assignedTo: Optional[str] = None
    serialNumber: Optional[str] = None
    tagNumber: Optional[str] = None
    maintenanceState: Optional[str] = None


class MobileScanRequest(BaseModel):
    # Roh-Scanwert (QR-Inhalt, Inventar-/Seriennummer). Auflösung erfolgt im Backend.
    value: str = Field(..., min_length=1, max_length=512)


class MobileScanResponse(BaseModel):
    """Ergebnis einer Scan-Auflösung — Einzelgerät, Sammel-QR oder unbekannt."""

    found: bool
    kind: Literal["asset", "group", "unknown"]
    # True, wenn aus dem aktuellen Status eine Buchung möglich ist
    # (Ausgabe bei Verfuegbar, Rücknahme bei Verliehen). Bei Defekt/In Wartung false.
    bookable: bool = False
    # Klartext-Begründung, falls nicht buchbar oder nicht gefunden.
    reason: Optional[str] = None
    asset: Optional[MobileAsset] = None
    group: Optional[QrGroupItem] = None


# --- Ausgabe / Rücknahme --------------------------------------------------

class MobileCheckoutRequest(BaseModel):
    assetId: str = Field(..., min_length=1)
    # Optionaler Planungsbezug (external_id der Planung) + Anzeigename.
    projectId: Optional[str] = None
    projectName: Optional[str] = None
    # Empfänger; bleibt leer => Backend setzt den eingeloggten Nutzer ein.
    recipient: Optional[str] = None


class MobileCheckinRequest(BaseModel):
    assetId: str = Field(..., min_length=1)
    # Optionaler Zustandsvermerk bei der Rücknahme (Freitext).
    condition: Optional[str] = None


class MobileBookingResult(BaseModel):
    """Ergebnis einer Einzelbuchung (Ausgabe/Rücknahme)."""

    assetId: str
    status: str
    message: str


# --- Scan-Historie (optional) --------------------------------------------

class MobileScanHistoryEntry(BaseModel):
    id: str
    title: str
    detail: str
    timestamp: str
    assetId: Optional[str] = None
