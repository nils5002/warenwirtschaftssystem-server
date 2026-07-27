"""Systemupdate: Versionspruefung + Redeploy ueber den Portainer-Stack-Webhook.

Grundprinzip: Das WWS verwaltet **kein Docker**. Es kennt weder Docker-Socket
noch Portainer-API-Zugang und fuehrt keine Shell-Befehle aus. Es ruft
ausschliesslich EINEN fest konfigurierten Portainer-Stack-Webhook auf; Portainer
zieht daraufhin selbst den aktuellen Git-Stand und baut den Stack neu.

Sicherheits-Leitplanken dieses Moduls:
* Repository, Branch und Webhook-URL stammen ausschliesslich aus der
  Serverkonfiguration — niemals aus dem Request. Es gibt keine freie Eingabe
  von Branch, Commit oder URL (kein SSRF-Vektor, keine Command-Injection).
* Die Webhook-URL wird nie vollstaendig geloggt (siehe ``mask_webhook_url``)
  und verlaesst den Server nie ueber die API.
* Der Update-Lock liegt in der Datenbank und ueberlebt damit den durch das
  Update ausgeloesten Backend-Neustart. Ein haengengebliebener Lauf wird nach
  ``SYSTEM_UPDATE_TIMEOUT_SECONDS`` als veraltet erkannt.
* Nach dem Neustart wird nur dann Erfolg gemeldet, wenn der tatsaechlich
  laufende Commit dem Zielcommit entspricht. Ist die Build-Version unbekannt,
  gilt der Lauf als fehlgeschlagen — niemals als Erfolg.
* Damit der neue Container seinen Commit ueberhaupt kennt, wird die Zielversion
  beim Redeploy als Query-Parameter an den Webhook uebergeben (``redeploy_url``)
  — Portainer legt bei Git-Stacks kein ``.git`` im Build-Kontext ab.

Erweiterbarkeit (bewusst vorbereitet, aber noch nicht freigegeben): Die
Aufloesung "welcher Commit ist das Ziel" liegt gekapselt in
``resolve_target_commit``. Ein spaeterer Ausbau auf freigegebene Git-Tags oder
Releases muss nur dort ansetzen; der Rest des Ablaufs (Lock, Backup, Webhook,
Verifikation) bleibt unveraendert.
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qsl, urlencode, urlparse, urlsplit, urlunsplit

import requests
from fastapi import HTTPException
from requests import exceptions as _requests_exceptions
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config.build_info import get_build_info
from ..config.settings import Settings, get_settings
from ..database.models import SystemUpdateRunRecord
from ..schemas.system_update import (
    CommitInfo,
    SystemUpdateCheckResponse,
    SystemUpdateHistoryResponse,
    SystemUpdateRunItem,
    SystemUpdateStartResponse,
    SystemUpdateStatusResponse,
    SystemVersionResponse,
)
from . import backup_service

logger = logging.getLogger("cloud_web.system_update")

# Status, bei denen ein Vorgang als "laeuft" gilt und den Lock haelt.
ACTIVE_STATUSES: tuple[str, ...] = (
    "checking",
    "backing_up",
    "redeploy_requested",
    "restarting",
)

GITHUB_API_BASE = "https://api.github.com"
# Getrennte Connect-/Read-Timeouts: eine haengende Gegenstelle darf den
# Adminbereich nicht blockieren.
_GITHUB_TIMEOUT = (5, 10)
_WEBHOOK_TIMEOUT = (5, 20)

# owner/repo — bewusst streng, damit aus der Konfiguration keine beliebige
# URL zusammengebaut werden kann.
_REPO_PATTERN = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
_BRANCH_PATTERN = re.compile(r"^[A-Za-z0-9_./-]{1,120}$")
_SHA_PATTERN = re.compile(r"^[0-9a-f]{7,64}$")

# Nach dieser Zeit ohne erneuten Prozessstart wird ein ``redeploy_requested``
# im Statusendpunkt als ``restarting`` angezeigt — Portainer baut dann bereits.
_RESTART_PHASE_AFTER_SECONDS = 20


# --- Hilfen -------------------------------------------------------------------

def mask_webhook_url(url: str | None) -> str:
    """Kuerzt eine Webhook-URL fuer Logausgaben auf Schema + Host.

    Der Pfad enthaelt das Portainer-Webhook-Token und darf niemals im Log
    (und erst recht nicht in einer API-Antwort) auftauchen.
    """
    if not url:
        return "<nicht konfiguriert>"
    try:
        parsed = urlparse(url)
    except ValueError:
        return "<ungueltig>"
    if not parsed.scheme or not parsed.netloc:
        return "<ungueltig>"
    return f"{parsed.scheme}://{parsed.netloc}/…"


def short_sha(value: str | None) -> str | None:
    if not value:
        return None
    return value[:7]


def _now() -> datetime:
    return datetime.now(UTC)


def _as_utc(value: datetime | None) -> datetime | None:
    """SQLite liefert naive Datetimes zurueck — als UTC interpretieren."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


def _fmt(value: datetime | None) -> str | None:
    value = _as_utc(value)
    if value is None:
        return None
    return value.isoformat()


def installed_commit(settings: Settings | None = None) -> str | None:
    """Commit des laufenden Builds — ``None``, wenn er nicht feststellbar ist.

    Vorrang hat ein ausdruecklich gesetztes ``APP_GIT_COMMIT``; sonst greift die
    beim Image-Build aus dem Git-Checkout ermittelte ``build_info.json``.

    Unter Portainer greift der erste Weg: Der Redeploy uebergibt die
    Zielversion als Query-Parameter an den Stack-Webhook (siehe
    ``redeploy_url``), weil Portainer im Checkout kein ``.git`` ablegt. Die
    ``build_info.json`` bleibt der Weg fuer Builds mit Git-Kontext (lokal, CI).
    """
    settings = settings or get_settings()
    raw = (settings.app_git_commit or "").strip().lower()
    if raw and _SHA_PATTERN.match(raw):
        return raw
    return get_build_info().commit


def webhook_configured(settings: Settings | None = None) -> bool:
    settings = settings or get_settings()
    url = (settings.portainer_stack_webhook_url or "").strip()
    if not url:
        return False
    parsed = urlparse(url)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def repository_url(settings: Settings | None = None) -> str:
    settings = settings or get_settings()
    return f"https://github.com/{settings.github_repository}"


def _validate_config(settings: Settings) -> None:
    """Prueft die (nur serverseitig gesetzte) Repo-/Branch-Konfiguration."""
    if not _REPO_PATTERN.match((settings.github_repository or "").strip()):
        raise HTTPException(
            status_code=500,
            detail="Ungültige Repository-Konfiguration (GITHUB_REPOSITORY).",
        )
    if not _BRANCH_PATTERN.match((settings.github_branch or "").strip()):
        raise HTTPException(
            status_code=500, detail="Ungültige Branch-Konfiguration (GITHUB_BRANCH)."
        )


def _run_to_item(record: SystemUpdateRunRecord) -> SystemUpdateRunItem:
    return SystemUpdateRunItem(
        id=record.external_id,
        status=record.status,  # type: ignore[arg-type]
        startedAt=_fmt(record.started_at),
        finishedAt=_fmt(record.finished_at),
        startedByUserId=record.started_by_user_id,
        startedByName=record.started_by_name,
        sourceCommit=record.source_commit,
        sourceShortCommit=short_sha(record.source_commit),
        targetCommit=record.target_commit,
        targetShortCommit=short_sha(record.target_commit),
        detectedCommitAfterRestart=record.detected_commit_after_restart,
        backupReference=record.backup_reference,
        message=record.message,
        errorDetails=record.error_details,
    )


# --- GitHub-Abfrage -----------------------------------------------------------

def fetch_latest_commit(settings: Settings | None = None) -> CommitInfo:
    """Liest den HEAD-Commit des konfigurierten Branches von der GitHub-API.

    Wirft ``HTTPException`` mit einer verstaendlichen deutschen Meldung. Das
    GitHub-Token wird ausschliesslich als Header gesendet und niemals geloggt.
    """
    settings = settings or get_settings()
    _validate_config(settings)

    repo = settings.github_repository.strip()
    branch = settings.github_branch.strip()
    url = f"{GITHUB_API_BASE}/repos/{repo}/commits/{branch}"
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "warehouse-system-update-check",
    }
    token = (settings.github_api_token or "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"

    try:
        response = requests.get(url, headers=headers, timeout=_GITHUB_TIMEOUT)
    except requests.RequestException as exc:
        # Nur der Ausnahmetyp wird geloggt — die Meldung koennte theoretisch
        # den Header-Inhalt enthalten.
        logger.warning("GitHub-Versionsprüfung fehlgeschlagen: %s", type(exc).__name__)
        raise HTTPException(
            status_code=502, detail="GitHub ist derzeit nicht erreichbar."
        ) from exc

    if response.status_code == 404:
        raise HTTPException(
            status_code=502,
            detail="Repository oder Branch wurde auf GitHub nicht gefunden.",
        )
    if response.status_code in (401, 403):
        raise HTTPException(
            status_code=502,
            detail="GitHub hat die Anfrage abgelehnt (Zugriff oder Rate-Limit).",
        )
    if response.status_code >= 400:
        logger.warning("GitHub-Versionsprüfung: HTTP %s", response.status_code)
        raise HTTPException(
            status_code=502, detail="Die Versionsprüfung bei GitHub ist fehlgeschlagen."
        )

    try:
        data = response.json()
        sha = str(data["sha"]).strip().lower()
        commit = data.get("commit") or {}
        author = (commit.get("author") or {}).get("name")
        date = (commit.get("author") or {}).get("date")
        raw_message = str(commit.get("message") or "").strip()
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(
            status_code=502, detail="Die Antwort von GitHub war unerwartet."
        ) from exc

    if not _SHA_PATTERN.match(sha):
        raise HTTPException(
            status_code=502, detail="Die Antwort von GitHub war unerwartet."
        )

    # Nur die erste Zeile der Commit-Nachricht anzeigen (Betreffzeile).
    message = raw_message.splitlines()[0][:200] if raw_message else ""
    return CommitInfo(
        sha=sha,
        shortSha=short_sha(sha) or sha,
        message=message,
        author=(str(author)[:120] if author else None),
        date=(str(date)[:40] if date else None),
        url=f"{repository_url(settings)}/commit/{sha}",
    )


def resolve_target_commit(settings: Settings | None = None) -> CommitInfo:
    """Ermittelt den Ziel-Commit eines Updates.

    Aktuell ausschliesslich der HEAD des konfigurierten Branches. Diese
    Funktion ist der einzige Ort, an dem eine spaetere Erweiterung auf
    freigegebene Git-Tags/Releases ansetzen muss.
    """
    return fetch_latest_commit(settings)


# --- Version / Pruefung -------------------------------------------------------

def version_info(settings: Settings | None = None) -> SystemVersionResponse:
    settings = settings or get_settings()
    commit = installed_commit(settings)
    # Branch/Buildzeit analog zum Commit: ausdrueckliche ENV-Vorgabe schlaegt
    # den beim Build ermittelten Wert.
    baked = get_build_info()
    return SystemVersionResponse(
        appVersion=settings.app_version,
        installedCommit=commit,
        installedShortCommit=short_sha(commit),
        installedBranch=(settings.app_git_branch or "").strip() or baked.branch,
        buildTime=(settings.app_build_time or "").strip() or baked.build_time,
        repository=settings.github_repository,
        branch=settings.github_branch,
        repositoryUrl=repository_url(settings),
        updateEnabled=bool(settings.system_update_enabled),
        webhookConfigured=webhook_configured(settings),
    )


def check_update(settings: Settings | None = None) -> SystemUpdateCheckResponse:
    """Vergleicht die installierte Version mit dem neuesten Commit.

    Fehler bei GitHub werden hier bewusst in eine normale Antwort mit
    ``state="check_failed"`` uebersetzt: Eine gestoerte Versionspruefung darf
    die uebrige Nutzung der Anwendung nicht beeintraechtigen.
    """
    settings = settings or get_settings()
    installed = installed_commit(settings)
    base = {
        "installedCommit": installed,
        "installedShortCommit": short_sha(installed),
        "updateEnabled": bool(settings.system_update_enabled),
        "webhookConfigured": webhook_configured(settings),
        "checkedAt": _fmt(_now()),
    }

    if not settings.system_update_enabled:
        return SystemUpdateCheckResponse(
            state="disabled",
            updateAvailable=False,
            message="Systemupdates sind auf diesem Server nicht aktiviert.",
            **base,
        )

    try:
        latest = resolve_target_commit(settings)
    except HTTPException as exc:
        return SystemUpdateCheckResponse(
            state="check_failed",
            updateAvailable=False,
            message=str(exc.detail),
            **base,
        )

    if installed is None:
        return SystemUpdateCheckResponse(
            state="installed_version_unknown",
            # Ohne bekannte Build-Version laesst sich nicht vergleichen. Ein
            # Update bleibt moeglich (der Admin entscheidet), wird aber nicht
            # als "verfuegbar" behauptet.
            updateAvailable=False,
            latest=latest,
            compareUrl=f"{repository_url(settings)}/commits/{settings.github_branch}",
            message=(
                "Die installierte Version ist unbekannt (APP_GIT_COMMIT ist nicht gesetzt). "
                "Ein Vergleich mit GitHub ist deshalb nicht möglich."
            ),
            **base,
        )

    if installed == latest.sha:
        return SystemUpdateCheckResponse(
            state="up_to_date",
            updateAvailable=False,
            latest=latest,
            compareUrl=f"{repository_url(settings)}/commits/{settings.github_branch}",
            message="Das System ist auf dem neuesten Stand.",
            **base,
        )

    return SystemUpdateCheckResponse(
        state="update_available",
        updateAvailable=True,
        latest=latest,
        compareUrl=f"{repository_url(settings)}/compare/{installed}...{latest.sha}",
        message="Eine neue Version ist verfügbar.",
        **base,
    )


# --- Lock / Status ------------------------------------------------------------

def _active_run(db: Session) -> SystemUpdateRunRecord | None:
    return db.scalar(
        select(SystemUpdateRunRecord)
        .where(SystemUpdateRunRecord.status.in_(ACTIVE_STATUSES))
        .order_by(SystemUpdateRunRecord.started_at.desc(), SystemUpdateRunRecord.id.desc())
    )


def _expire_if_stale(db: Session, record: SystemUpdateRunRecord, settings: Settings) -> bool:
    """Setzt einen abgelaufenen Vorgang auf ``timeout``. True = wurde beendet."""
    started = _as_utc(record.started_at)
    if started is None:
        return False
    timeout = max(60, int(settings.system_update_timeout_seconds))
    if _now() - started <= timedelta(seconds=timeout):
        return False
    record.status = "timeout"
    record.finished_at = _now()
    record.message = (
        "Zeitüberschreitung: Das Update wurde an Portainer übergeben, konnte aber "
        "nicht innerhalb der erwarteten Zeit bestätigt werden."
    )
    db.commit()
    logger.warning("Systemupdate %s als abgelaufen markiert (timeout)", record.external_id)
    return True


def current_status(db: Session, settings: Settings | None = None) -> SystemUpdateStatusResponse:
    settings = settings or get_settings()
    installed = installed_commit(settings)
    record = _active_run(db)

    if record is not None and _expire_if_stale(db, record, settings):
        record = None
    elif record is not None and record.status == "redeploy_requested":
        # Sichtbare Zwischenphase: Portainer baut und startet den Stack neu.
        started = _as_utc(record.started_at)
        if started is not None and _now() - started > timedelta(
            seconds=_RESTART_PHASE_AFTER_SECONDS
        ):
            record.status = "restarting"
            db.commit()

    if record is not None:
        return SystemUpdateStatusResponse(
            status=record.status,  # type: ignore[arg-type]
            inProgress=True,
            run=_run_to_item(record),
            installedCommit=installed,
            installedShortCommit=short_sha(installed),
            updateEnabled=bool(settings.system_update_enabled),
            webhookConfigured=webhook_configured(settings),
            timeoutSeconds=int(settings.system_update_timeout_seconds),
        )

    last = db.scalar(
        select(SystemUpdateRunRecord).order_by(
            SystemUpdateRunRecord.started_at.desc(), SystemUpdateRunRecord.id.desc()
        )
    )
    return SystemUpdateStatusResponse(
        status=(last.status if last is not None else "idle"),  # type: ignore[arg-type]
        inProgress=False,
        run=(_run_to_item(last) if last is not None else None),
        installedCommit=installed,
        installedShortCommit=short_sha(installed),
        updateEnabled=bool(settings.system_update_enabled),
        webhookConfigured=webhook_configured(settings),
        timeoutSeconds=int(settings.system_update_timeout_seconds),
    )


def history(db: Session, *, limit: int = 20, offset: int = 0) -> SystemUpdateHistoryResponse:
    limit = max(1, min(int(limit or 20), 100))
    offset = max(0, int(offset or 0))
    total = db.scalar(select(func.count(SystemUpdateRunRecord.id))) or 0
    records = db.scalars(
        select(SystemUpdateRunRecord)
        .order_by(SystemUpdateRunRecord.started_at.desc(), SystemUpdateRunRecord.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    return SystemUpdateHistoryResponse(
        items=[_run_to_item(record) for record in records], total=int(total)
    )


# --- Update ausloesen ---------------------------------------------------------

def _fail_run(db: Session, record: SystemUpdateRunRecord, message: str, details: str | None) -> None:
    record.status = "failed"
    record.finished_at = _now()
    record.message = message[:500]
    record.error_details = (details or None)
    db.commit()


def redeploy_url(webhook_url: str, target_sha: str, settings: Settings | None = None) -> str:
    """Haengt die Zielversion als Query-Parameter an die Webhook-URL.

    Hintergrund: Portainer legt im Checkout eines Git-Stacks **kein** ``.git``
    ab (geprueft mit Portainer 2.39). Die beim Image-Build vorgesehene
    Ableitung aus den Git-Metadaten laeuft dort deshalb leer, und der Container
    wuesste nach dem Redeploy nicht, welchen Commit er ausfuehrt — die
    Erfolgspruefung nach dem Neustart koennte nie greifen.

    Portainer uebernimmt Query-Parameter eines Stack-Webhooks als
    Umgebungsvariablen des Stacks. ``docker-compose.yml`` reicht
    ``APP_GIT_COMMIT``/``APP_GIT_BRANCH`` als Build-Args weiter, sodass genau
    die angeforderte Zielversion im neuen Image landet.

    Bewusst eng gehalten: Es werden ausschliesslich der bereits validierte
    Ziel-Commit und der serverseitig konfigurierte Branch angehaengt — keine
    Werte aus dem Request. Vorhandene Parameter der konfigurierten URL bleiben
    erhalten, gleichnamige werden ersetzt.
    """
    settings = settings or get_settings()
    if not settings.system_update_pass_build_metadata:
        return webhook_url

    sha = (target_sha or "").strip().lower()
    if not _SHA_PATTERN.match(sha):
        # Ohne plausiblen Commit lieber nichts anhaengen als etwas Falsches in
        # die Stack-Konfiguration schreiben.
        return webhook_url

    parts = urlsplit(webhook_url)
    query = [
        (key, value)
        for key, value in parse_qsl(parts.query, keep_blank_values=True)
        if key not in {"APP_GIT_COMMIT", "APP_GIT_BRANCH"}
    ]
    query.append(("APP_GIT_COMMIT", sha))
    branch = (settings.github_branch or "").strip()
    if _BRANCH_PATTERN.match(branch):
        query.append(("APP_GIT_BRANCH", branch))
    return urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment)
    )


def _unreachable_detail(exc: Exception) -> str:
    """Uebersetzt einen Verbindungsfehler in eine Meldung, die weiterhilft.

    Ein blosses „nicht erreichbar" laesst offen, ob der Name nicht aufloest, das
    Zertifikat abgelehnt wird oder die Gegenstelle schweigt — drei voellig
    verschiedene Ursachen. Die URL selbst taucht nie in der Meldung auf.
    """
    if isinstance(exc, _requests_exceptions.SSLError):
        return (
            "Portainer wurde erreicht, aber das TLS-Zertifikat konnte nicht geprüft werden. "
            "Das Update wurde nicht gestartet."
        )
    if isinstance(exc, _requests_exceptions.Timeout):
        return (
            "Portainer hat nicht rechtzeitig geantwortet. Das Update wurde nicht gestartet."
        )
    if isinstance(exc, _requests_exceptions.InvalidURL | _requests_exceptions.MissingSchema):
        return "Die konfigurierte Portainer-URL ist ungültig. Das Update wurde nicht gestartet."
    return "Portainer ist nicht erreichbar. Das Update wurde nicht gestartet."


def _trigger_webhook(url: str) -> None:
    """Ruft den Portainer-Webhook GENAU EINMAL auf (kein Retry).

    Ein Retry ist hier bewusst ausgeschlossen: Ein zweiter Aufruf wuerde einen
    zweiten Redeploy anstossen, waehrend der erste bereits laeuft.
    """
    try:
        response = requests.post(url, timeout=_WEBHOOK_TIMEOUT)
    except requests.RequestException as exc:
        # Nur Ausnahmetyp und maskierte URL ins Log — die Fehlermeldung selbst
        # koennte die vollstaendige URL samt Token enthalten.
        logger.error(
            "Portainer-Webhook nicht erreichbar: %s (%s)",
            type(exc).__name__,
            mask_webhook_url(url),
        )
        raise HTTPException(status_code=502, detail=_unreachable_detail(exc)) from exc

    if response.status_code >= 400:
        logger.error(
            "Portainer-Webhook abgelehnt: HTTP %s (%s)",
            response.status_code,
            mask_webhook_url(url),
        )
        raise HTTPException(
            status_code=502,
            detail=(
                f"Portainer hat den Redeploy abgelehnt (HTTP {response.status_code}). "
                "Das Update wurde nicht gestartet."
            ),
        )


def start_update(
    db: Session,
    *,
    actor_id: str | None,
    actor_name: str | None,
    settings: Settings | None = None,
) -> SystemUpdateStartResponse:
    """Fuehrt den Updatevorgang bis zur Uebergabe an Portainer aus.

    Reihenfolge ist verbindlich: Lock -> Versionspruefung -> Backup ->
    Protokoll -> Webhook. Schlaegt das Backup fehl, wird KEIN Webhook
    ausgeloest und der Lock wieder freigegeben.
    """
    settings = settings or get_settings()

    if not settings.system_update_enabled:
        raise HTTPException(
            status_code=403, detail="Systemupdates sind auf diesem Server nicht aktiviert."
        )
    webhook_url = (settings.portainer_stack_webhook_url or "").strip()
    if not webhook_configured(settings):
        raise HTTPException(
            status_code=503,
            detail="Es ist kein Portainer-Webhook konfiguriert. Bitte an die Administration wenden.",
        )

    # --- Lock ---------------------------------------------------------------
    running = _active_run(db)
    if running is not None and not _expire_if_stale(db, running, settings):
        raise HTTPException(
            status_code=409, detail="Es läuft bereits ein Systemupdate. Bitte warten."
        )

    installed = installed_commit(settings)
    record = SystemUpdateRunRecord(
        external_id=f"upd-{uuid.uuid4().hex[:12]}",
        started_at=_now(),
        started_by_user_id=actor_id,
        started_by_name=actor_name,
        source_commit=installed,
        status="checking",
        message="Version wird geprüft.",
    )
    db.add(record)
    try:
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        raise HTTPException(
            status_code=500, detail="Das Update konnte nicht gestartet werden."
        ) from exc

    # --- Versionspruefung ----------------------------------------------------
    try:
        latest = resolve_target_commit(settings)
    except HTTPException as exc:
        _fail_run(db, record, str(exc.detail), "github_check_failed")
        raise
    record.target_commit = latest.sha
    db.commit()

    if installed is not None and installed == latest.sha:
        record.status = "failed"
        record.finished_at = _now()
        record.message = "Das System ist bereits auf dem neuesten Stand."
        record.error_details = "no_update_available"
        db.commit()
        raise HTTPException(
            status_code=409, detail="Das System ist bereits auf dem neuesten Stand."
        )

    # --- Backup --------------------------------------------------------------
    record.status = "backing_up"
    record.message = "Backup wird erstellt."
    db.commit()
    try:
        artifact = backup_service.create_backup_archive(db)
    except HTTPException as exc:
        _fail_run(db, record, str(exc.detail), "backup_failed")
        raise
    except Exception as exc:  # noqa: BLE001
        _fail_run(
            db,
            record,
            "Das Backup konnte nicht erstellt werden. Das Update wurde abgebrochen.",
            "backup_failed",
        )
        logger.exception("Pre-Update-Backup fehlgeschlagen")
        raise HTTPException(
            status_code=500,
            detail="Das Backup konnte nicht erstellt werden. Das Update wurde abgebrochen.",
        ) from exc

    record.backup_reference = artifact.file_name
    record.message = "Backup erstellt. Update wird an Portainer übergeben."
    db.commit()

    # --- Portainer-Webhook (genau einmal) ------------------------------------
    logger.info(
        "Systemupdate %s: Redeploy wird angefordert (Ziel %s, Webhook %s, Backup %s)",
        record.external_id,
        short_sha(latest.sha),
        mask_webhook_url(webhook_url),
        artifact.file_name,
    )
    try:
        _trigger_webhook(redeploy_url(webhook_url, latest.sha, settings))
    except HTTPException as exc:
        _fail_run(db, record, str(exc.detail), "webhook_failed")
        raise

    record.status = "redeploy_requested"
    record.message = "Das Update wurde an Portainer übergeben."
    db.commit()

    return SystemUpdateStartResponse(
        accepted=True,
        status="redeploy_requested",
        targetCommit=latest.sha,
        message="Das Update wurde an Portainer übergeben.",
        run=_run_to_item(record),
    )


# --- Auswertung nach dem Neustart ---------------------------------------------

def reconcile_pending_runs(db: Session, settings: Settings | None = None) -> int:
    """Bewertet beim Start offene Updatevorgaenge. Liefert die Anzahl.

    Regeln:
    * laufender Commit == Zielcommit -> ``success``
    * Build-Version unbekannt -> ``failed`` (niemals faelschlich Erfolg melden)
    * anderer Commit + Zeitfenster ueberschritten -> ``timeout``
    * anderer Commit innerhalb des Zeitfensters -> ``failed`` (unerwarteter Stand)
    """
    settings = settings or get_settings()
    records = db.scalars(
        select(SystemUpdateRunRecord).where(SystemUpdateRunRecord.status.in_(ACTIVE_STATUSES))
    ).all()
    if not records:
        return 0

    installed = installed_commit(settings)
    timeout = max(60, int(settings.system_update_timeout_seconds))
    now = _now()

    for record in records:
        record.detected_commit_after_restart = installed
        record.finished_at = now
        started = _as_utc(record.started_at)
        expired = started is not None and now - started > timedelta(seconds=timeout)

        if installed is not None and record.target_commit and installed == record.target_commit:
            record.status = "success"
            record.message = "Das Update wurde erfolgreich installiert."
            record.error_details = None
        elif installed is None:
            record.status = "failed"
            record.message = (
                "Der Neustart wurde erkannt, die laufende Version lässt sich aber nicht "
                "überprüfen (APP_GIT_COMMIT ist nicht gesetzt)."
            )
            record.error_details = "installed_version_unknown"
        elif expired:
            record.status = "timeout"
            record.message = (
                "Zeitüberschreitung: Nach dem Neustart läuft weiterhin nicht die "
                "erwartete Version."
            )
            record.error_details = "timeout_unexpected_commit"
        else:
            record.status = "failed"
            record.message = (
                "Nach dem Neustart läuft eine unerwartete Version. Bitte den Stack in "
                "Portainer prüfen."
            )
            record.error_details = "unexpected_commit"

        logger.info(
            "Systemupdate %s nach Neustart bewertet: %s (installiert=%s, Ziel=%s)",
            record.external_id,
            record.status,
            short_sha(installed) or "unbekannt",
            short_sha(record.target_commit) or "-",
        )

    db.commit()
    return len(records)
