"""Regressionstest: Im Kategorien-Modul angelegte (nicht-kanonische)
Kategorien muessen in der Einsatzplanung planbar sein.

Hintergrund: Selbst angelegte Kategorien wie "Eigener Laptop" oder "DYMO"
liessen sich nicht einplanen. Ursache war das Frontend (``PlanningPage``),
das jeden ``categoryKey`` ueber ``normalizeCategory`` auf eine der 12
kanonischen Kategorien zwang ("Eigener Laptop" -> "Sonstiges"). Beim
Speichern ging die echte Kategorie damit verloren.

Diese Tests sichern den Backend-Kontrakt, auf den sich der Frontend-Fix
verlaesst: Eine aktive, nicht-kanonische Kategorie wird von ``upsert`` und
``availability`` unveraendert verarbeitet — sie wird NICHT auf "Sonstiges"
oder "Zuordnung erforderlich" abgebildet.
"""

from __future__ import annotations

from datetime import date, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from .auth_helpers import auth_headers


def _admin_headers(client: TestClient) -> dict[str, str]:
    return auth_headers(client, "Admin")


def test_custom_category_is_planbar_and_survives_upsert() -> None:
    """Custom-Kategorie bleibt in Planung + Availability exakt erhalten."""
    client = TestClient(app)
    suffix = uuid4().hex[:6]
    # Bewusst KEIN kanonischer Name und kein Synonym — sonst lehnt
    # POST /categories mit 409 ab (category_hint).
    custom_category = f"Sondergeraet-{suffix}"

    created_category = client.post(
        "/api/wms/categories",
        headers=_admin_headers(client),
        json={"name": custom_category},
    )
    assert created_category.status_code == 200, created_category.text
    category_id = created_category.json()["id"]

    planning_id: str | None = None
    try:
        planning_date = date.today() + timedelta(days=30)
        pm_id = f"pm-custom-{suffix}"
        payload = {
            "customerName": f"Kunde Custom {suffix}",
            "projectName": f"Projekt Custom {suffix}",
            "projectManagerUserId": pm_id,
            "startDate": planning_date.isoformat(),
            "endDate": planning_date.isoformat(),
            "notes": "",
            "status": "Entwurf",
            "days": [
                {
                    "planningDate": planning_date.isoformat(),
                    "weekday": "Montag",
                    "items": [{"categoryKey": custom_category, "qty": 2, "notes": None}],
                }
            ],
        }
        created = client.post(
            "/api/wms/planning",
            headers=auth_headers(client, "Projektmanager", user_id=pm_id),
            json=payload,
        )
        assert created.status_code == 200, created.text
        planning_id = created.json()["id"]

        # 1) Die gespeicherte Planung haelt die Custom-Kategorie unveraendert.
        stored_keys = [
            item["categoryKey"]
            for day in created.json()["days"]
            for item in day["items"]
        ]
        assert stored_keys == [custom_category], stored_keys

        # 2) Auch ein frisches GET liefert die Custom-Kategorie zurueck.
        fetched = client.get(
            f"/api/wms/planning/{planning_id}",
            headers=auth_headers(client, "Projektmanager", user_id=pm_id),
        )
        assert fetched.status_code == 200, fetched.text
        fetched_keys = [
            item["categoryKey"]
            for day in fetched.json()["days"]
            for item in day["items"]
        ]
        assert fetched_keys == [custom_category], fetched_keys

        # 3) Availability fuehrt die Custom-Kategorie in der categorySummary.
        availability = client.get(
            f"/api/wms/planning/{planning_id}/availability",
            headers=auth_headers(client, "Projektmanager", user_id=pm_id),
        )
        assert availability.status_code == 200, availability.text
        summary_keys = {
            entry["categoryKey"] for entry in availability.json()["categorySummary"]
        }
        assert custom_category in summary_keys, summary_keys
        item_keys = {entry["categoryKey"] for entry in availability.json()["items"]}
        assert custom_category in item_keys, item_keys
    finally:
        if planning_id is not None:
            client.delete(
                f"/api/wms/planning/{planning_id}",
                headers=_admin_headers(client),
            )
        client.delete(
            f"/api/wms/categories/{category_id}",
            headers=_admin_headers(client),
        )
