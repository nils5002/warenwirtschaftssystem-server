from __future__ import annotations

from datetime import date, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from .auth_helpers import auth_headers


def _admin_headers(client: TestClient) -> dict[str, str]:
    return auth_headers(client, "Admin")


def _pm_headers(client: TestClient, suffix: str) -> dict[str, str]:
    return auth_headers(client, "Projektmanager", user_id=f"pm-missing-{suffix}")


def _create_category(client: TestClient, suffix: str, label: str) -> str:
    """Create an isolated category so this test's stock isn't polluted by other tests."""
    name = f"TstCat-{label}-{suffix}"
    res = client.post(
        "/api/wms/categories",
        headers=_admin_headers(client),
        json={"name": name},
    )
    assert res.status_code == 200, res.text
    return name


def _create_owned_asset(client: TestClient, suffix: str, category: str, index: int) -> str:
    unique = uuid4().hex[:10]
    payload = {
        "id": f"asset-missing-{suffix}-{category}-{index}-{unique}",
        "name": f"Stock {suffix} {category} #{index}",
        "category": category,
        "location": "Hauptlager",
        "status": "Verfuegbar",
        "assignedTo": "-",
        "nextReturn": "-",
        "tagNumber": f"MISS-{suffix}-{unique}",
        "serialNumber": f"MISS-{suffix}-SN-{unique}",
        "qrCode": "",
        "maintenanceState": "Neu",
        "notes": "",
        "lastCheckout": "-",
        "nextReservation": "-",
    }
    res = client.post("/api/wms/assets", headers=_admin_headers(client), json=payload)
    assert res.status_code == 200, res.text
    return payload["id"]


def _create_planning(
    client: TestClient,
    suffix: str,
    *,
    on_date: date,
    items: list[dict],
    project_name: str | None = None,
) -> str:
    payload = {
        "customerName": f"Kunde Missing {suffix}",
        "projectName": project_name or f"Projekt Missing {suffix}",
        "eventName": "Missing-Test",
        "projectManagerUserId": f"pm-missing-{suffix}",
        "calendarWeek": on_date.isocalendar().week,
        "startDate": on_date.isoformat(),
        "endDate": on_date.isoformat(),
        "notes": "",
        "status": "Geplant",
        "days": [
            {
                "planningDate": on_date.isoformat(),
                "weekday": "Montag",
                "items": items,
            }
        ],
    }
    res = client.post("/api/wms/planning", headers=_pm_headers(client, suffix), json=payload)
    assert res.status_code == 200, res.text
    return res.json()["id"]


def _fetch_list_item(client: TestClient, suffix: str, planning_id: str) -> dict:
    res = client.get("/api/wms/planning", headers=_pm_headers(client, suffix))
    assert res.status_code == 200, res.text
    for row in res.json():
        if row["id"] == planning_id:
            return row
    raise AssertionError(f"planning {planning_id} not in list response")


def test_missing_items_reports_shortage_per_category() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    # Far-future date so no other test's planning overlaps with us.
    on_date = date.today() + timedelta(days=730)

    cat = _create_category(client, suffix, "Single")
    for index in range(4):
        _create_owned_asset(client, suffix, cat, index)

    planning_id = _create_planning(
        client,
        suffix,
        on_date=on_date,
        items=[{"categoryKey": cat, "qty": 5, "notes": None}],
    )

    item = _fetch_list_item(client, suffix, planning_id)
    assert item["openConflictCount"] == 1
    assert item["missingItems"] == [
        {
            "categoryKey": cat,
            "missingQty": 1,
            "requiredQty": 5,
            "availableQty": 4,
        }
    ]


def test_missing_items_empty_when_demand_is_covered() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    on_date = date.today() + timedelta(days=731)

    cat = _create_category(client, suffix, "Covered")
    for index in range(4):
        _create_owned_asset(client, suffix, cat, index)

    planning_id = _create_planning(
        client,
        suffix,
        on_date=on_date,
        items=[{"categoryKey": cat, "qty": 3, "notes": None}],
    )

    item = _fetch_list_item(client, suffix, planning_id)
    assert item["openConflictCount"] == 0
    assert item["missingItems"] == []


def test_missing_items_sorted_by_severity_and_truncates_with_marker_in_frontend() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    on_date = date.today() + timedelta(days=732)

    cat_a = _create_category(client, suffix, "A")
    cat_b = _create_category(client, suffix, "B")
    # Only 1 of A, 1 of B → demand 3 each leaves 2 missing each. Tie on missingQty,
    # so sort falls back to lower-cased categoryKey, which is deterministic.
    _create_owned_asset(client, suffix, cat_a, 0)
    _create_owned_asset(client, suffix, cat_b, 0)

    planning_id = _create_planning(
        client,
        suffix,
        on_date=on_date,
        items=[
            {"categoryKey": cat_a, "qty": 3, "notes": None},
            {"categoryKey": cat_b, "qty": 4, "notes": None},
        ],
    )

    item = _fetch_list_item(client, suffix, planning_id)
    # Both categories appear; biggest shortage first.
    assert item["openConflictCount"] == 2
    missing = item["missingItems"]
    assert len(missing) == 2
    by_category = {entry["categoryKey"]: entry for entry in missing}
    assert by_category[cat_a]["missingQty"] == 2
    assert by_category[cat_b]["missingQty"] == 3
    # Sorted by (-missingQty, categoryKey.lower()).
    assert [entry["categoryKey"] for entry in missing] == [cat_b, cat_a]


def test_missing_items_excludes_handover_covered_shortage() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    source_date = date.today() + timedelta(days=733)
    target_date = source_date + timedelta(days=1)

    cat = _create_category(client, suffix, "Hand")
    # 4 assets total. Source planning demands 4 on day D-1 → exactly covers stock.
    # Target planning demands 4 on day D with handover from source. Other planning
    # demands 1 on day D too — so raw shortage on day D = 1, but handover from
    # the source planning (which had 4 available the day before) covers it.
    for index in range(4):
        _create_owned_asset(client, suffix, cat, index)

    source_id = _create_planning(
        client,
        f"{suffix}-src",
        on_date=source_date,
        items=[{"categoryKey": cat, "qty": 4, "notes": None}],
        project_name=f"Quelle {suffix}",
    )

    # Other planning on target day causing the 1-unit raw shortage.
    _create_planning(
        client,
        f"{suffix}-otr",
        on_date=target_date,
        items=[{"categoryKey": cat, "qty": 1, "notes": None}],
        project_name=f"Andere {suffix}",
    )

    target_id = _create_planning(
        client,
        f"{suffix}-tgt",
        on_date=target_date,
        items=[
            {
                "categoryKey": cat,
                "qty": 4,
                "notes": None,
                "handoverEnabled": True,
                "linkedPlanningId": source_id,
            }
        ],
        project_name=f"Ziel {suffix}",
    )

    target_item = _fetch_list_item(client, f"{suffix}-tgt", target_id)
    # Handover from source covers the 1-unit shortage → no missing items, no
    # open conflict for the target planning.
    assert target_item["openConflictCount"] == 0
    assert target_item["missingItems"] == []
