"""Zentraler Katalog der Rollen-Rechte (Permissions) für „Rollen & Rechte".

Eine einzige Quelle der Wahrheit für:
- die existierenden Rollen-Keys (``admin``/``projektmanager``/``mitarbeiter``),
- den vollständigen Permission-Katalog (Key → deutsches Label → Gruppe),
- die Default-Zuordnung, die das *heutige* Verhalten 1:1 abbildet.

Wichtig: Die Permission-Keys sind technisch und werden NICHT im UI angezeigt —
das Frontend nutzt ausschließlich die deutschen ``label``-Werte.
"""

from __future__ import annotations

from dataclasses import dataclass

# Die drei bestehenden, normalisierten Rollen-Keys (siehe
# ``routes/dependencies.py:_normalize_role``). Es werden bewusst keine neuen
# Rollen eingeführt.
ROLE_KEYS: tuple[str, ...] = ("admin", "projektmanager", "mitarbeiter")

# Das Recht, das die Rechteverwaltung selbst schützt. Es darf nie der letzten
# Rolle entzogen werden (Aussperr-Schutz, siehe role_service).
PERMISSION_ROLES_MANAGE = "roles.manage"


@dataclass(frozen=True)
class PermissionDef:
    key: str
    label: str  # deutsch, wird im UI angezeigt
    group: str  # Gruppen-Key für die UI-Gruppierung


# Geordneter Katalog. Reihenfolge bestimmt die Anzeige-Reihenfolge im UI.
PERMISSION_CATALOG: tuple[PermissionDef, ...] = (
    PermissionDef("assets.read", "Inventar ansehen", "inventory"),
    PermissionDef("assets.update", "Inventar bearbeiten", "inventory"),
    PermissionDef("assets.delete", "Hardware löschen", "inventory"),
    PermissionDef("planning.read", "Einsatzplanung ansehen", "planning"),
    PermissionDef("planning.update", "Einsatzplanung bearbeiten", "planning"),
    PermissionDef("checkinout.use", "Ausgabe/Rücknahme nutzen", "operations"),
    PermissionDef("defects.report", "Defekte melden", "operations"),
    PermissionDef("defects.manage", "Defekte verwalten/abschließen", "operations"),
    PermissionDef("categories.manage", "Kategorien verwalten", "masterdata"),
    PermissionDef("qrcode.manage", "QR-Code verwalten", "administration"),
    PermissionDef("users.manage", "Benutzer verwalten", "administration"),
    PermissionDef("roles.manage", "Rollen & Rechte verwalten", "administration"),
    PermissionDef("backup.manage", "Backup verwalten", "administration"),
    PermissionDef("logs.read", "Logs ansehen", "administration"),
)

# Deutsche Gruppen-Labels (UI-Überschriften).
GROUP_LABELS: dict[str, str] = {
    "inventory": "Inventar",
    "planning": "Einsatzplanung",
    "operations": "Betrieb",
    "masterdata": "Stammdaten",
    "administration": "Administration",
}

# Reihenfolge der Gruppen im UI.
GROUP_ORDER: tuple[str, ...] = (
    "inventory",
    "planning",
    "operations",
    "masterdata",
    "administration",
)

ALL_PERMISSION_KEYS: frozenset[str] = frozenset(p.key for p in PERMISSION_CATALOG)

# Default-Rechte, die das bisherige hartkodierte Verhalten exakt abbilden.
# - admin: alles
# - projektmanager: Planung (lesen/bearbeiten), Inventar lesen, Ausgabe/Rücknahme,
#   Defekte melden, Kategorien verwalten (heute admin+pm)
# - mitarbeiter: Inventar lesen, Ausgabe/Rücknahme, Defekte melden, Planung lesen
DEFAULT_ROLE_PERMISSIONS: dict[str, frozenset[str]] = {
    "admin": ALL_PERMISSION_KEYS,
    "projektmanager": frozenset(
        {
            "planning.read",
            "planning.update",
            "assets.read",
            "checkinout.use",
            "defects.report",
            "categories.manage",
        }
    ),
    "mitarbeiter": frozenset(
        {
            "assets.read",
            "checkinout.use",
            "defects.report",
            "planning.read",
        }
    ),
}


def is_valid_role_key(role_key: str) -> bool:
    return role_key in ROLE_KEYS


def sanitize_permission_keys(keys: list[str]) -> list[str]:
    """Behält nur bekannte Keys, dedupliziert, in Katalog-Reihenfolge.

    Schützt die Tabelle vor unbekannten/getippten Keys und sorgt für stabile,
    deterministische Ausgaben.
    """
    requested = set(keys)
    return [p.key for p in PERMISSION_CATALOG if p.key in requested]
