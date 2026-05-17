"""Tests fuer die Konflikt-Schweregrad-Klassifikation (Konfliktanzeige-Paket).

Abgedeckt:
* Reine Unit-Tests fuer ``classify_conflict_cell`` (Praezedenz, Sekundaer-Badges).
* Integration: ``conflicts`` an der Planungsliste + Klassifikation der
  Availability-Items, ueber die echten API-Endpunkte.
* Regression: ``openConflictCount`` unveraendert, ``missingItems`` weiter
  vorhanden, Anzahl harter ``conflicts`` == ``openConflictCount``, Listen- und
  Detailpfad stimmen pro Zelle ueberein.
"""

from __future__ import annotations

from datetime import date, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient

from app.domain.conflict_classification import ConflictCellFacts, classify_conflict_cell
from app.main import app

from .auth_helpers import auth_headers

_DAY = date(2027, 6, 8)


# -----------------------------------------------------------------------------
# Unit-Tests: classify_conflict_cell
# -----------------------------------------------------------------------------
def _facts(**overrides) -> ConflictCellFacts:
    base = dict(
        category_key="QR-Code-Scanner",
        conflict_day=_DAY,
        unresolved_shortage_qty=0,
        handover_covered_qty=0,
        handover_status="none",
        handover_enabled=False,
        excluded_qty=0,
        excluded_from_planning_qty=0,
        card_printer_required_qty=0,
        card_printer_uplift_qty=0,
    )
    base.update(overrides)
    return ConflictCellFacts(**base)


def test_real_shortage_without_handover_is_echter_engpass() -> None:
    result = classify_conflict_cell(_facts(unresolved_shortage_qty=7))
    assert result is not None
    assert result.severity == "echter_engpass"
    assert result.reason == "real_shortage"
    assert result.secondary == ()


def test_organizational_handover_is_handover_review() -> None:
    result = classify_conflict_cell(
        _facts(unresolved_shortage_qty=1, handover_enabled=True, handover_status="organizational")
    )
    assert result is not None
    assert result.severity == "handover_review"


def test_planned_handover_without_coverage_is_handover_review() -> None:
    result = classify_conflict_cell(
        _facts(unresolved_shortage_qty=1, handover_enabled=True, handover_status="planned")
    )
    assert result is not None
    assert result.severity == "handover_review"


def test_partial_handover_is_teilweise_geloest() -> None:
    result = classify_conflict_cell(
        _facts(
            unresolved_shortage_qty=2,
            handover_covered_qty=3,
            handover_enabled=True,
            handover_status="planned",
        )
    )
    assert result is not None
    assert result.severity == "teilweise_geloest"


def test_compat_laptops_missing_wins_over_handover() -> None:
    result = classify_conflict_cell(
        _facts(
            category_key="Laptop",
            unresolved_shortage_qty=8,
            excluded_qty=7,
            handover_enabled=True,
            handover_status="organizational",
        )
    )
    assert result is not None
    assert result.severity == "kompatible_laptops_fehlen"
    # Die Uebergabe bleibt als Sekundaer-Badge sichtbar.
    assert "handover_review" in {badge.severity for badge in result.secondary}


def test_excluded_qty_on_non_laptop_does_not_trigger_compat() -> None:
    # Die Kompatibilitaetsregel gilt ausschliesslich fuer Laptop-Zeilen.
    result = classify_conflict_cell(
        _facts(category_key="QR-Code-Scanner", unresolved_shortage_qty=3, excluded_qty=5)
    )
    assert result is not None
    assert result.severity == "echter_engpass"


def test_non_plannable_excluded_is_primary_when_only_cause() -> None:
    result = classify_conflict_cell(
        _facts(category_key="Laptop", unresolved_shortage_qty=1, excluded_from_planning_qty=2)
    )
    assert result is not None
    assert result.severity == "nicht_planbare_ausgeschlossen"
    # "echter_engpass" ist nur Default-Primaer und nie ein Sekundaer-Badge.
    assert "echter_engpass" not in {badge.severity for badge in result.secondary}


def test_clean_cell_is_not_classified() -> None:
    assert classify_conflict_cell(_facts()) is None


def test_context_row_non_plannable_without_shortage() -> None:
    result = classify_conflict_cell(_facts(unresolved_shortage_qty=0, excluded_from_planning_qty=2))
    assert result is not None
    assert result.severity == "nicht_planbare_ausgeschlossen"


def test_context_row_card_printer_uplift_hint() -> None:
    result = classify_conflict_cell(_facts(unresolved_shortage_qty=0, card_printer_uplift_qty=2))
    assert result is not None
    assert result.severity == "hinweis"


# -----------------------------------------------------------------------------
# Integrations-Helfer
# -----------------------------------------------------------------------------
def _admin(client: TestClient) -> dict[str, str]:
    return auth_headers(client, "Admin")


def _pm(client: TestClient, suffix: str) -> dict[str, str]:
    return auth_headers(client, "Projektmanager", user_id=f"pm-cc-{suffix}")


def _reset(client: TestClient) -> None:
    res = client.post("/api/wms/backup/reset-for-import", headers=_admin(client))
    assert res.status_code == 200, res.text


def _create_category(client: TestClient, suffix: str) -> str:
    name = f"CC-Cat-{suffix}"
    res = client.post("/api/wms/categories", headers=_admin(client), json={"name": name})
    assert res.status_code == 200, res.text
    return name


def _create_asset(
    client: TestClient,
    suffix: str,
    category: str,
    index: int,
    *,
    card_printer_compatible: bool = True,
    available_for_planning: bool = True,
) -> None:
    unique = uuid4().hex[:10]
    payload = {
        "id": f"asset-cc-{suffix}-{index}-{unique}",
        "name": f"CC {suffix} {category} #{index}",
        "category": category,
        "location": "Hauptlager",
        "status": "Verfuegbar",
        "assignedTo": "-",
        "nextReturn": "-",
        "tagNumber": f"CC-{suffix}-{unique}",
        "serialNumber": f"CC-{suffix}-SN-{unique}",
        "qrCode": "",
        "maintenanceState": "Neu",
        "notes": "",
        "lastCheckout": "-",
        "nextReservation": "-",
        "cardPrinterCompatible": card_printer_compatible,
        "availableForPlanning": available_for_planning,
    }
    res = client.post("/api/wms/assets", headers=_admin(client), json=payload)
    assert res.status_code == 200, res.text


def _create_planning(
    client: TestClient,
    suffix: str,
    *,
    on_date: date,
    items: list[dict],
    linked_planning_id: str | None = None,
    project_name: str | None = None,
) -> str:
    payload = {
        "customerName": f"CC Kunde {suffix}",
        "projectName": project_name or f"CC Projekt {suffix}",
        "eventName": "CC-Test",
        "projectManagerUserId": f"pm-cc-{suffix}",
        "calendarWeek": on_date.isocalendar().week,
        "startDate": on_date.isoformat(),
        "endDate": on_date.isoformat(),
        "notes": "",
        "status": "Geplant",
        "days": [{"planningDate": on_date.isoformat(), "weekday": "Montag", "items": items}],
    }
    res = client.post("/api/wms/planning", headers=_pm(client, suffix), json=payload)
    assert res.status_code == 200, res.text
    return res.json()["id"]


def _list_item(client: TestClient, suffix: str, planning_id: str) -> dict:
    res = client.get("/api/wms/planning", headers=_pm(client, suffix))
    assert res.status_code == 200, res.text
    for row in res.json():
        if row["id"] == planning_id:
            return row
    raise AssertionError(f"planning {planning_id} not in list response")


def _availability(client: TestClient, suffix: str, planning_id: str) -> dict:
    res = client.get(
        f"/api/wms/planning/{planning_id}/availability", headers=_pm(client, suffix)
    )
    assert res.status_code == 200, res.text
    return res.json()


# -----------------------------------------------------------------------------
# Integration: echte Endpunkte
# -----------------------------------------------------------------------------
def test_real_shortage_classified_as_echter_engpass() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)
    cat = _create_category(client, suffix)
    for index in range(3):
        _create_asset(client, suffix, cat, index)
    planning_id = _create_planning(
        client, suffix, on_date=date.today() + timedelta(days=400),
        items=[{"categoryKey": cat, "qty": 6, "notes": None}],
    )

    item = _list_item(client, suffix, planning_id)
    assert item["openConflictCount"] == 1
    assert len(item["conflicts"]) == 1
    conflict = item["conflicts"][0]
    assert conflict["categoryKey"] == cat
    assert conflict["conflictSeverity"] == "echter_engpass"
    assert conflict["shortageReason"] == "real_shortage"
    assert conflict["unresolvedShortageQty"] == 3
    assert conflict["conflictDay"] == (date.today() + timedelta(days=400)).isoformat()
    # missingItems bleibt zusaetzlich erhalten.
    assert item["missingItems"] == [
        {"categoryKey": cat, "missingQty": 3, "requiredQty": 6, "availableQty": 3}
    ]


def test_card_printer_incompatible_laptop_classified() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)
    # 2 Server (nicht planbar), 7 MacBook Neo (inkompatibel), 3 normale Laptops,
    # 1 Kartendrucker. Bedarf 4 Laptops + 1 Kartendrucker -> usable 3, Fehlmenge 1.
    for index in range(2):
        _create_asset(client, suffix, "Laptop", index, available_for_planning=False)
    for index in range(2, 9):
        _create_asset(client, suffix, "Laptop", index, card_printer_compatible=False)
    for index in range(9, 12):
        _create_asset(client, suffix, "Laptop", index)
    _create_asset(client, suffix, "Kartendrucker", 12)

    on_date = date.today() + timedelta(days=401)
    planning_id = _create_planning(
        client, suffix, on_date=on_date,
        items=[
            {"categoryKey": "Laptop", "qty": 4, "notes": None},
            {"categoryKey": "Kartendrucker", "qty": 1, "notes": None},
        ],
    )

    item = _list_item(client, suffix, planning_id)
    laptop_conflicts = [c for c in item["conflicts"] if c["categoryKey"] == "Laptop"]
    assert len(laptop_conflicts) == 1
    laptop = laptop_conflicts[0]
    assert laptop["conflictSeverity"] == "kompatible_laptops_fehlen"
    assert laptop["excludedQty"] == 7
    assert laptop["excludedFromPlanningQty"] == 2
    # Nicht-planbare Server-Laptops erscheinen als Sekundaer-Badge.
    assert "nicht_planbare_ausgeschlossen" in {b["severity"] for b in laptop["secondary"]}

    # Cross-Pfad: Availability-Detail klassifiziert dieselbe Zelle gleich.
    payload = _availability(client, suffix, planning_id)
    avail_laptop = [i for i in payload["items"] if i["categoryKey"] == "Laptop"][0]
    assert avail_laptop["conflictSeverity"] == "kompatible_laptops_fehlen"
    assert avail_laptop["excludedQty"] == laptop["excludedQty"]
    assert avail_laptop["conflictDay"] == on_date.isoformat()


def test_organizational_handover_classified_as_handover_review() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)
    cat = _create_category(client, suffix)
    for index in range(3):
        _create_asset(client, suffix, cat, index)

    target_date = date.today() + timedelta(days=402)
    # Partnerplanung existiert und ist aktiv, liegt aber NICHT am Vortag des
    # Zieltermins -> source_capacity 0 -> handoverStatus "organizational".
    partner_id = _create_planning(
        client, f"{suffix}-p", on_date=target_date + timedelta(days=20),
        items=[{"categoryKey": cat, "qty": 3, "notes": None}],
        project_name=f"CC Partner {suffix}",
    )
    planning_id = _create_planning(
        client, suffix, on_date=target_date,
        items=[{
            "categoryKey": cat, "qty": 6, "notes": None,
            "handoverEnabled": True, "linkedPlanningId": partner_id,
        }],
    )

    item = _list_item(client, suffix, planning_id)
    assert item["openConflictCount"] == 1
    conflict = item["conflicts"][0]
    assert conflict["conflictSeverity"] == "handover_review"
    assert conflict["handoverStatus"] == "organizational"
    assert conflict["handoverEnabled"] is True


def test_non_plannable_excluded_surfaced_in_conflict() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)
    # 2 Server (nicht planbar) + 3 normale Laptops, kein Kartendrucker.
    for index in range(2):
        _create_asset(client, suffix, "Laptop", index, available_for_planning=False)
    for index in range(2, 5):
        _create_asset(client, suffix, "Laptop", index)

    planning_id = _create_planning(
        client, suffix, on_date=date.today() + timedelta(days=403),
        items=[{"categoryKey": "Laptop", "qty": 4, "notes": None}],
    )

    item = _list_item(client, suffix, planning_id)
    assert item["openConflictCount"] == 1
    conflict = item["conflicts"][0]
    # Fehlmenge 1, kein Kartendrucker, keine Uebergabe -> Primaer ist der
    # Ausschluss-Hinweis (2 Server-Laptops gesperrt).
    assert conflict["conflictSeverity"] == "nicht_planbare_ausgeschlossen"
    assert conflict["excludedFromPlanningQty"] == 2
    assert conflict["unresolvedShortageQty"] == 1


def test_open_conflict_count_unchanged_and_matches_conflicts() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)
    cat = _create_category(client, suffix)
    _create_asset(client, suffix, cat, 0)

    # Zweitaegige Planung, Bedarf 3 pro Tag, nur 1 Geraet -> Konflikt an 2 Tagen.
    # endDate ist exklusiv: start..start+2 deckt die Tage [start, start+1] ab.
    start = date.today() + timedelta(days=404)
    payload = {
        "customerName": f"CC Kunde {suffix}",
        "projectName": f"CC Projekt {suffix}",
        "eventName": "CC-Test",
        "projectManagerUserId": f"pm-cc-{suffix}",
        "startDate": start.isoformat(),
        "endDate": (start + timedelta(days=2)).isoformat(),
        "notes": "",
        "status": "Geplant",
        "days": [
            {"planningDate": start.isoformat(), "weekday": "Montag",
             "items": [{"categoryKey": cat, "qty": 3, "notes": None}]},
            {"planningDate": (start + timedelta(days=1)).isoformat(), "weekday": "Dienstag",
             "items": [{"categoryKey": cat, "qty": 3, "notes": None}]},
        ],
    }
    res = client.post("/api/wms/planning", headers=_pm(client, suffix), json=payload)
    assert res.status_code == 200, res.text
    planning_id = res.json()["id"]

    item = _list_item(client, suffix, planning_id)
    # Konfliktzaehlung unveraendert: 2 (Tag x Kategorie)-Zellen.
    assert item["openConflictCount"] == 2
    # Anzahl harter conflicts-Eintraege == openConflictCount.
    hard = [c for c in item["conflicts"] if c["conflictSeverity"] != "hinweis"]
    assert len(hard) == 2
    # missingItems bleibt eine Zeile je Kategorie (schlimmster Tag).
    assert len(item["missingItems"]) == 1
    # conflicts behaelt beide Tage einzeln.
    assert sorted(c["conflictDay"] for c in item["conflicts"]) == [
        start.isoformat(), (start + timedelta(days=1)).isoformat()
    ]
