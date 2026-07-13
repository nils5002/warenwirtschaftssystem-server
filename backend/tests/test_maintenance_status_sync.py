"""Wartungs-/Defekt-Statussynchronisierung des Assets beim Löschen von
Maintenance-Einträgen (Fachregel: Freigabe nur, wenn KEIN aktiver Eintrag
mehr existiert — Regression zum fehlenden Sync im Delete-Pfad)."""

from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from .auth_helpers import auth_headers


def _headers(client: TestClient) -> dict[str, str]:
    return auth_headers(client, "Admin")


def _create_asset(client: TestClient, suffix: str) -> dict:
    payload = {
        "id": f"asset-maintsync-{suffix}",
        "name": f"MaintSync Laptop {suffix}",
        "category": "Laptop",
        "location": "Hauptlager",
        "status": "Verfuegbar",
        "assignedTo": "-",
        "nextReturn": "-",
        "tagNumber": f"MAINTSYNC-{suffix}",
        "serialNumber": f"MAINTSYNC-SN-{suffix}",
        "qrCode": "",
        "maintenanceState": "Neu",
        "notes": "",
        "lastCheckout": "-",
        "nextReservation": "-",
    }
    res = client.post("/api/wms/assets", headers=_headers(client), json=payload)
    assert res.status_code == 200, res.text
    return payload


def _create_maintenance(
    client: TestClient, asset_name: str, *, status: str = "Offen"
) -> str:
    maintenance_id = f"maint-maintsync-{uuid4().hex[:10]}"
    payload = {
        "id": maintenance_id,
        "assetName": asset_name,
        "issue": "Testdefekt",
        "reportedAt": "2026-07-13",
        "dueDate": "2026-07-20",
        "priority": "Hoch",
        "status": status,
        "comment": "",
        "location": "Hauptlager",
    }
    res = client.post("/api/wms/maintenance", headers=_headers(client), json=payload)
    assert res.status_code == 200, res.text
    return maintenance_id


def _get_asset(client: TestClient, asset_id: str) -> dict:
    res = client.get("/api/wms/assets", headers=_headers(client))
    assert res.status_code == 200, res.text
    match = [item for item in res.json() if item["id"] == asset_id]
    assert match, f"Asset {asset_id} nicht gefunden"
    return match[0]


def _delete_maintenance(client: TestClient, maintenance_id: str) -> None:
    res = client.delete(f"/api/wms/maintenance/{maintenance_id}", headers=_headers(client))
    assert res.status_code == 200, res.text
    assert res.json()["deleted"] is True


def test_deleting_only_active_entry_releases_asset() -> None:
    client = TestClient(app)
    asset = _create_asset(client, uuid4().hex[:8])
    maintenance_id = _create_maintenance(client, asset["name"], status="Offen")
    assert _get_asset(client, asset["id"])["status"] == "Defekt"

    _delete_maintenance(client, maintenance_id)

    released = _get_asset(client, asset["id"])
    assert released["status"] == "Verfuegbar"
    assert released["maintenanceState"] == "Wartung erledigt"


def test_deleting_one_of_two_open_entries_keeps_asset_defekt() -> None:
    client = TestClient(app)
    asset = _create_asset(client, uuid4().hex[:8])
    first = _create_maintenance(client, asset["name"], status="Offen")
    _create_maintenance(client, asset["name"], status="Offen")

    _delete_maintenance(client, first)

    still_blocked = _get_asset(client, asset["id"])
    assert still_blocked["status"] == "Defekt"
    assert still_blocked["maintenanceState"] == "Defekt gemeldet"


def test_deleting_open_entry_with_remaining_in_progress_keeps_in_wartung() -> None:
    client = TestClient(app)
    asset = _create_asset(client, uuid4().hex[:8])
    open_entry = _create_maintenance(client, asset["name"], status="In Bearbeitung")
    _create_maintenance(client, asset["name"], status="Offen")
    # Letzter Upsert (Offen) hat das Asset auf Defekt gesetzt.
    assert _get_asset(client, asset["id"])["status"] == "Defekt"

    # Nach Löschen des Offen-Eintrags bestimmt der verbleibende
    # In-Bearbeitung-Eintrag den Status.
    entries = client.get("/api/wms/maintenance", headers=_headers(client)).json()
    open_ids = [
        item["id"]
        for item in entries
        if item["assetName"] == asset["name"] and item["status"] == "Offen"
    ]
    assert open_ids
    _delete_maintenance(client, open_ids[0])

    still_blocked = _get_asset(client, asset["id"])
    assert still_blocked["status"] == "In Wartung"
    assert still_blocked["maintenanceState"] == "Reparatur in Bearbeitung"

    # Aufräumen des verbliebenen Eintrags gibt das Asset frei.
    _delete_maintenance(client, open_entry)
    assert _get_asset(client, asset["id"])["status"] == "Verfuegbar"


def test_deleting_completed_entry_does_not_touch_available_asset() -> None:
    client = TestClient(app)
    asset = _create_asset(client, uuid4().hex[:8])
    maintenance_id = _create_maintenance(client, asset["name"], status="Erledigt")
    # Erledigt-Eintrag sperrt nicht; Asset war nie blockiert.
    before = _get_asset(client, asset["id"])
    assert before["status"] == "Verfuegbar"

    _delete_maintenance(client, maintenance_id)

    after = _get_asset(client, asset["id"])
    assert after["status"] == "Verfuegbar"
    # maintenanceState eines nie gesperrten Assets bleibt unangetastet.
    assert after["maintenanceState"] == before["maintenanceState"]


def test_deleting_entry_for_unknown_asset_still_deletes() -> None:
    client = TestClient(app)
    maintenance_id = _create_maintenance(
        client, f"Unbekanntes Geraet {uuid4().hex[:8]}", status="Offen"
    )
    _delete_maintenance(client, maintenance_id)
