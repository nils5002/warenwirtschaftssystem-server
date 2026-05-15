"""Regressionstests fuer Paket 2A: Uebergabe-/Connect-Logik.

Drei Live-Faelle aus dem Betrieb:
- BPI 1 / BPI 2 Kartendrucker: Uebergabe muss nach Statuswechsel des Partners
  weiter im Datensatz und in der Availability stehen.
- GLS / BDEW mit Datums-Ueberlapp: handoverStatus == 'planned'.
- Suedwestfalen / PSD HT ohne Ueberlapp: handoverStatus == 'organizational',
  KEIN gefaelschter Verfuegbarkeits-Ausgleich.

Plus zwei Schutztests fuer fehlende Verlinkungen (missing_link).
"""

from __future__ import annotations

from datetime import date, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app

from .auth_helpers import auth_headers


def _headers(client: TestClient, role: str, user_id: str | None = None) -> dict[str, str]:
    return auth_headers(client, role, user_id=user_id)


def _build_planning_payload(
    *,
    suffix: str,
    pm_user_id: str,
    project_name: str,
    customer_name: str,
    start: date,
    end: date,
    items_per_day: list[dict[str, object]],
    status: str = "Bestaetigt",
) -> dict[str, object]:
    """Hilfsfunktion: baut Planung mit gleichem items-Schema fuer jeden Tag."""
    days: list[dict[str, object]] = []
    current = start
    while current <= end:
        days.append(
            {
                "planningDate": current.isoformat(),
                "weekday": current.strftime("%A"),
                "items": [dict(item) for item in items_per_day],
            }
        )
        current = current + timedelta(days=1)
    return {
        "customerName": customer_name,
        "projectName": project_name,
        "eventName": f"Event {suffix}",
        "projectManagerUserId": pm_user_id,
        "calendarWeek": start.isocalendar().week,
        "startDate": start.isoformat(),
        "endDate": end.isoformat(),
        "notes": f"Notes {suffix}",
        "status": status,
        "days": days,
    }


# ---------------------------------------------------------------------------
# Live-Fall 1: BPI 1 / BPI 2 Kartendrucker
# ---------------------------------------------------------------------------


def test_handover_link_survives_partner_status_change() -> None:
    """Live-Fall BPI 1 / BPI 2 Kartendrucker.

    Owner verlinkt Partner. Partner wechselt anschliessend auf 'Abgeschlossen'.
    Owner-GET und Availability-GET MUESSEN den Link weiterhin enthalten —
    die UI faengt das visuell ueber den "verknuepft, anderer Status"-Fallback ab.
    """
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    planning_date = date.today() + timedelta(days=30)

    owner_user_id = f"pm-bpi1-{suffix}"
    partner_user_id = f"pm-bpi2-{suffix}"

    # Partner-Planung BPI 2 — am Vortag des Owner-Tages aktiv, damit
    # source_capacity > 0 ist. So bekommt die Verbindung beim Erstanlegen
    # ueberhaupt den 'planned'-Status. Spaeter ist es egal, weil
    # Persistenz-Pruefung den Status nicht weiter fordert.
    partner_payload = _build_planning_payload(
        suffix=f"bpi2-{suffix}",
        pm_user_id=partner_user_id,
        project_name=f"BPI 2 {suffix}",
        customer_name=f"Kunde BPI {suffix}",
        start=planning_date - timedelta(days=1),
        end=planning_date,
        items_per_day=[{"categoryKey": "Kartendrucker", "qty": 2, "notes": None}],
    )
    created_partner = client.post(
        "/api/wms/planning",
        headers=_headers(client, "Projektmanager", partner_user_id),
        json=partner_payload,
    )
    assert created_partner.status_code == 200, created_partner.text
    partner_id = created_partner.json()["id"]

    owner_payload = _build_planning_payload(
        suffix=f"bpi1-{suffix}",
        pm_user_id=owner_user_id,
        project_name=f"BPI 1 {suffix}",
        customer_name=f"Kunde BPI {suffix}",
        start=planning_date,
        end=planning_date,
        items_per_day=[
            {
                "categoryKey": "Kartendrucker",
                "qty": 4,
                "notes": None,
                "handoverEnabled": True,
                "linkedPlanningId": partner_id,
                "handoverNote": "BPI 2 uebergibt 2x Kartendrucker an BPI 1",
            }
        ],
    )
    created_owner = client.post(
        "/api/wms/planning",
        headers=_headers(client, "Projektmanager", owner_user_id),
        json=owner_payload,
    )
    assert created_owner.status_code == 200, created_owner.text
    owner_id = created_owner.json()["id"]

    # Partner-Status auf Abgeschlossen umschalten.
    status_change = client.post(
        f"/api/wms/planning/{partner_id}/status",
        headers=_headers(client, "Projektmanager", partner_user_id),
        json={"status": "Abgeschlossen"},
    )
    assert status_change.status_code == 200

    # Owner erneut laden: Link MUSS weiter da sein.
    reloaded_owner = client.get(
        f"/api/wms/planning/{owner_id}",
        headers=_headers(client, "Projektmanager", owner_user_id),
    )
    assert reloaded_owner.status_code == 200
    reloaded_item = reloaded_owner.json()["days"][0]["items"][0]
    assert reloaded_item["handoverEnabled"] is True
    assert reloaded_item["linkedPlanningId"] == partner_id
    assert reloaded_item["handoverNote"] == "BPI 2 uebergibt 2x Kartendrucker an BPI 1"

    # Availability muss den Link ebenfalls weiter ausweisen.
    availability = client.get(
        f"/api/wms/planning/{owner_id}/availability",
        headers=_headers(client, "Projektmanager", owner_user_id),
    )
    assert availability.status_code == 200
    avail_item = availability.json()["items"][0]
    assert avail_item["handoverEnabled"] is True
    assert avail_item["linkedPlanningId"] == partner_id


# ---------------------------------------------------------------------------
# Live-Fall 2: GLS / BDEW mit Datums-Ueberlapp
# ---------------------------------------------------------------------------


def test_handover_overlapping_dates_status_planned() -> None:
    """Live-Fall GLS / BDEW.

    Partner hat am Vortag des Owner-Tages echten Bedarf in der gleichen
    Kategorie. Damit existiert echter Zeitraum-Ueberlapp und die Status-
    Ableitung muss 'planned' liefern.
    """
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    planning_date = date.today() + timedelta(days=40)

    owner_user_id = f"pm-gls-{suffix}"
    partner_user_id = f"pm-bdew-{suffix}"

    partner_payload = _build_planning_payload(
        suffix=f"bdew-{suffix}",
        pm_user_id=partner_user_id,
        project_name=f"BDEW {suffix}",
        customer_name=f"Kunde GLS/BDEW {suffix}",
        start=planning_date - timedelta(days=1),
        end=planning_date,
        items_per_day=[{"categoryKey": "iPad", "qty": 5, "notes": None}],
    )
    created_partner = client.post(
        "/api/wms/planning",
        headers=_headers(client, "Projektmanager", partner_user_id),
        json=partner_payload,
    )
    assert created_partner.status_code == 200, created_partner.text
    partner_id = created_partner.json()["id"]

    owner_payload = _build_planning_payload(
        suffix=f"gls-{suffix}",
        pm_user_id=owner_user_id,
        project_name=f"GLS {suffix}",
        customer_name=f"Kunde GLS/BDEW {suffix}",
        start=planning_date,
        end=planning_date,
        items_per_day=[
            {
                "categoryKey": "iPad",
                "qty": 999,  # bewusst hoch, damit shortage entsteht und
                # handover_covered_qty > 0 sichtbar wird
                "notes": None,
                "handoverEnabled": True,
                "linkedPlanningId": partner_id,
                "handoverNote": "BDEW gibt 5x iPad an GLS",
            }
        ],
    )
    created_owner = client.post(
        "/api/wms/planning",
        headers=_headers(client, "Projektmanager", owner_user_id),
        json=owner_payload,
    )
    assert created_owner.status_code == 200, created_owner.text
    owner_id = created_owner.json()["id"]

    availability = client.get(
        f"/api/wms/planning/{owner_id}/availability",
        headers=_headers(client, "Projektmanager", owner_user_id),
    )
    assert availability.status_code == 200
    item = availability.json()["items"][0]
    assert item["handoverEnabled"] is True
    assert item["linkedPlanningId"] == partner_id
    assert item["handoverStatus"] == "planned", (
        f"Erwartet 'planned' bei echter Vortags-Ueberschneidung, bekommen: {item['handoverStatus']!r}"
    )
    assert item["handoverCoveredQty"] > 0


# ---------------------------------------------------------------------------
# Live-Fall 3: Suedwestfalen / PSD HT ohne Ueberlapp
# ---------------------------------------------------------------------------


def test_handover_non_overlapping_is_organizational() -> None:
    """Live-Fall Suedwestfalen / PSD HT — KEIN Datums-Ueberlapp.

    Die organisatorische Verknuepfung muss:
    1. persistiert werden (linkedPlanningId, handoverEnabled bleiben),
    2. als 'organizational' klassifiziert werden,
    3. handoverCoveredQty=0 belassen,
    4. shortageAfterHandoverQty == shortageQty halten (kein gefaelschter Ausgleich),
    5. usableStock NICHT veraendern.
    """
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    owner_user_id = f"pm-sw-{suffix}"
    partner_user_id = f"pm-psd-{suffix}"
    # Disjunkte Datumsbereiche, Abstand 7 Tage.
    owner_start = date.today() + timedelta(days=50)
    partner_start = owner_start + timedelta(days=7)

    partner_payload = _build_planning_payload(
        suffix=f"psd-{suffix}",
        pm_user_id=partner_user_id,
        project_name=f"PSD HT {suffix}",
        customer_name=f"Kunde Suedwestfalen/PSD {suffix}",
        start=partner_start,
        end=partner_start + timedelta(days=2),
        items_per_day=[{"categoryKey": "Kartendrucker", "qty": 2, "notes": None}],
    )
    created_partner = client.post(
        "/api/wms/planning",
        headers=_headers(client, "Projektmanager", partner_user_id),
        json=partner_payload,
    )
    assert created_partner.status_code == 200, created_partner.text
    partner_id = created_partner.json()["id"]

    # Owner-Planung OHNE Uebergabe: dient als Referenz fuer usableStock.
    reference_payload = _build_planning_payload(
        suffix=f"sw-ref-{suffix}",
        pm_user_id=owner_user_id,
        project_name=f"Suedwestfalen REF {suffix}",
        customer_name=f"Kunde Suedwestfalen/PSD {suffix}",
        start=owner_start,
        end=owner_start + timedelta(days=2),
        items_per_day=[{"categoryKey": "Kartendrucker", "qty": 3, "notes": None}],
    )
    created_reference = client.post(
        "/api/wms/planning",
        headers=_headers(client, "Projektmanager", owner_user_id),
        json=reference_payload,
    )
    assert created_reference.status_code == 200
    reference_availability = client.get(
        f"/api/wms/planning/{created_reference.json()['id']}/availability",
        headers=_headers(client, "Projektmanager", owner_user_id),
    )
    assert reference_availability.status_code == 200
    reference_items_all = reference_availability.json()["items"]
    assert reference_items_all, "Referenz-Planung muss mindestens ein Availability-Item haben"
    # Test bezieht sich nur auf Kartendrucker (handover wurde dafür gesetzt).
    # Seit der Kartendrucker→Laptop-Kopplung enthält die Antwort zusätzlich
    # eine synthetisierte Laptop-Zeile, die für diese handover-Prüfung
    # irrelevant ist.
    reference_items = [i for i in reference_items_all if i["categoryKey"] == "Kartendrucker"]
    assert reference_items, "Mindestens eine Kartendrucker-Zeile in der Referenz erwartet"
    reference_first = reference_items[0]
    reference_usable_stock = reference_first["usableStock"]
    reference_shortage_qty = reference_first["shortageQty"]
    # Referenz wieder loeschen, damit sie die echte Pruefung nicht verfaelscht.
    delete_reference = client.delete(
        f"/api/wms/planning/{created_reference.json()['id']}",
        headers=_headers(client, "Projektmanager", owner_user_id),
    )
    assert delete_reference.status_code == 200

    # Echte Owner-Planung Suedwestfalen MIT organisatorischer Uebergabe.
    owner_payload = _build_planning_payload(
        suffix=f"sw-{suffix}",
        pm_user_id=owner_user_id,
        project_name=f"Suedwestfalen {suffix}",
        customer_name=f"Kunde Suedwestfalen/PSD {suffix}",
        start=owner_start,
        end=owner_start + timedelta(days=2),
        items_per_day=[
            {
                "categoryKey": "Kartendrucker",
                "qty": 3,
                "notes": None,
                "handoverEnabled": True,
                "linkedPlanningId": partner_id,
                "handoverNote": "Organisatorische Anbindung an PSD HT",
            }
        ],
    )
    created_owner = client.post(
        "/api/wms/planning",
        headers=_headers(client, "Projektmanager", owner_user_id),
        json=owner_payload,
    )
    assert created_owner.status_code == 200, created_owner.text
    owner_id = created_owner.json()["id"]

    # (1) Persistenz nach Reload.
    reloaded = client.get(
        f"/api/wms/planning/{owner_id}",
        headers=_headers(client, "Projektmanager", owner_user_id),
    )
    assert reloaded.status_code == 200
    reloaded_item = reloaded.json()["days"][0]["items"][0]
    assert reloaded_item["handoverEnabled"] is True
    assert reloaded_item["linkedPlanningId"] == partner_id
    assert reloaded_item["handoverNote"] == "Organisatorische Anbindung an PSD HT"

    # (2)-(5) Availability-Pruefung.
    availability = client.get(
        f"/api/wms/planning/{owner_id}/availability",
        headers=_headers(client, "Projektmanager", owner_user_id),
    )
    assert availability.status_code == 200
    items_all = availability.json()["items"]
    assert items_all, "Availability muss mindestens ein Item enthalten"
    items = [i for i in items_all if i["categoryKey"] == "Kartendrucker"]
    assert items, "Mindestens eine Kartendrucker-Zeile erwartet"
    for entry in items:
        assert entry["handoverStatus"] == "organizational", (
            f"Erwartet 'organizational' ohne Datums-Ueberlapp, bekommen: {entry['handoverStatus']!r}"
        )
        assert entry["handoverCoveredQty"] == 0
        assert entry["shortageAfterHandoverQty"] == entry["shortageQty"], (
            "Kein gefaelschter Ausgleich: shortageAfterHandoverQty muss == shortageQty bleiben"
        )
        # usableStock identisch zur Referenz (gleiche Bestandslage, nur ohne Uebergabe).
        assert entry["usableStock"] == reference_usable_stock, (
            "Organisatorische Uebergabe darf usableStock nicht veraendern"
        )
    first = items[0]
    assert first["shortageQty"] == reference_shortage_qty, (
        "shortageQty muss identisch zur Referenz ohne Uebergabe sein"
    )


# ---------------------------------------------------------------------------
# Schutztests fuer fehlende Verlinkungen
# ---------------------------------------------------------------------------


def test_handover_missing_partner_returns_missing_link() -> None:
    """handoverEnabled=True + nicht existierende linkedPlanningId -> 'missing_link'."""
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    planning_date = date.today() + timedelta(days=60)

    payload = _build_planning_payload(
        suffix=f"orphan-{suffix}",
        pm_user_id=f"pm-orphan-{suffix}",
        project_name=f"Orphan {suffix}",
        customer_name=f"Kunde Orphan {suffix}",
        start=planning_date,
        end=planning_date,
        items_per_day=[
            {
                "categoryKey": "Laptop",
                "qty": 999,  # garantiert Shortage
                "notes": None,
                "handoverEnabled": True,
                "linkedPlanningId": f"pln-does-not-exist-{suffix}",
                "handoverNote": None,
            }
        ],
    )
    created = client.post(
        "/api/wms/planning",
        headers=_headers(client, "Projektmanager", f"pm-orphan-{suffix}"),
        json=payload,
    )
    assert created.status_code == 200, created.text

    availability = client.get(
        f"/api/wms/planning/{created.json()['id']}/availability",
        headers=_headers(client, "Projektmanager", f"pm-orphan-{suffix}"),
    )
    assert availability.status_code == 200
    item = availability.json()["items"][0]
    assert item["handoverStatus"] == "missing_link"
    assert item["handoverCoveredQty"] == 0


def test_handover_no_linked_id_returns_missing_link() -> None:
    """handoverEnabled=True + leere linkedPlanningId -> 'missing_link'."""
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    planning_date = date.today() + timedelta(days=62)

    payload = _build_planning_payload(
        suffix=f"empty-link-{suffix}",
        pm_user_id=f"pm-empty-{suffix}",
        project_name=f"Empty Link {suffix}",
        customer_name=f"Kunde Empty Link {suffix}",
        start=planning_date,
        end=planning_date,
        items_per_day=[
            {
                "categoryKey": "Laptop",
                "qty": 999,
                "notes": None,
                "handoverEnabled": True,
                "linkedPlanningId": None,
                "handoverNote": None,
            }
        ],
    )
    created = client.post(
        "/api/wms/planning",
        headers=_headers(client, "Projektmanager", f"pm-empty-{suffix}"),
        json=payload,
    )
    assert created.status_code == 200

    availability = client.get(
        f"/api/wms/planning/{created.json()['id']}/availability",
        headers=_headers(client, "Projektmanager", f"pm-empty-{suffix}"),
    )
    assert availability.status_code == 200
    item = availability.json()["items"][0]
    assert item["handoverStatus"] == "missing_link"
    assert item["handoverCoveredQty"] == 0
