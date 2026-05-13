"""Tests fuer den Admin-Log-Download Endpoint.

Pruefungen:
  - Admin darf Logs herunterladen (200, ZIP mit Logdateien)
  - Projektmanager und Mitarbeiter bekommen 403
  - ZIP enthaelt die wms-app.log-Datei
  - Es werden keine Authorization-Header / Tokens in die Logdatei geschrieben
"""
from __future__ import annotations

import io
import logging
import zipfile

import pytest
from fastapi.testclient import TestClient

from app.logging_setup import LOG_FILE_NAME, get_log_dir, setup_logging
from app.main import app

from .auth_helpers import auth_headers


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


def _logs_endpoint() -> str:
    return "/api/wms/admin/logs/download"


def _ensure_log_file_exists() -> None:
    setup_logging()
    log_path = get_log_dir() / LOG_FILE_NAME
    # Trigger a log entry to guarantee the file exists on disk.
    logging.getLogger("cloud_web.tests").info("test marker for admin log download")
    # Auch wenn das App-Log noch nicht angelegt wurde, sorgt der vorherige
    # Log-Aufruf dafuer, dass der RotatingFileHandler ihn anlegt. Falls aus
    # irgendeinem Grund nicht, schreiben wir defensiv eine Marker-Zeile.
    if not log_path.exists():
        log_path.write_text("seed entry\n", encoding="utf-8")


def test_admin_can_download_logs_returns_zip(client: TestClient) -> None:
    _ensure_log_file_exists()

    response = client.get(_logs_endpoint(), headers=auth_headers(client, "Admin"))
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("application/zip")
    disposition = response.headers.get("content-disposition", "")
    assert "wms-logs-" in disposition and disposition.endswith('.zip"')

    archive = zipfile.ZipFile(io.BytesIO(response.content))
    names = archive.namelist()
    assert any(name == LOG_FILE_NAME or name.startswith(f"{LOG_FILE_NAME}.") for name in names), names


def test_projektmanager_cannot_download_logs(client: TestClient) -> None:
    _ensure_log_file_exists()
    response = client.get(_logs_endpoint(), headers=auth_headers(client, "Projektmanager"))
    assert response.status_code == 403


def test_mitarbeiter_cannot_download_logs(client: TestClient) -> None:
    _ensure_log_file_exists()
    response = client.get(_logs_endpoint(), headers=auth_headers(client, "Mitarbeiter"))
    assert response.status_code == 403


def test_unauthenticated_cannot_download_logs(client: TestClient) -> None:
    _ensure_log_file_exists()
    response = client.get(_logs_endpoint())
    assert response.status_code == 401


def test_log_file_does_not_contain_authorization_header(client: TestClient) -> None:
    """Sanity-Check: Tokens / Authorization-Header landen nicht im Log.

    Wir machen einen authentifizierten Request, lesen anschliessend die
    aktuelle Logdatei und stellen sicher, dass weder das Wort
    ``Authorization`` noch der konkrete Bearer-Token (Praefix) auftauchen.
    """
    _ensure_log_file_exists()
    headers = auth_headers(client, "Admin")
    token = headers["Authorization"].split(" ", 1)[1]

    response = client.get("/api/wms/overview", headers=headers)
    assert response.status_code in {200, 204}

    log_path = get_log_dir() / LOG_FILE_NAME
    assert log_path.exists()
    # Handler haben ggf. gepuffert — flushen aller File-Handler erzwingen.
    for handler in logging.getLogger().handlers:
        try:
            handler.flush()
        except Exception:  # noqa: BLE001
            pass

    content = log_path.read_text(encoding="utf-8", errors="ignore")
    # Bearer-Token darf nirgendwo auftauchen.
    assert token not in content, "Bearer-Token wurde in die App-Log-Datei geschrieben."
    assert "Bearer " not in content, "Bearer-Header wurde in die App-Log-Datei geschrieben."


def test_admin_login_success_is_logged_without_password(client: TestClient) -> None:
    """Login-Success wird geloggt, das Passwort wird NICHT geloggt."""
    _ensure_log_file_exists()
    # auth_headers loest intern einen erfolgreichen Login aus.
    headers = auth_headers(client, "Admin")
    assert headers["Authorization"].startswith("Bearer ")

    for handler in logging.getLogger().handlers:
        try:
            handler.flush()
        except Exception:  # noqa: BLE001
            pass

    log_path = get_log_dir() / LOG_FILE_NAME
    assert log_path.exists()
    content = log_path.read_text(encoding="utf-8", errors="ignore")
    # Login-Erfolg muss als fachliches Ereignis vermerkt sein.
    assert "Login erfolgreich" in content
    # Bekanntes Test-Passwort darf nicht erscheinen.
    from .auth_helpers import TEST_PASSWORD

    assert TEST_PASSWORD not in content, "Test-Passwort wurde in die App-Log-Datei geschrieben."
