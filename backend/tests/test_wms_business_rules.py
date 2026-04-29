from __future__ import annotations

from datetime import date, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app


def _headers(role: str, user_id: str | None = None, project_context: str | None = None) -> dict[str, str]:
    headers = {"X-User-Role": role}
    if user_id:
        headers["X-User-Id"] = user_id
    if project_context:
        headers["X-Project-Context"] = project_context
    return headers


def _asset_payload(suffix: str, *, status: str = "Verfuegbar") -> dict[str, str]:
    return {
        "id": f"asset-wms-business-{suffix}",
        "name": f"WMS Business Laptop {suffix}",
        "category": "Laptop",
        "location": "Testlager",
        "status": status,
        "assignedTo": "-",
        "nextReturn": "-",
        "tagNumber": f"WMS-BIZ-{suffix}",
        "serialNumber": f"SN-WMS-BIZ-{suffix}",
        "qrCode": "",
        "maintenanceState": "Neu",
        "notes": "",
        "lastCheckout": "-",
        "nextReservation": "-",
    }


def _category_counts(client: TestClient, category: str) -> tuple[int, int]:
    response = client.get("/api/wms/assets", headers=_headers("Admin"))
    assert response.status_code == 200
    matching = [asset for asset in response.json() if asset["category"] == category]
    usable = [asset for asset in matching if asset["status"] in {"Verfuegbar", "Verfügbar"}]
    return len(matching), len(usable)


def test_maintenance_locks_asset_and_only_releases_after_all_active_items_are_done() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    asset = _asset_payload(suffix)
    created_asset = client.post("/api/wms/assets", headers=_headers("Admin"), json=asset)
    assert created_asset.status_code == 200

    first = {
        "id": f"mnt-wms-business-{suffix}-1",
        "assetName": asset["name"],
        "issue": "Display beschädigt",
        "reportedAt": date.today().strftime("%d.%m.%Y"),
        "dueDate": (date.today() + timedelta(days=4)).strftime("%d.%m.%Y"),
        "priority": "Mittel",
        "status": "Offen",
        "comment": "Test",
        "location": "Werkstatt",
    }
    second = {**first, "id": f"mnt-wms-business-{suffix}-2", "issue": "Akku defekt"}

    created_first = client.post("/api/wms/maintenance", headers=_headers("Mitarbeiter"), json=first)
    assert created_first.status_code == 200
    locked = client.get(f"/api/wms/assets/{asset['id']}", headers=_headers("Admin"))
    assert locked.status_code == 200
    assert locked.json()["status"] == "Defekt"

    created_second = client.post("/api/wms/maintenance", headers=_headers("Admin"), json=second)
    assert created_second.status_code == 200

    done_first = client.post(
        "/api/wms/maintenance",
        headers=_headers("Admin"),
        json={**created_first.json(), "status": "Erledigt"},
    )
    assert done_first.status_code == 200
    still_locked = client.get(f"/api/wms/assets/{asset['id']}", headers=_headers("Admin"))
    assert still_locked.status_code == 200
    assert still_locked.json()["status"] == "Defekt"

    done_second = client.post(
        "/api/wms/maintenance",
        headers=_headers("Admin"),
        json={**created_second.json(), "status": "Erledigt"},
    )
    assert done_second.status_code == 200
    released = client.get(f"/api/wms/assets/{asset['id']}", headers=_headers("Admin"))
    assert released.status_code == 200
    assert released.json()["status"] == "Verfuegbar"


def test_planning_availability_counts_only_available_assets_as_usable() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    baseline_total, baseline_usable = _category_counts(client, "Laptop")
    available = _asset_payload(f"{suffix}-available")
    loaned = _asset_payload(f"{suffix}-loaned", status="Verliehen")
    loaned["category"] = available["category"]
    loaned["assignedTo"] = "Max Mustermann · Testprojekt"
    loaned["nextReturn"] = (date.today() + timedelta(days=2)).isoformat()

    assert client.post("/api/wms/assets", headers=_headers("Admin"), json=available).status_code == 200
    assert client.post("/api/wms/assets", headers=_headers("Admin"), json=loaned).status_code == 200

    planning_date = date(2099, 1, 11)
    planning = {
        "customerName": f"Kunde WMS Business {suffix}",
        "projectName": f"Projekt WMS Business {suffix}",
        "eventName": "Availability Test",
        "projectManagerUserId": f"pm-{suffix}",
        "calendarWeek": planning_date.isocalendar().week,
        "startDate": planning_date.isoformat(),
        "endDate": planning_date.isoformat(),
        "notes": "Verliehen darf nicht nutzbar zählen",
        "status": "Entwurf",
        "days": [
            {
                "planningDate": planning_date.isoformat(),
                "weekday": "Montag",
                "items": [{"categoryKey": available["category"], "qty": 2, "notes": None}],
            }
        ],
    }
    created = client.post("/api/wms/planning", headers=_headers("Projektmanager", f"pm-{suffix}"), json=planning)
    assert created.status_code == 200

    availability = client.get(
        f"/api/wms/planning/{created.json()['id']}/availability",
        headers=_headers("Projektmanager", f"pm-{suffix}"),
    )
    assert availability.status_code == 200
    item = availability.json()["items"][0]
    assert item["totalStock"] == baseline_total + 2
    assert item["usableStock"] == baseline_usable + 1
    assert item["remainingQty"] == baseline_usable + 1
    assert item["shortageQty"] == max(0, 2 - (baseline_usable + 1))


def test_asset_and_planning_categories_are_normalized_for_availability() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    notebook = _asset_payload(f"{suffix}-notebook")
    notebook["category"] = "Notebooks"
    ipad = _asset_payload(f"{suffix}-ipad")
    ipad["category"] = "iPads"

    created_notebook = client.post("/api/wms/assets", headers=_headers("Admin"), json=notebook)
    created_ipad = client.post("/api/wms/assets", headers=_headers("Admin"), json=ipad)
    assert created_notebook.status_code == 200
    assert created_ipad.status_code == 200
    assert created_notebook.json()["category"] == "Laptop"
    assert created_ipad.json()["category"] == "iPad"

    planning_date = date.today() + timedelta(days=11)
    planning = {
        "customerName": f"Kunde Kategorie {suffix}",
        "projectName": f"Projekt Kategorie {suffix}",
        "eventName": "Kategorie Test",
        "projectManagerUserId": f"pm-cat-{suffix}",
        "calendarWeek": planning_date.isocalendar().week,
        "startDate": planning_date.isoformat(),
        "endDate": planning_date.isoformat(),
        "notes": "Synonyme müssen zusammengeführt werden",
        "status": "Entwurf",
        "days": [
            {
                "planningDate": planning_date.isoformat(),
                "weekday": "Montag",
                "items": [
                    {"categoryKey": "Notebook", "qty": 1, "notes": None},
                    {"categoryKey": "Laptop", "qty": 1, "notes": None},
                    {"categoryKey": "iPads", "qty": 1, "notes": None},
                ],
            }
        ],
    }
    created = client.post("/api/wms/planning", headers=_headers("Projektmanager", f"pm-cat-{suffix}"), json=planning)
    assert created.status_code == 200

    returned_items = created.json()["days"][0]["items"]
    assert sorted(item["categoryKey"] for item in returned_items) == ["Laptop", "iPad"]

    availability = client.get(
        f"/api/wms/planning/{created.json()['id']}/availability",
        headers=_headers("Projektmanager", f"pm-cat-{suffix}"),
    )
    assert availability.status_code == 200
    items = {item["categoryKey"]: item for item in availability.json()["items"]}
    assert items["Laptop"]["requestedQty"] == 2
    assert items["Laptop"]["totalStock"] >= 1
    assert items["iPad"]["requestedQty"] == 1
    assert items["iPad"]["totalStock"] >= 1


def test_categories_are_seeded_and_synonym_duplicates_are_blocked() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]

    categories = client.get("/api/wms/categories", headers=_headers("Admin"))
    assert categories.status_code == 200
    names = {item["name"] for item in categories.json()}
    assert {"Laptop", "iPad", "QR-Code-Scanner", "Sonstiges"}.issubset(names)

    duplicate = client.post("/api/wms/categories", headers=_headers("Admin"), json={"name": "Notebooks"})
    assert duplicate.status_code == 409
    assert "Laptop" in duplicate.json()["detail"]

    forbidden = client.post("/api/wms/categories", headers=_headers("Mitarbeiter"), json={"name": f"Kabel {suffix}"})
    assert forbidden.status_code == 403

    created = client.post("/api/wms/categories", headers=_headers("Admin"), json={"name": f"Kabel {suffix}"})
    assert created.status_code == 200
    assert created.json()["name"] == f"Kabel {suffix}"

    asset = _asset_payload(f"{suffix}-custom")
    asset["category"] = f"Kabel {suffix}"
    created_asset = client.post("/api/wms/assets", headers=_headers("Admin"), json=asset)
    assert created_asset.status_code == 200
    assert created_asset.json()["category"] == f"Kabel {suffix}"
