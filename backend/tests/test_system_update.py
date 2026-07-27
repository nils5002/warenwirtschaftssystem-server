"""Systemupdate über den Portainer-Stack-Webhook.

Alle GitHub- und Portainer-Aufrufe sind vollständig gemockt — die Tests gehen
niemals ins Netz und rühren keine produktive Umgebung an.

Abgedeckt:
- Nicht angemeldet / Nicht-Admin
- Funktion deaktiviert / fehlende Webhook-Konfiguration
- kein Update verfügbar / Update verfügbar
- Backup erfolgreich / Backup fehlgeschlagen (kein Webhook!)
- Portainer erfolgreich (genau EIN Aufruf) / Portainer nicht erreichbar
- paralleles Update, Update-Lock, Lock-Timeout
- Historie
- Erkennung nach Neustart (Erfolg, unerwarteter Commit, unbekannte Version)
- keine Secrets in API-Antworten oder Logs
"""

from __future__ import annotations

import json
import logging
import zipfile
from datetime import UTC, datetime, timedelta

import pytest
import requests
from fastapi.testclient import TestClient

from app.config.settings import Settings
from app.database.models import SystemUpdateRunRecord
from app.database.session import SessionLocal
from app.main import app
from app.services import backup_service, system_update_service
from app.services.rate_limiter import (
    system_update_check_rate_limiter,
    system_update_rate_limiter,
)

from .auth_helpers import auth_headers

INSTALLED_COMMIT = "1111111111111111111111111111111111111111"
LATEST_COMMIT = "2222222222222222222222222222222222222222"
WEBHOOK_SECRET = "5f5c9d0e-secret-webhook-token"
WEBHOOK_URL = f"https://portainer.example.com/api/stacks/webhooks/{WEBHOOK_SECRET}"
GITHUB_TOKEN = "ghp_supersecrettoken0000000000000000000"


# --- Mocks --------------------------------------------------------------------


class _FakeResponse:
    def __init__(self, status_code: int = 200, payload: dict | None = None) -> None:
        self.status_code = status_code
        self._payload = payload

    def json(self) -> dict:
        if self._payload is None:
            raise ValueError("keine JSON-Antwort")
        return self._payload


def _commit_payload(sha: str = LATEST_COMMIT) -> dict:
    return {
        "sha": sha,
        "commit": {
            "message": "fix(dashboard): Kalender korrigieren\n\nMehrzeilige Beschreibung",
            "author": {"name": "Nils Klemm", "date": "2026-07-27T08:12:00Z"},
        },
    }


class _FakeRequests:
    """Ersetzt das ``requests``-Modul im Service. Zeichnet alle Aufrufe auf."""

    RequestException = requests.RequestException

    def __init__(self) -> None:
        self.get_calls: list[str] = []
        self.post_calls: list[str] = []
        self.get_response: _FakeResponse | None = _FakeResponse(200, _commit_payload())
        self.get_error: Exception | None = None
        self.post_response: _FakeResponse | None = _FakeResponse(204)
        self.post_error: Exception | None = None

    def get(self, url: str, **_kwargs) -> _FakeResponse:
        self.get_calls.append(url)
        if self.get_error is not None:
            raise self.get_error
        assert self.get_response is not None
        return self.get_response

    def post(self, url: str, **_kwargs) -> _FakeResponse:
        self.post_calls.append(url)
        if self.post_error is not None:
            raise self.post_error
        assert self.post_response is not None
        return self.post_response


# --- Fixtures -----------------------------------------------------------------


@pytest.fixture(autouse=True)
def _clean_state():
    """Update-Läufe und Rate-Limiter zwischen den Tests zurücksetzen."""
    with SessionLocal() as db:
        db.query(SystemUpdateRunRecord).delete()
        db.commit()
    system_update_rate_limiter.reset_all()
    system_update_check_rate_limiter.reset_all()
    yield
    with SessionLocal() as db:
        db.query(SystemUpdateRunRecord).delete()
        db.commit()
    system_update_rate_limiter.reset_all()
    system_update_check_rate_limiter.reset_all()


@pytest.fixture()
def fake_requests(monkeypatch: pytest.MonkeyPatch) -> _FakeRequests:
    stub = _FakeRequests()
    monkeypatch.setattr(system_update_service, "requests", stub)
    return stub


@pytest.fixture()
def backup_dir(tmp_path, monkeypatch: pytest.MonkeyPatch):
    """Backups landen im tmp-Verzeichnis, nie im echten Datenverzeichnis."""
    target = tmp_path / "backups"
    target.mkdir()
    monkeypatch.setattr(
        backup_service, "get_settings", lambda: _settings(backup_path=str(target))
    )
    return target


def _settings(**overrides) -> Settings:
    values: dict = {
        "system_update_enabled": True,
        "portainer_stack_webhook_url": WEBHOOK_URL,
        "github_repository": "nils5002/warenwirtschaftssystem-server",
        "github_branch": "main",
        "github_api_token": GITHUB_TOKEN,
        "app_git_commit": INSTALLED_COMMIT,
        "app_git_branch": "main",
        "app_build_time": "2026-07-20T10:00:00Z",
        "system_update_timeout_seconds": 600,
    }
    values.update(overrides)
    return Settings(**values)


def _use_settings(monkeypatch: pytest.MonkeyPatch, **overrides) -> Settings:
    settings = _settings(**overrides)
    monkeypatch.setattr(system_update_service, "get_settings", lambda: settings)
    return settings


def _admin(client: TestClient) -> dict[str, str]:
    return auth_headers(client, "Admin", user_id="usr-sysupd-admin")


def _last_run() -> SystemUpdateRunRecord | None:
    with SessionLocal() as db:
        return db.query(SystemUpdateRunRecord).order_by(SystemUpdateRunRecord.id.desc()).first()


# --- Zugriffsschutz -----------------------------------------------------------


def test_endpoints_require_authentication():
    client = TestClient(app)
    for method, path in (
        ("get", "/api/admin/system/version"),
        ("get", "/api/admin/system/update/check"),
        ("post", "/api/admin/system/update"),
        ("get", "/api/admin/system/update/status"),
        ("get", "/api/admin/system/update/history"),
    ):
        response = getattr(client, method)(path)
        assert response.status_code == 401, f"{path}: {response.text}"


@pytest.mark.parametrize("role", ["Projektmanager", "Mitarbeiter"])
def test_endpoints_forbidden_for_non_admin(role: str):
    client = TestClient(app)
    headers = auth_headers(client, role, user_id=f"usr-sysupd-{role.lower()}")
    for method, path in (
        ("get", "/api/admin/system/version"),
        ("get", "/api/admin/system/update/check"),
        ("post", "/api/admin/system/update"),
        ("get", "/api/admin/system/update/status"),
        ("get", "/api/admin/system/update/history"),
    ):
        response = getattr(client, method)(path, headers=headers)
        assert response.status_code == 403, f"{path}: {response.text}"


def test_non_admin_cannot_start_update_even_when_enabled(monkeypatch, fake_requests):
    """RBAC greift VOR jeder Fachlogik — kein Webhook, kein Update-Lauf."""
    _use_settings(monkeypatch)
    client = TestClient(app)
    headers = auth_headers(client, "Projektmanager", user_id="usr-sysupd-pm2")
    response = client.post("/api/admin/system/update", headers=headers)
    assert response.status_code == 403
    assert fake_requests.post_calls == []
    assert _last_run() is None


# --- Konfigurationszustände ---------------------------------------------------


def test_check_reports_disabled_feature(monkeypatch, fake_requests):
    _use_settings(monkeypatch, system_update_enabled=False)
    client = TestClient(app)
    response = client.get("/api/admin/system/update/check", headers=_admin(client))
    assert response.status_code == 200
    body = response.json()
    assert body["state"] == "disabled"
    assert body["updateAvailable"] is False
    assert body["message"] == "Systemupdates sind auf diesem Server nicht aktiviert."
    # Bei deaktivierter Funktion wird GitHub gar nicht erst befragt.
    assert fake_requests.get_calls == []


def test_start_update_rejected_when_disabled(monkeypatch, fake_requests):
    _use_settings(monkeypatch, system_update_enabled=False)
    client = TestClient(app)
    response = client.post("/api/admin/system/update", headers=_admin(client))
    assert response.status_code == 403
    assert "nicht aktiviert" in response.json()["detail"]
    assert fake_requests.post_calls == []
    assert _last_run() is None


def test_start_update_rejected_without_webhook_configuration(monkeypatch, fake_requests):
    _use_settings(monkeypatch, portainer_stack_webhook_url=None)
    client = TestClient(app)
    response = client.post("/api/admin/system/update", headers=_admin(client))
    assert response.status_code == 503
    assert "Portainer-Webhook" in response.json()["detail"]
    assert fake_requests.post_calls == []
    # Ohne Webhook wird kein Lauf angelegt — der Lock bleibt frei.
    assert _last_run() is None


def test_version_endpoint_reports_build_metadata(monkeypatch, fake_requests):
    _use_settings(monkeypatch)
    client = TestClient(app)
    response = client.get("/api/admin/system/version", headers=_admin(client))
    assert response.status_code == 200
    body = response.json()
    assert body["installedCommit"] == INSTALLED_COMMIT
    assert body["installedShortCommit"] == INSTALLED_COMMIT[:7]
    assert body["branch"] == "main"
    assert body["updateEnabled"] is True
    assert body["webhookConfigured"] is True


def test_version_endpoint_marks_unknown_build(monkeypatch, fake_requests):
    _use_settings(monkeypatch, app_git_commit=None)
    client = TestClient(app)
    body = client.get("/api/admin/system/version", headers=_admin(client)).json()
    assert body["installedCommit"] is None
    assert body["installedShortCommit"] is None


# --- Versionsprüfung ----------------------------------------------------------


def test_check_reports_up_to_date(monkeypatch, fake_requests):
    _use_settings(monkeypatch, app_git_commit=LATEST_COMMIT)
    client = TestClient(app)
    body = client.get("/api/admin/system/update/check", headers=_admin(client)).json()
    assert body["state"] == "up_to_date"
    assert body["updateAvailable"] is False
    assert body["message"] == "Das System ist auf dem neuesten Stand."


def test_check_reports_available_update(monkeypatch, fake_requests):
    _use_settings(monkeypatch)
    client = TestClient(app)
    body = client.get("/api/admin/system/update/check", headers=_admin(client)).json()
    assert body["state"] == "update_available"
    assert body["updateAvailable"] is True
    assert body["latest"]["sha"] == LATEST_COMMIT
    assert body["latest"]["shortSha"] == LATEST_COMMIT[:7]
    # Nur die Betreffzeile der Commit-Nachricht.
    assert body["latest"]["message"] == "fix(dashboard): Kalender korrigieren"
    assert body["latest"]["author"] == "Nils Klemm"
    assert body["compareUrl"].endswith(f"{INSTALLED_COMMIT}...{LATEST_COMMIT}")


def test_check_reports_unknown_installed_version(monkeypatch, fake_requests):
    _use_settings(monkeypatch, app_git_commit=None)
    client = TestClient(app)
    body = client.get("/api/admin/system/update/check", headers=_admin(client)).json()
    assert body["state"] == "installed_version_unknown"
    assert body["updateAvailable"] is False
    assert body["latest"]["sha"] == LATEST_COMMIT


def test_check_survives_github_outage(monkeypatch, fake_requests):
    """Ein GitHub-Ausfall liefert 200 mit check_failed — kein 5xx im Adminbereich."""
    _use_settings(monkeypatch)
    fake_requests.get_error = requests.ConnectionError("boom")
    client = TestClient(app)
    response = client.get("/api/admin/system/update/check", headers=_admin(client))
    assert response.status_code == 200
    body = response.json()
    assert body["state"] == "check_failed"
    assert body["updateAvailable"] is False
    assert "GitHub" in body["message"]


def test_github_outage_does_not_affect_normal_usage(monkeypatch, fake_requests):
    _use_settings(monkeypatch)
    fake_requests.get_error = requests.ConnectionError("boom")
    client = TestClient(app)
    headers = _admin(client)
    client.get("/api/admin/system/update/check", headers=headers)
    assert client.get("/api/wms/overview", headers=headers).status_code == 200
    assert client.get("/health").status_code == 200


# --- Update auslösen ----------------------------------------------------------


def test_start_update_creates_backup_then_calls_webhook_once(
    monkeypatch, fake_requests, backup_dir
):
    _use_settings(monkeypatch)
    client = TestClient(app)
    response = client.post("/api/admin/system/update", headers=_admin(client))

    assert response.status_code == 202, response.text
    body = response.json()
    assert body["accepted"] is True
    assert body["status"] == "redeploy_requested"
    assert body["targetCommit"] == LATEST_COMMIT
    assert body["message"] == "Das Update wurde an Portainer übergeben."

    # Genau EIN Webhook-Aufruf, an die konfigurierte URL.
    assert fake_requests.post_calls == [WEBHOOK_URL]

    # Backup liegt im persistenten Datenverzeichnis und ist ein gültiges Archiv.
    archives = list(backup_dir.glob("wms-update-backup-*.zip"))
    assert len(archives) == 1
    with zipfile.ZipFile(archives[0]) as archive:
        payload = json.loads(archive.read("backup.json").decode("utf-8"))
    assert payload["version"] == 1
    for section in ("assets", "categories", "users", "plannings", "maintenanceItems", "systemSettings"):
        assert section in payload

    run = _last_run()
    assert run is not None
    assert run.status == "redeploy_requested"
    assert run.source_commit == INSTALLED_COMMIT
    assert run.target_commit == LATEST_COMMIT
    assert run.backup_reference == archives[0].name
    assert run.started_by_user_id == "usr-sysupd-admin"


def test_start_update_rejected_when_already_up_to_date(monkeypatch, fake_requests, backup_dir):
    _use_settings(monkeypatch, app_git_commit=LATEST_COMMIT)
    client = TestClient(app)
    response = client.post("/api/admin/system/update", headers=_admin(client))
    assert response.status_code == 409
    assert "neuesten Stand" in response.json()["detail"]
    assert fake_requests.post_calls == []
    assert list(backup_dir.glob("*.zip")) == []
    # Der Lock ist wieder frei.
    status = client.get("/api/admin/system/update/status", headers=_admin(client)).json()
    assert status["inProgress"] is False


def test_backup_failure_aborts_update_without_webhook(monkeypatch, fake_requests, backup_dir):
    _use_settings(monkeypatch)

    def _broken_backup(*_args, **_kwargs):
        raise OSError("Datenträger voll")

    monkeypatch.setattr(backup_service, "create_backup_archive", _broken_backup)

    client = TestClient(app)
    response = client.post("/api/admin/system/update", headers=_admin(client))
    assert response.status_code == 500
    assert "Backup" in response.json()["detail"]
    # Kein Redeploy und kein hängender Lock.
    assert fake_requests.post_calls == []
    run = _last_run()
    assert run is not None
    assert run.status == "failed"
    assert run.error_details == "backup_failed"
    assert run.backup_reference is None
    status = client.get("/api/admin/system/update/status", headers=_admin(client)).json()
    assert status["inProgress"] is False


def test_invalid_backup_archive_aborts_update(monkeypatch, fake_requests, backup_dir):
    """Ein nicht validierbares Backup bricht das Update ab (kein Webhook)."""
    _use_settings(monkeypatch)
    original_export = backup_service.export_backup

    class _BrokenPayload:
        def __init__(self, real):
            self._real = real
            self.assets = real.assets
            self.users = real.users
            self.plannings = real.plannings
            self.categories = real.categories
            self.maintenanceItems = real.maintenanceItems
            self.systemSettings = real.systemSettings

        def model_dump(self, **_kwargs):
            return {"version": 99, "kaputt": True}

    monkeypatch.setattr(
        backup_service, "export_backup", lambda db: _BrokenPayload(original_export(db))
    )

    client = TestClient(app)
    response = client.post("/api/admin/system/update", headers=_admin(client))
    assert response.status_code == 500
    assert fake_requests.post_calls == []
    # Das unbrauchbare Archiv wird wieder entfernt.
    assert list(backup_dir.glob("*.zip")) == []
    run = _last_run()
    assert run is not None and run.status == "failed"


def test_portainer_unreachable_releases_lock(monkeypatch, fake_requests, backup_dir):
    _use_settings(monkeypatch)
    fake_requests.post_error = requests.ConnectionError("no route to host")

    client = TestClient(app)
    response = client.post("/api/admin/system/update", headers=_admin(client))
    assert response.status_code == 502
    assert "Portainer" in response.json()["detail"]

    run = _last_run()
    assert run is not None
    assert run.status == "failed"
    assert run.error_details == "webhook_failed"
    status = client.get("/api/admin/system/update/status", headers=_admin(client)).json()
    assert status["inProgress"] is False


def test_portainer_http_error_releases_lock(monkeypatch, fake_requests, backup_dir):
    _use_settings(monkeypatch)
    fake_requests.post_response = _FakeResponse(404)

    client = TestClient(app)
    response = client.post("/api/admin/system/update", headers=_admin(client))
    assert response.status_code == 502
    run = _last_run()
    assert run is not None and run.status == "failed"


def test_parallel_update_is_blocked_by_lock(monkeypatch, fake_requests, backup_dir):
    _use_settings(monkeypatch)
    client = TestClient(app)
    headers = _admin(client)

    first = client.post("/api/admin/system/update", headers=headers)
    assert first.status_code == 202

    second = client.post("/api/admin/system/update", headers=headers)
    assert second.status_code == 409
    assert "läuft bereits" in second.json()["detail"]
    # Der zweite Versuch darf keinen zweiten Redeploy ausgelöst haben.
    assert fake_requests.post_calls == [WEBHOOK_URL]
    assert len(list(backup_dir.glob("*.zip"))) == 1


def test_update_lock_survives_restart_and_expires_after_timeout(
    monkeypatch, fake_requests, backup_dir
):
    _use_settings(monkeypatch)
    client = TestClient(app)
    headers = _admin(client)
    assert client.post("/api/admin/system/update", headers=headers).status_code == 202

    # Der Lock liegt in der DB und ist damit auch für einen frischen Prozess sichtbar.
    with SessionLocal() as db:
        assert system_update_service._active_run(db) is not None

    # Lauf künstlich altern lassen -> gilt als abgelaufen.
    with SessionLocal() as db:
        run = db.query(SystemUpdateRunRecord).order_by(SystemUpdateRunRecord.id.desc()).first()
        run.started_at = datetime.now(UTC) - timedelta(seconds=4000)
        db.commit()

    status = client.get("/api/admin/system/update/status", headers=headers).json()
    assert status["status"] == "timeout"
    assert status["inProgress"] is False

    # Nach dem Timeout ist ein neuer Versuch wieder möglich.
    assert client.post("/api/admin/system/update", headers=headers).status_code == 202


def test_status_moves_to_restarting_phase(monkeypatch, fake_requests, backup_dir):
    _use_settings(monkeypatch)
    client = TestClient(app)
    headers = _admin(client)
    client.post("/api/admin/system/update", headers=headers)

    status = client.get("/api/admin/system/update/status", headers=headers).json()
    assert status["status"] == "redeploy_requested"

    with SessionLocal() as db:
        run = db.query(SystemUpdateRunRecord).order_by(SystemUpdateRunRecord.id.desc()).first()
        run.started_at = datetime.now(UTC) - timedelta(seconds=60)
        db.commit()

    status = client.get("/api/admin/system/update/status", headers=headers).json()
    assert status["status"] == "restarting"
    assert status["inProgress"] is True


# --- Historie -----------------------------------------------------------------


def test_history_lists_runs_newest_first(monkeypatch, fake_requests, backup_dir):
    _use_settings(monkeypatch)
    client = TestClient(app)
    headers = _admin(client)

    # Fehlversuch (Portainer weg) + erfolgreicher Versuch.
    fake_requests.post_error = requests.ConnectionError("down")
    client.post("/api/admin/system/update", headers=headers)
    fake_requests.post_error = None
    client.post("/api/admin/system/update", headers=headers)

    body = client.get("/api/admin/system/update/history", headers=headers).json()
    assert body["total"] == 2
    assert len(body["items"]) == 2
    assert body["items"][0]["status"] == "redeploy_requested"
    assert body["items"][1]["status"] == "failed"
    assert body["items"][0]["targetShortCommit"] == LATEST_COMMIT[:7]
    assert body["items"][0]["startedByName"]


def test_history_is_empty_without_runs(monkeypatch, fake_requests):
    _use_settings(monkeypatch)
    client = TestClient(app)
    body = client.get("/api/admin/system/update/history", headers=_admin(client)).json()
    assert body == {"items": [], "total": 0}


# --- Auswertung nach dem Neustart ---------------------------------------------


def _pending_run(target: str = LATEST_COMMIT, *, age_seconds: int = 30) -> str:
    with SessionLocal() as db:
        run = SystemUpdateRunRecord(
            external_id=f"upd-test-{age_seconds}-{target[:6]}",
            started_at=datetime.now(UTC) - timedelta(seconds=age_seconds),
            started_by_user_id="usr-sysupd-admin",
            source_commit=INSTALLED_COMMIT,
            target_commit=target,
            status="redeploy_requested",
        )
        db.add(run)
        db.commit()
        return run.external_id


def test_reconcile_marks_success_when_target_commit_is_running(monkeypatch):
    settings = _settings(app_git_commit=LATEST_COMMIT)
    external_id = _pending_run()
    with SessionLocal() as db:
        assert system_update_service.reconcile_pending_runs(db, settings) == 1
        run = db.query(SystemUpdateRunRecord).filter_by(external_id=external_id).one()
        assert run.status == "success"
        assert run.detected_commit_after_restart == LATEST_COMMIT
        assert run.finished_at is not None


def test_reconcile_marks_failed_on_unexpected_commit(monkeypatch):
    settings = _settings(app_git_commit=INSTALLED_COMMIT)
    external_id = _pending_run()
    with SessionLocal() as db:
        system_update_service.reconcile_pending_runs(db, settings)
        run = db.query(SystemUpdateRunRecord).filter_by(external_id=external_id).one()
        assert run.status == "failed"
        assert run.error_details == "unexpected_commit"
        assert run.detected_commit_after_restart == INSTALLED_COMMIT


def test_reconcile_times_out_when_old_and_commit_unchanged(monkeypatch):
    settings = _settings(app_git_commit=INSTALLED_COMMIT)
    external_id = _pending_run(age_seconds=5000)
    with SessionLocal() as db:
        system_update_service.reconcile_pending_runs(db, settings)
        run = db.query(SystemUpdateRunRecord).filter_by(external_id=external_id).one()
        assert run.status == "timeout"


def test_reconcile_never_reports_success_for_unknown_build_version(monkeypatch):
    settings = _settings(app_git_commit=None)
    external_id = _pending_run()
    with SessionLocal() as db:
        system_update_service.reconcile_pending_runs(db, settings)
        run = db.query(SystemUpdateRunRecord).filter_by(external_id=external_id).one()
        assert run.status == "failed"
        assert run.error_details == "installed_version_unknown"


def test_reconcile_is_noop_without_pending_runs():
    with SessionLocal() as db:
        assert system_update_service.reconcile_pending_runs(db, _settings()) == 0


# --- Secrets ------------------------------------------------------------------


def test_api_responses_never_expose_secrets(monkeypatch, fake_requests, backup_dir):
    _use_settings(monkeypatch)
    client = TestClient(app)
    headers = _admin(client)
    client.post("/api/admin/system/update", headers=headers)

    for path in (
        "/api/admin/system/version",
        "/api/admin/system/update/check",
        "/api/admin/system/update/status",
        "/api/admin/system/update/history",
    ):
        text = client.get(path, headers=headers).text
        assert WEBHOOK_SECRET not in text, path
        assert "portainer.example.com" not in text, path
        assert GITHUB_TOKEN not in text, path


def test_logs_never_contain_webhook_or_token(monkeypatch, fake_requests, backup_dir, caplog):
    _use_settings(monkeypatch)
    client = TestClient(app)
    with caplog.at_level(logging.DEBUG):
        client.post("/api/admin/system/update", headers=_admin(client))
    logged = "\n".join(record.getMessage() for record in caplog.records)
    assert WEBHOOK_SECRET not in logged
    assert GITHUB_TOKEN not in logged
    # Der maskierte Hinweis darf (und soll) im Log stehen.
    assert "portainer.example.com/…" in logged


def test_mask_webhook_url_keeps_only_scheme_and_host():
    assert (
        system_update_service.mask_webhook_url(WEBHOOK_URL)
        == "https://portainer.example.com/…"
    )
    assert system_update_service.mask_webhook_url(None) == "<nicht konfiguriert>"
    assert system_update_service.mask_webhook_url("kaputt") == "<ungueltig>"


def test_update_endpoint_ignores_request_body(monkeypatch, fake_requests, backup_dir):
    """Weder Branch noch Commit noch URL dürfen aus dem Request stammen."""
    _use_settings(monkeypatch)
    client = TestClient(app)
    response = client.post(
        "/api/admin/system/update",
        headers=_admin(client),
        json={
            "branch": "angreifer-branch",
            "commit": "deadbeef",
            "webhookUrl": "https://evil.example.com/hook",
        },
    )
    assert response.status_code == 202
    # Es wurde ausschließlich die konfigurierte URL aufgerufen ...
    assert fake_requests.post_calls == [WEBHOOK_URL]
    # ... und ausschließlich der konfigurierte Branch abgefragt.
    assert fake_requests.get_calls == [
        "https://api.github.com/repos/nils5002/warenwirtschaftssystem-server/commits/main"
    ]
