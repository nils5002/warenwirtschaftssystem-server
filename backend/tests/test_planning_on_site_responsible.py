"""On-Site-Verantwortlicher je Planung (on_site_responsible_user_id):
optionales, rein organisatorisches Feld — unabhängig vom Projektverantwort-
lichen, ohne Einfluss auf Verfügbarkeit/Konflikte. Getestet werden Anlegen/
Ändern/Zurücksetzen, Validierung unbekannter Benutzer, Auflösung in der
Liste, Duplizieren sowie Backup/Restore inkl. Altbackup-Kompatibilität.
"""

from __future__ import annotations

import io
import json
from datetime import date, timedelta

from fastapi.testclient import TestClient

from app.main import app
from .auth_helpers import auth_headers


def _headers(client: TestClient) -> dict[str, str]:
    return auth_headers(client, "Admin")


def _reset(client: TestClient) -> None:
    res = client.post("/api/wms/backup/reset-for-import", headers=_headers(client))
    assert res.status_code == 200, res.text


def _create_user(client: TestClient, suffix: str) -> dict:
    payload = {
        "id": f"usr-os-{suffix}",
        "name": f"OnSite Tester {suffix}",
        "email": f"onsite.{suffix}@example.local",
        "role": "Mitarbeiter",
        "lastActive": "-",
        "status": "Aktiv",
    }
    res = client.post("/api/wms/users", headers=_headers(client), json=payload)
    assert res.status_code == 200, res.text
    return res.json()


def _planning_payload(label: str, on_site_user_id: str | None) -> dict:
    day = date.today() + timedelta(days=7)
    return {
        "customerName": f"Kunde {label}",
        "projectName": f"Projekt {label}",
        "eventName": None,
        "onSiteResponsibleUserId": on_site_user_id,
        "startDate": day.isoformat(),
        "endDate": (day + timedelta(days=1)).isoformat(),
        "notes": "",
        "status": "Geplant",
        "days": [{"planningDate": day.isoformat(), "weekday": "Montag", "items": []}],
    }


def _create_planning(client: TestClient, label: str, on_site_user_id: str | None) -> dict:
    res = client.post(
        "/api/wms/planning", headers=_headers(client), json=_planning_payload(label, on_site_user_id)
    )
    assert res.status_code == 200, res.text
    return res.json()


def _list_item(client: TestClient, planning_id: str) -> dict:
    res = client.get("/api/wms/planning", headers=_headers(client))
    assert res.status_code == 200, res.text
    rows = [item for item in res.json() if item["id"] == planning_id]
    assert rows, f"Planung {planning_id} fehlt in der Liste"
    return rows[0]


def test_create_without_on_site_defaults_to_null() -> None:
    client = TestClient(app)
    _reset(client)
    created = _create_planning(client, "Ohne", None)
    assert created["onSiteResponsibleUserId"] is None
    assert _list_item(client, created["id"])["onSiteResponsibleUser"] is None


def test_create_with_valid_on_site_and_resolved_in_list() -> None:
    client = TestClient(app)
    _reset(client)
    user = _create_user(client, "a1")
    created = _create_planning(client, "Mit", user["id"])
    assert created["onSiteResponsibleUserId"] == user["id"]

    # Abruf per Detail-Endpoint liefert die ID.
    res = client.get(f"/api/wms/planning/{created['id']}", headers=_headers(client))
    assert res.status_code == 200, res.text
    assert res.json()["onSiteResponsibleUserId"] == user["id"]

    # Liste löst den Benutzer auf (Name/Initialen/Farbe) — kein Nachladen nötig.
    resolved = _list_item(client, created["id"])["onSiteResponsibleUser"]
    assert resolved is not None
    assert resolved["id"] == user["id"]
    assert resolved["name"] == user["name"]
    assert resolved["initials"] == "OT"  # "OnSite Tester a1"
    assert resolved["signatureColor"] == user["signatureColor"]


def test_change_and_unset_on_site_responsible() -> None:
    client = TestClient(app)
    _reset(client)
    first = _create_user(client, "b1")
    second = _create_user(client, "b2")
    created = _create_planning(client, "Wechsel", first["id"])

    # Wechsel auf zweiten Benutzer.
    payload = _planning_payload("Wechsel", second["id"])
    payload["id"] = created["id"]
    res = client.put(f"/api/wms/planning/{created['id']}", headers=_headers(client), json=payload)
    assert res.status_code == 200, res.text
    assert res.json()["onSiteResponsibleUserId"] == second["id"]

    # Zurück auf "Nicht zugewiesen".
    payload["onSiteResponsibleUserId"] = None
    res = client.put(f"/api/wms/planning/{created['id']}", headers=_headers(client), json=payload)
    assert res.status_code == 200, res.text
    assert res.json()["onSiteResponsibleUserId"] is None


def test_unknown_on_site_user_is_rejected() -> None:
    client = TestClient(app)
    _reset(client)
    res = client.post(
        "/api/wms/planning",
        headers=_headers(client),
        json=_planning_payload("Unbekannt", "usr-gibt-es-nicht"),
    )
    assert res.status_code == 422, res.text
    assert "existiert nicht" in res.text


def test_same_user_may_be_manager_and_on_site() -> None:
    client = TestClient(app)
    _reset(client)
    user = _create_user(client, "c1")
    payload = _planning_payload("Doppelt", user["id"])
    payload["projectManagerUserId"] = user["id"]
    res = client.post("/api/wms/planning", headers=_headers(client), json=payload)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["projectManagerUserId"] == user["id"]
    assert body["onSiteResponsibleUserId"] == user["id"]


def test_duplicate_copies_on_site_responsible() -> None:
    client = TestClient(app)
    _reset(client)
    user = _create_user(client, "d1")
    created = _create_planning(client, "Dupli", user["id"])
    res = client.post(f"/api/wms/planning/{created['id']}/duplicate", headers=_headers(client))
    assert res.status_code == 200, res.text
    assert res.json()["onSiteResponsibleUserId"] == user["id"]


def test_backup_roundtrip_and_legacy_backup_without_field() -> None:
    client = TestClient(app)
    _reset(client)
    user = _create_user(client, "e1")
    created = _create_planning(client, "Backup", user["id"])

    # Export enthält das Feld.
    res = client.get("/api/wms/backup/export", headers=_headers(client))
    assert res.status_code == 200, res.text
    backup = res.json()
    exported = [item for item in backup["plannings"] if item["id"] == created["id"]][0]
    assert exported["onSiteResponsibleUserId"] == user["id"]

    # Restore stellt die Zuweisung wieder her.
    def _import(payload: dict) -> None:
        reset = client.post("/api/wms/backup/reset-for-import", headers=_headers(client))
        assert reset.status_code == 200, reset.text
        res = client.post(
            "/api/wms/backup/import",
            headers=_headers(client),
            files={"file": ("backup.json", io.BytesIO(json.dumps(payload).encode("utf-8")), "application/json")},
        )
        assert res.status_code == 200, res.text

    _import(backup)
    res = client.get(f"/api/wms/planning/{created['id']}", headers=_headers(client))
    assert res.status_code == 200, res.text
    assert res.json()["onSiteResponsibleUserId"] == user["id"]

    # Altbackup ohne das Feld bleibt importierbar → Zuweisung ist null.
    legacy = json.loads(json.dumps(backup))
    for item in legacy["plannings"]:
        item.pop("onSiteResponsibleUserId", None)
    _import(legacy)
    res = client.get(f"/api/wms/planning/{created['id']}", headers=_headers(client))
    assert res.status_code == 200, res.text
    assert res.json()["onSiteResponsibleUserId"] is None
