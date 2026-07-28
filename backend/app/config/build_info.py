"""Build-Metadaten des laufenden Containers (Commit, Branch, Buildzeit).

Zwei Quellen, in dieser Reihenfolge:

1. Die Umgebungsvariablen ``APP_GIT_COMMIT`` / ``APP_GIT_BRANCH`` /
   ``APP_BUILD_TIME`` — ausdrueckliche Vorgabe des Betreibers, hat Vorrang.
   Unter Portainer ist das der Normalfall: Das WWS setzt den Commit beim
   Redeploy als Webhook-Parameter (Portainer checkt Git-Stacks ohne ``.git``
   aus, siehe ``services/system_update_service.redeploy_url``).
2. ``build_info.json`` im Backend-Wurzelverzeichnis. Die Datei entsteht beim
   Image-Build aus den Git-Metadaten des Checkouts
   (``scripts/derive_build_info.py``) und traegt bei Builds mit Git-Kontext
   (lokal, CI).

Der Vorrang gilt **feldweise**: Ist nur der Commit per ENV gesetzt, stammen
Branch und Buildzeit weiterhin aus der Datei.

Fehlt beides, gilt die Version als **unbekannt**. Das ist ein gueltiger
Zustand: Die Anwendung laeuft normal, meldet ein Update nach dem Neustart aber
niemals faelschlich als erfolgreich (siehe ``services/system_update_service``).
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from .settings import get_settings

logger = logging.getLogger("cloud_web.build_info")

_SHA_PATTERN = re.compile(r"^[0-9a-f]{7,64}$")

# Backend-Wurzel: build_info.py liegt unter app/config/.
_BACKEND_ROOT = Path(__file__).resolve().parents[2]
BUILD_INFO_FILE = _BACKEND_ROOT / "build_info.json"


@dataclass(frozen=True)
class BuildInfo:
    commit: str | None
    branch: str | None
    build_time: str | None
    # Woher der Commit stammt: "env", "file" oder "unknown" (nur fuer Logs/Doku).
    source: str


def _clean_commit(value: str | None) -> str | None:
    raw = (value or "").strip().lower()
    if not raw or not _SHA_PATTERN.match(raw):
        return None
    return raw


def _read_file() -> dict:
    try:
        if not BUILD_INFO_FILE.is_file():
            return {}
        return json.loads(BUILD_INFO_FILE.read_text(encoding="utf-8")) or {}
    except (OSError, ValueError):
        # Eine kaputte Datei darf den Start nicht stoeren — Version bleibt
        # schlicht unbekannt.
        logger.warning("build_info.json konnte nicht gelesen werden — Version gilt als unbekannt")
        return {}


@lru_cache
def get_image_build_info() -> BuildInfo:
    """Nur die Angaben aus ``build_info.json`` — ohne ENV-Ueberschreibung.

    Die Buildzeit dieser Datei ist die **Identitaet des laufenden Images**: Sie
    aendert sich bei jedem Neubau und ist auch dann vorhanden, wenn der Commit
    unbekannt bleibt (Portainer checkt ohne ``.git`` aus). Genau darauf stuetzt
    sich die Erfolgspruefung nach einem Redeploy
    (``services/system_update_service``).
    """
    data = _read_file()
    commit = _clean_commit(data.get("commit"))
    return BuildInfo(
        commit=commit,
        branch=(data.get("branch") or "").strip() or None,
        build_time=(data.get("buildTime") or "").strip() or None,
        source="file" if commit else "unknown",
    )


@lru_cache
def get_build_info() -> BuildInfo:
    settings = get_settings()
    env_commit = _clean_commit(settings.app_git_commit)
    env_branch = (settings.app_git_branch or "").strip() or None
    env_build_time = (settings.app_build_time or "").strip() or None

    data = _read_file()
    file_commit = _clean_commit(data.get("commit"))
    file_branch = (data.get("branch") or "").strip() or None
    file_build_time = (data.get("buildTime") or "").strip() or None

    if env_commit:
        # Feldweise, nicht als Block: Unter Portainer kommt der Commit per
        # Stack-Variable, die Buildzeit aber nur aus der Datei — sonst bliebe
        # die Buildzeit dort dauerhaft leer.
        return BuildInfo(
            commit=env_commit,
            branch=env_branch or file_branch,
            build_time=env_build_time or file_build_time,
            source="env",
        )

    return BuildInfo(
        commit=file_commit,
        branch=env_branch or file_branch,
        build_time=env_build_time or file_build_time,
        source="file" if file_commit else "unknown",
    )
