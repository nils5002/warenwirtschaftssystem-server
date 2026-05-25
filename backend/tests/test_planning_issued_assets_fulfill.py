"""Schritt B: Konkret FÜR eine Planung ausgegebene Geräte erfüllen deren Bedarf
und dürfen ihn nicht zusätzlich als Engpass belasten (Behebung der
Doppelzählung). Echte Konflikte (andere Planungen, unterdeckte Ausgabe) bleiben
sichtbar — Konflikte werden NICHT ausgeblendet.
"""

from __future__ import annotations

from datetime import date, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient

from app.database.session import SessionLocal
from app.main import app
from app.schemas.backup import BackupAsset
from app.services import backup_service
from .auth_helpers import auth_headers


def _headers(client: TestClient, role: str, user_id: str | None = None) -> dict[str, str]:
    return auth_headers(client, role, user_id=user_id)


def _reset(client: TestClient) -> None:
    res = client.post("/api/wms/backup/reset-for-import", headers=_headers(client, "Admin"))
    assert res.status_code == 200, res.text


def _switch_payload(suffix: str, index: int) -> dict:
    return {
        "id": f"asset-issB-{suffix}-{index}",
        "name": f"Switch {suffix}-{index}",
        "category": "Switch",
        "location": "Hauptlager",
        "status": "Verfuegbar",
        "assignedTo": "-",
        "nextReturn": "-",
        "tagNumber": f"TAG-ISSB-{suffix}-{index}",
        "serialNumber": f"SN-ISSB-{suffix}-{index}",
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


def _checkout(client: TestClient, asset: dict, *, planning_id: str | None, next_return: str) -> dict:
    payload = dict(asset)
    payload["status"] = "Verliehen"
    payload["assignedTo"] = "- · Testprojekt"
    payload["nextReturn"] = next_return
    payload["assignedPlanningId"] = planning_id
    res = client.post("/api/wms/assets", headers=_headers(client, "Admin"), json=payload)
    assert res.status_code == 200, res.text
    return res.json()


def _create_switch_planning(client: TestClient, suffix: str, label: str, day: date, qty: int) -> str:
    pm = f"pm-issB-{suffix}-{label}"
    payload = {
        "customerName": f"Kunde {label} {suffix}",
        "projectName": f"Projekt {label} {suffix}",
        "eventName": "IssB-Test",
        "projectManagerUserId": pm,
        "calendarWeek": day.isocalendar().week,
        "startDate": day.isoformat(),
        "endDate": day.isoformat(),
        "notes": "",
        "status": "Geplant",
        "days": [
            {
                "planningDate": day.isoformat(),
                "weekday": "Montag",
                "items": [{"categoryKey": "Switch", "qty": qty, "notes": None}],
            }
        ],
    }
    res = client.post("/api/wms/planning", headers=_headers(client, "Projektmanager", user_id=pm), json=payload)
    assert res.status_code == 200, res.text
    return res.json()["id"]


def _switch_item(client: TestClient, planning_id: str, suffix: str, label: str) -> dict:
    res = client.get(
        f"/api/wms/planning/{planning_id}/availability",
        headers=_headers(client, "Projektmanager", user_id=f"pm-issB-{suffix}-{label}"),
    )
    assert res.status_code == 200, res.text
    items = [it for it in res.json()["items"] if it["categoryKey"] == "Switch"]
    assert items, "Switch-Item muss enthalten sein"
    return items[0]


# 1. Asset FÜR Planung Y ausgegeben → kein künstlicher Konflikt für Y.
def test_issued_asset_fulfills_own_planning() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)

    switches = _create_switches(client, suffix, count=2)
    day = date.today() + timedelta(days=10)
    planning = _create_switch_planning(client, suffix, "Y", day, qty=2)
    # Ausgabe FÜR diese Planung, Rückgabe erst nach dem Planungstag (auf Ausleihe).
    _checkout(client, switches[0], planning_id=planning, next_return=(day + timedelta(days=1)).isoformat())

    item = _switch_item(client, planning, suffix, "Y")
    # 1 Gerät verliehen (nicht im Pool), aber FÜR diese Planung → erfüllt Bedarf.
    assert item["usableStock"] == 1, item
    assert item["requestedQty"] == 2, item            # geplant bleibt 2
    assert item["issuedForPlanningQty"] == 1, item    # davon 1 bereits ausgegeben
    assert item["currentPlanningQty"] == 1, item      # offener Bedarf 1
    assert item["shortageQty"] == 0, item
    assert item["hasGlobalShortage"] is False, item


# 1b. Kontrolle: dieselbe Ausgabe OHNE Planungsbezug → künstlicher Konflikt
#     (beweist, dass die Verknüpfung den Fix bewirkt, nicht allein Schritt A —
#     der Rückgabetag liegt nach dem Planungstag, das Gerät bleibt gesperrt).
def test_issued_asset_without_link_still_conflicts() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)

    switches = _create_switches(client, suffix, count=2)
    day = date.today() + timedelta(days=10)
    planning = _create_switch_planning(client, suffix, "Y", day, qty=2)
    _checkout(client, switches[0], planning_id=None, next_return=(day + timedelta(days=1)).isoformat())

    item = _switch_item(client, planning, suffix, "Y")
    assert item["usableStock"] == 1, item
    assert item["issuedForPlanningQty"] == 0, item
    assert item["shortageQty"] == 1, item


# 2. Asset FÜR Planung A ausgegeben → überschneidende Planung B bekommt echten
#    Konflikt (Gerät ist physisch nicht verfügbar). Konflikt NICHT ausgeblendet.
#    A's EIGENER Bedarf wird nicht mehr doppelt gezählt (currentPlanningQty=0);
#    die Tagesüberbuchung (A+B > Bestand) bleibt wie im bestehenden Cross-
#    Planning-Modell auf beiden Zeilen sichtbar (bewusst nicht ausgeblendet).
def test_issued_for_other_planning_keeps_real_conflict() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)

    switches = _create_switches(client, suffix, count=2)
    day = date.today() + timedelta(days=10)
    planning_a = _create_switch_planning(client, suffix, "A", day, qty=2)
    planning_b = _create_switch_planning(client, suffix, "B", day, qty=1)
    # Beide Switches FÜR A ausgegeben.
    for sw in switches:
        _checkout(client, sw, planning_id=planning_a, next_return=(day + timedelta(days=1)).isoformat())

    item_a = _switch_item(client, planning_a, suffix, "A")
    # A's eigener Bedarf ist vollständig durch Ausgaben gedeckt → kein
    # Doppelzählungs-Engpass aus A's EIGENEM Bedarf.
    assert item_a["issuedForPlanningQty"] == 2, item_a
    assert item_a["currentPlanningQty"] == 0, item_a

    item_b = _switch_item(client, planning_b, suffix, "B")
    # B hat keine eigenen Ausgaben, alle Geräte sind für A draußen → echter Engpass.
    assert item_b["issuedForPlanningQty"] == 0, item_b
    assert item_b["usableStock"] == 0, item_b
    assert item_b["shortageQty"] == 1, item_b
    assert item_b["hasGlobalShortage"] is True, item_b


# 3. Rücknahme beendet die Verknüpfung; Gerät wieder normal verfügbar.
def test_checkin_clears_planning_link() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)

    switch = _create_switches(client, suffix, count=1)[0]
    day = date.today() + timedelta(days=10)
    planning = _create_switch_planning(client, suffix, "Y", day, qty=1)
    out = _checkout(client, switch, planning_id=planning, next_return=(day + timedelta(days=1)).isoformat())
    assert out["assignedPlanningId"] == planning, out

    checkin = dict(out)
    checkin["status"] = "Verfuegbar"
    checkin["assignedTo"] = "-"
    checkin["nextReturn"] = "-"
    res = client.post("/api/wms/assets", headers=_headers(client, "Admin"), json=checkin)
    assert res.status_code == 200, res.text
    assert res.json()["assignedPlanningId"] is None, res.json()

    # Wieder im Pool, kein Engpass.
    item = _switch_item(client, planning, suffix, "Y")
    assert item["usableStock"] == 1, item
    assert item["issuedForPlanningQty"] == 0, item
    assert item["shortageQty"] == 0, item


# 4. Schritt A bleibt erhalten: nach dem Rückgabetag zählt das Gerät wieder im
#    Pool und wird NICHT zusätzlich als erfüllter Bedarf doppelt verrechnet.
def test_after_return_date_asset_back_in_pool_not_double_counted() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)

    switches = _create_switches(client, suffix, count=2)
    day = date.today() + timedelta(days=20)
    planning = _create_switch_planning(client, suffix, "Y", day, qty=2)
    # Rückgabe VOR dem Planungstag -> Gerät ist am Planungstag wieder verfügbar.
    _checkout(client, switches[0], planning_id=planning, next_return=(day - timedelta(days=5)).isoformat())

    item = _switch_item(client, planning, suffix, "Y")
    assert item["usableStock"] == 2, item             # beide wieder im Pool
    assert item["issuedForPlanningQty"] == 0, item    # nicht mehr "draußen" → nicht erfüllt-gezählt
    assert item["currentPlanningQty"] == 2, item
    assert item["shortageQty"] == 0, item


# 5. Backup: altes Schema OHNE Feld bleibt importierbar; neues Feld roundtrippt.
def test_backup_roundtrip_and_legacy_compat() -> None:
    # Altbackup ohne assignedPlanningId -> Default None, kein Fehler.
    legacy = BackupAsset(
        id="asset-legacy",
        name="Alt",
        category="Switch",
        location="L",
        status="Verliehen",
        assignedTo="-",
        nextReturn="-",
        tagNumber="TAG-LEGACY",
        serialNumber="SN-LEGACY",
    )
    assert legacy.assignedPlanningId is None

    # Export enthält das neue Feld (Roundtrip über echten Service).
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)
    switch = _create_switches(client, suffix, count=1)[0]
    day = date.today() + timedelta(days=10)
    planning = _create_switch_planning(client, suffix, "Y", day, qty=1)
    _checkout(client, switch, planning_id=planning, next_return=(day + timedelta(days=1)).isoformat())

    with SessionLocal() as db:
        exported = backup_service.export_backup(db)
    ours = [a for a in exported.assets if a.id == switch["id"]]
    assert ours and ours[0].assignedPlanningId == planning, ours
