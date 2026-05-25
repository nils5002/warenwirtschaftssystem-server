"""Schritt A: Ein verliehenes Eigengerät darf die Einsatzplanung nur INNERHALB
seines Ausleihzeitraums (bis einschließlich erwartetem Rückgabetag) blockieren —
nicht datumsunabhängig den gesamten künftigen Planungshorizont.

Hintergrund (reproduzierter Livetest-Bug): Eine eintägige Ausgabe am 28.05.2026
erzeugte künstliche Konflikte bei späteren Planungen (08.06., 17.06.), weil
``_is_asset_usable_on_date`` ein ``Verliehen``-Eigengerät an JEDEM Tag aus dem
nutzbaren Bestand entfernte.
"""

from __future__ import annotations

from datetime import date, timedelta
from types import SimpleNamespace
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from app.repositories import planning_repository as pr
from .auth_helpers import auth_headers


# --------------------------------------------------------------------------- #
# Unit-Tests: die reine Datumslogik (schnell, ohne DB/HTTP)
# --------------------------------------------------------------------------- #
def _asset(**kwargs) -> SimpleNamespace:
    base = dict(
        status="Verliehen",
        ownership_type="owned",
        expected_return_date=None,
        next_return="-",
        returned_at=None,
        available_from=None,
        available_until=None,
    )
    base.update(kwargs)
    return SimpleNamespace(**base)


def test_parse_loose_date_iso_and_german_and_garbage() -> None:
    assert pr._parse_loose_date("2026-05-23") == date(2026, 5, 23)
    assert pr._parse_loose_date("21.5.2026") == date(2026, 5, 21)
    assert pr._parse_loose_date("03.11.2026") == date(2026, 11, 3)
    assert pr._parse_loose_date(date(2026, 1, 1)) == date(2026, 1, 1)
    # Freitext / leer / unparsebar -> None (defensiv, NICHT blind raten)
    assert pr._parse_loose_date("-") is None
    assert pr._parse_loose_date("") is None
    assert pr._parse_loose_date("bald") is None
    assert pr._parse_loose_date("32.13.2026") is None
    assert pr._parse_loose_date(None) is None


def test_verliehen_owned_blocks_within_window_but_not_after() -> None:
    ret = date(2026, 5, 23)
    asset = _asset(expected_return_date=ret)
    # bis EINSCHLIESSLICH Rückgabetag blockiert
    assert pr._is_asset_usable_on_date(asset, ret - timedelta(days=1)) is False
    assert pr._is_asset_usable_on_date(asset, ret) is False
    # ab dem Tag DANACH wieder nutzbar
    assert pr._is_asset_usable_on_date(asset, ret + timedelta(days=1)) is True
    assert pr._is_asset_usable_on_date(asset, ret + timedelta(days=30)) is True


def test_verliehen_owned_falls_back_to_next_return_for_legacy_data() -> None:
    # Altbestand/Backup ohne strukturiertes Feld: next_return wird defensiv genutzt.
    asset = _asset(expected_return_date=None, next_return="2026-05-23")
    assert pr._is_asset_usable_on_date(asset, date(2026, 6, 8)) is True
    assert pr._is_asset_usable_on_date(asset, date(2026, 5, 22)) is False


def test_verliehen_owned_without_reliable_date_stays_blocked() -> None:
    # Kein zuverlässiges Rückgabedatum -> konservativ blockiert (bisheriges Verhalten).
    asset = _asset(expected_return_date=None, next_return="-")
    assert pr._is_asset_usable_on_date(asset, date(2099, 1, 1)) is False


def test_defekt_owned_stays_blocked_regardless_of_date() -> None:
    asset = _asset(status="Defekt", expected_return_date=date(2026, 5, 23))
    assert pr._is_asset_usable_on_date(asset, date(2026, 12, 31)) is False


def test_fremdbestand_logic_unchanged() -> None:
    # Fremdbestand ignoriert expected_return_date und nutzt weiterhin sein Fenster.
    asset = _asset(
        status="Verfuegbar",
        ownership_type="rented",
        available_from=date(2026, 6, 1),
        available_until=date(2026, 6, 30),
        expected_return_date=date(2026, 5, 23),
    )
    assert pr._is_asset_usable_on_date(asset, date(2026, 5, 31)) is False  # vor Fenster
    assert pr._is_asset_usable_on_date(asset, date(2026, 6, 15)) is True   # im Fenster
    assert pr._is_asset_usable_on_date(asset, date(2026, 7, 1)) is False   # nach Fenster


# --------------------------------------------------------------------------- #
# Integrationstests: voller Pfad Checkout -> Availability/Konflikt über die API
# --------------------------------------------------------------------------- #
def _headers(client: TestClient, role: str, user_id: str | None = None) -> dict[str, str]:
    return auth_headers(client, role, user_id=user_id)


def _reset(client: TestClient) -> None:
    res = client.post("/api/wms/backup/reset-for-import", headers=_headers(client, "Admin"))
    assert res.status_code == 200, res.text


def _switch_payload(suffix: str, index: int) -> dict:
    return {
        "id": f"asset-loan-{suffix}-{index}",
        "name": f"Switch {suffix}-{index}",
        "category": "Switch",
        "location": "Hauptlager",
        "status": "Verfuegbar",
        "assignedTo": "-",
        "nextReturn": "-",
        "tagNumber": f"TAG-LOAN-{suffix}-{index}",
        "serialNumber": f"SN-LOAN-{suffix}-{index}",
        "qrCode": "",
        "maintenanceState": "Neu",
        "notes": "",
        "lastCheckout": "-",
        "nextReservation": "-",
    }


def _create_switches(client: TestClient, suffix: str, count: int) -> list[dict]:
    headers = _headers(client, "Admin")
    created = []
    for index in range(count):
        payload = _switch_payload(suffix, index)
        res = client.post("/api/wms/assets", headers=headers, json=payload)
        assert res.status_code == 200, res.text
        created.append(res.json())
    return created


def _checkout(client: TestClient, asset: dict, next_return: str) -> dict:
    headers = _headers(client, "Admin")
    payload = dict(asset)
    payload["status"] = "Verliehen"
    payload["assignedTo"] = "- · VB Ruhr Mitte · Vertreterversammlung"
    payload["nextReturn"] = next_return
    res = client.post("/api/wms/assets", headers=headers, json=payload)
    assert res.status_code == 200, res.text
    return res.json()


def _create_switch_planning(client: TestClient, suffix: str, planning_day: date, qty: int) -> str:
    pm_user_id = f"pm-loan-{suffix}"
    payload = {
        "customerName": f"Kunde Loan {suffix}",
        "projectName": f"Projekt Loan {suffix}",
        "eventName": "Loan-Test",
        "projectManagerUserId": pm_user_id,
        "calendarWeek": planning_day.isocalendar().week,
        "startDate": planning_day.isoformat(),
        "endDate": planning_day.isoformat(),
        "notes": "",
        "status": "Geplant",
        "days": [
            {
                "planningDate": planning_day.isoformat(),
                "weekday": "Montag",
                "items": [{"categoryKey": "Switch", "qty": qty, "notes": None}],
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


def _switch_item(client: TestClient, planning_id: str, suffix: str) -> dict:
    res = client.get(
        f"/api/wms/planning/{planning_id}/availability",
        headers=_headers(client, "Projektmanager", user_id=f"pm-loan-{suffix}"),
    )
    assert res.status_code == 200, res.text
    items = [it for it in res.json()["items"] if it["categoryKey"] == "Switch"]
    assert items, "Switch-Item muss in der Availability-Antwort enthalten sein"
    return items[0]


def test_checkout_does_not_block_planning_after_return_date() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)

    switches = _create_switches(client, suffix, count=2)
    return_day = date.today() + timedelta(days=2)
    _checkout(client, switches[0], next_return=return_day.isoformat())

    # Planung lange NACH der Rückgabe -> beide Switches nutzbar, kein Engpass.
    planning_after = _create_switch_planning(
        client, suffix, planning_day=return_day + timedelta(days=14), qty=2
    )
    item = _switch_item(client, planning_after, suffix)
    assert item["usableStock"] == 2, item
    assert item["shortageQty"] == 0, item
    assert item["hasGlobalShortage"] is False, item


def test_checkout_still_blocks_planning_within_loan_window() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)

    switches = _create_switches(client, suffix, count=2)
    return_day = date.today() + timedelta(days=5)
    _checkout(client, switches[0], next_return=return_day.isoformat())

    # Planung INNERHALB des Ausleihzeitraums -> nur 1 Switch nutzbar, Fehlmenge 1.
    planning_within = _create_switch_planning(
        client, suffix, planning_day=return_day - timedelta(days=1), qty=2
    )
    item = _switch_item(client, planning_within, suffix)
    assert item["usableStock"] == 1, item
    assert item["shortageQty"] == 1, item


def test_checkout_sets_and_checkin_clears_expected_return_date() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)

    switch = _create_switches(client, suffix, count=1)[0]
    return_day = date.today() + timedelta(days=3)

    # Checkout ohne strukturiertes Feld -> Server leitet es aus nextReturn ab.
    out = _checkout(client, switch, next_return=return_day.isoformat())
    assert out["expectedReturnDate"] == return_day.isoformat(), out

    # Checkin -> Sperre wird wieder aufgehoben.
    checkin = dict(out)
    checkin["status"] = "Verfuegbar"
    checkin["assignedTo"] = "-"
    checkin["nextReturn"] = "-"
    res = client.post("/api/wms/assets", headers=_headers(client, "Admin"), json=checkin)
    assert res.status_code == 200, res.text
    assert res.json()["expectedReturnDate"] is None, res.json()
