"""Schritt C (reine Anzeige): GET /api/wms/planning/{id}/assigned-assets liefert
geplant vs. ausgegeben je Kategorie + die konkret zugeordneten Geräte
(assigned_planning_id == external_id), unabhängig vom Ausleihfenster. Verändert
keine Availability-/Konfliktlogik.
"""

from __future__ import annotations

from datetime import date, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from .auth_helpers import auth_headers


def _headers(client: TestClient, role: str, user_id: str | None = None) -> dict[str, str]:
    return auth_headers(client, role, user_id=user_id)


def _reset(client: TestClient) -> None:
    res = client.post("/api/wms/backup/reset-for-import", headers=_headers(client, "Admin"))
    assert res.status_code == 200, res.text


def _asset_payload(suffix: str, index: int, category: str) -> dict:
    return {
        "id": f"asset-aa-{suffix}-{index}",
        "name": f"{category}-{suffix}-{index}",
        "category": category,
        "location": "Hauptlager",
        "status": "Verfuegbar",
        "assignedTo": "-",
        "nextReturn": "-",
        "tagNumber": f"TAG-AA-{suffix}-{index}",
        "serialNumber": f"SN-AA-{suffix}-{index}",
        "qrCode": "",
        "maintenanceState": "Neu",
        "notes": "",
        "lastCheckout": "-",
        "nextReservation": "-",
    }


def _create_assets(client: TestClient, suffix: str, specs: list[str]) -> list[dict]:
    headers = _headers(client, "Admin")
    created = []
    for index, category in enumerate(specs):
        res = client.post("/api/wms/assets", headers=headers, json=_asset_payload(suffix, index, category))
        assert res.status_code == 200, res.text
        created.append(res.json())
    return created


def _checkout(client: TestClient, asset: dict, *, planning_id: str | None, project: str = "Projekt") -> dict:
    payload = dict(asset)
    payload["status"] = "Verliehen"
    payload["assignedTo"] = f"- · {project}"
    payload["nextReturn"] = (date.today() + timedelta(days=5)).isoformat()
    payload["assignedPlanningId"] = planning_id
    res = client.post("/api/wms/assets", headers=_headers(client, "Admin"), json=payload)
    assert res.status_code == 200, res.text
    return res.json()


def _create_planning(client: TestClient, suffix: str, label: str, items: list[dict]) -> str:
    pm = f"pm-aa-{suffix}-{label}"
    day = date.today() + timedelta(days=10)
    payload = {
        "customerName": f"Kunde {label} {suffix}",
        "projectName": f"Projekt {label} {suffix}",
        "eventName": "AA-Test",
        "projectManagerUserId": pm,
        "calendarWeek": day.isocalendar().week,
        "startDate": day.isoformat(),
        "endDate": day.isoformat(),
        "notes": "",
        "status": "Geplant",
        "days": [{"planningDate": day.isoformat(), "weekday": "Montag", "items": items}],
    }
    res = client.post("/api/wms/planning", headers=_headers(client, "Projektmanager", user_id=pm), json=payload)
    assert res.status_code == 200, res.text
    return res.json()["id"]


def _assigned(client: TestClient, planning_id: str, suffix: str, label: str) -> dict:
    res = client.get(
        f"/api/wms/planning/{planning_id}/assigned-assets",
        headers=_headers(client, "Projektmanager", user_id=f"pm-aa-{suffix}-{label}"),
    )
    assert res.status_code == 200, res.text
    return res.json()


def _cat(data: dict, category: str) -> dict:
    rows = [c for c in data["categories"] if c["categoryKey"] == category]
    assert rows, f"Kategorie {category} fehlt in {data['categories']}"
    return rows[0]


# 1.+2.+3. Aggregation + Differenz exakt/Überausgabe/Unterausgabe + Asset-Liste.
def test_assigned_assets_aggregation_and_differences() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)

    assets = _create_assets(client, suffix, ["Switch", "Switch", "Switch", "Laptop", "Laptop", "iPad"])
    by_cat = {}
    for a in assets:
        by_cat.setdefault(a["category"], []).append(a)

    planning = _create_planning(client, suffix, "Y", [
        {"categoryKey": "Switch", "qty": 1, "notes": None},
        {"categoryKey": "Laptop", "qty": 2, "notes": None},
        {"categoryKey": "iPad", "qty": 1, "notes": None},
    ])
    # Ausgegeben FÜR Y: 2 Switch (Überausgabe), 1 Laptop (Unterausgabe), iPad keiner.
    _checkout(client, by_cat["Switch"][0], planning_id=planning)
    _checkout(client, by_cat["Switch"][1], planning_id=planning)
    _checkout(client, by_cat["Laptop"][0], planning_id=planning)

    data = _assigned(client, planning, suffix, "Y")
    assert data["planningId"] == planning

    sw = _cat(data, "Switch")
    assert (sw["plannedQty"], sw["assignedQty"], sw["differenceQty"]) == (1, 2, 1), sw   # Überausgabe
    lp = _cat(data, "Laptop")
    assert (lp["plannedQty"], lp["assignedQty"], lp["differenceQty"]) == (2, 1, -1), lp  # Unterausgabe
    ip = _cat(data, "iPad")
    assert (ip["plannedQty"], ip["assignedQty"], ip["differenceQty"]) == (1, 0, -1), ip  # Unterausgabe

    assert data["plannedTotal"] == 4, data
    assert data["assignedTotal"] == 3, data
    assert data["differenceTotal"] == -1, data

    # Konkrete Asset-Liste: 3 zugeordnete Geräte, alle Verliehen, mit Rückgabedatum.
    assert len(data["assets"]) == 3, data["assets"]
    for a in data["assets"]:
        assert a["status"] == "Verliehen"
        assert a["assignedPlanningId"] == planning
        assert a["expectedReturnDate"], a
        assert a["category"] in {"Switch", "Laptop"}


# 4. Assets OHNE assigned_planning_id (auch bei gleichem Freitext-Projekt) und
#    Assets anderer Planung werden NICHT zugeordnet.
def test_unlinked_and_other_planning_assets_excluded() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)

    assets = _create_assets(client, suffix, ["Switch", "Switch", "Switch"])
    planning_p = _create_planning(client, suffix, "P", [{"categoryKey": "Switch", "qty": 2, "notes": None}])
    planning_q = _create_planning(client, suffix, "Q", [{"categoryKey": "Switch", "qty": 1, "notes": None}])

    # 1x ohne Link (gleicher Freitext-Projektname wie P), 1x für Q.
    _checkout(client, assets[0], planning_id=None, project=f"Kunde P {suffix}")
    _checkout(client, assets[1], planning_id=planning_q)

    data_p = _assigned(client, planning_p, suffix, "P")
    sw_p = _cat(data_p, "Switch")
    assert sw_p["assignedQty"] == 0, sw_p          # weder Freitext noch Q zählen für P
    assert sw_p["differenceQty"] == -2, sw_p
    assert data_p["assets"] == [], data_p

    data_q = _assigned(client, planning_q, suffix, "Q")
    sw_q = _cat(data_q, "Switch")
    assert sw_q["assignedQty"] == 1, sw_q


# 5. Unbekannte Planung -> 404.
def test_assigned_assets_unknown_planning_404() -> None:
    client = TestClient(app)
    _reset(client)
    res = client.get(
        "/api/wms/planning/pln-does-not-exist/assigned-assets",
        headers=_headers(client, "Admin"),
    )
    assert res.status_code == 404, res.text
