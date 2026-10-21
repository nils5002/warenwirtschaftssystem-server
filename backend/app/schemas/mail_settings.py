"""Schemas der Adminoberflaeche „E-Mail-Einstellungen".

Grundregel fuer ALLE Antworten hier: Es verlaesst niemals ein SMTP-Passwort
den Server — weder im Klartext noch als Chiffretext. Dass ein Passwort
hinterlegt ist, wird ausschliesslich ueber ``passwordSet`` mitgeteilt.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

MailSecurity = Literal["starttls", "ssl", "none"]
RegistrationMode = Literal["classic_admin_approval", "email_verification"]
# Woher stammt die aktuell verwendete Konfiguration?
MailConfigSource = Literal["admin", "env", "none"]


class MailSettingsResponse(BaseModel):
    """Gespeicherte Adminkonfiguration (ohne jedes Geheimnis)."""

    enabled: bool = False
    host: Optional[str] = None
    port: int = 587
    security: MailSecurity = "starttls"
    username: Optional[str] = None
    # True = es ist ein verschluesseltes Passwort hinterlegt. Der Wert selbst
    # wird NIE ausgeliefert; das Frontend zeigt nur einen Platzhalter.
    passwordSet: bool = False
    fromEmail: Optional[str] = None
    fromName: Optional[str] = None
    timeoutSeconds: int = 15
    verificationExpiryHours: int = 24
    # In der Administration gepflegte oeffentliche WWS-Adresse (None = es
    # gilt FRONTEND_URL aus der ENV).
    publicBaseUrl: Optional[str] = None
    updatedAt: Optional[str] = None
    updatedBy: Optional[str] = None


class MailSettingsPayload(BaseModel):
    """Eingabe der Adminoberflaeche.

    ``password`` ist optional: Wird es weggelassen oder leer gesendet, bleibt
    ein bereits gespeichertes Passwort unveraendert. Zum bewussten Entfernen
    dient ``clearPassword``.
    """

    enabled: bool = False
    host: Optional[str] = Field(default=None, max_length=255)
    port: int = Field(default=587, ge=1, le=65535)
    security: MailSecurity = "starttls"
    username: Optional[str] = Field(default=None, max_length=255)
    password: Optional[str] = Field(default=None, max_length=512)
    clearPassword: bool = False
    fromEmail: Optional[str] = Field(default=None, max_length=255)
    fromName: Optional[str] = Field(default=None, max_length=120)
    timeoutSeconds: int = Field(default=15, ge=1, le=120)
    verificationExpiryHours: int = Field(default=24, ge=1, le=336)
    # Oeffentliche WWS-Adresse fuer Bestaetigungslinks. None = unveraendert
    # lassen, "" = Admin-Wert entfernen (dann gilt wieder FRONTEND_URL).
    publicBaseUrl: Optional[str] = Field(default=None, max_length=255)


class MailStatusResponse(BaseModel):
    """Kompakter Systemstatus fuer die Statuskarte im Adminbereich."""

    # Maschinenlesbarer Zustand; das Frontend bildet daraus Text + Farbe.
    state: Literal[
        "not_configured",
        "disabled",
        "configured",
        "test_succeeded",
        "connection_failed",
        "send_failed",
    ]
    # Quelle der AKTIV verwendeten Konfiguration.
    source: MailConfigSource
    # Kann aktuell ueberhaupt versendet werden?
    canSend: bool
    # Log-/UI-sicherer Grund, wenn nicht (nie Zugangsdaten).
    problem: Optional[str] = None
    lastTestAt: Optional[str] = None
    lastTestSuccess: Optional[bool] = None
    lastTestError: Optional[str] = None
    lastSendAt: Optional[str] = None
    lastSendSuccess: Optional[bool] = None
    lastSendError: Optional[str] = None
    testMailAcceptedAt: Optional[str] = None
    registrationMode: RegistrationMode
    # Ist die Selbstregistrierung ueberhaupt offen? (bestehender, unabhaengiger
    # Schalter — hier nur zur Anzeige)
    registrationEnabled: bool
    # Darf auf "E-Mail-Bestaetigung" umgestellt werden, und was fehlt sonst?
    canEnableVerification: bool
    verificationBlockers: list[str] = Field(default_factory=list)
    # Steht ein Schluessel fuer das Speichern von Passwoertern bereit?
    secretStorageAvailable: bool
    secretStorageHint: Optional[str] = None
    # Herkunft dieses Schluessels: "derived" (aus AUTH_TOKEN_SECRET abgeleitet)
    # oder "explicit" (MAIL_CONFIG_ENCRYPTION_KEY). Nie der Schluessel selbst.
    secretKeySource: Optional[Literal["derived", "explicit"]] = None
    # Ist ein gespeichertes Passwort mit dem aktuellen Schluessel lesbar?
    # None = kein Passwort gespeichert.
    passwordReadable: Optional[bool] = None
    # Wirksame oeffentliche Adresse fuer Bestaetigungslinks + Herkunft.
    frontendUrlReady: bool
    frontendUrlHint: Optional[str] = None
    publicBaseUrl: Optional[str] = None
    publicBaseUrlSource: MailConfigSource = "none"
    # Gueltigkeit der Bestaetigungslinks in Stunden (wirksamer Wert).
    verificationExpiryHours: int = 24
    # Darf "Unverschluesselt" ueberhaupt gewaehlt werden? (nur Entwicklung)
    plainSmtpAllowed: bool = False


class MailTestConnectionResponse(BaseModel):
    """Ergebnis von „Verbindung testen" — bereinigt, ohne Servertexte."""

    success: bool
    message: str
    connectionOk: bool = False
    authenticationOk: bool = False


class MailSendTestPayload(BaseModel):
    recipient: str = Field(..., min_length=3, max_length=255)


class MailSendTestResponse(BaseModel):
    success: bool
    message: str
    connectionOk: bool = False
    authenticationOk: bool = False
    accepted: bool = False


class RegistrationModePayload(BaseModel):
    mode: RegistrationMode


class RegistrationModeResponse(BaseModel):
    mode: RegistrationMode
    message: str
