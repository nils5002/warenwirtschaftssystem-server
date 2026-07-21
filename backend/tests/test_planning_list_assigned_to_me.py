"""Persönliche Planungsliste (GET /api/wms/planning?assignedToMe=true):
liefert nur Planungen, in denen der eingeloggte Benutzer als Projekt-
verantwortlicher ODER On-Site-Verantwortlicher hinterlegt ist. Grundlage
für den benutzerbezogenen Dashboard-Planungsüberblick — auch Admins sehen
dort nur ihre eigenen Zuweisungen, nicht automatisch alles.
"""

from __future__ import annotations

from datetime import date, timedelta

from fastapi.testclient import TestClient

from app.main import app
from .auth_helpers import auth_headers


def _admin_headers(client: TestClient) -> dict[str, str]:
    return auth_headers(client, "Admin")


def _reset(client: TestClient) -> None:
    res = client.post("/api/wms/backup/reset-for-import", headers=_admin_headers(client))
    assert res.status_code == 200, res.text


def _planning_payload(
    label: str,
    project_manager_user_id: str | None = None,
    on_site_user_id: str | None = None,
    start_offset_days: int = 7,
) -> dict:
    day = date.today() + timedelta(days=start_offset_days)
    return {
        "customerName": f"Kunde {label}",
        "projectName": f"Projekt {label}",
        "eventName": None,
        "projectManagerUserId": project_manager_user_id,
        "onSiteResponsibleUserId": on_site_user_id,
        "startDate": day.isoformat(),
        "endDate": (day + timedelta(days=1)).isoformat(),
        "notes": "",
        "status": "Geplant",
        "days": [{"planningDate": day.isoformat(), "weekday": "Montag", "items": []}],
    }


def _create_planning(client: TestClient, payload: dict) -> dict:
    res = client.post("/api/wms/planning", headers=_admin_headers(client), json=payload)
    assert res.status_code == 200, res.text
    return res.json()


def _list_assigned_ids(client: TestClient, headers: dict[str, str], query: str = "assignedToMe=true") -> set[str]:
    res = client.get(f"/api/wms/planning?{query}", headers=headers)
    assert res.status_code == 200, res.text
    return {item["id"] for item in res.json()}


def test_assigned_to_me_filters_by_pm_and_on_site() -> None:
    client = TestClient(app)
    _reset(client)
    headers_u1 = auth_headers(client, "Mitarbeiter", user_id="usr-dash-u1")
    headers_u2 = auth_headers(client, "Mitarbeiter", user_id="usr-dash-u2")

    as_pm = _create_planning(client, _planning_payload("PM", project_manager_user_id="usr-dash-u1"))
    as_on_site = _create_planning(client, _planning_payload("OnSite", on_site_user_id="usr-dash-u1"))
    foreign = _create_planning(client, _planning_payload("Fremd", on_site_user_id="usr-dash-u2"))

    ids_u1 = _list_assigned_ids(client, headers_u1)
    assert ids_u1 == {as_pm["id"], as_on_site["id"]}

    ids_u2 = _list_assigned_ids(client, headers_u2)
    assert ids_u2 == {foreign["id"]}


def test_assigned_to_me_empty_for_user_without_assignments() -> None:
    client = TestClient(app)
    _reset(client)
    headers_u3 = auth_headers(client, "Mitarbeiter", user_id="usr-dash-u3")
    _create_planning(client, _planning_payload("Fremd", on_site_user_id="usr-test-admin"))

    assert _list_assigned_ids(client, headers_u3) == set()


def test_admin_does_not_see_all_plannings_with_assigned_to_me() -> None:
    client = TestClient(app)
    _reset(client)
    headers_u4 = auth_headers(client, "Mitarbeiter", user_id="usr-dash-u4")
    admin_headers = _admin_headers(client)

    own = _create_planning(client, _planning_payload("AdminEigen", project_manager_user_id="usr-test-admin"))
    other = _create_planning(client, _planning_payload("MitarbeiterEigen", on_site_user_id="usr-dash-u4"))

    # Admin sieht persönlich nur die eigene Zuweisung — keine Sonderrolle.
    assert _list_assigned_ids(client, admin_headers) == {own["id"]}
    # Ohne Filter bleibt die Gesamtliste unverändert vollständig.
    assert _list_assigned_ids(client, admin_headers, query="") >= {own["id"], other["id"]}
    assert _list_assigned_ids(client, headers_u4) == {other["id"]}


def test_assigned_to_me_combines_with_date_window() -> None:
    client = TestClient(app)
    _reset(client)
    headers_u5 = auth_headers(client, "Mitarbeiter", user_id="usr-dash-u5")

    past = _create_planning(
        client,
        _planning_payload("Vergangen", on_site_user_id="usr-dash-u5", start_offset_days=-30),
    )
    upcoming = _create_planning(
        client,
        _planning_payload("Kommend", on_site_user_id="usr-dash-u5", start_offset_days=7),
    )

    today = date.today().isoformat()
    ids = _list_assigned_ids(client, headers_u5, query=f"assignedToMe=true&fromDate={today}")
    assert upcoming["id"] in ids
    assert past["id"] not in ids
