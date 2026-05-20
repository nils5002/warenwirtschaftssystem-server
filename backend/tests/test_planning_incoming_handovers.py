"""Regressionstests fuer incomingHandovers in Detail- und Availability-Endpoint.

Hintergrund: Uebergaben werden in der Datenbank asymmetrisch gespeichert —
nur die abgebende Seite traegt ein Item mit handoverEnabled/linkedPlanningId.
Damit die UI den Uebergabe-Block auch auf der empfangenden Seite zeigt, muss
die Detail- und Availability-API die eingehenden Verknuepfungen explizit
mitliefern (analog zum incoming-Zweig von _build_handover_list_summary_map
in der Listen-API).
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


def test_detail_endpoint_returns_incoming_handovers_for_receiver() -> None:
    """Empfaenger-Seite sieht eingehende Uebergabe im Detail-Endpoint.

    Konstellation: Planung A traegt handoverEnabled=True mit linkedPlanningId=B.
    Planung B hat selbst KEINE outgoing-Items. Die Detail-API von B muss die
    Verbindung trotzdem als incomingHandover ausweisen.
    """
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    planning_date = date.today() + timedelta(days=70)

    sender_pm = f"pm-sender-{suffix}"
    receiver_pm = f"pm-receiver-{suffix}"

    # Receiver (B) zuerst anlegen — braucht eigene Items, aber ohne Handover.
    receiver_payload = _build_planning_payload(
        suffix=f"recv-{suffix}",
        pm_user_id=receiver_pm,
        project_name=f"Receiver {suffix}",
        customer_name=f"Kunde Receiver/Sender {suffix}",
        start=planning_date,
        end=planning_date,
        items_per_day=[{"categoryKey": "Laptop", "qty": 2, "notes": None}],
    )
    created_receiver = client.post(
        "/api/wms/planning",
        headers=_headers(client, "Projektmanager", receiver_pm),
        json=receiver_payload,
    )
    assert created_receiver.status_code == 200, created_receiver.text
    receiver_id = created_receiver.json()["id"]

    # Sender (A) mit Handover-Link auf B.
    sender_payload = _build_planning_payload(
        suffix=f"send-{suffix}",
        pm_user_id=sender_pm,
        project_name=f"Sender {suffix}",
        customer_name=f"Kunde Receiver/Sender {suffix}",
        start=planning_date - timedelta(days=1),
        end=planning_date,
        items_per_day=[
            {
                "categoryKey": "Laptop",
                "qty": 3,
                "notes": None,
                "handoverEnabled": True,
                "linkedPlanningId": receiver_id,
                "handoverNote": "Sender uebergibt 3x Laptop an Receiver",
            }
        ],
    )
    created_sender = client.post(
        "/api/wms/planning",
        headers=_headers(client, "Projektmanager", sender_pm),
        json=sender_payload,
    )
    assert created_sender.status_code == 200, created_sender.text
    sender_id = created_sender.json()["id"]

    # Detail-Endpoint des Empfaengers MUSS die eingehende Uebergabe melden.
    detail = client.get(
        f"/api/wms/planning/{receiver_id}",
        headers=_headers(client, "Projektmanager", receiver_pm),
    )
    assert detail.status_code == 200, detail.text
    detail_body = detail.json()
    assert "incomingHandovers" in detail_body, "Detail-Response muss incomingHandovers liefern"
    incoming = detail_body["incomingHandovers"]
    assert len(incoming) >= 1, f"Erwartet mindestens 1 eingehende Uebergabe, bekommen: {incoming!r}"
    # Mindestens ein Eintrag muss den Sender als Partner ausweisen.
    matching = [entry for entry in incoming if entry["partnerPlanningId"] == sender_id]
    assert matching, f"Sender {sender_id} fehlt in incomingHandovers: {incoming!r}"
    entry = matching[0]
    assert entry["categoryKey"] == "Laptop"
    assert entry["partnerPlanningLabel"], "partnerPlanningLabel muss gesetzt sein"
    assert entry["qty"] >= 1
    assert entry["note"] == "Sender uebergibt 3x Laptop an Receiver"

    # Sender (A) selbst hat KEINE eingehende Uebergabe -> Liste leer.
    sender_detail = client.get(
        f"/api/wms/planning/{sender_id}",
        headers=_headers(client, "Projektmanager", sender_pm),
    )
    assert sender_detail.status_code == 200
    assert sender_detail.json().get("incomingHandovers", []) == [], (
        "Sender darf keine incomingHandovers haben — er ist die abgebende Seite"
    )


def test_availability_endpoint_returns_incoming_handovers_for_receiver() -> None:
    """Availability-Endpoint liefert eingehende Uebergaben analog zum Detail."""
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    planning_date = date.today() + timedelta(days=80)

    sender_pm = f"pm-av-sender-{suffix}"
    receiver_pm = f"pm-av-receiver-{suffix}"

    receiver_payload = _build_planning_payload(
        suffix=f"av-recv-{suffix}",
        pm_user_id=receiver_pm,
        project_name=f"Av Receiver {suffix}",
        customer_name=f"Kunde Av {suffix}",
        start=planning_date,
        end=planning_date,
        items_per_day=[{"categoryKey": "iPad", "qty": 1, "notes": None}],
    )
    created_receiver = client.post(
        "/api/wms/planning",
        headers=_headers(client, "Projektmanager", receiver_pm),
        json=receiver_payload,
    )
    assert created_receiver.status_code == 200, created_receiver.text
    receiver_id = created_receiver.json()["id"]

    sender_payload = _build_planning_payload(
        suffix=f"av-send-{suffix}",
        pm_user_id=sender_pm,
        project_name=f"Av Sender {suffix}",
        customer_name=f"Kunde Av {suffix}",
        start=planning_date - timedelta(days=1),
        end=planning_date,
        items_per_day=[
            {
                "categoryKey": "iPad",
                "qty": 2,
                "notes": None,
                "handoverEnabled": True,
                "linkedPlanningId": receiver_id,
                "handoverNote": "Av Sender uebergibt iPads",
            }
        ],
    )
    created_sender = client.post(
        "/api/wms/planning",
        headers=_headers(client, "Projektmanager", sender_pm),
        json=sender_payload,
    )
    assert created_sender.status_code == 200, created_sender.text
    sender_id = created_sender.json()["id"]

    availability = client.get(
        f"/api/wms/planning/{receiver_id}/availability",
        headers=_headers(client, "Projektmanager", receiver_pm),
    )
    assert availability.status_code == 200, availability.text
    body = availability.json()
    assert "incomingHandovers" in body, "Availability-Response muss incomingHandovers liefern"
    incoming = body["incomingHandovers"]
    matching = [entry for entry in incoming if entry["partnerPlanningId"] == sender_id]
    assert matching, f"Sender {sender_id} fehlt in incomingHandovers: {incoming!r}"
    entry = matching[0]
    assert entry["categoryKey"] == "iPad"
    assert entry["partnerPlanningLabel"]


def test_incoming_handovers_excludes_self_references() -> None:
    """Eine Planung, die sich selbst referenziert, darf keine incomingHandover-Eigenschleife erzeugen."""
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    planning_date = date.today() + timedelta(days=90)
    pm = f"pm-self-{suffix}"

    # Erst anlegen ohne Self-Link, dann Update mit Self-Link.
    payload = _build_planning_payload(
        suffix=f"self-{suffix}",
        pm_user_id=pm,
        project_name=f"Selfref {suffix}",
        customer_name=f"Kunde Self {suffix}",
        start=planning_date,
        end=planning_date,
        items_per_day=[{"categoryKey": "Drucker", "qty": 1, "notes": None}],
    )
    created = client.post(
        "/api/wms/planning",
        headers=_headers(client, "Projektmanager", pm),
        json=payload,
    )
    assert created.status_code == 200, created.text
    self_id = created.json()["id"]

    update_payload = dict(payload)
    update_payload["id"] = self_id
    update_payload["days"] = [
        {
            "planningDate": planning_date.isoformat(),
            "weekday": planning_date.strftime("%A"),
            "items": [
                {
                    "categoryKey": "Drucker",
                    "qty": 1,
                    "notes": None,
                    "handoverEnabled": True,
                    "linkedPlanningId": self_id,
                    "handoverNote": "self-reference (sollte ignoriert werden)",
                }
            ],
        }
    ]
    updated = client.put(
        f"/api/wms/planning/{self_id}",
        headers=_headers(client, "Projektmanager", pm),
        json=update_payload,
    )
    # Falls die API self-references gar nicht zulaesst, ist das auch in
    # Ordnung — Hauptsache, der incomingHandovers-Channel zeigt am Ende
    # keine Eigenschleife. Falls 200, weiter pruefen.
    if updated.status_code == 200:
        detail = client.get(
            f"/api/wms/planning/{self_id}",
            headers=_headers(client, "Projektmanager", pm),
        )
        assert detail.status_code == 200
        for entry in detail.json().get("incomingHandovers", []):
            assert entry["partnerPlanningId"] != self_id, (
                "Self-reference darf nicht als incomingHandover auftauchen"
            )
