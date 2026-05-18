"""Tests fuer die regelbasierten Loesungs-Hinweise (conflictGroups.recommendations).

Abgedeckt:
* Reine Unit-Tests fuer ``build_conflict_recommendations`` (alle v1-Regeln).
* Integration ueber ``GET /api/wms/overview``.
* Pflicht-Invarianten: ``openConflictCount`` und ``Sum(totalConflictEvents)``
  bleiben unveraendert; leere conflictGroups -> keine Empfehlungen.

Es gibt KEINE AI-/LLM-/API-Anbindung — alle Vorschlaege sind rein regelbasiert.
"""

from __future__ import annotations

from datetime import date, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from app.repositories.planning_repository import build_conflict_recommendations

from .auth_helpers import auth_headers


# -----------------------------------------------------------------------------
# Unit-Tests: build_conflict_recommendations (rein, kein DB)
# -----------------------------------------------------------------------------
def _recos(**overrides):
    base = dict(
        category_key="QR-Code-Scanner",
        date_from=date(2027, 6, 8),
        date_to=date(2027, 6, 9),
        max_missing_qty=7,
        affected_planning_ids=["pln-a", "pln-b"],
        draft_planning_ids=[],
        handover_planning_ids=[],
    )
    base.update(overrides)
    return build_conflict_recommendations(**base)


def test_shortage_produces_procurement_recommendation() -> None:
    recos = _recos()
    procurement = [r for r in recos if r.type == "procurement"]
    assert len(procurement) == 1
    assert procurement[0].suggestedQty == 7
    assert procurement[0].priority == "high"
    # Hinweis-Formulierung, keine harte Anweisung.
    assert "kaufen" not in procurement[0].title.lower()
    assert "beschaffen oder mieten" in procurement[0].title


def test_single_day_procurement_uses_rental_wording() -> None:
    recos = _recos(date_from=date(2027, 6, 8), date_to=date(2027, 6, 8), max_missing_qty=3)
    procurement = [r for r in recos if r.type == "procurement"][0]
    assert "Kurzfristige Miete" in procurement.title
    assert procurement.priority == "medium"  # max_missing 3 < 5


def test_multiple_plannings_produce_coordination_recommendation() -> None:
    recos = _recos(affected_planning_ids=["a", "b", "c"])
    coord = [r for r in recos if r.type == "planning_adjustment" and "abstimmen" in r.title]
    assert len(coord) == 1
    assert coord[0].affectedPlanningIds == ["a", "b", "c"]


def test_single_planning_has_no_coordination_recommendation() -> None:
    recos = _recos(affected_planning_ids=["a"])
    assert not [r for r in recos if "abstimmen" in r.title]


def test_draft_plannings_produce_demand_check_recommendation() -> None:
    recos = _recos(draft_planning_ids=["a"])
    draft = [r for r in recos if "Entwurf" in r.title]
    assert len(draft) == 1
    assert draft[0].affectedPlanningIds == ["a"]


def test_no_draft_plannings_no_demand_check() -> None:
    assert not [r for r in _recos(draft_planning_ids=[]) if "Entwurf" in r.title]


def test_laptop_category_produces_compatibility_recommendation() -> None:
    assert [r for r in _recos(category_key="Laptop") if "Kompatibilität" in r.title]
    assert not [r for r in _recos(category_key="QR-Code-Scanner") if "Kompatibilität" in r.title]


def test_handover_produces_handover_recommendation() -> None:
    recos = _recos(handover_planning_ids=["a"])
    handover = [r for r in recos if r.type == "handover"]
    assert len(handover) == 1
    assert handover[0].affectedPlanningIds == ["a"]
    assert not [r for r in _recos() if r.type == "handover"]


def test_recommendations_sorted_high_to_low() -> None:
    recos = _recos(
        category_key="Laptop",
        affected_planning_ids=["a", "b"],
        draft_planning_ids=["a"],
        handover_planning_ids=["a"],
    )
    rank = {"high": 0, "medium": 1, "low": 2}
    sequence = [rank[r.priority] for r in recos]
    assert sequence == sorted(sequence)


# -----------------------------------------------------------------------------
# Integration: GET /api/wms/overview -> conflictGroups[].recommendations
# -----------------------------------------------------------------------------
def _admin(client: TestClient) -> dict[str, str]:
    return auth_headers(client, "Admin")


def _pm(client: TestClient, suffix: str) -> dict[str, str]:
    return auth_headers(client, "Projektmanager", user_id=f"pm-cr-{suffix}")


def _reset(client: TestClient) -> None:
    res = client.post("/api/wms/backup/reset-for-import", headers=_admin(client))
    assert res.status_code == 200, res.text


def _create_category(client: TestClient, suffix: str) -> str:
    name = f"CR-Cat-{suffix}"
    res = client.post("/api/wms/categories", headers=_admin(client), json={"name": name})
    assert res.status_code == 200, res.text
    return name


def _create_asset(client: TestClient, suffix: str, category: str, index: int) -> None:
    unique = uuid4().hex[:10]
    payload = {
        "id": f"asset-cr-{suffix}-{index}-{unique}",
        "name": f"CR {suffix} #{index}",
        "category": category,
        "location": "Hauptlager",
        "status": "Verfuegbar",
        "assignedTo": "-",
        "nextReturn": "-",
        "tagNumber": f"CR-{suffix}-{unique}",
        "serialNumber": f"CR-{suffix}-SN-{unique}",
        "qrCode": "",
        "maintenanceState": "Neu",
        "notes": "",
        "lastCheckout": "-",
        "nextReservation": "-",
    }
    res = client.post("/api/wms/assets", headers=_admin(client), json=payload)
    assert res.status_code == 200, res.text


def _create_planning(
    client: TestClient, suffix: str, *, status: str, days: list[tuple[date, list[dict]]]
) -> str:
    ordered = sorted(days, key=lambda entry: entry[0])
    payload = {
        "customerName": f"CR Kunde {suffix}",
        "projectName": f"CR Projekt {suffix}",
        "eventName": "CR-Test",
        "projectManagerUserId": f"pm-cr-{suffix}",
        "startDate": ordered[0][0].isoformat(),
        "endDate": (ordered[-1][0] + timedelta(days=1)).isoformat(),
        "notes": "",
        "status": status,
        "days": [
            {"planningDate": day.isoformat(), "weekday": "Montag", "items": items}
            for day, items in ordered
        ],
    }
    res = client.post("/api/wms/planning", headers=_pm(client, suffix), json=payload)
    assert res.status_code == 200, res.text
    return res.json()["id"]


def _planning_summary(client: TestClient) -> dict:
    res = client.get("/api/wms/overview", headers=_admin(client))
    assert res.status_code == 200, res.text
    summary = res.json().get("planningSummary")
    assert summary is not None
    return summary


def test_shared_qr_engpass_produces_recommendations() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)
    cat = _create_category(client, suffix)
    for index in range(5):
        _create_asset(client, suffix, cat, index)

    base = date.today() + timedelta(days=600)
    conflict_days = [base, base + timedelta(days=1), base + timedelta(days=2)]
    # 3 Entwurf-Planungen, je 3 Tage, je 4 Stück -> Tagesbedarf 12, nutzbar 5.
    for n in range(3):
        _create_planning(
            client, f"{suffix}-{n}", status="Entwurf",
            days=[(d, [{"categoryKey": cat, "qty": 4, "notes": None}]) for d in conflict_days],
        )

    summary = _planning_summary(client)
    # Invarianten: Konfliktzählung unverändert.
    assert summary["openConflictCount"] == 9
    groups = summary["conflictGroups"]
    assert len(groups) == 1
    assert sum(g["totalConflictEvents"] for g in groups) == summary["openConflictCount"]

    recos = groups[0]["recommendations"]
    assert recos, "Konfliktursache muss Lösungsvorschläge tragen"
    types = {r["type"] for r in recos}
    # Beschaffungs-/Mietvorschlag vorhanden.
    procurement = [r for r in recos if r["type"] == "procurement"]
    assert len(procurement) == 1
    # Tagesbedarf 12, nutzbar 5 -> Fehlmenge 7 = maxMissingQty = suggestedQty.
    assert procurement[0]["suggestedQty"] == 7
    # Mehrere betroffene Planungen -> Abstimmungsvorschlag.
    assert "planning_adjustment" in types
    assert any("abstimmen" in r["title"] for r in recos)
    # Entwurf-Planungen beteiligt -> Bedarf-prüfen-Vorschlag.
    assert any("Entwurf" in r["title"] for r in recos)


def test_no_conflicts_produce_no_recommendations() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)
    cat = _create_category(client, suffix)
    for index in range(10):
        _create_asset(client, suffix, cat, index)
    # Bedarf < Bestand -> kein Konflikt, keine Gruppe, keine Empfehlung.
    _create_planning(
        client, suffix, status="Geplant",
        days=[(date.today() + timedelta(days=620), [{"categoryKey": cat, "qty": 3, "notes": None}])],
    )

    summary = _planning_summary(client)
    assert summary["openConflictCount"] == 0
    assert summary["conflictGroups"] == []


def test_geplant_only_engpass_has_no_draft_recommendation() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)
    cat = _create_category(client, suffix)
    for index in range(2):
        _create_asset(client, suffix, cat, index)
    # Eine einzelne Planung im Status Geplant -> Engpass, aber kein Entwurf
    # und nur 1 Planung -> kein Abstimmungs-, kein Entwurf-Vorschlag.
    _create_planning(
        client, suffix, status="Geplant",
        days=[(date.today() + timedelta(days=640), [{"categoryKey": cat, "qty": 5, "notes": None}])],
    )

    summary = _planning_summary(client)
    assert summary["openConflictCount"] == 1
    recos = summary["conflictGroups"][0]["recommendations"]
    assert any(r["type"] == "procurement" for r in recos)
    assert not any("Entwurf" in r["title"] for r in recos)
    assert not any("abstimmen" in r["title"] for r in recos)
