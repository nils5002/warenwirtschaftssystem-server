"""Verfügbarkeitslogik: Laptops ohne Kartendrucker-Kompatibilität müssen
für Planungen mit Kartendrucker-Bedarf vom nutzbaren Bestand ausgeschlossen
werden.

Beispiel aus dem fachlichen Auftrag (MacBook Neo):
- 10 Laptops verfügbar, davon 7 inkompatibel (z. B. MacBook Neo)
- Projekt fordert 9 Laptops + 1 Kartendrucker
- Erwartung: usableStock=3 für Laptop, excludedQty=7, shortageQty=6
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
    """Saubere Ausgangslage — Bestand ist global, daher müssen wir den
    Test-DB-Stand zwischen Szenarien zurücksetzen."""
    res = client.post("/api/wms/backup/reset-for-import", headers=_headers(client, "Admin"))
    assert res.status_code == 200, res.text


def _make_asset_payload(
    *,
    suffix: str,
    index: int,
    category: str,
    card_printer_compatible: bool = True,
) -> dict:
    return {
        "id": f"asset-cpc-{suffix}-{index}",
        "name": f"Gerät {suffix}-{index}",
        "category": category,
        "location": "Hauptlager",
        "status": "Verfuegbar",
        "assignedTo": "-",
        "nextReturn": "-",
        "tagNumber": f"TAG-CPC-{suffix}-{index}",
        "serialNumber": f"SN-CPC-{suffix}-{index}",
        "qrCode": "",
        "maintenanceState": "Neu",
        "notes": "",
        "lastCheckout": "-",
        "nextReservation": "-",
        "cardPrinterCompatible": card_printer_compatible,
    }


def _create_assets(
    client: TestClient,
    suffix: str,
    *,
    laptops_compatible: int,
    laptops_incompatible: int,
    card_printers: int,
) -> None:
    headers = _headers(client, "Admin")
    index = 0
    for _ in range(laptops_compatible):
        index += 1
        res = client.post(
            "/api/wms/assets",
            headers=headers,
            json=_make_asset_payload(
                suffix=suffix, index=index, category="Laptop", card_printer_compatible=True
            ),
        )
        assert res.status_code == 200, res.text
    for _ in range(laptops_incompatible):
        index += 1
        res = client.post(
            "/api/wms/assets",
            headers=headers,
            json=_make_asset_payload(
                suffix=suffix, index=index, category="Laptop", card_printer_compatible=False
            ),
        )
        assert res.status_code == 200, res.text
    for _ in range(card_printers):
        index += 1
        res = client.post(
            "/api/wms/assets",
            headers=headers,
            json=_make_asset_payload(
                suffix=suffix, index=index, category="Kartendrucker", card_printer_compatible=True
            ),
        )
        assert res.status_code == 200, res.text


def _create_planning(
    client: TestClient,
    suffix: str,
    *,
    laptop_qty: int,
    card_printer_qty: int,
) -> str:
    pm_user_id = f"pm-cpc-{suffix}"
    planning_date = date.today() + timedelta(days=21)
    items = [{"categoryKey": "Laptop", "qty": laptop_qty, "notes": None}]
    if card_printer_qty > 0:
        items.append({"categoryKey": "Kartendrucker", "qty": card_printer_qty, "notes": None})
    payload = {
        "customerName": f"Kunde CPC {suffix}",
        "projectName": f"Projekt CPC {suffix}",
        "eventName": "Kompat-Test",
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
        headers=_headers(client, "Projektmanager", user_id=f"pm-cpc-{suffix}"),
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


def test_incompatible_laptops_excluded_when_card_printer_required() -> None:
    """User-Beispiel: 10 Laptops (7 inkompatibel), Bedarf 9 Laptops + 1 Kartendrucker."""
    client = TestClient(app)
    suffix = uuid4().hex[:8]

    _reset(client)
    _create_assets(client, suffix, laptops_compatible=3, laptops_incompatible=7, card_printers=1)
    planning_id = _create_planning(client, suffix, laptop_qty=9, card_printer_qty=1)

    payload = _availability(client, planning_id, suffix)

    laptop = _laptop_item(payload)
    assert laptop["totalStock"] == 10, laptop
    assert laptop["usableStock"] == 3, laptop
    assert laptop["excludedQty"] == 7, laptop
    assert laptop["requestedQty"] == 9, laptop
    # Bedarf 9 vs nutzbarer Bestand 3 → Fehlmenge 6.
    assert laptop["shortageQty"] == 6, laptop
    assert laptop["hasGlobalShortage"] is True

    summary = _laptop_summary(payload)
    assert summary["totalStock"] == 10
    assert summary["usableStock"] == 3
    assert summary["excludedFromUsable"] == 7


def test_incompatible_laptops_count_normally_without_card_printer() -> None:
    """Ohne Kartendrucker im Projekt zählen alle Laptops normal mit."""
    client = TestClient(app)
    suffix = uuid4().hex[:8]

    _reset(client)
    _create_assets(client, suffix, laptops_compatible=3, laptops_incompatible=7, card_printers=1)
    planning_id = _create_planning(client, suffix, laptop_qty=9, card_printer_qty=0)

    payload = _availability(client, planning_id, suffix)

    laptop = _laptop_item(payload)
    assert laptop["totalStock"] == 10
    assert laptop["usableStock"] == 10
    assert laptop["excludedQty"] == 0
    assert laptop["requestedQty"] == 9
    assert laptop["shortageQty"] == 0
    assert laptop["hasGlobalShortage"] is False

    summary = _laptop_summary(payload)
    assert summary["excludedFromUsable"] == 0


def test_incompatible_laptops_only_excluded_in_planning_with_card_printer() -> None:
    """Eine Planung mit Kartendrucker schließt inkompatible Laptops aus,
    eine parallele Planung ohne Kartendrucker zählt sie weiterhin mit.
    """
    client = TestClient(app)
    suffix_a = uuid4().hex[:8]
    suffix_b = uuid4().hex[:8]

    _reset(client)
    _create_assets(client, suffix_a, laptops_compatible=3, laptops_incompatible=7, card_printers=1)

    planning_with_printer = _create_planning(client, suffix_a, laptop_qty=5, card_printer_qty=1)
    planning_without_printer = _create_planning(client, suffix_b, laptop_qty=5, card_printer_qty=0)

    payload_a = _availability(client, planning_with_printer, suffix_a)
    payload_b = _availability(client, planning_without_printer, suffix_b)

    laptop_a = _laptop_item(payload_a)
    laptop_b = _laptop_item(payload_b)

    # Mit Kartendrucker → nur 3 kompatible Laptops nutzbar, Bedarf 5 → Fehlmenge 2.
    assert laptop_a["usableStock"] == 3
    assert laptop_a["excludedQty"] == 7
    assert laptop_a["shortageQty"] >= 2

    # Ohne Kartendrucker → alle 10 Laptops nutzbar, kein Ausschluss.
    assert laptop_b["usableStock"] == 10
    assert laptop_b["excludedQty"] == 0
