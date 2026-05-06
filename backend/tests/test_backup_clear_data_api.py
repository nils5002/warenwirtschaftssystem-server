from __future__ import annotations

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
    assert payload["categories"] == []

    users = payload["users"]
    assert users, "Mindestens ein Admin muss erhalten bleiben."
    assert all(str(item.get("role", "")).strip().lower() == "admin" for item in users)
    assert all(item.get("id") != employee_payload["id"] for item in users)
