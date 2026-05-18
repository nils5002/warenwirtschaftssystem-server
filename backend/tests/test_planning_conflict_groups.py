"""Tests fuer die Konfliktursachen-Gruppierung (planningSummary.conflictGroups).

Abgedeckt:
* Reine Unit-Tests fuer ``group_conflict_causes`` (Gruppierung nach Kategorie +
  zusammenhaengenden Datums-Laeufen).
* Integration ueber ``GET /api/wms/overview``.
* Pflicht-Invarianten:
  - ``openConflictCount`` bleibt unveraendert (technische Konfliktzahl).
  - ``Sum(conflictGroups.totalConflictEvents) == openConflictCount``.
  - gemeinsamer Pool-Engpass -> EINE Ursache.
  - mehrere Kategorien -> getrennte Gruppen.
  - nicht zusammenhaengende Tage -> getrennte Gruppen.
"""

from __future__ import annotations

from datetime import date, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from app.repositories.planning_repository import group_conflict_causes
from app.schemas.planning import PlanningConflictDetail

from .auth_helpers import auth_headers

_D = date(2027, 6, 8)


# -----------------------------------------------------------------------------
# Unit-Tests: group_conflict_causes (rein, kein DB)
# -----------------------------------------------------------------------------
def _cell(category: str, day: date, missing: int, *, required: int = 0, usable: int = 0) -> PlanningConflictDetail:
    return PlanningConflictDetail(
        categoryKey=category,
        conflictDay=day,
        shortageReason="real_shortage",
        conflictSeverity="echter_engpass",
        conflictLabel="Echter Engpass",
        unresolvedShortageQty=missing,
        totalRequiredQty=required,
        usableStock=usable,
    )


def _summaries(mapping: dict[str, list[PlanningConflictDetail]]) -> dict[str, dict[str, object]]:
    return {
        ext_id: {"count": len(cells), "missing": [], "conflicts": cells}
        for ext_id, cells in mapping.items()
    }


def test_shared_pool_engpass_is_one_cause() -> None:
    cells_a = [_cell("QR-Code-Scanner", _D, 7, required=35, usable=28),
               _cell("QR-Code-Scanner", _D + timedelta(days=1), 1, required=29, usable=28)]
    cells_b = [_cell("QR-Code-Scanner", _D, 7, required=35, usable=28),
               _cell("QR-Code-Scanner", _D + timedelta(days=1), 1, required=29, usable=28)]
    groups = group_conflict_causes(
        _summaries({"pln-a": cells_a, "pln-b": cells_b}),
        {"pln-a": "Kunde A / Projekt A", "pln-b": "Kunde B / Projekt B"},
    )
    assert len(groups) == 1
    group = groups[0]
    assert group.categoryKey == "QR-Code-Scanner"
    assert group.dateFrom == _D
    assert group.dateTo == _D + timedelta(days=1)
    assert group.totalConflictEvents == 4
    assert group.affectedPlanningCount == 2
    assert group.maxMissingQty == 7
    assert len(group.days) == 2
    assert sorted(group.affectedPlanningLabels) == ["Kunde A / Projekt A", "Kunde B / Projekt B"]


def test_multiple_categories_are_separate_groups() -> None:
    groups = group_conflict_causes(
        _summaries({"pln-a": [_cell("QR-Code-Scanner", _D, 7), _cell("Laptop", _D, 3)]}),
        {"pln-a": "Kunde A / Projekt A"},
    )
    assert {g.categoryKey for g in groups} == {"QR-Code-Scanner", "Laptop"}
    assert len(groups) == 2


def test_non_contiguous_days_are_separate_groups() -> None:
    cells = [_cell("QR-Code-Scanner", _D, 7),
             _cell("QR-Code-Scanner", _D + timedelta(days=5), 4)]
    groups = group_conflict_causes(_summaries({"pln-a": cells}), {"pln-a": "A / A"})
    assert len(groups) == 2
    assert {(g.dateFrom, g.dateTo) for g in groups} == {
        (_D, _D), (_D + timedelta(days=5), _D + timedelta(days=5))
    }


def test_one_day_gap_stays_one_group_two_day_gap_splits() -> None:
    one_gap = group_conflict_causes(
        _summaries({"p": [_cell("Laptop", _D, 1), _cell("Laptop", _D + timedelta(days=1), 1)]}),
        {"p": "A / A"},
    )
    assert len(one_gap) == 1
    two_gap = group_conflict_causes(
        _summaries({"p": [_cell("Laptop", _D, 1), _cell("Laptop", _D + timedelta(days=2), 1)]}),
        {"p": "A / A"},
    )
    assert len(two_gap) == 2


def test_no_conflicts_yields_no_groups() -> None:
    assert group_conflict_causes({}, {}) == []


# -----------------------------------------------------------------------------
# Integration: GET /api/wms/overview -> planningSummary.conflictGroups
# -----------------------------------------------------------------------------
def _admin(client: TestClient) -> dict[str, str]:
    return auth_headers(client, "Admin")


def _pm(client: TestClient, suffix: str) -> dict[str, str]:
    return auth_headers(client, "Projektmanager", user_id=f"pm-cg-{suffix}")


def _reset(client: TestClient) -> None:
    res = client.post("/api/wms/backup/reset-for-import", headers=_admin(client))
    assert res.status_code == 200, res.text


def _create_category(client: TestClient, suffix: str, label: str) -> str:
    name = f"CG-{label}-{suffix}"
    res = client.post("/api/wms/categories", headers=_admin(client), json={"name": name})
    assert res.status_code == 200, res.text
    return name


def _create_asset(client: TestClient, suffix: str, category: str, index: int) -> None:
    unique = uuid4().hex[:10]
    payload = {
        "id": f"asset-cg-{suffix}-{index}-{unique}",
        "name": f"CG {suffix} {category} #{index}",
        "category": category,
        "location": "Hauptlager",
        "status": "Verfuegbar",
        "assignedTo": "-",
        "nextReturn": "-",
        "tagNumber": f"CG-{suffix}-{unique}",
        "serialNumber": f"CG-{suffix}-SN-{unique}",
        "qrCode": "",
        "maintenanceState": "Neu",
        "notes": "",
        "lastCheckout": "-",
        "nextReservation": "-",
    }
    res = client.post("/api/wms/assets", headers=_admin(client), json=payload)
    assert res.status_code == 200, res.text


def _create_planning(client: TestClient, suffix: str, *, days: list[tuple[date, list[dict]]]) -> str:
    ordered = sorted(days, key=lambda entry: entry[0])
    start = ordered[0][0]
    # endDate ist exklusiv -> letzter Tag + 1, damit alle Tage abgedeckt sind.
    end = ordered[-1][0] + timedelta(days=1)
    payload = {
        "customerName": f"CG Kunde {suffix}",
        "projectName": f"CG Projekt {suffix}",
        "eventName": "CG-Test",
        "projectManagerUserId": f"pm-cg-{suffix}",
        "startDate": start.isoformat(),
        "endDate": end.isoformat(),
        "notes": "",
        "status": "Geplant",
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


def test_shared_qr_scanner_engpass_grouped_as_one_cause() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)
    cat = _create_category(client, suffix, "Scanner")
    for index in range(5):
        _create_asset(client, suffix, cat, index)

    base = date.today() + timedelta(days=500)
    conflict_days = [base, base + timedelta(days=1), base + timedelta(days=2)]
    # 3 Planungen, je 3 Tage, je 4 Stueck -> Tagesbedarf 12, nutzbar 5.
    for n in range(3):
        _create_planning(
            client, f"{suffix}-{n}",
            days=[(d, [{"categoryKey": cat, "qty": 4, "notes": None}]) for d in conflict_days],
        )

    summary = _planning_summary(client)
    # 3 Planungen x 3 Tage = 9 technische Konflikte.
    assert summary["openConflictCount"] == 9
    groups = summary["conflictGroups"]
    assert len(groups) == 1
    assert summary["conflictCauseCount"] == 1
    group = groups[0]
    assert group["categoryKey"] == cat
    assert group["totalConflictEvents"] == 9
    assert group["affectedPlanningCount"] == 3
    assert len(group["days"]) == 3
    assert group["dateFrom"] == base.isoformat()
    assert group["dateTo"] == (base + timedelta(days=2)).isoformat()
    # Invariante: Summe der Gruppen-Events == technische Konfliktzahl.
    assert sum(g["totalConflictEvents"] for g in groups) == summary["openConflictCount"]
    # Tagesdetail traegt benoetigt/nutzbar/fehlt.
    day0 = next(d for d in group["days"] if d["date"] == base.isoformat())
    assert day0["requiredQty"] == 12
    assert day0["usableStock"] == 5
    assert day0["missingQty"] == 7


def test_multiple_categories_create_separate_groups() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)
    cat_a = _create_category(client, suffix, "A")
    cat_b = _create_category(client, suffix, "B")
    for index in range(2):
        _create_asset(client, suffix, cat_a, index)
        _create_asset(client, suffix, cat_b, index)

    day = date.today() + timedelta(days=520)
    _create_planning(
        client, suffix,
        days=[(day, [
            {"categoryKey": cat_a, "qty": 5, "notes": None},
            {"categoryKey": cat_b, "qty": 5, "notes": None},
        ])],
    )

    summary = _planning_summary(client)
    groups = summary["conflictGroups"]
    assert {g["categoryKey"] for g in groups} == {cat_a, cat_b}
    assert summary["conflictCauseCount"] == 2
    assert sum(g["totalConflictEvents"] for g in groups) == summary["openConflictCount"]


def test_non_contiguous_days_create_separate_groups() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)
    cat = _create_category(client, suffix, "Gap")
    for index in range(2):
        _create_asset(client, suffix, cat, index)

    day_one = date.today() + timedelta(days=540)
    day_far = day_one + timedelta(days=12)
    # Zwei eintaegige Planungen mit grossem Abstand -> getrennte Ursachen.
    _create_planning(client, f"{suffix}-1", days=[(day_one, [{"categoryKey": cat, "qty": 5, "notes": None}])])
    _create_planning(client, f"{suffix}-2", days=[(day_far, [{"categoryKey": cat, "qty": 5, "notes": None}])])

    summary = _planning_summary(client)
    groups = [g for g in summary["conflictGroups"] if g["categoryKey"] == cat]
    assert len(groups) == 2
    assert sum(g["totalConflictEvents"] for g in summary["conflictGroups"]) == summary["openConflictCount"]


def test_open_conflict_count_unchanged_when_no_conflicts() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)
    cat = _create_category(client, suffix, "Plenty")
    for index in range(10):
        _create_asset(client, suffix, cat, index)
    # Bedarf < Bestand -> kein Konflikt, keine Ursache.
    _create_planning(
        client, suffix,
        days=[(date.today() + timedelta(days=560), [{"categoryKey": cat, "qty": 3, "notes": None}])],
    )

    summary = _planning_summary(client)
    assert summary["openConflictCount"] == 0
    assert summary["conflictGroups"] == []
    assert summary["conflictCauseCount"] == 0
