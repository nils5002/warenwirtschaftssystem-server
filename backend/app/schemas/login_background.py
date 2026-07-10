"""Schemas für die admin-verwalteten Login-Hintergrundbilder."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class LoginBackgroundResponse(BaseModel):
    """Ein Login-Hintergrundbild inkl. Anzeige-Metadaten (Admin-Ansicht)."""

    id: str
    url: str
    originalName: str
    mimeType: str
    sizeBytes: int
    width: int
    height: int
    uploadedByName: str | None = None
    isActive: bool = False
    createdAt: datetime


class LoginBrandingResponse(BaseModel):
    """Öffentliche, unauthentifizierte Sicht für die Login-Seite: liefert nur
    die URL des aktuell aktiven Hintergrundbilds (oder ``None``)."""

    backgroundUrl: str | None = None
