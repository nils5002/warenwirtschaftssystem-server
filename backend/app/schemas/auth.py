from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


AppRole = Literal["Admin", "Projektmanager", "Mitarbeiter"]


class AuthLoginRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=255, description="E-Mail")
    password: str = Field(..., min_length=1, max_length=256, description="Klartext-Passwort")


class AuthUserInfo(BaseModel):
    userId: str
    name: str
    email: str
    role: AppRole
    # Effektive Rechte-Keys der Rolle (Feature „Rollen & Rechte"). Additiv mit
    # Default [], damit bestehende Konstruktionen (Login/Token) ohne dieses Feld
    # gültig bleiben und ältere Frontends das Feld ignorieren können.
    permissions: list[str] = Field(default_factory=list)


class AuthLoginResponse(BaseModel):
    accessToken: str
    tokenType: Literal["bearer"] = "bearer"
    expiresIn: int
    user: AuthUserInfo


class AuthRegisterRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    email: str = Field(..., min_length=3, max_length=255)
    password: str = Field(..., min_length=8, max_length=128)
    # Honeypot: unsichtbares Formularfeld. Menschen lassen es leer — füllt ein
    # Bot es aus, wird die Registrierung still verworfen (generische Antwort).
    website: str | None = Field(default=None, max_length=255)


class AuthRegisterResponse(BaseModel):
    message: str
    # Welches Verfahren galt für diese Registrierung? False = klassischer
    # Ablauf (nur Admin-Freigabe, kein Mailversand). Hängt ausschließlich an
    # der serverseitigen Einstellung, nie am einzelnen Konto.
    verificationRequired: bool = False
    # Ehrliche Rückmeldung, ob die Bestätigungsmail rausgegangen ist. Bewusst
    # KEIN Enumerations-Kanal: Der Wert hängt nur am Versandweg (SMTP), nicht
    # daran, ob die E-Mail bereits ein Konto hat — bei einem Duplikat wird
    # derselbe Weg benutzt bzw. dasselbe Ergebnis gemeldet. Im klassischen
    # Modus immer True (es ist gar kein Versand vorgesehen).
    emailSent: bool = True
    # Nur gesetzt, wenn der Versand nicht geklappt hat: fachlicher Hinweis für
    # die UI (nie technische Details, nie Zugangsdaten).
    emailHint: str | None = None


class AuthVerifyEmailRequest(BaseModel):
    # Der Token wird ausschließlich per POST-Body eingelöst — nie per GET,
    # damit er nicht in Server-/Proxy-Logs oder der Browser-History landet.
    token: str = Field(..., min_length=16, max_length=512)


class AuthVerifyEmailResponse(BaseModel):
    status: Literal["verified", "already_verified"]
    message: str
    # True, sobald der Admin das Konto zusätzlich freigegeben hat.
    accountActive: bool = False


class AuthResendVerificationRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=255)


class AuthResendVerificationResponse(BaseModel):
    message: str
    emailSent: bool = True
    emailHint: str | None = None
