from __future__ import annotations

from datetime import date, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from .auth_helpers import auth_headers


def _admin_headers(client: TestClient, suffix: str) -> dict[str, str]:
    return auth_headers(client, "Admin", user_id=f"adm-hdr-{suffix}")


def _pm_headers(client: TestClient, suffix: str) -> dict[str, str]:
    return auth_headers(client, "Projektmanager", user_id=f"pm-hdr-{suffix}")


def _employee_headers(client: TestClient, suffix: str) -> dict[str, str]:
    return auth_headers(client, "Mitarbeiter", user_id=f"emp-hdr-{suffix}")


def _build_payload(
    *,
    on_date: date,
    customer: str,
    project: str,
    event: str | None,
    pm_user_id: str,
    status: str = "Geplant",
    notes: str = "",
) -> dict:
    return {
        "customerName": customer,
        "projectName": project,
        "eventName": event,
        "projectManagerUserId": pm_user_id,
        "calendarWeek": on_date.isocalendar().week,
        "startDate": on_date.isoformat(),
        "endDate": on_date.isoformat(),
        "notes": notes,
        "status": status,
        "days": [
            {
                "planningDate": on_date.isoformat(),
                "weekday": "Montag",
                "items": [],
            }
        ],
    }


def test_update_planning_persists_customer_project_event() -> None:
    """PUT on an existing planning must update customer/project/event names and
    keep the changes visible in subsequent GET responses and in the list view."""
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    on_date = date.today() + timedelta(days=900)
    pm_user_id = f"pm-hdr-{suffix}"

    create_payload = _build_payload(
        on_date=on_date,
        customer=f"Kunde Alt {suffix}",
        project=f"Projekt Alt {suffix}",
        event=f"Veranstaltung Alt {suffix}",
        pm_user_id=pm_user_id,
        notes="erste version",
    )
    created = client.post(
        "/api/wms/planning",
        headers=_pm_headers(client, suffix),
        json=create_payload,
    )
    assert created.status_code == 200, created.text
    planning_id = created.json()["id"]

    update_payload = _build_payload(
        on_date=on_date,
        customer=f"Kunde Neu {suffix}",
        project=f"Projekt Neu {suffix}",
        event=f"Veranstaltung Neu {suffix}",
        pm_user_id=pm_user_id,
        notes="erste version",
    )
    updated = client.put(
        f"/api/wms/planning/{planning_id}",
        headers=_pm_headers(client, suffix),
        json=update_payload,
    )
    assert updated.status_code == 200, updated.text
    body = updated.json()
    assert body["customerName"] == f"Kunde Neu {suffix}"
    assert body["projectName"] == f"Projekt Neu {suffix}"
    assert body["eventName"] == f"Veranstaltung Neu {suffix}"

    refetched = client.get(
        f"/api/wms/planning/{planning_id}",
        headers=_pm_headers(client, suffix),
    )
    assert refetched.status_code == 200, refetched.text
    refetched_body = refetched.json()
    assert refetched_body["customerName"] == f"Kunde Neu {suffix}"
    assert refetched_body["projectName"] == f"Projekt Neu {suffix}"
    assert refetched_body["eventName"] == f"Veranstaltung Neu {suffix}"

    listed = client.get("/api/wms/planning", headers=_pm_headers(client, suffix))
    assert listed.status_code == 200, listed.text
    row = next((entry for entry in listed.json() if entry["id"] == planning_id), None)
    assert row is not None, "updated planning missing from list response"
    assert row["customerName"] == f"Kunde Neu {suffix}"
    assert row["projectName"] == f"Projekt Neu {suffix}"
    assert row["eventName"] == f"Veranstaltung Neu {suffix}"


def test_update_planning_can_clear_event_name() -> None:
    """Setting eventName to null on update must remove the previous event label."""
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    on_date = date.today() + timedelta(days=901)
    pm_user_id = f"pm-hdr-{suffix}"

    created = client.post(
        "/api/wms/planning",
        headers=_pm_headers(client, suffix),
        json=_build_payload(
            on_date=on_date,
            customer=f"Kunde {suffix}",
            project=f"Projekt {suffix}",
            event=f"Veranstaltung {suffix}",
            pm_user_id=pm_user_id,
        ),
    )
    assert created.status_code == 200, created.text
    planning_id = created.json()["id"]

    cleared = client.put(
        f"/api/wms/planning/{planning_id}",
        headers=_pm_headers(client, suffix),
        json=_build_payload(
            on_date=on_date,
            customer=f"Kunde {suffix}",
            project=f"Projekt {suffix}",
            event=None,
            pm_user_id=pm_user_id,
        ),
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["eventName"] is None


def test_employee_cannot_update_planning_header_fields() -> None:
    """Mitarbeiter must not be able to update planning header fields."""
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    on_date = date.today() + timedelta(days=902)
    pm_user_id = f"pm-hdr-{suffix}"

    created = client.post(
        "/api/wms/planning",
        headers=_pm_headers(client, suffix),
        json=_build_payload(
            on_date=on_date,
            customer=f"Kunde {suffix}",
            project=f"Projekt {suffix}",
            event=f"Veranstaltung {suffix}",
            pm_user_id=pm_user_id,
        ),
    )
    assert created.status_code == 200, created.text
    planning_id = created.json()["id"]

    forbidden = client.put(
        f"/api/wms/planning/{planning_id}",
        headers=_employee_headers(client, suffix),
        json=_build_payload(
            on_date=on_date,
            customer=f"Kunde Hijack {suffix}",
            project=f"Projekt Hijack {suffix}",
            event=f"Veranstaltung Hijack {suffix}",
            pm_user_id=pm_user_id,
        ),
    )
    assert forbidden.status_code == 403, forbidden.text

    refetched = client.get(
        f"/api/wms/planning/{planning_id}",
        headers=_pm_headers(client, suffix),
    )
    assert refetched.status_code == 200, refetched.text
    body = refetched.json()
    assert body["customerName"] == f"Kunde {suffix}"
    assert body["projectName"] == f"Projekt {suffix}"
    assert body["eventName"] == f"Veranstaltung {suffix}"


def test_admin_can_update_planning_header_fields() -> None:
    """Admin must be able to update header fields even if planning was created by a PM."""
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    on_date = date.today() + timedelta(days=903)
    pm_user_id = f"pm-hdr-{suffix}"

    created = client.post(
        "/api/wms/planning",
        headers=_pm_headers(client, suffix),
        json=_build_payload(
            on_date=on_date,
            customer=f"Kunde {suffix}",
            project=f"Projekt {suffix}",
            event=None,
            pm_user_id=pm_user_id,
        ),
    )
    assert created.status_code == 200, created.text
    planning_id = created.json()["id"]

    updated = client.put(
        f"/api/wms/planning/{planning_id}",
        headers=_admin_headers(client, suffix),
        json=_build_payload(
            on_date=on_date,
            customer=f"Kunde Admin {suffix}",
            project=f"Projekt Admin {suffix}",
            event=f"Veranstaltung Admin {suffix}",
            pm_user_id=pm_user_id,
        ),
    )
    assert updated.status_code == 200, updated.text
    body = updated.json()
    assert body["customerName"] == f"Kunde Admin {suffix}"
    assert body["projectName"] == f"Projekt Admin {suffix}"
    assert body["eventName"] == f"Veranstaltung Admin {suffix}"
