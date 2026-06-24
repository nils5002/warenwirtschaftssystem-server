"""Tests der Mobile-API (`/api/mobile`) für die iPhone-App.

Abgedeckt (gemäß Auftrag Block 4/5):
  - Login erfolgreich / fehlgeschlagen
  - /auth/me ohne Token blockiert; mit Access-Token ok
  - Refresh-Flow: gültiger Refresh → neuer Access-Token; Refresh-Token darf NICHT
    als normaler Bearer funktionieren; Access-Token darf nicht als Refresh dienen
  - Scan: ohne Token blockiert; unbekannt; verfügbar; verliehen; defekt; Sammel-QR
  - Checkout: ohne Token 401; ohne checkinout.use 403; defekt/in Wartung/bereits
    verliehen → 409; verfügbares Gerät → Verliehen + Audit (actor_user_id)
  - Checkin: verliehen → Verfuegbar + Audit; bereits verfügbar → idempotent
  - Web-Login/Cookie-Auth bleibt funktionsfähig

Isolation: jeder Test nutzt eindeutige IDs/Seriennummern (uuid), damit sich die
in der Session-DB hinterlassenen Geräte nicht gegenseitig stören.
"""

from __future__ import annotations

from datetime import date, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database.models import ActivityRecord, UserRecord
from app.database.session import SessionLocal
from app.main import app
from app.repositories import role_permission_repository
from .auth_helpers import ensure_auth_user, auth_headers, TEST_PASSWORD


# --- Helfer ---------------------------------------------------------------

def _mobile_login(client: TestClient, email: str, password: str = TEST_PASSWORD):
    return client.post("/api/mobile/auth/login", json={"email": email, "password": password})


def _mobile_tokens(client: TestClient, role: str, user_id: str | None = None) -> tuple[dict, str]:
    """Legt einen Nutzer an, loggt mobil ein und liefert (token_json, user_id)."""
    uid = user_id or f"usr-mob-{role.lower()}-{uuid4().hex[:8]}"
    email, password = ensure_auth_user(role=role, user_id=uid)
    res = _mobile_login(client, email, password)
    assert res.status_code == 200, res.text
    return res.json(), uid


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _owned_asset_payload(suffix: str, *, status: str = "Verfuegbar", serial: str | None = None) -> dict:
    return {
        "id": f"asset-mob-{suffix}",
        "name": f"Mobile Testgerät {suffix}",
        "category": "Laptop",
        "location": "Lager",
        "status": status,
        "assignedTo": "-",
        "nextReturn": "-",
        "tagNumber": f"TAG-{suffix}",
        "serialNumber": serial or f"SN-{suffix}",
        "qrCode": "",
        "maintenanceState": "",
        "notes": "",
        "lastCheckout": "-",
        "nextReservation": "-",
    }


def _create_asset(client: TestClient, admin: dict[str, str], payload: dict) -> str:
    res = client.post("/api/wms/assets", headers=admin, json=payload)
    assert res.status_code == 200, res.text
    return payload["id"]


def _activities_for(asset_id: str) -> list[ActivityRecord]:
    with SessionLocal() as db:
        return list(
            db.scalars(
                select(ActivityRecord).where(ActivityRecord.asset_external_id == asset_id)
            ).all()
        )


# --- Auth: Login ----------------------------------------------------------

def test_mobile_login_success_returns_access_and_refresh() -> None:
    client = TestClient(app)
    email, password = ensure_auth_user(role="Mitarbeiter", user_id=f"usr-mob-login-{uuid4().hex[:8]}")
    res = _mobile_login(client, email, password)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["accessToken"]
    assert body["refreshToken"]
    assert body["tokenType"] == "bearer"
    assert body["expiresIn"] > 0
    assert body["refreshExpiresIn"] > body["expiresIn"]
    assert body["user"]["email"] == email
    # Mobile-Login darf KEIN Web-Cookie setzen (strikt getrennt vom Web-Flow).
    assert "wms_auth" not in res.cookies


def test_mobile_login_wrong_password_fails() -> None:
    client = TestClient(app)
    email, _ = ensure_auth_user(role="Mitarbeiter", user_id=f"usr-mob-badpw-{uuid4().hex[:8]}")
    res = _mobile_login(client, email, "FalschesPasswort!")
    assert res.status_code == 401, res.text


# --- Auth: /me ------------------------------------------------------------

def test_mobile_me_requires_token() -> None:
    client = TestClient(app)
    res = client.get("/api/mobile/auth/me")
    assert res.status_code == 401, res.text


def test_mobile_me_with_access_token() -> None:
    client = TestClient(app)
    tokens, uid = _mobile_tokens(client, "Mitarbeiter")
    res = client.get("/api/mobile/auth/me", headers=_bearer(tokens["accessToken"]))
    assert res.status_code == 200, res.text
    assert res.json()["userId"] == uid


# --- Auth: Refresh --------------------------------------------------------

def test_refresh_token_yields_working_access_token() -> None:
    client = TestClient(app)
    tokens, _ = _mobile_tokens(client, "Mitarbeiter")
    res = client.post("/api/mobile/auth/refresh", json={"refreshToken": tokens["refreshToken"]})
    assert res.status_code == 200, res.text
    new_tokens = res.json()
    assert new_tokens["accessToken"]
    assert new_tokens["refreshToken"]
    # Der frische Access-Token muss an einem geschützten Endpoint funktionieren.
    me = client.get("/api/mobile/auth/me", headers=_bearer(new_tokens["accessToken"]))
    assert me.status_code == 200, me.text


def test_refresh_token_not_accepted_as_bearer() -> None:
    """Refresh-Token darf NICHT als Bearer für normale Endpunkte gelten."""
    client = TestClient(app)
    tokens, _ = _mobile_tokens(client, "Mitarbeiter")
    refresh = tokens["refreshToken"]
    # /me lehnt einen Refresh-Token als Bearer ab.
    me = client.get("/api/mobile/auth/me", headers=_bearer(refresh))
    assert me.status_code == 401, me.text
    # Auch ein buchender Endpoint (scan) lehnt ihn ab.
    scan = client.post("/api/mobile/assets/scan", headers=_bearer(refresh), json={"value": "x"})
    assert scan.status_code == 401, scan.text


def test_access_token_not_accepted_as_refresh() -> None:
    client = TestClient(app)
    tokens, _ = _mobile_tokens(client, "Mitarbeiter")
    res = client.post("/api/mobile/auth/refresh", json={"refreshToken": tokens["accessToken"]})
    assert res.status_code == 401, res.text


# --- Scan -----------------------------------------------------------------

def test_scan_requires_access_token() -> None:
    client = TestClient(app)
    res = client.post("/api/mobile/assets/scan", json={"value": "irgendwas"})
    assert res.status_code == 401, res.text


def test_scan_unknown_value() -> None:
    client = TestClient(app)
    tokens, _ = _mobile_tokens(client, "Mitarbeiter")
    res = client.post(
        "/api/mobile/assets/scan",
        headers=_bearer(tokens["accessToken"]),
        json={"value": f"UNBEKANNT-{uuid4().hex}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["found"] is False
    assert body["kind"] == "unknown"
    assert body["bookable"] is False


def test_scan_available_asset_is_bookable() -> None:
    client = TestClient(app)
    admin = auth_headers(client, "Admin")
    tokens, _ = _mobile_tokens(client, "Mitarbeiter")
    suffix = uuid4().hex[:10]
    serial = f"SN-AVAIL-{suffix}"
    _create_asset(client, admin, _owned_asset_payload(suffix, serial=serial))

    res = client.post(
        "/api/mobile/assets/scan", headers=_bearer(tokens["accessToken"]), json={"value": serial}
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["found"] is True
    assert body["kind"] == "asset"
    assert body["bookable"] is True
    assert body["asset"]["status"] == "Verfuegbar"
    assert body["asset"]["serialNumber"] == serial


def test_scan_loaned_asset_reports_status() -> None:
    client = TestClient(app)
    admin = auth_headers(client, "Admin")
    tokens, _ = _mobile_tokens(client, "Mitarbeiter")
    suffix = uuid4().hex[:10]
    serial = f"SN-LOAN-{suffix}"
    _create_asset(client, admin, _owned_asset_payload(suffix, status="Verliehen", serial=serial))

    res = client.post(
        "/api/mobile/assets/scan", headers=_bearer(tokens["accessToken"]), json={"value": serial}
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["kind"] == "asset"
    assert body["asset"]["status"] == "Verliehen"
    assert body["bookable"] is True  # Rücknahme möglich


def test_scan_defect_asset_not_bookable() -> None:
    client = TestClient(app)
    admin = auth_headers(client, "Admin")
    tokens, _ = _mobile_tokens(client, "Mitarbeiter")
    suffix = uuid4().hex[:10]
    serial = f"SN-DEF-{suffix}"
    _create_asset(client, admin, _owned_asset_payload(suffix, status="Defekt", serial=serial))

    res = client.post(
        "/api/mobile/assets/scan", headers=_bearer(tokens["accessToken"]), json={"value": serial}
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["asset"]["status"] == "Defekt"
    assert body["bookable"] is False
    assert body["reason"]


def test_scan_resolves_group_token() -> None:
    client = TestClient(app)
    admin = auth_headers(client, "Admin")
    tokens, _ = _mobile_tokens(client, "Mitarbeiter")
    suffix = uuid4().hex[:8]
    # Eindeutige Kategorie + Fremdbestand für eine Gruppe.
    cat = client.post("/api/wms/categories", headers=admin, json={"name": f"MobKat-{suffix}"}).json()["name"]
    today = date.today()
    asset_ids = []
    for idx in range(2):
        payload = {
            "id": f"asset-mobgrp-{suffix}-{idx}",
            "name": f"Miet {suffix}-{idx}",
            "category": cat,
            "location": "Fremdbestand",
            "status": "Verfuegbar",
            "assignedTo": "-",
            "nextReturn": "-",
            "tagNumber": f"MG-{suffix}-{idx}",
            "serialNumber": f"MG-SN-{suffix}-{idx}",
            "qrCode": "",
            "maintenanceState": "",
            "notes": "",
            "lastCheckout": "-",
            "nextReservation": "-",
            "ownershipType": "rented",
            "availableFrom": today.isoformat(),
            "availableUntil": (today + timedelta(days=30)).isoformat(),
        }
        asset_ids.append(_create_asset(client, admin, payload))
    group = client.post(
        "/api/wms/qr-groups",
        headers=admin,
        json={"name": f"Mob Grp {suffix}", "category": cat, "stockType": "rented", "assetIds": asset_ids},
    ).json()

    res = client.post(
        "/api/mobile/assets/scan",
        headers=_bearer(tokens["accessToken"]),
        json={"value": group["qrCode"]},  # Format "GROUP:<token>"
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["kind"] == "group"
    assert body["group"]["id"] == group["id"]


# --- Checkout -------------------------------------------------------------

def test_checkout_requires_token() -> None:
    client = TestClient(app)
    res = client.post("/api/mobile/checkout", json={"assetId": "x"})
    assert res.status_code == 401, res.text


def test_checkout_forbidden_without_permission() -> None:
    """Ohne Recht checkinout.use → 403 bei scan/checkout/checkin."""
    client = TestClient(app)
    admin = auth_headers(client, "Admin")
    tokens, _ = _mobile_tokens(client, "Mitarbeiter")
    suffix = uuid4().hex[:10]
    asset_id = _create_asset(client, admin, _owned_asset_payload(suffix))

    # checkinout.use für die Rolle mitarbeiter temporär entziehen.
    with SessionLocal() as db:
        snapshot = sorted(role_permission_repository.permissions_for_role(db, "mitarbeiter"))
    reduced = [p for p in snapshot if p != "checkinout.use"]
    try:
        with SessionLocal() as db:
            role_permission_repository.replace_role_permissions(db, "mitarbeiter", reduced)
        hdr = _bearer(tokens["accessToken"])
        co = client.post("/api/mobile/checkout", headers=hdr, json={"assetId": asset_id})
        assert co.status_code == 403, co.text
        ci = client.post("/api/mobile/checkin", headers=hdr, json={"assetId": asset_id})
        assert ci.status_code == 403, ci.text
        sc = client.post("/api/mobile/assets/scan", headers=hdr, json={"value": "x"})
        assert sc.status_code == 403, sc.text
    finally:
        with SessionLocal() as db:
            role_permission_repository.replace_role_permissions(db, "mitarbeiter", snapshot)


def test_checkout_defect_asset_blocked() -> None:
    client = TestClient(app)
    admin = auth_headers(client, "Admin")
    tokens, _ = _mobile_tokens(client, "Mitarbeiter")
    suffix = uuid4().hex[:10]
    asset_id = _create_asset(client, admin, _owned_asset_payload(suffix, status="Defekt"))

    res = client.post(
        "/api/mobile/checkout", headers=_bearer(tokens["accessToken"]), json={"assetId": asset_id}
    )
    assert res.status_code == 409, res.text


def test_checkout_maintenance_asset_blocked() -> None:
    client = TestClient(app)
    admin = auth_headers(client, "Admin")
    tokens, _ = _mobile_tokens(client, "Mitarbeiter")
    suffix = uuid4().hex[:10]
    asset_id = _create_asset(client, admin, _owned_asset_payload(suffix, status="In Wartung"))

    res = client.post(
        "/api/mobile/checkout", headers=_bearer(tokens["accessToken"]), json={"assetId": asset_id}
    )
    assert res.status_code == 409, res.text


def test_checkout_already_loaned_blocked() -> None:
    client = TestClient(app)
    admin = auth_headers(client, "Admin")
    tokens, _ = _mobile_tokens(client, "Mitarbeiter")
    suffix = uuid4().hex[:10]
    asset_id = _create_asset(client, admin, _owned_asset_payload(suffix, status="Verliehen"))

    res = client.post(
        "/api/mobile/checkout", headers=_bearer(tokens["accessToken"]), json={"assetId": asset_id}
    )
    assert res.status_code == 409, res.text


def test_checkout_available_asset_succeeds_and_writes_audit() -> None:
    client = TestClient(app)
    admin = auth_headers(client, "Admin")
    tokens, uid = _mobile_tokens(client, "Mitarbeiter")
    suffix = uuid4().hex[:10]
    asset_id = _create_asset(client, admin, _owned_asset_payload(suffix))

    res = client.post(
        "/api/mobile/checkout",
        headers=_bearer(tokens["accessToken"]),
        json={"assetId": asset_id, "projectName": "Messe Berlin"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "Verliehen"

    # Gerät ist nun verliehen + Empfänger im Format "Empfänger · Projekt".
    item = client.get(f"/api/wms/assets/{asset_id}", headers=admin).json()
    assert item["status"] == "Verliehen"
    assert "·" in item["assignedTo"]
    assert "Messe Berlin" in item["assignedTo"]

    # Audit/ActivityRecord enthält die ausführende Person (actor_user_id).
    with SessionLocal() as db:
        operator = db.scalar(select(UserRecord).where(UserRecord.external_id == uid))
        operator_name = operator.name
    acts = _activities_for(asset_id)
    checkout_acts = [a for a in acts if a.title == "Checkout gebucht"]
    assert checkout_acts, "Es muss ein Checkout-Audit-Eintrag existieren"
    assert any(operator_name in a.detail for a in checkout_acts), (
        "actor_user_id muss im Audit als ausführende Person landen"
    )


# --- Checkin --------------------------------------------------------------

def test_checkin_loaned_asset_sets_available_and_writes_audit() -> None:
    client = TestClient(app)
    admin = auth_headers(client, "Admin")
    tokens, uid = _mobile_tokens(client, "Mitarbeiter")
    suffix = uuid4().hex[:10]
    asset_id = _create_asset(client, admin, _owned_asset_payload(suffix))

    # Erst ausgeben, dann zurücknehmen.
    out = client.post(
        "/api/mobile/checkout", headers=_bearer(tokens["accessToken"]), json={"assetId": asset_id}
    )
    assert out.status_code == 200, out.text

    res = client.post(
        "/api/mobile/checkin", headers=_bearer(tokens["accessToken"]), json={"assetId": asset_id}
    )
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "Verfuegbar"

    item = client.get(f"/api/wms/assets/{asset_id}", headers=admin).json()
    assert item["status"] == "Verfuegbar"

    acts = _activities_for(asset_id)
    assert any(a.title == "Checkin gebucht" for a in acts), "Checkin-Audit muss existieren"
    with SessionLocal() as db:
        operator_name = db.scalar(select(UserRecord).where(UserRecord.external_id == uid)).name
    checkin_acts = [a for a in acts if a.title == "Checkin gebucht"]
    assert any(operator_name in a.detail for a in checkin_acts)


def test_checkin_already_available_is_idempotent() -> None:
    client = TestClient(app)
    admin = auth_headers(client, "Admin")
    tokens, _ = _mobile_tokens(client, "Mitarbeiter")
    suffix = uuid4().hex[:10]
    asset_id = _create_asset(client, admin, _owned_asset_payload(suffix))  # bereits Verfuegbar

    res = client.post(
        "/api/mobile/checkin", headers=_bearer(tokens["accessToken"]), json={"assetId": asset_id}
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "Verfuegbar"
    assert "bereits" in body["message"].lower()


def test_checkin_defect_asset_blocked() -> None:
    client = TestClient(app)
    admin = auth_headers(client, "Admin")
    tokens, _ = _mobile_tokens(client, "Mitarbeiter")
    suffix = uuid4().hex[:10]
    asset_id = _create_asset(client, admin, _owned_asset_payload(suffix, status="Defekt"))

    res = client.post(
        "/api/mobile/checkin", headers=_bearer(tokens["accessToken"]), json={"assetId": asset_id}
    )
    assert res.status_code == 409, res.text


# --- Regression: Web-Login/Cookie-Auth bleibt funktionsfähig --------------

def test_web_login_still_sets_cookie() -> None:
    client = TestClient(app)
    email, password = ensure_auth_user(role="Admin", user_id=f"usr-web-{uuid4().hex[:8]}")
    res = client.post("/api/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200, res.text
    assert res.json()["accessToken"]
    # Web-Flow setzt weiterhin das HttpOnly-Cookie wms_auth.
    assert "wms_auth" in res.cookies
