from __future__ import annotations

import json
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


def test_handover_update_is_persisted_across_get_and_availability_reload() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    planning_date = date(2026, 4, 30)
    owner_user_id = f"pm-owner-{suffix}"
    partner_user_id = f"pm-partner-{suffix}"

    partner_payload = {
        "customerName": f"Kunde Partner {suffix}",
        "projectName": f"Projekt Partner {suffix}",
        "eventName": "Partnerprojekt",
        "projectManagerUserId": partner_user_id,
        "calendarWeek": planning_date.isocalendar().week,
        "startDate": planning_date.isoformat(),
        "endDate": planning_date.isoformat(),
        "notes": "Partnerprojekt für Übergabe",
        "status": "Bestaetigt",
        "days": [
            {
                "planningDate": planning_date.isoformat(),
                "weekday": "Donnerstag",
                "items": [{"categoryKey": "iPad", "qty": 8, "notes": None}],
            }
        ],
    }
    owner_payload = {
        "customerName": f"Kunde Owner {suffix}",
        "projectName": f"Projekt Owner {suffix}",
        "eventName": "Ownerprojekt",
        "projectManagerUserId": owner_user_id,
        "calendarWeek": planning_date.isocalendar().week,
        "startDate": planning_date.isoformat(),
        "endDate": planning_date.isoformat(),
        "notes": "Ownerprojekt ohne Übergabe",
        "status": "Bestaetigt",
        "days": [
            {
                "planningDate": planning_date.isoformat(),
                "weekday": "Donnerstag",
                "items": [{"categoryKey": "iPad", "qty": 30, "notes": None}],
            }
        ],
    }

    created_partner = client.post(
        "/api/wms/planning",
        headers=_headers(client, "Projektmanager", partner_user_id),
        json=partner_payload,
    )
    created_owner = client.post(
        "/api/wms/planning",
        headers=_headers(client, "Projektmanager", owner_user_id),
        json=owner_payload,
    )
    assert created_partner.status_code == 200
    assert created_owner.status_code == 200

    owner_id = created_owner.json()["id"]
    partner_id = created_partner.json()["id"]

    existing = client.get(
        f"/api/wms/planning/{owner_id}",
        headers=_headers(client, "Projektmanager", owner_user_id),
    )
    assert existing.status_code == 200

    update_payload = existing.json()
    update_payload["days"][0]["items"][0]["handoverEnabled"] = True
    update_payload["days"][0]["items"][0]["linkedPlanningId"] = partner_id
    update_payload["days"][0]["items"][0]["handoverNote"] = "Übergabe nach Aufbau"

    updated = client.put(
        f"/api/wms/planning/{owner_id}",
        headers=_headers(client, "Projektmanager", owner_user_id),
        json=update_payload,
    )
    assert updated.status_code == 200
    updated_item = updated.json()["days"][0]["items"][0]
    assert updated_item["handoverEnabled"] is True
    assert updated_item["linkedPlanningId"] == partner_id
    assert updated_item["handoverNote"] == "Übergabe nach Aufbau"
    assert updated_item["linkedPlanningLabel"] == created_partner.json()["projectName"]

    reloaded = client.get(
        f"/api/wms/planning/{owner_id}",
        headers=_headers(client, "Projektmanager", owner_user_id),
    )
    assert reloaded.status_code == 200
    reloaded_item = reloaded.json()["days"][0]["items"][0]
    assert reloaded_item["handoverEnabled"] is True
    assert reloaded_item["linkedPlanningId"] == partner_id
    assert reloaded_item["handoverNote"] == "Übergabe nach Aufbau"
    assert reloaded_item["linkedPlanningLabel"] == created_partner.json()["projectName"]

    availability = client.get(
        f"/api/wms/planning/{owner_id}/availability",
        headers=_headers(client, "Projektmanager", owner_user_id),
    )
    assert availability.status_code == 200
    availability_item = availability.json()["items"][0]
    assert availability_item["handoverEnabled"] is True
    assert availability_item["linkedPlanningId"] == partner_id
    assert availability_item["handoverNote"] == "Übergabe nach Aufbau"
    assert availability_item["linkedPlanningLabel"] == created_partner.json()["projectName"]


def test_backup_restore_preserves_handover_links_and_availability_state() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    planning_date = date.today() + timedelta(days=20)
    owner_user_id = f"pm-backup-owner-{suffix}"
    partner_user_id = f"pm-backup-partner-{suffix}"

    partner_payload = {
        "customerName": f"Kunde Backup Partner {suffix}",
        "projectName": f"Projekt Backup Partner {suffix}",
        "eventName": "Backup Partner",
        "projectManagerUserId": partner_user_id,
        "calendarWeek": planning_date.isocalendar().week,
        "startDate": planning_date.isoformat(),
        "endDate": planning_date.isoformat(),
        "notes": "Partnerprojekt für Backup-Test",
        "status": "Bestaetigt",
        "days": [
            {
                "planningDate": planning_date.isoformat(),
                "weekday": "Montag",
                "items": [{"categoryKey": "iPad", "qty": 8, "notes": None}],
            }
        ],
    }
    owner_payload = {
        "customerName": f"Kunde Backup Owner {suffix}",
        "projectName": f"Projekt Backup Owner {suffix}",
        "eventName": "Backup Owner",
        "projectManagerUserId": owner_user_id,
        "calendarWeek": planning_date.isocalendar().week,
        "startDate": planning_date.isoformat(),
        "endDate": planning_date.isoformat(),
        "notes": "Ownerprojekt für Backup-Test",
        "status": "Bestaetigt",
        "days": [
            {
                "planningDate": planning_date.isoformat(),
                "weekday": "Montag",
                "items": [{"categoryKey": "iPad", "qty": 30, "notes": None}],
            }
        ],
    }

    created_partner = client.post("/api/wms/planning", headers=_headers(client, "Projektmanager", partner_user_id), json=partner_payload)
    created_owner = client.post("/api/wms/planning", headers=_headers(client, "Projektmanager", owner_user_id), json=owner_payload)
    assert created_partner.status_code == 200
    assert created_owner.status_code == 200

    owner_id = created_owner.json()["id"]
    partner_id = created_partner.json()["id"]

    existing_owner = client.get(f"/api/wms/planning/{owner_id}", headers=_headers(client, "Projektmanager", owner_user_id))
    assert existing_owner.status_code == 200
    update_payload = existing_owner.json()
    update_payload["days"][0]["items"][0]["handoverEnabled"] = True
    update_payload["days"][0]["items"][0]["linkedPlanningId"] = partner_id
    update_payload["days"][0]["items"][0]["handoverNote"] = "Restore muss Verbund erhalten"

    updated = client.put(f"/api/wms/planning/{owner_id}", headers=_headers(client, "Projektmanager", owner_user_id), json=update_payload)
    assert updated.status_code == 200

    exported = client.get("/api/wms/backup/export", headers=_headers(client, "Admin"))
    assert exported.status_code == 200
    backup_json = exported.json()

    import_response = client.post(
        "/api/wms/backup/import",
        headers=_headers(client, "Admin"),
        files={"file": ("backup.json", json.dumps(backup_json).encode("utf-8"), "application/json")},
    )
    assert import_response.status_code == 200

    owner_after = client.get(f"/api/wms/planning/{owner_id}", headers=_headers(client, "Projektmanager", owner_user_id))
    assert owner_after.status_code == 200
    owner_item = owner_after.json()["days"][0]["items"][0]
    assert owner_item["handoverEnabled"] is True
    assert owner_item["linkedPlanningId"] == partner_id
    assert owner_item["handoverNote"] == "Restore muss Verbund erhalten"

    owner_availability_after = client.get(
        f"/api/wms/planning/{owner_id}/availability",
        headers=_headers(client, "Projektmanager", owner_user_id),
    )
    assert owner_availability_after.status_code == 200
    availability_item = owner_availability_after.json()["items"][0]
    assert availability_item["handoverEnabled"] is True
    assert availability_item["linkedPlanningId"] == partner_id
    assert availability_item["handoverStatus"] in {"none", "planned"}

    planning_list = client.get("/api/wms/planning", headers=_headers(client, "Admin"))
    assert planning_list.status_code == 200
    by_id = {item["id"]: item for item in planning_list.json()}
    assert by_id[owner_id]["handoverSummary"] is not None
    assert by_id[owner_id]["handoverSummary"]["partnerPlanningId"] == partner_id
    assert by_id[partner_id]["handoverSummary"] is not None
    assert by_id[partner_id]["handoverSummary"]["direction"] in {"incoming", "mixed"}


def test_backup_import_remains_compatible_without_handover_fields() -> None:
    client = TestClient(app)
    exported = client.get("/api/wms/backup/export", headers=_headers(client, "Admin"))
    assert exported.status_code == 200
    backup_json = exported.json()

    for planning in backup_json.get("plannings", []):
        for day in planning.get("days", []):
            for item in day.get("items", []):
                item.pop("handoverEnabled", None)
                item.pop("linkedPlanningId", None)
                item.pop("handoverNote", None)

    imported = client.post(
        "/api/wms/backup/import",
        headers=_headers(client, "Admin"),
        files={"file": ("legacy-backup.json", json.dumps(backup_json).encode("utf-8"), "application/json")},
    )
    assert imported.status_code == 200


def test_planning_list_marks_outgoing_and_incoming_handover_networks() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    planning_date = date(2026, 4, 30)
    owner_user_id = f"pm-list-owner-{suffix}"
    partner_user_id = f"pm-list-partner-{suffix}"

    partner_payload = {
        "customerName": f"Kunde Listen Partner {suffix}",
        "projectName": f"Projekt Listen Partner {suffix}",
        "eventName": "Partnerliste",
        "projectManagerUserId": partner_user_id,
        "calendarWeek": planning_date.isocalendar().week,
        "startDate": planning_date.isoformat(),
        "endDate": planning_date.isoformat(),
        "notes": "Partnerprojekt für Listenansicht",
        "status": "Bestaetigt",
        "days": [
            {
                "planningDate": planning_date.isoformat(),
                "weekday": "Donnerstag",
                "items": [{"categoryKey": "iPad", "qty": 8, "notes": None}],
            }
        ],
    }
    owner_payload = {
        "customerName": f"Kunde Listen Owner {suffix}",
        "projectName": f"Projekt Listen Owner {suffix}",
        "eventName": "Ownerliste",
        "projectManagerUserId": owner_user_id,
        "calendarWeek": planning_date.isocalendar().week,
        "startDate": planning_date.isoformat(),
        "endDate": planning_date.isoformat(),
        "notes": "Ownerprojekt für Listenansicht",
        "status": "Bestaetigt",
        "days": [
            {
                "planningDate": planning_date.isoformat(),
                "weekday": "Donnerstag",
                "items": [{"categoryKey": "iPad", "qty": 30, "notes": None}],
            }
        ],
    }

    created_partner = client.post("/api/wms/planning", headers=_headers(client, "Projektmanager", partner_user_id), json=partner_payload)
    created_owner = client.post("/api/wms/planning", headers=_headers(client, "Projektmanager", owner_user_id), json=owner_payload)
    assert created_partner.status_code == 200
    assert created_owner.status_code == 200

    owner_id = created_owner.json()["id"]
    partner_id = created_partner.json()["id"]

    existing_owner = client.get(f"/api/wms/planning/{owner_id}", headers=_headers(client, "Projektmanager", owner_user_id))
    assert existing_owner.status_code == 200
    update_payload = existing_owner.json()
    update_payload["days"][0]["items"][0]["handoverEnabled"] = True
    update_payload["days"][0]["items"][0]["linkedPlanningId"] = partner_id
    update_payload["days"][0]["items"][0]["handoverNote"] = "Verbund für Listenansicht"

    updated = client.put(
        f"/api/wms/planning/{owner_id}",
        headers=_headers(client, "Projektmanager", owner_user_id),
        json=update_payload,
    )
    assert updated.status_code == 200

    planning_list = client.get("/api/wms/planning", headers=_headers(client, "Admin"))
    assert planning_list.status_code == 200
    items_by_id = {item["id"]: item for item in planning_list.json()}

    owner_summary = items_by_id[owner_id]["handoverSummary"]
    assert owner_summary["direction"] == "outgoing"
    assert owner_summary["partnerPlanningId"] == partner_id
    assert owner_summary["partnerPlanningLabel"].startswith("Projekt Listen Partner")
    assert "iPad" in owner_summary["categoryKeys"]

    partner_summary = items_by_id[partner_id]["handoverSummary"]
    assert partner_summary["direction"] == "incoming"
    assert partner_summary["partnerPlanningId"] == owner_id
    assert partner_summary["partnerPlanningLabel"].startswith("Projekt Listen Owner")
    assert "iPad" in partner_summary["categoryKeys"]


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


def test_overview_open_conflicts_are_global_and_refresh_with_handover_resolution() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    category_name = f"KonfliktKategorie-{suffix}"
    source_date = date(2099, 5, 10)
    target_date = source_date + timedelta(days=1)

    created_category = client.post("/api/wms/categories", headers=_headers(client, "Admin"), json={"name": category_name})
    assert created_category.status_code == 200
    category = created_category.json()["name"]

    baseline_overview = client.get("/api/wms/overview", headers=_headers(client, "Admin"))
    assert baseline_overview.status_code == 200
    baseline_count = int((baseline_overview.json().get("planningSummary") or {}).get("openConflictCount") or 0)

    payload_source = {
        "customerName": f"Kunde Global Source {suffix}",
        "projectName": f"Projekt Global Source {suffix}",
        "eventName": "Global Source",
        "projectManagerUserId": f"pm-global-source-{suffix}",
        "calendarWeek": source_date.isocalendar().week,
        "startDate": source_date.isoformat(),
        "endDate": source_date.isoformat(),
        "notes": "Quelle für Übergabe",
        "status": "Geplant",
        "days": [
            {
                "planningDate": source_date.isoformat(),
                "weekday": "Montag",
                "items": [{"categoryKey": category, "qty": 1, "notes": None}],
            }
        ],
    }
    payload_target = {
        "customerName": f"Kunde Global Target {suffix}",
        "projectName": f"Projekt Global Target {suffix}",
        "eventName": "Global Target",
        "projectManagerUserId": f"pm-global-target-{suffix}",
        "calendarWeek": target_date.isocalendar().week,
        "startDate": target_date.isoformat(),
        "endDate": target_date.isoformat(),
        "notes": "Soll per Übergabe aufgelöst werden",
        "status": "Bestaetigt",
        "days": [
            {
                "planningDate": target_date.isoformat(),
                "weekday": "Dienstag",
                "items": [{"categoryKey": category, "qty": 1, "notes": None}],
            }
        ],
    }

    created_source = client.post(
        "/api/wms/planning",
        headers=_headers(client, "Projektmanager", f"pm-global-source-{suffix}"),
        json=payload_source,
    )
    created_target = client.post(
        "/api/wms/planning",
        headers=_headers(client, "Projektmanager", f"pm-global-target-{suffix}"),
        json=payload_target,
    )
    assert created_source.status_code == 200
    assert created_target.status_code == 200
    source_id = created_source.json()["id"]
    target_id = created_target.json()["id"]

    overview_with_conflicts = client.get("/api/wms/overview", headers=_headers(client, "Admin"))
    assert overview_with_conflicts.status_code == 200
    with_conflicts_count = int((overview_with_conflicts.json().get("planningSummary") or {}).get("openConflictCount") or 0)
    assert with_conflicts_count == baseline_count + 2

    # Opening or loading one planning detail must not change the global counter.
    fetched_target = client.get(
        f"/api/wms/planning/{target_id}",
        headers=_headers(client, "Projektmanager", f"pm-global-target-{suffix}"),
    )
    assert fetched_target.status_code == 200
    fetched_target_availability = client.get(
        f"/api/wms/planning/{target_id}/availability",
        headers=_headers(client, "Projektmanager", f"pm-global-target-{suffix}"),
    )
    assert fetched_target_availability.status_code == 200
    overview_after_open = client.get("/api/wms/overview", headers=_headers(client, "Admin"))
    assert overview_after_open.status_code == 200
    after_open_count = int((overview_after_open.json().get("planningSummary") or {}).get("openConflictCount") or 0)
    assert after_open_count == with_conflicts_count

    # Resolve target shortage via valid handover from source planning (previous day).
    update_payload = fetched_target.json()
    update_payload["days"][0]["items"][0]["handoverEnabled"] = True
    update_payload["days"][0]["items"][0]["linkedPlanningId"] = source_id
    update_payload["days"][0]["items"][0]["handoverNote"] = "Verbund aktiv"
    updated_target = client.put(
        f"/api/wms/planning/{target_id}",
        headers=_headers(client, "Projektmanager", f"pm-global-target-{suffix}"),
        json=update_payload,
    )
    assert updated_target.status_code == 200

    overview_after_resolution = client.get("/api/wms/overview", headers=_headers(client, "Admin"))
    assert overview_after_resolution.status_code == 200
    after_resolution_count = int((overview_after_resolution.json().get("planningSummary") or {}).get("openConflictCount") or 0)
    assert after_resolution_count == baseline_count + 1

    # If source planning is completed, handover is no longer valid and target conflict re-opens.
    closed_source = client.post(
        f"/api/wms/planning/{source_id}/status",
        headers=_headers(client, "Projektmanager", f"pm-global-source-{suffix}"),
        json={"status": "Abgeschlossen"},
    )
    assert closed_source.status_code == 200

    overview_after_source_close = client.get("/api/wms/overview", headers=_headers(client, "Admin"))
    assert overview_after_source_close.status_code == 200
    after_source_close_count = int((overview_after_source_close.json().get("planningSummary") or {}).get("openConflictCount") or 0)
    assert after_source_close_count == baseline_count + 1

    # Completed target planning must be excluded from active conflict counting.
    closed_target = client.post(
        f"/api/wms/planning/{target_id}/status",
        headers=_headers(client, "Projektmanager", f"pm-global-target-{suffix}"),
        json={"status": "Abgeschlossen"},
    )
    assert closed_target.status_code == 200

    overview_after_target_close = client.get("/api/wms/overview", headers=_headers(client, "Admin"))
    assert overview_after_target_close.status_code == 200
    after_target_close_count = int((overview_after_target_close.json().get("planningSummary") or {}).get("openConflictCount") or 0)
    assert after_target_close_count == baseline_count


def test_overview_contains_planning_summary_separate_from_inventory_status() -> None:
    client = TestClient(app)
    response = client.get("/api/wms/overview", headers=_headers(client, "Admin"))
    assert response.status_code == 200
    summary = response.json().get("planningSummary")
    assert isinstance(summary, dict)
    assert "todayPlannedQty" in summary
    assert "todayShortageCount" in summary
    assert "openConflictCount" in summary
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

