"""Schemas für Security-Events und Benutzer-Sicherheitsdetails (Admin-Bereich).

Bewusst keine sensiblen Felder: Passwörter/Hashes/Tokens tauchen weder in den
Events noch in den Antworten auf. IP-Adressen werden serverseitig gekürzt
ausgeliefert (Datenschutz) — die vollständige IP bleibt nur in der DB.
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class SecurityEventItem(BaseModel):
    id: int
    createdAt: str
    eventType: str
    severity: str
    success: bool
    userId: Optional[str] = None
    enteredIdentifier: Optional[str] = None
    actorId: Optional[str] = None
    # Serverseitig gekürzte IP (letztes Oktett/Suffix maskiert).
    ip: Optional[str] = None
    userAgent: Optional[str] = None
    method: Optional[str] = None
    path: Optional[str] = None
    reasonCode: Optional[str] = None
    requestId: Optional[str] = None
    meta: Optional[str] = None


class SecurityEventListResponse(BaseModel):
    items: list[SecurityEventItem]
    total: int


class SecuritySummaryResponse(BaseModel):
    totalEvents24h: int
    failedLogins24h: int
    failedLogins7d: int
    pendingUsers: int
    lockedUsers: int
    # Anzahl Ereignisse mit Severity warning/critical seit `since` (Query-Param);
    # ohne `since`: letzte 24 h. Quelle für den Sidebar-Badge.
    newSuspicious: int


class UserSecurityInfo(BaseModel):
    userId: str
    status: str
    createdAt: Optional[str] = None
    lastLoginAt: Optional[str] = None
    lastLoginAttemptAt: Optional[str] = None
    lastLoginIp: Optional[str] = None
    lastLoginUserAgent: Optional[str] = None
    failedLoginCount: int = 0
    lockedUntil: Optional[str] = None
    approvedAt: Optional[str] = None
    approvedBy: Optional[str] = None
    rejectedAt: Optional[str] = None


class RegistrationSettingResponse(BaseModel):
    enabled: bool


class RegistrationSettingPayload(BaseModel):
    enabled: bool


class UserActionResponse(BaseModel):
    ok: bool = True
    message: Optional[str] = Field(default=None)
