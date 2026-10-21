"""Schemas der Companion App (Smartphone-Kopplung, Geraetesitzungen, Passkeys).

Keine Antwort enthaelt je ein Geraete-Secret, einen Kopplungs-Nachweis des
Handys oder Passkey-Schluesselmaterial. Der einmalige Kopplungscode verlaesst
den Server genau einmal (``PairingStartResponse.pairingCode``) — nur fuer den
QR-Code am PC.
"""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from .auth import AuthUserInfo

PairingStatus = Literal["pending", "claimed", "approved", "rejected", "consumed", "cancelled", "expired"]


class CompanionDevice(BaseModel):
    id: str
    name: str
    platform: Optional[str] = None
    connectedAt: Optional[str] = None
    lastSeenAt: Optional[str] = None
    passkeyRegistered: bool = False
    # True = die Anfrage kommt von genau diesem Geraet.
    current: bool = False


class CompanionSettingsResponse(BaseModel):
    enabled: bool
    devices: list[CompanionDevice] = Field(default_factory=list)
    maxDevices: int
    # Laeuft die aktuelle Sitzung selbst auf einem gekoppelten Geraet?
    currentDeviceId: Optional[str] = None


class CompanionSettingsPayload(BaseModel):
    enabled: bool


class CompanionRevokeResponse(BaseModel):
    ok: bool = True
    revoked: int = 0


class PairingStartResponse(BaseModel):
    pairingId: str
    # Einmaliger Kopplungscode fuer den QR-Link (#-Fragment, nie Query).
    pairingCode: str
    expiresAt: str
    expiresInSeconds: int


class PairingStatusResponse(BaseModel):
    pairingId: str
    status: PairingStatus
    expiresAt: str
    expiresInSeconds: int
    # Erst nach dem Einlesen am Handy gesetzt.
    deviceName: Optional[str] = None
    devicePlatform: Optional[str] = None
    matchCode: Optional[str] = None


class PairingClaimPayload(BaseModel):
    code: str = Field(..., min_length=20, max_length=128)


class PairingClaimResponse(BaseModel):
    """Was das Handy vor der PC-Bestaetigung sehen darf."""

    accountName: str
    accountEmail: str
    matchCode: str
    expiresInSeconds: int


class PairingClaimStatusResponse(BaseModel):
    status: PairingStatus
    expiresInSeconds: int


class CompanionSessionResponse(BaseModel):
    """Ergebnis von Kopplungsabschluss und Sitzungserneuerung."""

    user: AuthUserInfo
    deviceId: str
    deviceName: str
    passkeyRegistered: bool = False
    # Muss die App vor der Nutzung per Passkey entsperrt werden?
    locked: bool = False


class CompanionLockedResponse(BaseModel):
    """Antwort, wenn das Geraet gekoppelt, aber gesperrt ist (HTTP 423)."""

    locked: Literal[True] = True
    deviceId: str
    deviceName: str


class PasskeyOptionsResponse(BaseModel):
    # PublicKeyCredentialCreationOptions / RequestOptions im JSON-Format,
    # direkt an @simplewebauthn/browser durchreichbar.
    options: dict[str, Any]


class PasskeyVerifyPayload(BaseModel):
    credential: dict[str, Any]
