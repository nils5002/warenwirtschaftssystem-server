from __future__ import annotations

import io
import json
from datetime import date, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from .auth_helpers import auth_headers


def _headers(client: TestClient, role: str, user_id: str | None = None) -> dict[str, str]:
    return auth_headers(client, role, user_id=user_id)


def test_only_admin_can_clear_backup_data() -> None:
    client = TestClient(app)
    denied = client.post("/api/wms/backup/reset-for-import", headers=_headers(client, "Mitarbeiter"))
    assert denied.status_code == 403


def test_admin_can_clear_wms_data_and_preserves_admin_user() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]

    employee_payload = {
        "id": f"usr-clear-employee-{suffix}",
        "name": f"Clear Employee {suffix}",
        "email": f"clear.employee.{suffix}@example.local",
        "role": "Mitarbeiter",
        "lastActive": "Neu",
        "status": "Aktiv",
        "department": "Ops",
        "location": "Berlin",
    }
    created_employee = client.post("/api/wms/users", headers=_headers(client, "Admin"), json=employee_payload)
    assert created_employee.status_code == 200

    asset_payload = {
        "id": f"asset-clear-{suffix}",
        "name": f"Clear Asset {suffix}",
        "category": "Laptop",
        "location": "Testlager",
        "status": "Verfuegbar",
        "assignedTo": "-",
        "nextReturn": "-",
        "tagNumber": f"TAG-CLEAR-{suffix}",
        "serialNumber": f"SN-CLEAR-{suffix}",
        "qrCode": "",
        "maintenanceState": "Neu",
        "notes": "",
        "lastCheckout": "-",
        "nextReservation": "-",
    }
    created_asset = client.post("/api/wms/assets", headers=_headers(client, "Admin"), json=asset_payload)
    assert created_asset.status_code == 200

    clear_response = client.post("/api/wms/backup/reset-for-import", headers=_headers(client, "Admin"))
    assert clear_response.status_code == 200
    assert clear_response.json()["success"] is True

    exported = client.get("/api/wms/backup/export", headers=_headers(client, "Admin"))
    assert exported.status_code == 200
    payload = exported.json()

    assert payload["assets"] == []
    assert payload["activities"] == []
    assert payload["reservations"] == []
    assert payload["maintenanceItems"] == []
    assert payload["locations"] == []
    assert payload["plannings"] == []
    # Standardkategorien werden nach dem Clear bewusst neu geseedet, damit die
    # App weiter benutzbar bleibt (Stammdaten ohne App-Restart verfuegbar).
    standard_names = {c["name"] for c in payload["categories"] if c.get("isStandard")}
    assert "Laptop" in standard_names
    assert "iPad" in standard_names
    assert all(c.get("isStandard") for c in payload["categories"]), (
        "Nach Clear duerfen nur Standardkategorien uebrig sein, keine benutzerdefinierten."
    )

    users = payload["users"]
    assert users, "Mindestens ein Admin muss erhalten bleiben."
    assert all(str(item.get("role", "")).strip().lower() == "admin" for item in users)
    assert all(item.get("id") != employee_payload["id"] for item in users)


def test_backup_restore_preserves_qr_codes_planning_items_categories() -> None:
    """Sicherheitsnetz für Backup/Restore-Invarianten.

    Beim Restore dürfen IDs, QR-Codes, Planungs-Tage/-Items und Kategorien
    NICHT verändert oder neu generiert werden. Dieser Test deckt die wichtigste
    Datensicherheit ab, nachdem die Anwendung als Hardware-Warenwirtschaft auf
    QR-Codes als physische Etikett-Verknüpfung angewiesen ist.
    """
    client = TestClient(app)
    suffix = uuid4().hex[:8]

    # Eigene Kategorie anlegen, damit nach Restore prüfbar bleibt, dass sie
    # erhalten ist (Kategorien-Liste ist sonst leer nach reset).
    category_payload = {
        "name": f"TestKategorie {suffix}",
        "isActive": True,
    }
    cat_res = client.post(
        "/api/wms/categories",
        headers=_headers(client, "Admin"),
        json=category_payload,
    )
    assert cat_res.status_code in {200, 201}

    # Asset mit explizit bekanntem QR-Code anlegen.
    expected_qr = f"WMS|asset-restore-{suffix}|TAG-RESTORE-{suffix}"
    asset_payload = {
        "id": f"asset-restore-{suffix}",
        "name": f"Restore Asset {suffix}",
        "category": f"TestKategorie {suffix}",
        "location": "Testlager",
        "status": "Verfuegbar",
        "assignedTo": "-",
        "nextReturn": "-",
        "tagNumber": f"TAG-RESTORE-{suffix}",
        "serialNumber": f"SN-RESTORE-{suffix}",
        "qrCode": expected_qr,
        "maintenanceState": "Neu",
        "notes": "Backup-Restore-Test",
        "lastCheckout": "-",
        "nextReservation": "-",
    }
    asset_res = client.post("/api/wms/assets", headers=_headers(client, "Admin"), json=asset_payload)
    assert asset_res.status_code == 200
    asset_id = asset_res.json()["id"]
    qr_before = asset_res.json()["qrCode"]
    assert qr_before, "Asset muss einen QR-Code haben"

    # Planung mit Tagen und Items anlegen.
    pm_user_id = f"pm-restore-{suffix}"
    today = date.today()
    planning_payload = {
        "customerName": f"Kunde Restore {suffix}",
        "projectName": f"Projekt Restore {suffix}",
        "eventName": "Restore-Test",
        "projectManagerUserId": pm_user_id,
        "calendarWeek": today.isocalendar().week,
        "startDate": today.isoformat(),
        "endDate": (today + timedelta(days=2)).isoformat(),
        "notes": "Originalnotiz Restore",
        "status": "Entwurf",
        "days": [
            {
                "planningDate": today.isoformat(),
                "weekday": "Montag",
                "items": [{"categoryKey": "Laptop", "qty": 3, "notes": "Tag 1"}],
            },
            {
                "planningDate": (today + timedelta(days=1)).isoformat(),
                "weekday": "Dienstag",
                "items": [{"categoryKey": "iPad", "qty": 5, "notes": "Tag 2"}],
            },
        ],
    }
    planning_res = client.post(
        "/api/wms/planning",
        headers=_headers(client, "Projektmanager", user_id=pm_user_id),
        json=planning_payload,
    )
    assert planning_res.status_code == 200
    planning_id = planning_res.json()["id"]
    days_before = sorted(
        ((day["planningDate"], tuple((it["categoryKey"], it["qty"]) for it in day["items"]))
         for day in planning_res.json()["days"]),
    )
    assert len(days_before) == 2

    # Backup exportieren.
    export_res = client.get("/api/wms/backup/export", headers=_headers(client, "Admin"))
    assert export_res.status_code == 200
    backup_payload = export_res.json()
    assert any(a["id"] == asset_id and a["qrCode"] == qr_before for a in backup_payload["assets"]), (
        "Backup muss Asset-ID und QR-Code identisch enthalten."
    )
    assert any(p["id"] == planning_id for p in backup_payload["plannings"]), (
        "Backup muss Planung enthalten."
    )

    # Daten löschen, dann Restore aus dem zuvor exportierten Payload.
    clear_res = client.post("/api/wms/backup/reset-for-import", headers=_headers(client, "Admin"))
    assert clear_res.status_code == 200

    backup_bytes = json.dumps(backup_payload).encode("utf-8")
    import_res = client.post(
        "/api/wms/backup/import",
        headers=_headers(client, "Admin"),
        files={"file": (f"backup-{suffix}.json", io.BytesIO(backup_bytes), "application/json")},
    )
    assert import_res.status_code == 200, import_res.text

    # 1. Asset-ID identisch + QR-Code unverändert (kein Regenerieren).
    assets_after = client.get("/api/wms/assets", headers=_headers(client, "Admin"))
    assert assets_after.status_code == 200
    restored_asset = next((a for a in assets_after.json() if a["id"] == asset_id), None)
    assert restored_asset is not None, "Asset muss nach Restore mit gleicher ID existieren."
    assert restored_asset["qrCode"] == qr_before, (
        f"QR-Code MUSS beim Restore unverändert bleiben. Vorher={qr_before!r}, Nachher={restored_asset['qrCode']!r}"
    )
    assert restored_asset["tagNumber"] == asset_payload["tagNumber"]
    assert restored_asset["serialNumber"] == asset_payload["serialNumber"]

    # 2. Planung mit gleicher external_id, gleichen Tagen und Items.
    plannings_after = client.get(
        "/api/wms/planning", headers=_headers(client, "Admin")
    )
    assert plannings_after.status_code == 200
    assert any(p["id"] == planning_id for p in plannings_after.json()), (
        "Planungs-ID muss nach Restore identisch sein."
    )

    planning_detail = client.get(
        f"/api/wms/planning/{planning_id}", headers=_headers(client, "Admin")
    )
    assert planning_detail.status_code == 200
    detail = planning_detail.json()
    days_after = sorted(
        ((day["planningDate"], tuple((it["categoryKey"], it["qty"]) for it in day["items"]))
         for day in detail["days"]),
    )
    assert days_after == days_before, "Planungs-Tage und -Items müssen unverändert bleiben."
    assert detail["customerName"] == planning_payload["customerName"]
    assert detail["projectName"] == planning_payload["projectName"]

    # 3. Kategorie wieder vorhanden (nicht doppelt, nicht verloren).
    categories_after = client.get(
        "/api/wms/categories", headers=_headers(client, "Admin")
    )
    assert categories_after.status_code == 200
    cat_names = [c.get("name") for c in categories_after.json()]
    assert category_payload["name"] in cat_names, "Kategorie muss erhalten bleiben."
    assert cat_names.count(category_payload["name"]) == 1, "Kategorie darf nicht doppelt entstehen."

    # Aufräumen.
    client.delete(f"/api/wms/planning/{planning_id}", headers=_headers(client, "Admin"))
    client.delete(f"/api/wms/assets/{asset_id}", headers=_headers(client, "Admin"))
