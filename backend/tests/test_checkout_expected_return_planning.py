"""F1: Ausgabe auf eine Planung bindet das erwartete Rückgabedatum an die
Planung (Parität zum Handover-Pfad) statt an den Frontend-Default "heute+2".

Hintergrund (reproduzierter Befund, Backup 2026-07-07): Geräte, die auf eine
mehrwöchige Planung ausgegeben wurden, trugen expected_return_date=heute+2 und
fielen dadurch MITTEN in der Projektlaufzeit zurück in den freien Bestand —
Über-Allokations-/Doppelbuchungsrisiko für überlappende Planungen.

Regeln (F1):
* Checkout mit assignedPlanningId und OHNE explizites expectedReturnDate
  ⇒ expected_return_date = letzter Belegungstag der Planung
    (``_blocking_end_exclusive(start, end, buffer) - 1 Tag``, Enddatum
    exklusiv — Handover-Parität), next_return = fachlicher Rückgabetag.
* Explizit mitgesendetes expectedReturnDate (bewusste manuelle Wahl) hat Vorrang.
* Checkout OHNE Planung ⇒ bisheriges Verhalten (next_return wird interpretiert).
* Nur der Checkout-ÜBERGANG bindet — spätere Edits eines bereits verliehenen
  Geräts überschreiben keine manuellen Korrekturen.
"""

from __future__ import annotations

import json
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


def _switch_payload(suffix: str, index: int) -> dict:
    return {
        "id": f"asset-f1-{suffix}-{index}",
        "name": f"Switch F1-{suffix}-{index}",
        "category": "Switch",
        "location": "Hauptlager",
        "status": "Verfuegbar",
        "assignedTo": "-",
        "nextReturn": "-",
        "tagNumber": f"TAG-F1-{suffix}-{index}",
        "serialNumber": f"SN-F1-{suffix}-{index}",
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
        res = client.post("/api/wms/assets", headers=headers, json=_switch_payload(suffix, index))
        assert res.status_code == 200, res.text
        created.append(res.json())
    return created


def _create_planning(
    client: TestClient,
    suffix: str,
    start: date,
    end: date,
    qty: int,
    *,
    buffer_days: int = 0,
    pm_suffix: str = "",
) -> str:
    pm_user_id = f"pm-f1-{suffix}{pm_suffix}"
    payload = {
        "customerName": f"Kunde F1 {suffix}{pm_suffix}",
        "projectName": f"Projekt F1 {suffix}{pm_suffix}",
        "eventName": "F1-Test",
        "projectManagerUserId": pm_user_id,
        "calendarWeek": start.isocalendar().week,
        "startDate": start.isoformat(),
        "endDate": end.isoformat(),
        "notes": "",
        "status": "Geplant",
        "returnBufferDays": buffer_days,
        "days": [
            {
                "planningDate": start.isoformat(),
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


def _checkout(
    client: TestClient,
    asset: dict,
    *,
    next_return: str,
    planning_id: str | None = None,
    expected_return_date: str | None = None,
) -> dict:
    payload = dict(asset)
    payload["status"] = "Verliehen"
    payload["assignedTo"] = "- · Projekt F1"
    payload["nextReturn"] = next_return
    payload["assignedPlanningId"] = planning_id
    payload["expectedReturnDate"] = expected_return_date
    res = client.post("/api/wms/assets", headers=_headers(client, "Admin"), json=payload)
    assert res.status_code == 200, res.text
    return res.json()


def _switch_item_on(client: TestClient, planning_id: str, pm_user_id: str, day: date) -> dict:
    res = client.get(
        f"/api/wms/planning/{planning_id}/availability",
        headers=_headers(client, "Projektmanager", user_id=pm_user_id),
    )
    assert res.status_code == 200, res.text
    items = [
        it
        for it in res.json()["items"]
        if it["categoryKey"] == "Switch" and it["planningDate"] == day.isoformat()
    ]
    assert items, f"Switch-Item für {day} fehlt in der Availability-Antwort"
    return items[0]


# --------------------------------------------------------------------------- #
# Pflichttest 2: Checkout-Default kommt aus der Planung, nicht "heute+2"
# --------------------------------------------------------------------------- #
def test_checkout_with_planning_binds_expected_return_to_planning_end() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)

    today = date.today()
    start, end = today, today + timedelta(days=13)  # mehrwöchig, Enddatum exklusiv
    planning_id = _create_planning(client, suffix, start, end, qty=1)
    switch = _create_switches(client, suffix, count=1)[0]

    # Alter (falscher) Frontend-Default heute+2 wird mitgesendet — der Server
    # muss ihn beim Planungs-Checkout durch die Planungsdaten ersetzen.
    plus_two = (today + timedelta(days=2)).isoformat()
    out = _checkout(client, switch, next_return=plus_two, planning_id=planning_id)

    expected_last_blocked = (end - timedelta(days=1)).isoformat()
    assert out["expectedReturnDate"] == expected_last_blocked, out
    assert out["expectedReturnDate"] != plus_two, out
    assert out["nextReturn"] == end.isoformat(), out
    assert out["assignedPlanningId"] == planning_id, out


def test_checkout_single_day_planning_binds_to_event_day() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)

    event_day = date.today() + timedelta(days=7)
    planning_id = _create_planning(client, suffix, event_day, event_day, qty=1)
    switch = _create_switches(client, suffix, count=1)[0]

    out = _checkout(
        client,
        switch,
        next_return=(date.today() + timedelta(days=2)).isoformat(),
        planning_id=planning_id,
    )
    # Eintagesplanung: Rückgabetag = Einsatztag selbst.
    assert out["expectedReturnDate"] == event_day.isoformat(), out
    assert out["nextReturn"] == event_day.isoformat(), out


def test_checkout_with_planning_respects_return_buffer() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)

    today = date.today()
    start, end = today, today + timedelta(days=5)
    planning_id = _create_planning(client, suffix, start, end, qty=1, buffer_days=2)
    switch = _create_switches(client, suffix, count=1)[0]

    out = _checkout(
        client,
        switch,
        next_return=(today + timedelta(days=2)).isoformat(),
        planning_id=planning_id,
    )
    # Blockierfenster = [start, end+2) ⇒ letzter blockierter Tag = end+1.
    assert out["expectedReturnDate"] == (end + timedelta(days=1)).isoformat(), out


def test_checkout_manual_expected_return_wins_over_planning() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)

    today = date.today()
    planning_id = _create_planning(client, suffix, today, today + timedelta(days=13), qty=1)
    switch = _create_switches(client, suffix, count=1)[0]

    manual = (today + timedelta(days=1)).isoformat()
    out = _checkout(
        client,
        switch,
        next_return=manual,
        planning_id=planning_id,
        expected_return_date=manual,  # bewusste manuelle Wahl der UI
    )
    assert out["expectedReturnDate"] == manual, out
    assert out["nextReturn"] == manual, out


def test_checkout_without_planning_keeps_legacy_default() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)

    switch = _create_switches(client, suffix, count=1)[0]
    plus_two = (date.today() + timedelta(days=2)).isoformat()
    out = _checkout(client, switch, next_return=plus_two, planning_id=None)
    # Ohne Planungsbezug bleibt das bisherige Verhalten (next_return zählt).
    assert out["expectedReturnDate"] == plus_two, out


def test_edit_of_loaned_asset_does_not_rebind_to_planning() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)

    today = date.today()
    planning_id = _create_planning(client, suffix, today, today + timedelta(days=13), qty=1)
    switch = _create_switches(client, suffix, count=1)[0]
    out = _checkout(
        client,
        switch,
        next_return=(today + timedelta(days=2)).isoformat(),
        planning_id=planning_id,
    )

    # Nachträgliche manuelle Korrektur (Edit eines BEREITS verliehenen Geräts)
    # darf NICHT wieder an die Planung gebunden werden.
    corrected = (today + timedelta(days=4)).isoformat()
    edit = dict(out)
    edit["nextReturn"] = corrected
    edit["expectedReturnDate"] = None  # Edit-Dialoge senden kein strukturiertes Datum
    res = client.post("/api/wms/assets", headers=_headers(client, "Admin"), json=edit)
    assert res.status_code == 200, res.text
    assert res.json()["expectedReturnDate"] == corrected, res.json()


# --------------------------------------------------------------------------- #
# Pflichttest 1: Loan-Window-Invariante über die gesamte Projektlaufzeit
# --------------------------------------------------------------------------- #
def test_loan_window_invariant_full_project_duration() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)

    today = date.today()
    start, end = today, today + timedelta(days=6)  # Belegung: heute .. heute+5
    switches = _create_switches(client, suffix, count=2)

    planning_a = _create_planning(client, suffix, start, end, qty=1)
    out = _checkout(
        client,
        switches[0],
        next_return=(today + timedelta(days=2)).isoformat(),
        planning_id=planning_a,
    )
    assert out["expectedReturnDate"] == (end - timedelta(days=1)).isoformat(), out

    # a) Die eigene Planung sieht das Gerät als erfüllten Bedarf — an JEDEM
    #    Belegungstag, insbesondere weit NACH dem alten heute+2-Fenster.
    res = client.get(
        f"/api/wms/planning/{planning_a}/availability",
        headers=_headers(client, "Projektmanager", user_id=f"pm-f1-{suffix}"),
    )
    assert res.status_code == 200, res.text
    switch_items = [it for it in res.json()["items"] if it["categoryKey"] == "Switch"]
    assert len(switch_items) == 6, switch_items
    for item in switch_items:
        assert item["issuedForPlanningQty"] == 1, item
        assert item["shortageQty"] == 0, item

    # b) Überlappende Planung MITTEN in der Laufzeit (heute+3) sieht nur noch
    #    1 freien Switch — das ausgegebene Gerät zählt NICHT als verfügbar.
    mid_day = today + timedelta(days=3)
    planning_mid = _create_planning(
        client, suffix, mid_day, mid_day, qty=2, pm_suffix="-mid"
    )
    item_mid = _switch_item_on(client, planning_mid, f"pm-f1-{suffix}-mid", mid_day)
    assert item_mid["usableStock"] == 1, item_mid
    assert item_mid["shortageQty"] == 1, item_mid
    assert item_mid["hasGlobalShortage"] is True, item_mid

    # c) Am Rückgabetag (Enddatum, exklusiv belegt) ist das Gerät wieder frei:
    #    eine Folgeplanung am Enddatum bekommt beide Switches ohne Konflikt.
    planning_after = _create_planning(client, suffix, end, end, qty=2, pm_suffix="-after")
    item_after = _switch_item_on(client, planning_after, f"pm-f1-{suffix}-after", end)
    assert item_after["usableStock"] == 2, item_after
    assert item_after["shortageQty"] == 0, item_after
    assert item_after["hasGlobalShortage"] is False, item_after


# --------------------------------------------------------------------------- #
# Pflichttest 3: keine Regressionen bei Rückgabe und Backup/Restore
# --------------------------------------------------------------------------- #
def test_checkin_after_planning_bound_checkout_releases_everything() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)

    today = date.today()
    planning_id = _create_planning(client, suffix, today, today + timedelta(days=6), qty=1)
    switch = _create_switches(client, suffix, count=1)[0]
    out = _checkout(
        client,
        switch,
        next_return=(today + timedelta(days=2)).isoformat(),
        planning_id=planning_id,
    )

    checkin = dict(out)
    checkin["status"] = "Verfuegbar"
    checkin["assignedTo"] = "-"
    checkin["nextReturn"] = "-"
    res = client.post("/api/wms/assets", headers=_headers(client, "Admin"), json=checkin)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "Verfuegbar", body
    assert body["expectedReturnDate"] is None, body
    assert body["assignedPlanningId"] is None, body


def test_backup_roundtrip_preserves_planning_bound_dates() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)

    today = date.today()
    end = today + timedelta(days=6)
    planning_id = _create_planning(client, suffix, today, end, qty=1)
    switch = _create_switches(client, suffix, count=1)[0]
    out = _checkout(
        client,
        switch,
        next_return=(today + timedelta(days=2)).isoformat(),
        planning_id=planning_id,
    )
    expected_return = out["expectedReturnDate"]
    assert expected_return == (end - timedelta(days=1)).isoformat(), out

    export = client.get("/api/wms/backup/export", headers=_headers(client, "Admin"))
    assert export.status_code == 200, export.text
    payload = export.json()
    exported_asset = next(a for a in payload["assets"] if a["id"] == switch["id"])
    assert exported_asset["expectedReturnDate"] == expected_return, exported_asset
    assert exported_asset["assignedPlanningId"] == planning_id, exported_asset

    imported = client.post(
        "/api/wms/backup/import",
        headers=_headers(client, "Admin"),
        files={"file": ("backup.json", json.dumps(payload), "application/json")},
    )
    assert imported.status_code == 200, imported.text

    res = client.get(f"/api/wms/assets/{switch['id']}", headers=_headers(client, "Admin"))
    assert res.status_code == 200, res.text
    restored = res.json()
    assert restored["expectedReturnDate"] == expected_return, restored
    assert restored["assignedPlanningId"] == planning_id, restored
