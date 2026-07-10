"""Kalender-Zeitleiste: GET /api/wms/planning liefert je Planung additiv
totalQty, categoryTotals (Summe über alle Tage), assignedCount (aktuell
zugeordnete Geräte) und handoverNeedsReview — damit braucht der Kalender keine
Detail-/Availability-Roundtrips pro Planung. Verändert keine Konfliktlogik.
"""

from __future__ import annotations

from datetime import date, timedelta

from fastapi.testclient import TestClient

from app.main import app
from .auth_helpers import auth_headers


def _headers(client: TestClient, role: str, user_id: str | None = None) -> dict[str, str]:
    return auth_headers(client, role, user_id=user_id)


def _reset(client: TestClient) -> None:
    res = client.post("/api/wms/backup/reset-for-import", headers=_headers(client, "Admin"))
    assert res.status_code == 200, res.text


def _asset_payload(index: int, category: str) -> dict:
    return {
        "id": f"asset-cal-{index}",
        "name": f"{category}-cal-{index}",
        "category": category,
        "location": "Hauptlager",
        "status": "Verfuegbar",
        "assignedTo": "-",
        "nextReturn": "-",
        "tagNumber": f"TAG-CAL-{index}",
        "serialNumber": f"SN-CAL-{index}",
        "qrCode": "",
        "maintenanceState": "Neu",
        "notes": "",
        "lastCheckout": "-",
        "nextReservation": "-",
    }


def _create_planning(client: TestClient, label: str, items: list[dict]) -> str:
    day = date.today() + timedelta(days=10)
    payload = {
        "customerName": f"Kunde {label}",
        "projectName": f"Projekt {label}",
        "eventName": None,
        "startDate": day.isoformat(),
        "endDate": (day + timedelta(days=3)).isoformat(),
        "notes": "",
        "status": "Geplant",
        "days": [{"planningDate": day.isoformat(), "weekday": "Montag", "items": items}],
    }
    res = client.post("/api/wms/planning", headers=_headers(client, "Admin"), json=payload)
    assert res.status_code == 200, res.text
    return res.json()["id"]


def _list_item(client: TestClient, planning_id: str) -> dict:
    res = client.get("/api/wms/planning", headers=_headers(client, "Admin"))
    assert res.status_code == 200, res.text
    rows = [item for item in res.json() if item["id"] == planning_id]
    assert rows, f"Planung {planning_id} fehlt in der Liste"
    return rows[0]


def test_list_contains_category_totals_and_total_qty() -> None:
    client = TestClient(app)
    _reset(client)
    planning_id = _create_planning(
        client,
        "Totals",
        [
            {"categoryKey": "QR-Code-Scanner", "qty": 10},
            {"categoryKey": "LTE-Router", "qty": 2},
        ],
    )
    item = _list_item(client, planning_id)
    assert item["totalQty"] == 12
    # Sortierung: größte Menge zuerst.
    assert item["categoryTotals"] == [
        {"categoryKey": "QR-Code-Scanner", "qty": 10},
        {"categoryKey": "LTE-Router", "qty": 2},
    ]
    assert item["assignedCount"] == 0
    assert item["handoverNeedsReview"] is False


def test_list_counts_assigned_assets() -> None:
    client = TestClient(app)
    _reset(client)
    planning_id = _create_planning(client, "Assigned", [{"categoryKey": "Laptop", "qty": 2}])

    headers = _headers(client, "Admin")
    for index in range(2):
        res = client.post("/api/wms/assets", headers=headers, json=_asset_payload(index, "Laptop"))
        assert res.status_code == 200, res.text
        asset = res.json()
        asset["status"] = "Verliehen"
        asset["assignedTo"] = "- · Projekt Assigned"
        asset["nextReturn"] = (date.today() + timedelta(days=5)).isoformat()
        asset["assignedPlanningId"] = planning_id
        res = client.post("/api/wms/assets", headers=headers, json=asset)
        assert res.status_code == 200, res.text

    item = _list_item(client, planning_id)
    assert item["assignedCount"] == 2


def test_list_flags_handover_without_partner_as_needs_review() -> None:
    client = TestClient(app)
    _reset(client)
    planning_id = _create_planning(
        client,
        "Review",
        [{"categoryKey": "Laptop", "qty": 1, "handoverEnabled": True, "linkedPlanningId": None}],
    )
    item = _list_item(client, planning_id)
    assert item["handoverNeedsReview"] is True
