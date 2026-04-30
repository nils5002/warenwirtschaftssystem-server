from __future__ import annotations

from datetime import date, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from .auth_helpers import auth_headers


def _headers(client: TestClient, role: str, user_id: str | None = None, project_context: str | None = None) -> dict[str, str]:
    
    return auth_headers(client, role, user_id=user_id, project_context=project_context)


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
    response = client.get("/api/wms/assets", headers=_headers(client, "Admin"))
    assert response.status_code == 200
    matching = [asset for asset in response.json() if asset["category"] == category]
    usable = [asset for asset in matching if asset["status"] in {"Verfuegbar", "Verfügbar"}]
    return len(matching), len(usable)


def test_maintenance_locks_asset_and_only_releases_after_all_active_items_are_done() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    asset = _asset_payload(suffix)
    created_asset = client.post("/api/wms/assets", headers=_headers(client, "Admin"), json=asset)
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

    created_first = client.post("/api/wms/maintenance", headers=_headers(client, "Mitarbeiter"), json=first)
    assert created_first.status_code == 200
    locked = client.get(f"/api/wms/assets/{asset['id']}", headers=_headers(client, "Admin"))
    assert locked.status_code == 200
    assert locked.json()["status"] == "Defekt"

    created_second = client.post("/api/wms/maintenance", headers=_headers(client, "Admin"), json=second)
    assert created_second.status_code == 200

    done_first = client.post(
        "/api/wms/maintenance",
        headers=_headers(client, "Admin"),
        json={**created_first.json(), "status": "Erledigt"},
    )
    assert done_first.status_code == 200
    still_locked = client.get(f"/api/wms/assets/{asset['id']}", headers=_headers(client, "Admin"))
    assert still_locked.status_code == 200
    assert still_locked.json()["status"] == "Defekt"

    done_second = client.post(
        "/api/wms/maintenance",
        headers=_headers(client, "Admin"),
        json={**created_second.json(), "status": "Erledigt"},
    )
    assert done_second.status_code == 200
    released = client.get(f"/api/wms/assets/{asset['id']}", headers=_headers(client, "Admin"))
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

    assert client.post("/api/wms/assets", headers=_headers(client, "Admin"), json=available).status_code == 200
    assert client.post("/api/wms/assets", headers=_headers(client, "Admin"), json=loaned).status_code == 200

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
    created = client.post("/api/wms/planning", headers=_headers(client, "Projektmanager", f"pm-{suffix}"), json=planning)
    assert created.status_code == 200

    availability = client.get(
        f"/api/wms/planning/{created.json()['id']}/availability",
        headers=_headers(client, "Projektmanager", f"pm-{suffix}"),
    )
    assert availability.status_code == 200
    item = availability.json()["items"][0]
    assert item["totalStock"] == baseline_total + 2
    assert item["usableStock"] == baseline_usable + 1
    assert item["remainingQty"] == item["usableStock"] - item["alreadyPlanned"]
    assert item["shortageQty"] == max(0, 2 - item["remainingQty"])


def test_asset_and_planning_categories_are_normalized_for_availability() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    notebook = _asset_payload(f"{suffix}-notebook")
    notebook["category"] = "Notebooks"
    ipad = _asset_payload(f"{suffix}-ipad")
    ipad["category"] = "iPads"

    created_notebook = client.post("/api/wms/assets", headers=_headers(client, "Admin"), json=notebook)
    created_ipad = client.post("/api/wms/assets", headers=_headers(client, "Admin"), json=ipad)
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
    created = client.post("/api/wms/planning", headers=_headers(client, "Projektmanager", f"pm-cat-{suffix}"), json=planning)
    assert created.status_code == 200

    returned_items = created.json()["days"][0]["items"]
    assert sorted(item["categoryKey"] for item in returned_items) == ["Laptop", "iPad"]

    availability = client.get(
        f"/api/wms/planning/{created.json()['id']}/availability",
        headers=_headers(client, "Projektmanager", f"pm-cat-{suffix}"),
    )
    assert availability.status_code == 200
    items = {item["categoryKey"]: item for item in availability.json()["items"]}
    assert items["Laptop"]["requestedQty"] == 2
    assert items["Laptop"]["totalStock"] >= 1
    assert items["iPad"]["requestedQty"] == 1
    assert items["iPad"]["totalStock"] >= 1


def test_planning_shortage_with_handover_is_warning_not_green() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    planning_date = date.today() + timedelta(days=15)
    category = "Laptop"
    _, usable = _category_counts(client, category)
    requested = usable + 3

    payload = {
        "customerName": f"Kunde Handover {suffix}",
        "projectName": f"Projekt Handover {suffix}",
        "eventName": "Handover Check",
        "projectManagerUserId": f"pm-ho-{suffix}",
        "calendarWeek": planning_date.isocalendar().week,
        "startDate": planning_date.isoformat(),
        "endDate": planning_date.isoformat(),
        "notes": "Engpass mit Übergabe markieren",
        "status": "Entwurf",
        "days": [
            {
                "planningDate": planning_date.isoformat(),
                "weekday": "Montag",
                "items": [
                    {
                        "categoryKey": category,
                        "qty": requested,
                        "notes": None,
                        "handoverEnabled": True,
                        "linkedPlanningId": f"pln-linked-{suffix}",
                        "handoverNote": "Übergabe zwischen Projektteams",
                    }
                ],
            }
        ],
    }

    created = client.post("/api/wms/planning", headers=_headers(client, "Projektmanager", f"pm-ho-{suffix}"), json=payload)
    assert created.status_code == 200

    availability = client.get(
        f"/api/wms/planning/{created.json()['id']}/availability",
        headers=_headers(client, "Projektmanager", f"pm-ho-{suffix}"),
    )
    assert availability.status_code == 200
    item = availability.json()["items"][0]
    assert item["shortageQty"] > 0
    assert item["availabilityState"] == "yellow"
    assert item["handoverEnabled"] is True
    assert item["handoverStatus"] in {"planned", "missing_link"}


def test_planning_shortage_without_handover_stays_red() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    planning_date = date.today() + timedelta(days=16)
    category = "Laptop"
    _, usable = _category_counts(client, category)
    requested = usable + 2

    payload = {
        "customerName": f"Kunde No Handover {suffix}",
        "projectName": f"Projekt No Handover {suffix}",
        "eventName": "No Handover Check",
        "projectManagerUserId": f"pm-noho-{suffix}",
        "calendarWeek": planning_date.isocalendar().week,
        "startDate": planning_date.isoformat(),
        "endDate": planning_date.isoformat(),
        "notes": "Engpass ohne Übergabe",
        "status": "Entwurf",
        "days": [
            {
                "planningDate": planning_date.isoformat(),
                "weekday": "Dienstag",
                "items": [{"categoryKey": category, "qty": requested, "notes": None}],
            }
        ],
    }

    created = client.post("/api/wms/planning", headers=_headers(client, "Projektmanager", f"pm-noho-{suffix}"), json=payload)
    assert created.status_code == 200

    availability = client.get(
        f"/api/wms/planning/{created.json()['id']}/availability",
        headers=_headers(client, "Projektmanager", f"pm-noho-{suffix}"),
    )
    assert availability.status_code == 200
    item = availability.json()["items"][0]
    assert item["shortageQty"] > 0
    assert item["availabilityState"] == "red"
    assert item["handoverStatus"] == "none"


def test_handover_fields_are_persisted_and_orphan_link_does_not_crash() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    planning_date = date.today() + timedelta(days=17)
    orphan_link = f"pln-orphan-{suffix}"
    payload = {
        "customerName": f"Kunde Persistenz {suffix}",
        "projectName": f"Projekt Persistenz {suffix}",
        "eventName": "Persistenz Test",
        "projectManagerUserId": f"pm-persist-{suffix}",
        "calendarWeek": planning_date.isocalendar().week,
        "startDate": planning_date.isoformat(),
        "endDate": planning_date.isoformat(),
        "notes": "Handover Persistenz",
        "status": "Entwurf",
        "days": [
            {
                "planningDate": planning_date.isoformat(),
                "weekday": "Mittwoch",
                "items": [
                    {
                        "categoryKey": "iPad",
                        "qty": 4,
                        "notes": None,
                        "handoverEnabled": True,
                        "linkedPlanningId": orphan_link,
                        "handoverNote": "Übergabe nach Aufbau",
                    }
                ],
            }
        ],
    }

    created = client.post(
        "/api/wms/planning",
        headers=_headers(client, "Projektmanager", f"pm-persist-{suffix}"),
        json=payload,
    )
    assert created.status_code == 200
    day_item = created.json()["days"][0]["items"][0]
    assert day_item["handoverEnabled"] is True
    assert day_item["linkedPlanningId"] == orphan_link
    assert day_item["handoverNote"] == "Übergabe nach Aufbau"

    fetched = client.get(
        f"/api/wms/planning/{created.json()['id']}",
        headers=_headers(client, "Projektmanager", f"pm-persist-{suffix}"),
    )
    assert fetched.status_code == 200
    fetched_item = fetched.json()["days"][0]["items"][0]
    assert fetched_item["linkedPlanningId"] == orphan_link
    assert fetched_item["handoverNote"] == "Übergabe nach Aufbau"

    availability = client.get(
        f"/api/wms/planning/{created.json()['id']}/availability",
        headers=_headers(client, "Projektmanager", f"pm-persist-{suffix}"),
    )
    assert availability.status_code == 200
    assert availability.json()["items"][0]["linkedPlanningId"] == orphan_link


def test_handover_planning_does_not_change_real_asset_status() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    asset = _asset_payload(f"{suffix}-handover-status")
    asset["category"] = "iPad"
    create_asset = client.post("/api/wms/assets", headers=_headers(client, "Admin"), json=asset)
    assert create_asset.status_code == 200
    assert create_asset.json()["status"] in {"Verfuegbar", "Verfügbar"}

    planning_date = date.today() + timedelta(days=18)
    payload = {
        "customerName": f"Kunde Status {suffix}",
        "projectName": f"Projekt Status {suffix}",
        "eventName": "Status Test",
        "projectManagerUserId": f"pm-status-{suffix}",
        "calendarWeek": planning_date.isocalendar().week,
        "startDate": planning_date.isoformat(),
        "endDate": planning_date.isoformat(),
        "notes": "Nur Planungsannahme",
        "status": "Entwurf",
        "days": [
            {
                "planningDate": planning_date.isoformat(),
                "weekday": "Donnerstag",
                "items": [
                    {
                        "categoryKey": "iPad",
                        "qty": 2,
                        "notes": None,
                        "handoverEnabled": True,
                        "linkedPlanningId": f"pln-status-linked-{suffix}",
                        "handoverNote": "Übergabe intern",
                    }
                ],
            }
        ],
    }
    created = client.post(
        "/api/wms/planning",
        headers=_headers(client, "Projektmanager", f"pm-status-{suffix}"),
        json=payload,
    )
    assert created.status_code == 200

    asset_after = client.get(f"/api/wms/assets/{asset['id']}", headers=_headers(client, "Admin"))
    assert asset_after.status_code == 200
    assert asset_after.json()["status"] in {"Verfuegbar", "Verfügbar"}


def test_cross_project_shortage_is_counted_for_draft_plannings() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    planning_date = date.today() + timedelta(days=19)
    category = "iPad"
    _, usable = _category_counts(client, category)
    first_qty = max(1, usable)
    second_qty = 2

    payload_a = {
        "customerName": f"Kunde A {suffix}",
        "projectName": f"Projekt A {suffix}",
        "eventName": "Cross A",
        "projectManagerUserId": f"pm-a-{suffix}",
        "calendarWeek": planning_date.isocalendar().week,
        "startDate": planning_date.isoformat(),
        "endDate": planning_date.isoformat(),
        "notes": "Draft A",
        "status": "Entwurf",
        "days": [{"planningDate": planning_date.isoformat(), "weekday": "Freitag", "items": [{"categoryKey": category, "qty": first_qty, "notes": None}]}],
    }
    payload_b = {
        "customerName": f"Kunde B {suffix}",
        "projectName": f"Projekt B {suffix}",
        "eventName": "Cross B",
        "projectManagerUserId": f"pm-b-{suffix}",
        "calendarWeek": planning_date.isocalendar().week,
        "startDate": planning_date.isoformat(),
        "endDate": planning_date.isoformat(),
        "notes": "Draft B",
        "status": "Entwurf",
        "days": [{"planningDate": planning_date.isoformat(), "weekday": "Freitag", "items": [{"categoryKey": category, "qty": second_qty, "notes": None}]}],
    }

    created_a = client.post("/api/wms/planning", headers=_headers(client, "Projektmanager", f"pm-a-{suffix}"), json=payload_a)
    created_b = client.post("/api/wms/planning", headers=_headers(client, "Projektmanager", f"pm-b-{suffix}"), json=payload_b)
    assert created_a.status_code == 200
    assert created_b.status_code == 200

    availability_b = client.get(
        f"/api/wms/planning/{created_b.json()['id']}/availability",
        headers=_headers(client, "Projektmanager", f"pm-b-{suffix}"),
    )
    assert availability_b.status_code == 200
    item = availability_b.json()["items"][0]
    assert item["alreadyPlanned"] >= first_qty
    assert item["shortageQty"] >= 0
    assert "currentPlanningQty" in item
    assert "otherPlannedQty" in item
    assert "totalPlannedQtyForDateCategory" in item
    assert "remainingAfterAllPlanning" in item
    assert "hasGlobalShortage" in item
    assert "affectedPlanningIds" in item


def test_confirmed_cross_project_shortage_has_expected_global_numbers() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    planning_date = date(2026, 4, 30)
    category = "iPad"

    payload_a = {
        "customerName": f"Kunde C1 {suffix}",
        "projectName": f"Projekt C1 {suffix}",
        "eventName": "Confirmed A",
        "projectManagerUserId": f"pm-c1-{suffix}",
        "calendarWeek": planning_date.isocalendar().week,
        "startDate": planning_date.isoformat(),
        "endDate": planning_date.isoformat(),
        "notes": "Confirmed A",
        "status": "Bestaetigt",
        "days": [{"planningDate": planning_date.isoformat(), "weekday": "Donnerstag", "items": [{"categoryKey": category, "qty": 30, "notes": None}]}],
    }
    payload_b = {
        "customerName": f"Kunde C2 {suffix}",
        "projectName": f"Projekt C2 {suffix}",
        "eventName": "Confirmed B",
        "projectManagerUserId": f"pm-c2-{suffix}",
        "calendarWeek": planning_date.isocalendar().week,
        "startDate": planning_date.isoformat(),
        "endDate": planning_date.isoformat(),
        "notes": "Confirmed B",
        "status": "Bestaetigt",
        "days": [{"planningDate": planning_date.isoformat(), "weekday": "Donnerstag", "items": [{"categoryKey": category, "qty": 8, "notes": None}]}],
    }

    created_a = client.post("/api/wms/planning", headers=_headers(client, "Projektmanager", f"pm-c1-{suffix}"), json=payload_a)
    created_b = client.post("/api/wms/planning", headers=_headers(client, "Projektmanager", f"pm-c2-{suffix}"), json=payload_b)
    assert created_a.status_code == 200
    assert created_b.status_code == 200

    availability_a = client.get(
        f"/api/wms/planning/{created_a.json()['id']}/availability",
        headers=_headers(client, "Projektmanager", f"pm-c1-{suffix}"),
    )
    assert availability_a.status_code == 200
    item = availability_a.json()["items"][0]
    assert item["currentPlanningQty"] == 30
    assert item["otherPlannedQty"] >= 8
    assert item["totalPlannedQtyForDateCategory"] == item["currentPlanningQty"] + item["otherPlannedQty"]
    assert item["remainingAfterAllPlanning"] == item["usableStock"] - item["totalPlannedQtyForDateCategory"]
    assert item["shortageQty"] == max(0, -item["remainingAfterAllPlanning"])


def test_overview_contains_planning_summary_separate_from_inventory_status() -> None:
    client = TestClient(app)
    response = client.get("/api/wms/overview", headers=_headers(client, "Admin"))
    assert response.status_code == 200
    summary = response.json().get("planningSummary")
    assert isinstance(summary, dict)
    assert "todayPlannedQty" in summary
    assert "todayShortageCount" in summary
    assert "categorySummaries" in summary


def test_categories_are_seeded_and_synonym_duplicates_are_blocked() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]

    categories = client.get("/api/wms/categories", headers=_headers(client, "Admin"))
    assert categories.status_code == 200
    names = {item["name"] for item in categories.json()}
    assert {"Laptop", "iPad", "QR-Code-Scanner", "Sonstiges"}.issubset(names)

    duplicate = client.post("/api/wms/categories", headers=_headers(client, "Admin"), json={"name": "Notebooks"})
    assert duplicate.status_code == 409
    assert "Laptop" in duplicate.json()["detail"]

    forbidden = client.post("/api/wms/categories", headers=_headers(client, "Mitarbeiter"), json={"name": f"Kabel {suffix}"})
    assert forbidden.status_code == 403

    created = client.post("/api/wms/categories", headers=_headers(client, "Admin"), json={"name": f"Kabel {suffix}"})
    assert created.status_code == 200
    assert created.json()["name"] == f"Kabel {suffix}"

    asset = _asset_payload(f"{suffix}-custom")
    asset["category"] = f"Kabel {suffix}"
    created_asset = client.post("/api/wms/assets", headers=_headers(client, "Admin"), json=asset)
    assert created_asset.status_code == 200
    assert created_asset.json()["category"] == f"Kabel {suffix}"

