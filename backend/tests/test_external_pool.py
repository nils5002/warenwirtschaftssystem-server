"""Tests für Fremdbestand-Verwaltung (Mietgeräte / Leihgeräte / extern).

Deckt die in der Spec beschriebenen 6 Fälle ab + Backup-Round-Trip + Techniker-
Rechte:

1. Bestehendes Asset ohne ownership_type wird als 'owned' behandelt.
2. Mietgerät zählt innerhalb seines Verfügbarkeitsfensters zur Availability.
3. Mietgerät zählt nach availableUntil nicht mehr zur Availability.
4. Mietgerät mit returnedAt zählt nicht mehr zur Availability.
5. Mietgerät im Status Defekt / In Wartung zählt nicht als verfügbar.
6. Fremdbestand kann nicht als zurückgegeben markiert werden, solange das
   Gerät aktuell verliehen ist.
7. Backup/Restore: Mietgerät mit allen Fremdbestand-Feldern + QR-Code wird
   1:1 erhalten.
8. Techniker (rolle: techniker, intern auf admin gemappt) darf Fremdbestand
   anlegen und als zurückgegeben markieren.
"""

from __future__ import annotations

import io
import json
from datetime import date, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from .auth_helpers import auth_headers


def _headers(client: TestClient, role: str) -> dict[str, str]:
    return auth_headers(client, role)


def _create_owned_asset(client: TestClient, suffix: str, *, category: str = "Laptop") -> str:
    """Legt einen Eigenbestand-Laptop an und gibt die external_id zurück."""
    payload = {
        "id": f"asset-pool-owned-{suffix}",
        "name": f"Pool Owned {suffix}",
        "category": category,
        "location": "Hauptlager",
        "status": "Verfuegbar",
        "assignedTo": "-",
        "nextReturn": "-",
        "tagNumber": f"POOL-OWN-{suffix}",
        "serialNumber": f"POOL-OWN-SN-{suffix}",
        "qrCode": "",
        "maintenanceState": "Neu",
        "notes": "",
        "lastCheckout": "-",
        "nextReservation": "-",
    }
    res = client.post("/api/wms/assets", headers=_headers(client, "Admin"), json=payload)
    assert res.status_code == 200, res.text
    return payload["id"]


def _create_external_pool(
    client: TestClient,
    *,
    category: str,
    count: int,
    name_prefix: str,
    available_from: date | None,
    available_until: date | None,
    ownership_type: str = "rented",
) -> list[str]:
    payload = {
        "category": category,
        "ownershipType": ownership_type,
        "count": count,
        "namePrefix": name_prefix,
        "availableFrom": available_from.isoformat() if available_from else None,
        "availableUntil": available_until.isoformat() if available_until else None,
        "sourceName": "TestRent",
    }
    res = client.post("/api/wms/assets/external-pool", headers=_headers(client, "Admin"), json=payload)
    assert res.status_code == 200, res.text
    return res.json()["createdAssetIds"]


def _create_planning(
    client: TestClient,
    suffix: str,
    *,
    start: date,
    end: date,
    qty: int,
    category: str = "Laptop",
) -> str:
    payload = {
        "customerName": f"Kunde Pool {suffix}",
        "projectName": f"Projekt Pool {suffix}",
        "eventName": "Pool-Test",
        "projectManagerUserId": f"pm-pool-{suffix}",
        "calendarWeek": start.isocalendar().week,
        "startDate": start.isoformat(),
        "endDate": end.isoformat(),
        "notes": "",
        "status": "Geplant",
        "days": [
            {
                "planningDate": start.isoformat(),
                "weekday": "Montag",
                "items": [{"categoryKey": category, "qty": qty, "notes": None}],
            }
        ],
    }
    res = client.post(
        "/api/wms/planning",
        headers=auth_headers(client, "Projektmanager", user_id=f"pm-pool-{suffix}"),
        json=payload,
    )
    assert res.status_code == 200, res.text
    return res.json()["id"]


def _availability_for(client: TestClient, planning_id: str) -> dict:
    res = client.get(f"/api/wms/planning/{planning_id}/availability", headers=_headers(client, "Admin"))
    assert res.status_code == 200, res.text
    return res.json()


def _cleanup_planning(client: TestClient, planning_id: str) -> None:
    client.delete(f"/api/wms/planning/{planning_id}", headers=_headers(client, "Admin"))


def _cleanup_assets(client: TestClient, asset_ids: list[str]) -> None:
    for asset_id in asset_ids:
        client.delete(f"/api/wms/assets/{asset_id}", headers=_headers(client, "Admin"))


# -----------------------------------------------------------------------------
# Testfall 1: Bestehender Eigenbestand ohne ownershipType wird als 'owned' behandelt
# -----------------------------------------------------------------------------
def test_existing_asset_defaults_to_owned_ownership_type() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:6]
    asset_id = _create_owned_asset(client, suffix)
    try:
        res = client.get(f"/api/wms/assets/{asset_id}", headers=_headers(client, "Admin"))
        assert res.status_code == 200
        body = res.json()
        # Nicht gesetzt im Payload → Default 'owned'
        assert body["ownershipType"] == "owned"
        assert body["availableFrom"] is None
        assert body["availableUntil"] is None
        assert body["returnedAt"] is None
    finally:
        _cleanup_assets(client, [asset_id])


# -----------------------------------------------------------------------------
# Testfall 2: Mietgerät zählt innerhalb seines Zeitraums zur Verfügbarkeit
# -----------------------------------------------------------------------------
def test_rented_asset_counts_within_availability_window() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:6]
    today = date.today()
    rented_ids = _create_external_pool(
        client,
        category="Pool-Cat-A",
        count=3,
        name_prefix=f"Pool-{suffix}",
        available_from=today,
        available_until=today + timedelta(days=10),
    )
    planning_id = _create_planning(
        client,
        suffix,
        start=today + timedelta(days=2),
        end=today + timedelta(days=4),
        qty=2,
        category="Pool-Cat-A",
    )
    try:
        availability = _availability_for(client, planning_id)
        items = availability["items"]
        assert items, "Availability sollte Items enthalten"
        first = items[0]
        # 3 verfügbare Mietgeräte, 2 angefragt → kein Engpass
        assert first["usableStock"] >= 2
        assert first["shortageQty"] == 0
    finally:
        _cleanup_planning(client, planning_id)
        _cleanup_assets(client, rented_ids)


# -----------------------------------------------------------------------------
# Testfall 3: Mietgerät zählt nach availableUntil nicht mehr
# -----------------------------------------------------------------------------
def test_rented_asset_does_not_count_after_available_until() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:6]
    today = date.today()
    rented_ids = _create_external_pool(
        client,
        category="Pool-Cat-B",
        count=5,
        name_prefix=f"Pool-{suffix}",
        available_from=today,
        available_until=today + timedelta(days=5),
    )
    # Planung läuft NACH dem Verfügbarkeitsfenster
    planning_id = _create_planning(
        client,
        suffix,
        start=today + timedelta(days=20),
        end=today + timedelta(days=22),
        qty=2,
        category="Pool-Cat-B",
    )
    try:
        availability = _availability_for(client, planning_id)
        first = availability["items"][0]
        # Die 5 Mietgeräte sind nach dem Fenster nicht verfügbar → 2 fehlen
        assert first["usableStock"] == 0
        assert first["shortageQty"] == 2
    finally:
        _cleanup_planning(client, planning_id)
        _cleanup_assets(client, rented_ids)


# -----------------------------------------------------------------------------
# Testfall 4: Mietgerät mit returnedAt zählt nicht mehr zur Availability
# -----------------------------------------------------------------------------
def test_rented_asset_marked_returned_does_not_count_anymore() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:6]
    today = date.today()
    rented_ids = _create_external_pool(
        client,
        category="Pool-Cat-C",
        count=2,
        name_prefix=f"Pool-{suffix}",
        available_from=today,
        available_until=today + timedelta(days=30),
    )
    # Eines als zurückgegeben markieren — sollte aus der Availability rausfallen.
    mark_res = client.post(
        f"/api/wms/assets/{rented_ids[0]}/mark-returned",
        headers=_headers(client, "Admin"),
        json={},
    )
    assert mark_res.status_code == 200, mark_res.text
    assert mark_res.json()["returnedAt"] is not None

    planning_id = _create_planning(
        client,
        suffix,
        start=today + timedelta(days=2),
        end=today + timedelta(days=3),
        qty=2,
        category="Pool-Cat-C",
    )
    try:
        availability = _availability_for(client, planning_id)
        first = availability["items"][0]
        # Nur 1 Mietgerät zählt noch → Engpass von 1
        assert first["usableStock"] == 1
        assert first["shortageQty"] == 1
    finally:
        _cleanup_planning(client, planning_id)
        _cleanup_assets(client, rented_ids)


# -----------------------------------------------------------------------------
# Testfall 5: Mietgerät im Status Defekt zählt nicht als verfügbar
# -----------------------------------------------------------------------------
def test_rented_asset_in_defekt_does_not_count() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:6]
    today = date.today()
    rented_ids = _create_external_pool(
        client,
        category="Pool-Cat-D",
        count=2,
        name_prefix=f"Pool-{suffix}",
        available_from=today,
        available_until=today + timedelta(days=30),
    )
    # Eines als Defekt umsetzen via vollem AssetItem-Update.
    detail_res = client.get(f"/api/wms/assets/{rented_ids[0]}", headers=_headers(client, "Admin"))
    assert detail_res.status_code == 200
    asset_payload = detail_res.json()
    asset_payload["status"] = "Defekt"
    upd_res = client.post("/api/wms/assets", headers=_headers(client, "Admin"), json=asset_payload)
    assert upd_res.status_code == 200, upd_res.text
    assert upd_res.json()["status"] == "Defekt"

    planning_id = _create_planning(
        client,
        suffix,
        start=today + timedelta(days=2),
        end=today + timedelta(days=3),
        qty=2,
        category="Pool-Cat-D",
    )
    try:
        availability = _availability_for(client, planning_id)
        first = availability["items"][0]
        # Nur 1 verfügbar (das andere ist Defekt) → Engpass von 1
        assert first["usableStock"] == 1
        assert first["shortageQty"] == 1
    finally:
        _cleanup_planning(client, planning_id)
        _cleanup_assets(client, rented_ids)


# -----------------------------------------------------------------------------
# Testfall 6: Mark-as-returned wird verweigert, wenn Gerät aktuell verliehen ist
# -----------------------------------------------------------------------------
def test_mark_returned_refused_when_asset_currently_loaned_out() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:6]
    today = date.today()
    rented_ids = _create_external_pool(
        client,
        category="Pool-Cat-E",
        count=1,
        name_prefix=f"Pool-{suffix}",
        available_from=today,
        available_until=today + timedelta(days=30),
    )
    asset_id = rented_ids[0]
    try:
        # Gerät via vollem Update auf Verliehen setzen.
        detail = client.get(f"/api/wms/assets/{asset_id}", headers=_headers(client, "Admin")).json()
        detail["status"] = "Verliehen"
        detail["assignedTo"] = "Test User"
        upd = client.post("/api/wms/assets", headers=_headers(client, "Admin"), json=detail)
        assert upd.status_code == 200

        # Mark-returned muss jetzt fehlschlagen.
        mark = client.post(
            f"/api/wms/assets/{asset_id}/mark-returned",
            headers=_headers(client, "Admin"),
            json={},
        )
        assert mark.status_code == 400
        detail_msg = mark.json().get("detail", "")
        assert "ausgegeben" in detail_msg or "Rücknahme" in detail_msg

        # Status zurück auf Verfügbar setzen — jetzt darf Mark-returned klappen.
        detail["status"] = "Verfuegbar"
        detail["assignedTo"] = "-"
        client.post("/api/wms/assets", headers=_headers(client, "Admin"), json=detail)
        mark2 = client.post(
            f"/api/wms/assets/{asset_id}/mark-returned",
            headers=_headers(client, "Admin"),
            json={},
        )
        assert mark2.status_code == 200
        assert mark2.json()["returnedAt"] is not None
    finally:
        _cleanup_assets(client, [asset_id])


# -----------------------------------------------------------------------------
# Testfall 7: Backup/Restore-Round-Trip — alle Fremdbestand-Felder + QR-Code
#             eines Mietgeräts müssen identisch bleiben.
# -----------------------------------------------------------------------------
def test_backup_restore_preserves_external_pool_fields_and_qr() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:6]
    today = date.today()
    rented_ids = _create_external_pool(
        client,
        category="Pool-Backup",
        count=2,
        name_prefix=f"BackupRent-{suffix}",
        available_from=today,
        available_until=today + timedelta(days=21),
    )
    asset_id = rented_ids[0]
    try:
        # Vorher-Zustand erfassen (inkl. QR-Code).
        before = client.get(f"/api/wms/assets/{asset_id}", headers=_headers(client, "Admin")).json()
        assert before["ownershipType"] == "rented"
        assert before["availableFrom"] == today.isoformat()
        assert before["availableUntil"] == (today + timedelta(days=21)).isoformat()
        assert before["sourceName"] == "TestRent"
        original_qr = before["qrCode"]
        original_tag = before["tagNumber"]
        original_serial = before["serialNumber"]
        assert original_qr, "QR-Code muss gesetzt sein"

        # Backup exportieren.
        export_res = client.get("/api/wms/backup/export", headers=_headers(client, "Admin"))
        assert export_res.status_code == 200
        backup_payload = export_res.json()
        backup_asset = next(
            (a for a in backup_payload["assets"] if a["id"] == asset_id),
            None,
        )
        assert backup_asset is not None, "Mietgerät muss im Backup enthalten sein"
        # Alle Fremdbestand-Felder müssen im Backup-Export auftauchen.
        assert backup_asset["ownershipType"] == "rented"
        assert backup_asset["sourceName"] == "TestRent"
        assert backup_asset["availableFrom"] == today.isoformat()
        assert backup_asset["availableUntil"] == (today + timedelta(days=21)).isoformat()
        assert backup_asset["returnedAt"] is None
        assert backup_asset["qrCode"] == original_qr

        # Daten löschen + Backup wieder importieren.
        clear_res = client.post("/api/wms/backup/reset-for-import", headers=_headers(client, "Admin"))
        assert clear_res.status_code == 200
        backup_bytes = json.dumps(backup_payload).encode("utf-8")
        import_res = client.post(
            "/api/wms/backup/import",
            headers=_headers(client, "Admin"),
            files={"file": (f"backup-pool-{suffix}.json", io.BytesIO(backup_bytes), "application/json")},
        )
        assert import_res.status_code == 200, import_res.text

        # Nachher-Zustand: identisch zu vorher (insbesondere QR-Code).
        after = client.get(f"/api/wms/assets/{asset_id}", headers=_headers(client, "Admin")).json()
        assert after["ownershipType"] == "rented"
        assert after["sourceName"] == "TestRent"
        assert after["availableFrom"] == today.isoformat()
        assert after["availableUntil"] == (today + timedelta(days=21)).isoformat()
        assert after["returnedAt"] is None
        assert after["qrCode"] == original_qr, (
            f"QR-Code MUSS unverändert bleiben. Vorher={original_qr!r}, Nachher={after['qrCode']!r}"
        )
        assert after["tagNumber"] == original_tag
        assert after["serialNumber"] == original_serial
    finally:
        # Aufräumen: nach dem Restore haben wir andere Asset-IDs (nur die
        # importierten); das ursprüngliche Mietgerät ist über asset_id wieder da.
        _cleanup_assets(client, rented_ids)


# -----------------------------------------------------------------------------
# Testfall 8: Techniker (DB-Rolle techniker → intern admin) darf Fremdbestand
#             anlegen und als zurückgegeben markieren.
# -----------------------------------------------------------------------------
def test_techniker_can_manage_external_pool() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:6]
    today = date.today()
    techniker_user_id = f"tech-pool-{suffix}"
    techniker_headers = auth_headers(client, "Techniker", user_id=techniker_user_id)

    # Anlegen via Techniker
    create_payload = {
        "category": "Pool-Tech",
        "ownershipType": "rented",
        "count": 1,
        "namePrefix": f"TechRent-{suffix}",
        "availableFrom": today.isoformat(),
        "availableUntil": (today + timedelta(days=7)).isoformat(),
        "sourceName": "Techniker-Quelle",
    }
    create_res = client.post(
        "/api/wms/assets/external-pool",
        headers=techniker_headers,
        json=create_payload,
    )
    assert create_res.status_code == 200, create_res.text
    asset_id = create_res.json()["createdAssetIds"][0]

    try:
        # Mark-as-returned via Techniker
        mark_res = client.post(
            f"/api/wms/assets/{asset_id}/mark-returned",
            headers=techniker_headers,
            json={},
        )
        assert mark_res.status_code == 200, mark_res.text
        assert mark_res.json()["returnedAt"] is not None

        # Sicherheits-Gegenprobe: Mitarbeiter darf NICHT.
        mitarbeiter_headers = auth_headers(client, "Mitarbeiter", user_id=f"emp-pool-{suffix}")
        denied_create = client.post(
            "/api/wms/assets/external-pool",
            headers=mitarbeiter_headers,
            json=create_payload,
        )
        assert denied_create.status_code == 403
        denied_mark = client.post(
            f"/api/wms/assets/{asset_id}/mark-returned",
            headers=mitarbeiter_headers,
            json={},
        )
        assert denied_mark.status_code == 403
    finally:
        _cleanup_assets(client, [asset_id])
