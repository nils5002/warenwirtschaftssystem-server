"""Signaturfarben pro Benutzer (Einsatzplanung / Benutzerverwaltung).

Feste, gut unterscheidbare Palette (30 Farben, dark- und light-tauglich,
nicht grell). Gespeichert wird pro Benutzer der kanonische Basis-Hexwert
(= Border-/Akzentfarbe); die abgeleiteten Anzeige-Varianten (transparenter
Hintergrund, hellerer Text) liegen im Frontend (asset-ui/userColors.ts) —
beide Listen müssen dieselben Basiswerte in derselben Reihenfolge führen.

Vergabe:
- Neue Benutzer und der Startup-Backfill nehmen die am wenigsten genutzte
  Farbe (Wiederholung erst, wenn alle 30 vergeben sind); bei Gleichstand
  entscheidet deterministisch der Hash der User-ID.
- Einmal gespeichert bleibt die Farbe stabil ('auto'); Admins können sie
  manuell ändern ('manual') — die Automatik überschreibt 'manual' nie.

Die ersten 10 Einträge sind die Bestandspalette in Originalreihenfolge —
bereits vergebene Farben bleiben dadurch gültige Palettenwerte.
"""

from __future__ import annotations

import hashlib
from collections import Counter
from collections.abc import Iterable

USER_SIGNATURE_COLORS: tuple[str, ...] = (
    # --- Bestandspalette (Reihenfolge nicht ändern) ---
    "#7C3AED",  # Violett
    "#2563EB",  # Königsblau
    "#059669",  # Smaragd
    "#D97706",  # Bernstein
    "#DC2626",  # Rot
    "#0891B2",  # Cyan
    "#DB2777",  # Himbeer
    "#65A30D",  # Apfelgrün
    "#0F766E",  # Petrol
    "#9333EA",  # Purpur
    # --- Erweiterung auf 30 (Farbfamilien bewusst gestreut) ---
    "#3B82F6",  # Blau
    "#F97316",  # Orange
    "#14B8A6",  # Türkis
    "#EC4899",  # Pink
    "#84CC16",  # Limette
    "#6366F1",  # Indigo
    "#EAB308",  # Gelb
    "#F43F5E",  # Rose
    "#22C55E",  # Grün
    "#C026D3",  # Fuchsia
    "#0EA5E9",  # Sky
    "#C2410C",  # Kupfer
    "#BE123C",  # Weinrot
    "#4D7C0F",  # Moos
    "#A855F7",  # Lila
    "#06B6D4",  # Aqua
    "#D946EF",  # Magenta
    "#64748B",  # Schiefer
    "#FB7185",  # Koralle
    "#2DD4BF",  # Mint
)

SIGNATURE_COLOR_SOURCE_AUTO = "auto"
SIGNATURE_COLOR_SOURCE_MANUAL = "manual"


def _hash_index(user_external_id: str) -> int:
    digest = hashlib.sha256((user_external_id or "").encode("utf-8")).digest()
    # Zwei Bytes, damit alle 30 Indizes erreichbar und gleichverteilt sind.
    return (digest[0] * 256 + digest[1]) % len(USER_SIGNATURE_COLORS)


def pick_signature_color(user_external_id: str) -> str:
    """Deterministische Fallback-Farbe rein aus der User-ID (Read-Pfade für
    noch nicht befüllte Benutzer). Persistierte Vergabe läuft über
    ``pick_least_used_signature_color``."""
    return USER_SIGNATURE_COLORS[_hash_index(user_external_id)]


def pick_least_used_signature_color(
    user_external_id: str, used_colors: Iterable[str | None]
) -> str:
    """Am wenigsten genutzte Palettenfarbe — Farben wiederholen sich erst,
    wenn alle vergeben sind. Bei Gleichstand startet die Suche deterministisch
    am Hash-Index der User-ID (stabil und gleichzeitig gestreut)."""
    counts: Counter[str] = Counter()
    for value in used_colors:
        normalized = normalize_signature_color(value)
        if normalized:
            counts[normalized] += 1
    minimum = min((counts.get(color, 0) for color in USER_SIGNATURE_COLORS), default=0)
    start = _hash_index(user_external_id)
    total = len(USER_SIGNATURE_COLORS)
    for offset in range(total):
        candidate = USER_SIGNATURE_COLORS[(start + offset) % total]
        if counts.get(candidate, 0) == minimum:
            return candidate
    return USER_SIGNATURE_COLORS[start]


def normalize_signature_color(value: str | None) -> str | None:
    """Normalisiert eine Farbe auf die kanonische Paletten-Schreibweise;
    ``None`` wenn der Wert nicht in der erlaubten Palette liegt."""
    candidate = (value or "").strip().upper()
    for color in USER_SIGNATURE_COLORS:
        if color.upper() == candidate:
            return color
    return None
