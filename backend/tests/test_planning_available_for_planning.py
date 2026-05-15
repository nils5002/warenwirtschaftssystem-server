"""Globaler Planungs-Ausschluss: ``available_for_planning=False`` muss ein
Asset komplett aus der Einsatzplanung entfernen — vor dem
Kartendrucker-Filter und unabhängig von Status oder Kategorie.

Hauptszenario aus dem fachlichen Auftrag:
- 10 Laptops physisch im Inventar
  - 2 Server-Laptops (available_for_planning=False)
  - 7 MacBook Neo (available_for_planning=True, card_printer_compatible=False)
  - 1 normaler Laptop (beide True)
- 1 Kartendrucker
- Planung: 5 Laptops + 1 Kartendrucker
- Erwartung: usableStock=1, excludedFromPlanningQty=2, excludedQty=7,
  shortageQty=4
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


def _make_asset_payload(
    *,
    suffix: str,
    index: int,
    category: str,
    card_printer_compatible: bool = True,
    available_for_planning: bool = True,
) -> dict:
    return {
        "id": f"asset-afp-{suffix}-{index}",
        "name": f"Gerät {suffix}-{index}",
        "category": category,
        "location": "Hauptlager",
        "status": "Verfuegbar",
        "assignedTo": "-",
        "nextReturn": "-",
        "tagNumber": f"TAG-AFP-{suffix}-{index}",
        "serialNumber": f"SN-AFP-{suffix}-{index}",
        "qrCode": "",
        "maintenanceState": "Neu",
        "notes": "",
        "lastCheckout": "-",
        "nextReservation": "-",
        "cardPrinterCompatible": card_printer_compatible,
        "availableForPlanning": available_for_planning,
    }


def _create_assets(
    client: TestClient,
    suffix: str,
    *,
    server_laptops: int = 0,
    macbook_neo_laptops: int = 0,
    normal_laptops: int = 0,
    card_printers: int = 0,
) -> None:
    headers = _headers(client, "Admin")
    index = 0

    def _post(payload: dict) -> None:
        res = client.post("/api/wms/assets", headers=headers, json=payload)
        assert res.status_code == 200, res.text

    for _ in range(server_laptops):
        index += 1
        _post(_make_asset_payload(
            suffix=suffix,
            index=index,
            category="Laptop",
            available_for_planning=False,
            card_printer_compatible=True,
        ))
    for _ in range(macbook_neo_laptops):
        index += 1
        _post(_make_asset_payload(
            suffix=suffix,
            index=index,
            category="Laptop",
            available_for_planning=True,
            card_printer_compatible=False,
        ))
    for _ in range(normal_laptops):
        index += 1
        _post(_make_asset_payload(
            suffix=suffix,
            index=index,
            category="Laptop",
            available_for_planning=True,
            card_printer_compatible=True,
        ))
    for _ in range(card_printers):
        index += 1
        _post(_make_asset_payload(
            suffix=suffix,
            index=index,
            category="Kartendrucker",
        ))


def _create_planning(
    client: TestClient,
    suffix: str,
    *,
    laptop_qty: int,
    card_printer_qty: int,
) -> str:
    pm_user_id = f"pm-afp-{suffix}"
    planning_date = date.today() + timedelta(days=21)
    items = [{"categoryKey": "Laptop", "qty": laptop_qty, "notes": None}]
    if card_printer_qty > 0:
        items.append({"categoryKey": "Kartendrucker", "qty": card_printer_qty, "notes": None})
    payload = {
        "customerName": f"Kunde AFP {suffix}",
        "projectName": f"Projekt AFP {suffix}",
        "eventName": "AFP-Test",
        "projectManagerUserId": pm_user_id,
        "calendarWeek": planning_date.isocalendar().week,
        "startDate": planning_date.isoformat(),
        "endDate": planning_date.isoformat(),
        "notes": "",
        "status": "Entwurf",
        "days": [
            {
                "planningDate": planning_date.isoformat(),
                "weekday": "Montag",
                "items": items,
            }
        ],
    }
    res = client.post(
        "/api/wms/planning",
        headers=_headers(client, "Projektmanager", user_id=pm_user_id),
        json=payload,
    )
    assert res.status_code == 200, res.text
    return res.json()["id"]


def _availability(client: TestClient, planning_id: str, suffix: str) -> dict:
    res = client.get(
        f"/api/wms/planning/{planning_id}/availability",
        headers=_headers(client, "Projektmanager", user_id=f"pm-afp-{suffix}"),
    )
    assert res.status_code == 200, res.text
    return res.json()


def _laptop_item(payload: dict) -> dict:
    items = [item for item in payload["items"] if item["categoryKey"] == "Laptop"]
    assert items, "Laptop-Item muss in der Verfügbarkeitsantwort enthalten sein"
    return items[0]


def _laptop_summary(payload: dict) -> dict:
    items = [item for item in payload["categorySummary"] if item["categoryKey"] == "Laptop"]
    assert items, "Laptop-Summary muss enthalten sein"
    return items[0]


# 1. Asset mit available_for_planning=False zählt nicht in Planning Availability.
def test_non_planable_asset_not_counted_in_availability() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]

    _reset(client)
    _create_assets(client, suffix, server_laptops=2, normal_laptops=3)
    planning_id = _create_planning(client, suffix, laptop_qty=4, card_printer_qty=0)

    payload = _availability(client, planning_id, suffix)
    laptop = _laptop_item(payload)

    # 5 physisch im Inventar, aber 2 server zählen nicht → totalStock=3.
    assert laptop["totalStock"] == 3, laptop
    assert laptop["usableStock"] == 3, laptop
    assert laptop["excludedFromPlanningQty"] == 2, laptop
    assert laptop["excludedQty"] == 0, laptop
    # Bedarf 4, nutzbar 3 → Fehlmenge 1.
    assert laptop["shortageQty"] == 1, laptop

    summary = _laptop_summary(payload)
    assert summary["totalStock"] == 3
    assert summary["usableStock"] == 3
    assert summary["excludedFromPlanningTotal"] == 2


# 2. Asset mit available_for_planning=False zählt auch dann nicht, wenn Status
#    verfügbar UND ansonsten kompatibel wäre.
def test_non_planable_asset_excluded_even_if_otherwise_compatible() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]

    _reset(client)
    # 2 Server-Laptops (kompatibel mit Kartendrucker, aber nicht planbar) +
    # 1 normaler Laptop. Ohne Kartendrucker im Projekt darf der Compat-Filter
    # nichts ändern; nur der Global-Filter greift.
    _create_assets(client, suffix, server_laptops=2, normal_laptops=1)
    planning_id = _create_planning(client, suffix, laptop_qty=3, card_printer_qty=0)

    payload = _availability(client, planning_id, suffix)
    laptop = _laptop_item(payload)

    assert laptop["usableStock"] == 1
    assert laptop["excludedFromPlanningQty"] == 2
    assert laptop["excludedQty"] == 0
    # Bedarf 3, nutzbar 1 → Fehlmenge 2.
    assert laptop["shortageQty"] == 2


# 3. Hauptszenario aus dem User-Auftrag: 10 Laptops (2 Server, 7 MacBook Neo,
#    1 normal) + 1 Kartendrucker; Bedarf 5 Laptops + 1 Kartendrucker.
def test_combined_server_macbook_card_printer_scenario() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]

    _reset(client)
    _create_assets(
        client, suffix,
        server_laptops=2,
        macbook_neo_laptops=7,
        normal_laptops=1,
        card_printers=1,
    )
    planning_id = _create_planning(client, suffix, laptop_qty=5, card_printer_qty=1)

    payload = _availability(client, planning_id, suffix)
    laptop = _laptop_item(payload)

    # 10 physisch − 2 global ausgeschlossen = 8 im Planungs-Universum.
    assert laptop["totalStock"] == 8, laptop
    assert laptop["excludedFromPlanningQty"] == 2, laptop
    # Von den 8 sind 7 wegen Kartendrucker inkompatibel, 1 ist nutzbar.
    assert laptop["usableStock"] == 1, laptop
    assert laptop["excludedQty"] == 7, laptop
    # Bedarf 5, nutzbar 1 → Fehlmenge 4.
    assert laptop["shortageQty"] == 4, laptop
    assert laptop["hasGlobalShortage"] is True

    summary = _laptop_summary(payload)
    assert summary["totalStock"] == 8
    assert summary["usableStock"] == 1
    assert summary["excludedFromUsable"] == 7
    assert summary["excludedFromPlanningTotal"] == 2


# 4. Planung OHNE Kartendrucker: Server ausgeschlossen, MacBook Neo zählen mit.
def test_no_card_printer_planning_excludes_servers_includes_macbook() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]

    _reset(client)
    _create_assets(
        client, suffix,
        server_laptops=2,
        macbook_neo_laptops=7,
        normal_laptops=1,
    )
    planning_id = _create_planning(client, suffix, laptop_qty=5, card_printer_qty=0)

    payload = _availability(client, planning_id, suffix)
    laptop = _laptop_item(payload)

    # Ohne Kartendrucker → MacBook Neo zählen normal.
    # 10 physisch − 2 server = 8 nutzbar.
    assert laptop["totalStock"] == 8
    assert laptop["usableStock"] == 8
    assert laptop["excludedFromPlanningQty"] == 2
    assert laptop["excludedQty"] == 0
    assert laptop["shortageQty"] == 0


# 5. Planung MIT Kartendrucker: Server + MacBook Neo ausgeschlossen.
def test_with_card_printer_planning_excludes_both() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]

    _reset(client)
    _create_assets(
        client, suffix,
        server_laptops=2,
        macbook_neo_laptops=7,
        normal_laptops=3,
        card_printers=1,
    )
    planning_id = _create_planning(client, suffix, laptop_qty=4, card_printer_qty=1)

    payload = _availability(client, planning_id, suffix)
    laptop = _laptop_item(payload)

    # 12 physisch − 2 server = 10 im Planungs-Universum.
    assert laptop["totalStock"] == 10
    assert laptop["excludedFromPlanningQty"] == 2
    # Von den 10 sind 7 wegen Kartendrucker inkompatibel, 3 nutzbar.
    assert laptop["usableStock"] == 3
    assert laptop["excludedQty"] == 7
    # Bedarf 4, nutzbar 3 → Fehlmenge 1.
    assert laptop["shortageQty"] == 1
