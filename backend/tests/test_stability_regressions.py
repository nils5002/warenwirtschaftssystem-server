"""Regressionstests für das Stabilitäts-Audit.

Diese Tests decken die kritischen Endpoints aus dem Stabilitäts-Paket ab und
sollen verhindern, dass typische 502-/Crash-Ursachen wieder einziehen:

- Health/Readiness antwortet ohne Auth.
- Overview liefert deterministische Struktur, auch ohne Daten.
- Planung/Availability crasht nicht auf nicht existierenden IDs.
- Backup-Import gibt bei korrupten Eingaben eine kontrollierte 4xx zurück.
"""

from __future__ import annotations

import io

from fastapi.testclient import TestClient

from app.main import app
from .auth_helpers import auth_headers


def _admin_headers(client: TestClient) -> dict[str, str]:
    return auth_headers(client, "Admin")


def test_health_endpoint_is_public_and_cheap() -> None:
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_ready_pings_db() -> None:
    client = TestClient(app)
    response = client.get("/health/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


def test_overview_returns_stable_shape_without_crash() -> None:
    client = TestClient(app)
    response = client.get("/api/wms/overview", headers=_admin_headers(client))
    assert response.status_code == 200
    payload = response.json()
    # Felder müssen immer vorhanden sein, auch wenn leere DB.
    for key in (
        "assets",
        "activities",
        "reservations",
        "maintenanceItems",
        "locations",
        "categories",
        "users",
    ):
        assert key in payload, f"Overview-Antwort muss {key!r} enthalten"
        assert isinstance(payload[key], list)
    # planningSummary darf None oder Dict sein, aber kein Crash.
    assert payload.get("planningSummary") is None or isinstance(payload["planningSummary"], dict)


def test_planning_detail_unknown_id_returns_404_not_500() -> None:
    client = TestClient(app)
    response = client.get(
        "/api/wms/planning/does-not-exist", headers=_admin_headers(client)
    )
    assert response.status_code == 404
    assert response.json().get("detail")


def test_planning_availability_unknown_id_returns_404_not_500() -> None:
    client = TestClient(app)
    response = client.get(
        "/api/wms/planning/does-not-exist/availability",
        headers=_admin_headers(client),
    )
    assert response.status_code == 404
    assert response.json().get("detail")


def test_backup_import_rejects_empty_file_with_4xx() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/wms/backup/import",
        headers=_admin_headers(client),
        files={"file": ("empty.json", io.BytesIO(b""), "application/json")},
    )
    assert response.status_code == 400, response.text
    assert "leer" in (response.json().get("detail") or "").lower()


def test_backup_import_rejects_invalid_json_with_4xx() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/wms/backup/import",
        headers=_admin_headers(client),
        files={"file": ("broken.json", io.BytesIO(b"{not-json"), "application/json")},
    )
    assert response.status_code == 400
    assert response.json().get("detail")


def test_backup_import_rejects_non_json_extension_with_4xx() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/wms/backup/import",
        headers=_admin_headers(client),
        files={"file": ("backup.exe", io.BytesIO(b'{"version":1}'), "application/octet-stream")},
    )
    assert response.status_code == 400


def test_backup_import_rejects_wrong_schema_with_4xx() -> None:
    """Wenn das JSON valide ist, aber nicht zum Backup-Schema passt, MUSS der
    Server eine kontrollierte 400 liefern — kein 500, kein unhandled crash."""
    client = TestClient(app)
    response = client.post(
        "/api/wms/backup/import",
        headers=_admin_headers(client),
        files={
            "file": (
                "wrong.json",
                io.BytesIO(b'{"version": 1, "exportedAt": "not-a-datetime"}'),
                "application/json",
            ),
        },
    )
    assert response.status_code == 400
    assert response.json().get("detail")
