"""Schemas fuer das Systemupdate (Portainer-Redeploy aus dem Adminbereich).

Wichtig fuer alle Antwortmodelle: Sie enthalten NIEMALS die Portainer-Webhook-URL
und niemals das GitHub-Token. Dass ein Webhook konfiguriert ist, wird
ausschliesslich als Boolean (``webhookConfigured``) mitgeteilt.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel

# Persistierte Status eines Updatevorgangs. ``idle`` ist kein DB-Status,
# sondern die Antwort, wenn ueberhaupt kein Vorgang laeuft.
UpdateRunStatus = Literal[
    "idle",
    "checking",
    "backing_up",
    "redeploy_requested",
    "restarting",
    "success",
    "failed",
    "timeout",
]

# Ergebnis der Versionspruefung.
UpdateCheckState = Literal[
    "up_to_date",
    "update_available",
    "check_failed",
    "installed_version_unknown",
    "disabled",
]


class CommitInfo(BaseModel):
    """Ein Commit, wie ihn die GitHub-API liefert (nur unkritische Felder)."""

    sha: str
    shortSha: str
    message: str
    author: Optional[str] = None
    date: Optional[str] = None
    url: Optional[str] = None


class SystemVersionResponse(BaseModel):
    appVersion: str
    # Build-Metadaten des laufenden Containers. None = unbekannt (nicht gesetzt).
    installedCommit: Optional[str] = None
    installedShortCommit: Optional[str] = None
    installedBranch: Optional[str] = None
    buildTime: Optional[str] = None
    # Konfiguration (ohne Secrets): Repository/Branch, gegen die geprueft wird.
    repository: str
    branch: str
    repositoryUrl: str
    updateEnabled: bool
    # True, wenn eine Portainer-Webhook-URL hinterlegt ist — die URL selbst
    # verlaesst den Server nie.
    webhookConfigured: bool


class SystemUpdateCheckResponse(BaseModel):
    state: UpdateCheckState
    updateAvailable: bool
    installedCommit: Optional[str] = None
    installedShortCommit: Optional[str] = None
    latest: Optional[CommitInfo] = None
    # Vergleichs-URL Installiert -> Neu bzw. Commit-Liste des Branches.
    compareUrl: Optional[str] = None
    checkedAt: Optional[str] = None
    # Deutsche Klartextmeldung fuer das UI (auch im Fehlerfall ohne Details).
    message: str
    updateEnabled: bool
    webhookConfigured: bool


class SystemUpdateRunItem(BaseModel):
    id: str
    status: UpdateRunStatus
    startedAt: Optional[str] = None
    finishedAt: Optional[str] = None
    startedByUserId: Optional[str] = None
    startedByName: Optional[str] = None
    sourceCommit: Optional[str] = None
    sourceShortCommit: Optional[str] = None
    targetCommit: Optional[str] = None
    targetShortCommit: Optional[str] = None
    detectedCommitAfterRestart: Optional[str] = None
    backupReference: Optional[str] = None
    message: Optional[str] = None
    # Technische Kurzbeschreibung des Fehlers. Bewusst getrennt von ``message``,
    # damit das normale UI nur die verstaendliche Meldung anzeigt.
    errorDetails: Optional[str] = None


class SystemUpdateStatusResponse(BaseModel):
    status: UpdateRunStatus
    # Laeuft gerade ein Vorgang (Lock belegt)?
    inProgress: bool
    run: Optional[SystemUpdateRunItem] = None
    installedCommit: Optional[str] = None
    installedShortCommit: Optional[str] = None
    updateEnabled: bool
    webhookConfigured: bool
    # Nach dieser Zeit gilt ein Vorgang als abgelaufen (fuer die UI-Anzeige).
    timeoutSeconds: int


class SystemUpdateStartResponse(BaseModel):
    accepted: bool = True
    status: UpdateRunStatus = "redeploy_requested"
    targetCommit: Optional[str] = None
    message: str
    run: Optional[SystemUpdateRunItem] = None


class SystemUpdateHistoryResponse(BaseModel):
    items: list[SystemUpdateRunItem]
    total: int
