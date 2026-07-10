"""Signaturfarben pro Benutzer (Einsatzplanung / Benutzerverwaltung).

Feste, gut unterscheidbare Palette (dark- und light-tauglich, nicht grell).
Die Farbe wird beim Anlegen bzw. per Startup-Backfill EINMAL vergeben und in
``users.signature_color`` gespeichert (``signature_color_source`` = 'auto').
Admins können sie manuell ändern ('manual') — die Automatik überschreibt
manuell gesetzte Farben nie.
"""

from __future__ import annotations

import hashlib

USER_SIGNATURE_COLORS: tuple[str, ...] = (
    "#7C3AED",  # Lila
    "#2563EB",  # Blau
    "#059669",  # Grün
    "#D97706",  # Orange
    "#DC2626",  # Rot
    "#0891B2",  # Cyan
    "#DB2777",  # Pink
    "#65A30D",  # Lime
    "#0F766E",  # Teal
    "#9333EA",  # Violett
)

SIGNATURE_COLOR_SOURCE_AUTO = "auto"
SIGNATURE_COLOR_SOURCE_MANUAL = "manual"


def pick_signature_color(user_external_id: str) -> str:
    """Deterministische Farbe aus der User-ID — stabil über Neustarts,
    Reihenfolge-unabhängig und unbeeinflusst von gelöschten Benutzern."""
    digest = hashlib.sha256((user_external_id or "").encode("utf-8")).digest()
    return USER_SIGNATURE_COLORS[digest[0] % len(USER_SIGNATURE_COLORS)]


def normalize_signature_color(value: str | None) -> str | None:
    """Normalisiert eine Farbe auf die kanonische Paletten-Schreibweise;
    ``None`` wenn der Wert nicht in der erlaubten Palette liegt."""
    candidate = (value or "").strip().upper()
    for color in USER_SIGNATURE_COLORS:
        if color.upper() == candidate:
            return color
    return None
