"""Signaturfarben pro Benutzer: automatische Vergabe (deterministisch, stabil),
Startup-Backfill nur für leere Werte, Admin-Update mit Palette-Validierung,
manuell gesetzte Farben überleben die Automatik, Planungsliste liefert den
Verantwortlichen inkl. Farbe/Initialen mit.
"""

from __future__ import annotations

from datetime import date, timedelta

from fastapi.testclient import TestClient

from app.database.session import SessionLocal
from app.domain.user_colors import USER_SIGNATURE_COLORS, pick_signature_color
from app.main import app
from app.repositories.wms_repository import ensure_signature_colors
from app.database.models import UserRecord
from sqlalchemy import select

from .auth_helpers import auth_headers


def _headers(client: TestClient, role: str, user_id: str | None = None) -> dict[str, str]:
    return auth_headers(client, role, user_id=user_id)


def _reset(client: TestClient) -> None:
    res = client.post("/api/wms/backup/reset-for-import", headers=_headers(client, "Admin"))
    assert res.status_code == 200, res.text


def _create_user(client: TestClient, suffix: str) -> dict:
    payload = {
        "id": f"usr-sig-{suffix}",
        "name": f"Sig Tester {suffix}",
        "email": f"sig.{suffix}@example.local",
        "role": "Mitarbeiter",
        "lastActive": "-",
        "status": "Aktiv",
    }
    res = client.post("/api/wms/users", headers=_headers(client, "Admin"), json=payload)
    assert res.status_code == 200, res.text
    return res.json()


def test_new_user_gets_stable_palette_color() -> None:
    client = TestClient(app)
    _reset(client)
    created = _create_user(client, "a1")
    assert created["signatureColor"] in USER_SIGNATURE_COLORS
    assert created["signatureColorSource"] == "auto"
    # Deterministisch: identisch zur Ableitung aus der ID, stabil bei Reload.
    assert created["signatureColor"] == pick_signature_color(created["id"])
    res = client.get("/api/wms/users", headers=_headers(client, "Admin"))
    listed = [item for item in res.json() if item["id"] == created["id"]][0]
    assert listed["signatureColor"] == created["signatureColor"]


def test_backfill_fills_only_missing_colors() -> None:
    client = TestClient(app)
    _reset(client)
    created = _create_user(client, "b1")
    with SessionLocal() as db:
        record = db.scalar(select(UserRecord).where(UserRecord.external_id == created["id"]))
        record.signature_color = None
        record.signature_color_source = None
        db.commit()
        filled = ensure_signature_colors(db)
        assert filled >= 1
        db.refresh(record)
        assert record.signature_color == pick_signature_color(created["id"])
        assert record.signature_color_source == "auto"
        # Idempotent: zweiter Lauf ändert nichts mehr.
        assert ensure_signature_colors(db) == 0


def test_admin_sets_manual_color_and_automatic_never_overwrites() -> None:
    client = TestClient(app)
    _reset(client)
    created = _create_user(client, "c1")
    manual_color = next(c for c in USER_SIGNATURE_COLORS if c != created["signatureColor"])
    res = client.patch(
        f"/api/wms/users/{created['id']}",
        headers=_headers(client, "Admin"),
        json={"signatureColor": manual_color},
    )
    assert res.status_code == 200, res.text
    assert res.json()["signatureColor"] == manual_color
    assert res.json()["signatureColorSource"] == "manual"

    # Backfill darf die manuelle Farbe nicht anfassen.
    with SessionLocal() as db:
        ensure_signature_colors(db)
        record = db.scalar(select(UserRecord).where(UserRecord.external_id == created["id"]))
        assert record.signature_color == manual_color
        assert record.signature_color_source == "manual"


def test_invalid_color_is_rejected() -> None:
    client = TestClient(app)
    _reset(client)
    created = _create_user(client, "d1")
    res = client.patch(
        f"/api/wms/users/{created['id']}",
        headers=_headers(client, "Admin"),
        json={"signatureColor": "#123456"},
    )
    assert res.status_code == 422, res.text


def test_non_admin_cannot_change_color() -> None:
    client = TestClient(app)
    _reset(client)
    created = _create_user(client, "e1")
    res = client.patch(
        f"/api/wms/users/{created['id']}",
        headers=_headers(client, "Mitarbeiter", user_id="usr-sig-worker"),
        json={"signatureColor": USER_SIGNATURE_COLORS[0]},
    )
    assert res.status_code in {401, 403}, res.text


def test_planning_list_contains_responsible_user_with_color() -> None:
    client = TestClient(app)
    _reset(client)
    created = _create_user(client, "f1")
    day = date.today() + timedelta(days=5)
    res = client.post(
        "/api/wms/planning",
        headers=_headers(client, "Admin"),
        json={
            "customerName": "Kunde Farbe",
            "projectName": "Projekt Farbe",
            "eventName": None,
            "projectManagerUserId": created["id"],
            "startDate": day.isoformat(),
            "endDate": day.isoformat(),
            "notes": "",
            "status": "Geplant",
            "days": [{"planningDate": day.isoformat(), "weekday": "Montag", "items": []}],
        },
    )
    assert res.status_code == 200, res.text
    planning_id = res.json()["id"]

    listed = client.get("/api/wms/planning", headers=_headers(client, "Admin")).json()
    row = [item for item in listed if item["id"] == planning_id][0]
    responsible = row["responsibleUser"]
    assert responsible is not None
    assert responsible["id"] == created["id"]
    assert responsible["name"] == created["name"]
    assert responsible["initials"] == "ST"  # "Sig Tester f1"
    assert responsible["signatureColor"] == created["signatureColor"]


def test_planning_without_manager_has_no_responsible_user() -> None:
    client = TestClient(app)
    _reset(client)
    day = date.today() + timedelta(days=5)
    res = client.post(
        "/api/wms/planning",
        headers=_headers(client, "Admin"),
        json={
            "customerName": "Kunde Ohne",
            "projectName": "Projekt Ohne",
            "eventName": None,
            "startDate": day.isoformat(),
            "endDate": day.isoformat(),
            "notes": "",
            "status": "Geplant",
            "days": [{"planningDate": day.isoformat(), "weekday": "Montag", "items": []}],
        },
    )
    assert res.status_code == 200, res.text
    listed = client.get("/api/wms/planning", headers=_headers(client, "Admin")).json()
    row = [item for item in listed if item["id"] == res.json()["id"]][0]
    assert row["responsibleUser"] is None
