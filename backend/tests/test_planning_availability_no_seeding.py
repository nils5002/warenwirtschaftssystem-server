from __future__ import annotations

from datetime import date, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from app.repositories import category_repository, planning_repository
from app.repositories import wms_repository
from .auth_helpers import auth_headers


def _headers(client: TestClient, role: str, user_id: str | None = None) -> dict[str, str]:
    return auth_headers(client, role, user_id=user_id)


def _seed_planning_with_items(client: TestClient, suffix: str, item_count: int) -> str:
    planning_date = date.today() + timedelta(days=21)
    payload = {
        "customerName": f"Kunde Pool {suffix}",
        "projectName": f"Projekt Pool {suffix}",
        "eventName": "Pool Test",
        "projectManagerUserId": f"pm-pool-{suffix}",
        "calendarWeek": planning_date.isocalendar().week,
        "startDate": planning_date.isoformat(),
        "endDate": planning_date.isoformat(),
        "notes": "Pool Regression",
        "status": "Entwurf",
        "days": [
            {
                "planningDate": planning_date.isoformat(),
                "weekday": "Montag",
                "items": [
                    {"categoryKey": "Laptop" if index % 2 == 0 else "iPad", "qty": 1, "notes": None}
                    for index in range(item_count)
                ],
            }
        ],
    }
    created = client.post(
        "/api/wms/planning",
        headers=_headers(client, "Projektmanager", f"pm-pool-{suffix}"),
        json=payload,
    )
    assert created.status_code == 200
    return created.json()["id"]


def test_normalize_category_for_db_does_not_seed_on_read_path(monkeypatch) -> None:
    client = TestClient(app)
    seed_calls: list[int] = []
    real_seed = category_repository.seed_standard_categories

    def tracking_seed(db) -> None:
        seed_calls.append(1)
        real_seed(db)

    monkeypatch.setattr(category_repository, "seed_standard_categories", tracking_seed)

    suffix = uuid4().hex[:8]
    planning_id = _seed_planning_with_items(client, suffix, item_count=4)

    seed_calls.clear()
    response = client.get(
        f"/api/wms/planning/{planning_id}/availability",
        headers=_headers(client, "Projektmanager", f"pm-pool-{suffix}"),
    )
    assert response.status_code == 200
    assert seed_calls == [], "seed_standard_categories must not be called from a read request"


def test_get_planning_availability_loads_active_categories_at_most_once(monkeypatch) -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    planning_id = _seed_planning_with_items(client, suffix, item_count=8)

    call_count = {"value": 0}
    real_active = category_repository.active_category_names

    def counting_active(db):
        call_count["value"] += 1
        return real_active(db)

    monkeypatch.setattr(category_repository, "active_category_names", counting_active)

    response = client.get(
        f"/api/wms/planning/{planning_id}/availability",
        headers=_headers(client, "Projektmanager", f"pm-pool-{suffix}"),
    )
    assert response.status_code == 200
    assert call_count["value"] <= 1, (
        "active_category_names must be loaded at most once per availability request, "
        f"called {call_count['value']} times"
    )


def test_overview_does_not_seed_or_query_categories_per_item(monkeypatch) -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _seed_planning_with_items(client, suffix, item_count=6)

    seed_calls: list[int] = []
    active_calls: list[int] = []
    real_seed = category_repository.seed_standard_categories
    real_active = category_repository.active_category_names

    def tracking_seed(db) -> None:
        seed_calls.append(1)
        real_seed(db)

    def counting_active(db):
        active_calls.append(1)
        return real_active(db)

    monkeypatch.setattr(category_repository, "seed_standard_categories", tracking_seed)
    monkeypatch.setattr(category_repository, "active_category_names", counting_active)

    response = client.get("/api/wms/overview", headers=_headers(client, "Admin"))
    assert response.status_code == 200
    assert seed_calls == [], "overview must not seed categories on read path"
    # Overview legitimately calls active_category_names a constant number of times
    # across different sub-queries (list_assets, _build_planning_summary, nested
    # get_open_conflict_counts_for_plannings). The threshold catches per-item
    # regressions: with 6 seeded items, any N+1 pattern would balloon past this.
    assert len(active_calls) <= 5, (
        "overview should load active category names a constant number of times, "
        f"observed {len(active_calls)}"
    )


def test_normalize_category_value_is_pure_and_db_free() -> None:
    active = {"Laptop", "iPad", "Sonstiges"}
    assert category_repository.normalize_category_value("Notebooks", active) == "Laptop"
    assert category_repository.normalize_category_value("iPads", active) == "iPad"
    assert category_repository.normalize_category_value("Unbekannt", active) == "Zuordnung erforderlich"
    assert category_repository.normalize_category_value(None, active) == "Zuordnung erforderlich"


def test_planning_repository_uses_db_free_normalizer() -> None:
    import inspect

    source = inspect.getsource(planning_repository.get_planning_availability)
    assert "normalize_category_for_db" not in source, (
        "get_planning_availability must not call normalize_category_for_db (per-item DB query)"
    )
    assert "normalize_category_value" in source

    overview_source = inspect.getsource(wms_repository._build_planning_summary)
    assert "normalize_category_for_db" not in overview_source
    assert "normalize_category_value" in overview_source
