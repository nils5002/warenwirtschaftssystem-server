from __future__ import annotations

from datetime import date, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from .auth_helpers import auth_headers


def _admin_headers(client: TestClient, suffix: str) -> dict[str, str]:
    return auth_headers(client, "Admin", user_id=f"adm-plev-{suffix}")


def _employee_headers(client: TestClient, suffix: str) -> dict[str, str]:
    return auth_headers(client, "Mitarbeiter", user_id=f"emp-plev-{suffix}")


def _planning_payload(on_date: date, suffix: str, *, items: list[dict] | None = None) -> dict:
    return {
        "customerName": f"Eventkunde {suffix}",
        "projectName": f"Projekt {suffix}",
        "eventName": None,
        "startDate": on_date.isoformat(),
        "endDate": (on_date + timedelta(days=1)).isoformat(),
        "notes": "",
        "status": "Entwurf",
        "returnBufferDays": 0,
        "days": [
            {
                "planningDate": on_date.isoformat(),
                "weekday": "Montag",
                "items": items or [],
            }
        ],
    }


def _event_types(client: TestClient, headers: dict[str, str], planning_id: str) -> list[str]:
    response = client.get(f"/api/wms/planning/{planning_id}/events", headers=headers)
    assert response.status_code == 200, response.text
    return [event["eventType"] for event in response.json()["events"]]


def _events(client: TestClient, headers: dict[str, str], planning_id: str) -> list[dict]:
    response = client.get(f"/api/wms/planning/{planning_id}/events", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["events"]


def test_create_update_and_status_write_events() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    headers = _admin_headers(client, suffix)
    on_date = date.today() + timedelta(days=910)

    created = client.post(
        "/api/wms/planning",
        headers=headers,
        json=_planning_payload(on_date, suffix, items=[{"categoryKey": "Laptop", "qty": 8}]),
    )
    assert created.status_code == 200, created.text
    planning_id = created.json()["id"]

    assert _event_types(client, headers, planning_id) == ["planning_created"]

    # Menge ändern + Position ergänzen + Zeitraum verschieben in einem Update.
    update_payload = _planning_payload(
        on_date + timedelta(days=1),
        suffix,
        items=[{"categoryKey": "Laptop", "qty": 10}, {"categoryKey": "Switch", "qty": 1}],
    )
    updated = client.put(
        f"/api/wms/planning/{planning_id}", headers=headers, json=update_payload
    )
    assert updated.status_code == 200, updated.text

    events = _events(client, headers, planning_id)
    types = [event["eventType"] for event in events]
    assert "timeframe_changed" in types
    assert "quantity_changed" in types
    assert "position_added" in types

    qty_event = next(e for e in events if e["eventType"] == "quantity_changed")
    assert qty_event["payload"] == {"categoryKey": "Laptop", "oldQty": 8, "newQty": 10}
    added_event = next(e for e in events if e["eventType"] == "position_added")
    assert added_event["payload"] == {"categoryKey": "Switch", "qty": 1}

    # Statuswechsel schreibt genau ein status_changed mit alt -> neu.
    status = client.post(
        f"/api/wms/planning/{planning_id}/status", headers=headers, json={"status": "Geplant"}
    )
    assert status.status_code == 200, status.text
    events = _events(client, headers, planning_id)
    status_event = next(e for e in events if e["eventType"] == "status_changed")
    assert status_event["payload"] == {"old": "Entwurf", "new": "Geplant"}
    # Jüngstes Event steht vorn.
    assert events[0]["eventType"] == "status_changed"
    assert events[0]["createdAt"].endswith("Z")

    # Position entfernen erzeugt position_removed.
    removal = client.put(
        f"/api/wms/planning/{planning_id}",
        headers=headers,
        json=_planning_payload(
            on_date + timedelta(days=1), suffix, items=[{"categoryKey": "Laptop", "qty": 10}]
        ),
    )
    assert removal.status_code == 200, removal.text
    assert "position_removed" in _event_types(client, headers, planning_id)


def test_note_endpoint_writes_note_event_and_enforces_roles() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    admin = _admin_headers(client, suffix)
    employee = _employee_headers(client, suffix)
    on_date = date.today() + timedelta(days=920)

    created = client.post(
        "/api/wms/planning", headers=admin, json=_planning_payload(on_date, suffix)
    )
    assert created.status_code == 200, created.text
    planning_id = created.json()["id"]

    note = client.post(
        f"/api/wms/planning/{planning_id}/events/note",
        headers=admin,
        json={"text": "  Kunde wünscht Backup-Drucker.  "},
    )
    assert note.status_code == 200, note.text
    body = note.json()
    assert body["eventType"] == "note_added"
    assert body["payload"] == {"text": "Kunde wünscht Backup-Drucker."}
    assert body["actorName"]

    # Leere Notiz wird abgelehnt.
    empty = client.post(
        f"/api/wms/planning/{planning_id}/events/note", headers=admin, json={"text": "   "}
    )
    assert empty.status_code == 422

    # Mitarbeiter dürfen lesen, aber keine Notizen anlegen.
    forbidden = client.post(
        f"/api/wms/planning/{planning_id}/events/note",
        headers=employee,
        json={"text": "unerlaubt"},
    )
    assert forbidden.status_code == 403
    read = client.get(f"/api/wms/planning/{planning_id}/events", headers=employee)
    assert read.status_code == 200


def test_checkout_and_checkin_write_issue_and_return_events() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    headers = _admin_headers(client, suffix)
    on_date = date.today() + timedelta(days=930)

    created = client.post(
        "/api/wms/planning",
        headers=headers,
        json=_planning_payload(on_date, suffix, items=[{"categoryKey": "Laptop", "qty": 1}]),
    )
    assert created.status_code == 200, created.text
    planning_id = created.json()["id"]

    asset_id = f"asset-plev-{suffix}"
    base_asset = {
        "id": asset_id,
        "name": f"Laptop Event {suffix}",
        "category": "Laptop",
        "location": "Hauptlager",
        "status": "Verfuegbar",
        "assignedTo": "-",
        "nextReturn": "-",
        "tagNumber": f"HW-PLEV-{suffix}",
        "serialNumber": f"SN-PLEV-{suffix}",
        "qrCode": "",
        "maintenanceState": "Neu erfasst",
        "notes": "",
        "lastCheckout": "-",
        "nextReservation": "-",
    }
    assert client.post("/api/wms/assets", headers=headers, json=base_asset).status_code == 200

    checkout = client.post(
        "/api/wms/assets",
        headers=headers,
        json={
            **base_asset,
            "status": "Verliehen",
            "assignedTo": f"- · Projekt {suffix}",
            "assignedPlanningId": planning_id,
        },
    )
    assert checkout.status_code == 200, checkout.text

    events = _events(client, headers, planning_id)
    issue = next(e for e in events if e["eventType"] == "issue_recorded")
    assert issue["payload"]["assetId"] == asset_id
    assert issue["payload"]["categoryKey"] == "Laptop"
    assert issue["payload"]["tagNumber"] == f"HW-PLEV-{suffix}"

    checkin = client.post(
        "/api/wms/assets",
        headers=headers,
        json={**base_asset, "status": "Verfuegbar", "assignedTo": "-"},
    )
    assert checkin.status_code == 200, checkin.text

    events = _events(client, headers, planning_id)
    ret = next(e for e in events if e["eventType"] == "return_recorded")
    assert ret["payload"]["assetId"] == asset_id


def test_delete_planning_removes_events() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    headers = _admin_headers(client, suffix)
    on_date = date.today() + timedelta(days=940)

    created = client.post(
        "/api/wms/planning", headers=headers, json=_planning_payload(on_date, suffix)
    )
    assert created.status_code == 200, created.text
    planning_id = created.json()["id"]

    deleted = client.delete(f"/api/wms/planning/{planning_id}", headers=headers)
    assert deleted.status_code == 200, deleted.text

    from app.database.models import PlanningEventRecord
    from app.database.session import SessionLocal
    from sqlalchemy import select

    with SessionLocal() as db:
        remaining = db.scalars(
            select(PlanningEventRecord).where(
                PlanningEventRecord.planning_external_id == planning_id
            )
        ).all()
    assert remaining == []
