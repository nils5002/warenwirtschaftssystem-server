"""Kartendrucker-Mindestbedarf-Kopplung: pro geplantem Kartendrucker wird
mindestens 1 kompatibler Laptop benötigt (1:1).

Effektiver Laptop-Bedarf pro Tag = max(planned_laptop_qty, planned_card_printer_qty).
Die existierende "nur-kompatible-Laptops"-Pool-Restriktion bleibt unverändert.
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
        "id": f"asset-cpu-{suffix}-{index}",
        "name": f"Gerät {suffix}-{index}",
        "category": category,
        "location": "Hauptlager",
        "status": "Verfuegbar",
        "assignedTo": "-",
        "nextReturn": "-",
        "tagNumber": f"TAG-CPU-{suffix}-{index}",
        "serialNumber": f"SN-CPU-{suffix}-{index}",
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
    compatible_laptops: int = 0,
    incompatible_laptops: int = 0,
    server_laptops: int = 0,
    card_printers: int = 0,
) -> None:
    headers = _headers(client, "Admin")
    index = 0

    def _post(payload: dict) -> None:
        res = client.post("/api/wms/assets", headers=headers, json=payload)
        assert res.status_code == 200, res.text

    for _ in range(compatible_laptops):
        index += 1
        _post(_make_asset_payload(
            suffix=suffix, index=index, category="Laptop",
            card_printer_compatible=True, available_for_planning=True,
        ))
    for _ in range(incompatible_laptops):
        index += 1
        _post(_make_asset_payload(
            suffix=suffix, index=index, category="Laptop",
            card_printer_compatible=False, available_for_planning=True,
        ))
    for _ in range(server_laptops):
        index += 1
        _post(_make_asset_payload(
            suffix=suffix, index=index, category="Laptop",
            available_for_planning=False, card_printer_compatible=True,
        ))
    for _ in range(card_printers):
        index += 1
        _post(_make_asset_payload(
            suffix=suffix, index=index, category="Kartendrucker",
        ))


def _create_planning(
    client: TestClient,
    suffix: str,
    *,
    laptop_qty: int,
    card_printer_qty: int,
) -> str:
    pm_user_id = f"pm-cpu-{suffix}"
    planning_date = date.today() + timedelta(days=21)
    items: list[dict] = []
    if laptop_qty > 0:
        items.append({"categoryKey": "Laptop", "qty": laptop_qty, "notes": None})
    if card_printer_qty > 0:
        items.append({"categoryKey": "Kartendrucker", "qty": card_printer_qty, "notes": None})
    payload = {
        "customerName": f"Kunde CPU {suffix}",
        "projectName": f"Projekt CPU {suffix}",
        "eventName": "CPU-Test",
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
        headers=_headers(client, "Projektmanager", user_id=f"pm-cpu-{suffix}"),
    )
    assert res.status_code == 200, res.text
    return res.json()


def _laptop_item(payload: dict) -> dict:
    items = [item for item in payload["items"] if item["categoryKey"] == "Laptop"]
    assert items, f"Laptop-Item muss in der Verfügbarkeitsantwort enthalten sein: {payload}"
    return items[0]


# Test 1: Bestand reicht 1:1 — kein Uplift, keine Fehlmenge.
def test_compatible_matches_card_printer_count_no_uplift() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]

    _reset(client)
    _create_assets(client, suffix, compatible_laptops=3, incompatible_laptops=7, card_printers=3)
    planning_id = _create_planning(client, suffix, laptop_qty=3, card_printer_qty=3)

    payload = _availability(client, planning_id, suffix)
    laptop = _laptop_item(payload)

    assert laptop["cardPrinterRequiredQty"] == 3, laptop
    assert laptop["cardPrinterUpliftQty"] == 0, laptop
    assert laptop["requestedQty"] == 3
    assert laptop["usableStock"] == 3
    assert laptop["shortageQty"] == 0
    assert laptop["excludedQty"] == 7


# Test 2: Bestand zu klein — kein Uplift (Bedarf >= Kartendrucker), Fehlmenge 1.
def test_shortage_without_uplift() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]

    _reset(client)
    _create_assets(client, suffix, compatible_laptops=2, incompatible_laptops=7, card_printers=3)
    planning_id = _create_planning(client, suffix, laptop_qty=3, card_printer_qty=3)

    payload = _availability(client, planning_id, suffix)
    laptop = _laptop_item(payload)

    assert laptop["cardPrinterUpliftQty"] == 0
    assert laptop["requestedQty"] == 3
    assert laptop["usableStock"] == 2
    assert laptop["shortageQty"] == 1
    assert laptop["excludedQty"] == 7


# Test 3: User plant zu wenig Laptops — Uplift +2, Bestand reicht.
def test_uplift_no_shortage() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]

    _reset(client)
    _create_assets(client, suffix, compatible_laptops=3, incompatible_laptops=7, card_printers=3)
    planning_id = _create_planning(client, suffix, laptop_qty=1, card_printer_qty=3)

    payload = _availability(client, planning_id, suffix)
    laptop = _laptop_item(payload)

    assert laptop["cardPrinterRequiredQty"] == 3
    assert laptop["cardPrinterUpliftQty"] == 2  # 3 - 1
    assert laptop["requestedQty"] == 3  # angehoben
    assert laptop["usableStock"] == 3
    assert laptop["shortageQty"] == 0


# Test 4: User plant zu wenig Laptops UND Bestand zu klein — Uplift + Fehlmenge.
def test_uplift_with_shortage() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]

    _reset(client)
    _create_assets(client, suffix, compatible_laptops=1, incompatible_laptops=7, card_printers=3)
    planning_id = _create_planning(client, suffix, laptop_qty=1, card_printer_qty=3)

    payload = _availability(client, planning_id, suffix)
    laptop = _laptop_item(payload)

    assert laptop["cardPrinterRequiredQty"] == 3
    assert laptop["cardPrinterUpliftQty"] == 2
    assert laptop["requestedQty"] == 3
    assert laptop["usableStock"] == 1
    assert laptop["shortageQty"] == 2
    assert laptop["excludedQty"] == 7


# Test 5: Planung ohne Kartendrucker — MacBook Neo zählen normal mit, kein Uplift.
def test_no_card_printer_no_uplift() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]

    _reset(client)
    _create_assets(client, suffix, compatible_laptops=1, incompatible_laptops=7)
    planning_id = _create_planning(client, suffix, laptop_qty=4, card_printer_qty=0)

    payload = _availability(client, planning_id, suffix)
    laptop = _laptop_item(payload)

    assert laptop["cardPrinterRequiredQty"] == 0
    assert laptop["cardPrinterUpliftQty"] == 0
    assert laptop["requestedQty"] == 4
    # Ohne Kartendrucker zählen alle 8 Laptops mit.
    assert laptop["usableStock"] == 8
    assert laptop["excludedQty"] == 0
    assert laptop["shortageQty"] == 0


# Test 6: Server-Laptops global ausgeschlossen, Uplift greift trotzdem über
# die verbleibenden kompatiblen Laptops.
def test_uplift_with_server_laptops_excluded() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]

    _reset(client)
    # 2 Server (global aus) + 3 kompatibel + 7 MacBook + 3 Kartendrucker.
    # Bedarf: 1 Laptop + 3 Kartendrucker → Uplift 1→3.
    _create_assets(
        client, suffix,
        server_laptops=2,
        compatible_laptops=3,
        incompatible_laptops=7,
        card_printers=3,
    )
    planning_id = _create_planning(client, suffix, laptop_qty=1, card_printer_qty=3)

    payload = _availability(client, planning_id, suffix)
    laptop = _laptop_item(payload)

    # 12 physisch − 2 Server = 10 im Planungs-Universum.
    assert laptop["totalStock"] == 10
    assert laptop["excludedFromPlanningQty"] == 2
    # Von den 10 sind 7 wegen Kartendrucker inkompatibel, 3 nutzbar.
    assert laptop["usableStock"] == 3
    assert laptop["excludedQty"] == 7
    assert laptop["cardPrinterRequiredQty"] == 3
    assert laptop["cardPrinterUpliftQty"] == 2
    assert laptop["requestedQty"] == 3
    assert laptop["shortageQty"] == 0


# Test 7 (Edge-Case Synthesis): Planung enthält 0 Laptops + 2 Kartendrucker
# → Laptop-Zeile wird synthetisiert, requestedQty=2 (komplett aus Uplift).
def test_synthesizes_laptop_row_when_only_card_printers_planned() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]

    _reset(client)
    _create_assets(client, suffix, compatible_laptops=2, card_printers=2)
    planning_id = _create_planning(client, suffix, laptop_qty=0, card_printer_qty=2)

    payload = _availability(client, planning_id, suffix)

    # Die Laptop-Zeile MUSS entstehen, obwohl der User keine Laptops geplant hat.
    laptop = _laptop_item(payload)
    assert laptop["cardPrinterRequiredQty"] == 2
    assert laptop["cardPrinterUpliftQty"] == 2
    assert laptop["requestedQty"] == 2
    assert laptop["usableStock"] == 2
    assert laptop["shortageQty"] == 0
