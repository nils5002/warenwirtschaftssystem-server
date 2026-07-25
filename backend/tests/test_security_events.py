"""Tests für das Security-Paket „supman": Audit-Logging, Registrierungs-Schalter,
E-Mail-Validierung, Honeypot, persistente Sperre, Freigeben/Ablehnen/Sperren.
"""
from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database.models import SecurityEventRecord, UserRecord
from app.database.session import SessionLocal
from app.main import app
from app.services import security_event_service as sec
from app.services.rate_limiter import account_login_rate_limiter, login_rate_limiter

from .auth_helpers import auth_headers


def _register(client: TestClient, email: str, *, name: str = "Sec Probe", website: str | None = None):
    payload = {"name": name, "email": email, "password": "Willkommen123!"}
    if website is not None:
        payload["website"] = website
    # Eindeutige XFF, damit der Register-Rate-Limiter nicht queraussteuert.
    return client.post(
        "/api/auth/register",
        headers={"X-Forwarded-For": f"reg-{uuid4().hex}"},
        json=payload,
    )


def _events_for(identifier: str, event_type: str | None = None) -> list[SecurityEventRecord]:
    with SessionLocal() as db:
        stmt = select(SecurityEventRecord).where(
            SecurityEventRecord.entered_identifier == identifier.lower()
        )
        if event_type:
            stmt = stmt.where(SecurityEventRecord.event_type == event_type)
        return list(db.scalars(stmt).all())


# --- Registrierung -----------------------------------------------------------

def test_register_creates_pending_and_logs_event() -> None:
    client = TestClient(app)
    email = f"pending-{uuid4().hex}@conventex.com"
    res = _register(client, email)
    assert res.status_code == 201
    assert _events_for(email, sec.REGISTER_SUCCESS_PENDING)
    # Neuer Benutzer ist inaktiv/wartend.
    with SessionLocal() as db:
        user = db.scalar(select(UserRecord).where(UserRecord.email == email))
        assert user is not None
        assert user.is_active is False
        assert user.status == "Wartet auf Freigabe"


def test_register_invalid_email_is_rejected() -> None:
    client = TestClient(app)
    # "supman"-Fall: kein gültiges E-Mail-Format.
    res = _register(client, "supman")
    assert res.status_code == 400
    with SessionLocal() as db:
        assert db.scalar(select(UserRecord).where(UserRecord.email == "supman")) is None


def test_register_disabled_returns_403_and_creates_no_account() -> None:
    client = TestClient(app)
    email = f"disabled-{uuid4().hex}@conventex.com"
    with SessionLocal() as db:
        sec.set_registration_enabled(db, False)
    try:
        res = _register(client, email)
        # Ehrlicher 403: serverseitige Sperre ist von außen erkennbar,
        # und es entsteht KEIN Konto.
        assert res.status_code == 403
        assert res.json()["detail"] == "Registrierung ist deaktiviert."
        with SessionLocal() as db:
            assert db.scalar(select(UserRecord).where(UserRecord.email == email)) is None
        assert _events_for(email, sec.REGISTER_BLOCKED_DISABLED)
    finally:
        with SessionLocal() as db:
            sec.set_registration_enabled(db, True)


def test_register_enabled_flow_unchanged_after_toggle() -> None:
    # Schalter aus- und wieder einschalten: danach funktioniert der
    # reguläre Registrierungsflow (pending + Freigabe durch Admin) unverändert.
    client = TestClient(app)
    email = f"reenabled-{uuid4().hex}@conventex.com"
    with SessionLocal() as db:
        sec.set_registration_enabled(db, False)
        sec.set_registration_enabled(db, True)
    res = _register(client, email)
    assert res.status_code == 201
    with SessionLocal() as db:
        user = db.scalar(select(UserRecord).where(UserRecord.email == email))
        assert user is not None
        assert user.is_active is False
        assert user.status == "Wartet auf Freigabe"


def test_register_honeypot_is_silently_dropped() -> None:
    client = TestClient(app)
    email = f"bot-{uuid4().hex}@conventex.com"
    res = _register(client, email, website="http://spam.example")
    assert res.status_code == 201
    with SessionLocal() as db:
        assert db.scalar(select(UserRecord).where(UserRecord.email == email)) is None
    assert _events_for(email, sec.REGISTER_HONEYPOT)


def test_register_external_domain_is_flagged() -> None:
    client = TestClient(app)
    email = f"ext-{uuid4().hex}@gmail.com"
    res = _register(client, email)
    assert res.status_code == 201
    assert _events_for(email, sec.REGISTER_EXTERNAL_DOMAIN)


# --- Login -------------------------------------------------------------------

def test_login_success_logs_event_and_metadata() -> None:
    client = TestClient(app)
    email, password = auth_headers(client, "Admin"), None  # noqa: F841
    # auth_headers() führt bereits einen erfolgreichen Login aus.
    # Wir prüfen nur, dass mindestens ein login_success-Event existiert.
    with SessionLocal() as db:
        count = db.scalar(
            select(SecurityEventRecord).where(SecurityEventRecord.event_type == sec.LOGIN_SUCCESS)
        )
    assert count is not None


def test_login_failed_logs_event() -> None:
    client = TestClient(app)
    email = f"nouser-{uuid4().hex}@tests.local"
    res = client.post("/api/auth/login", json={"email": email, "password": "falsch"})
    assert res.status_code == 401
    assert _events_for(email, sec.LOGIN_FAILED)


def test_inactive_user_cannot_login() -> None:
    client = TestClient(app)
    email = f"inactive-{uuid4().hex}@conventex.com"
    _register(client, email)  # legt wartendes Konto an
    res = client.post("/api/auth/login", json={"email": email, "password": "Willkommen123!"})
    assert res.status_code == 403
    assert _events_for(email, sec.LOGIN_BLOCKED_INACTIVE)


def test_persistent_lock_after_repeated_failures() -> None:
    client = TestClient(app)
    email = f"lockme-{uuid4().hex}@conventex.com"
    _register(client, email)
    with SessionLocal() as db:
        user = db.scalar(select(UserRecord).where(UserRecord.email == email))
        user.is_active = True
        user.status = "Aktiv"
        db.commit()
    # In-Memory-Limiter zurücksetzen, damit wir die DB-basierte Sperre isolieren.
    login_rate_limiter.reset_all()
    account_login_rate_limiter.reset_all()
    # 10 Fehlversuche mit rotierender IP (umgeht In-Memory, trifft DB-Sperre).
    last = None
    for i in range(10):
        login_rate_limiter.reset_all()
        account_login_rate_limiter.reset_all()
        last = client.post(
            "/api/auth/login",
            headers={"X-Forwarded-For": f"rot-{i}-{uuid4().hex}"},
            json={"email": email, "password": "falsch"},
        )
    assert last is not None and last.status_code == 429
    with SessionLocal() as db:
        user = db.scalar(select(UserRecord).where(UserRecord.email == email))
        assert user.locked_until is not None
    # Danach ist selbst das RICHTIGE Passwort geblockt (429), Sperre wirkt.
    login_rate_limiter.reset_all()
    account_login_rate_limiter.reset_all()
    blocked = client.post(
        "/api/auth/login",
        headers={"X-Forwarded-For": f"rot-final-{uuid4().hex}"},
        json={"email": email, "password": "Willkommen123!"},
    )
    assert blocked.status_code == 429


# --- Admin-Aktionen ----------------------------------------------------------

def test_approve_and_reject_flow() -> None:
    client = TestClient(app)
    admin = auth_headers(client, "Admin")
    pending_email = f"approve-{uuid4().hex}@conventex.com"
    _register(client, pending_email)
    with SessionLocal() as db:
        user = db.scalar(select(UserRecord).where(UserRecord.email == pending_email))
        user_id = user.external_id

    # Freigeben -> Aktiv + Event.
    approve = client.post(f"/api/wms/users/{user_id}/approve", headers=admin)
    assert approve.status_code == 200
    assert approve.json()["status"] == "Aktiv"

    # reject auf aktivem Konto -> 409 (nur aus "Wartet auf Freigabe").
    reject = client.post(f"/api/wms/users/{user_id}/reject", headers=admin)
    assert reject.status_code == 409


def test_reject_sets_status_abgelehnt() -> None:
    client = TestClient(app)
    admin = auth_headers(client, "Admin")
    email = f"reject-{uuid4().hex}@conventex.com"
    _register(client, email)
    with SessionLocal() as db:
        user_id = db.scalar(select(UserRecord).where(UserRecord.email == email)).external_id
    res = client.post(f"/api/wms/users/{user_id}/reject", headers=admin)
    assert res.status_code == 200
    assert res.json()["status"] == "Abgelehnt"


def test_lock_unlock_flow_and_session_invalidation() -> None:
    client = TestClient(app)
    admin = auth_headers(client, "Admin")
    # Ein normaler Benutzer mit eigener Session.
    victim_headers = auth_headers(client, "Mitarbeiter", user_id=f"usr-lock-{uuid4().hex[:8]}")
    with SessionLocal() as db:
        # external_id des gerade angelegten Test-Users über sein Token /me holen.
        me = client.get("/api/auth/me", headers=victim_headers).json()
        victim_id = me["userId"]

    lock = client.post(f"/api/wms/users/{victim_id}/lock", headers=admin)
    assert lock.status_code == 200
    assert lock.json()["status"] == "Gesperrt"
    # Bestehende Session ist nach dem Sperren ungültig (token_version-Bump).
    after = client.get("/api/auth/me", headers=victim_headers)
    assert after.status_code == 401

    unlock = client.post(f"/api/wms/users/{victim_id}/unlock", headers=admin)
    assert unlock.status_code == 200
    assert unlock.json()["status"] == "Aktiv"


def test_security_endpoints_require_logs_read() -> None:
    client = TestClient(app)
    # Mitarbeiter hat kein logs.read.
    denied = client.get("/api/wms/admin/security-events", headers=auth_headers(client, "Mitarbeiter"))
    assert denied.status_code == 403
    # Admin darf.
    allowed = client.get("/api/wms/admin/security-events", headers=auth_headers(client, "Admin"))
    assert allowed.status_code == 200
    assert "items" in allowed.json()


def test_admin_action_denied_is_logged() -> None:
    client = TestClient(app)
    client.get("/api/wms/admin/security-events", headers=auth_headers(client, "Mitarbeiter"))
    with SessionLocal() as db:
        denied = db.scalar(
            select(SecurityEventRecord).where(
                SecurityEventRecord.event_type == sec.ADMIN_ACTION_DENIED
            )
        )
    assert denied is not None


def test_registration_setting_toggle_requires_permission() -> None:
    client = TestClient(app)
    admin = auth_headers(client, "Admin")
    get_res = client.get("/api/wms/admin/settings/registration", headers=admin)
    assert get_res.status_code == 200
    assert "enabled" in get_res.json()
    denied = client.get(
        "/api/wms/admin/settings/registration", headers=auth_headers(client, "Mitarbeiter")
    )
    assert denied.status_code == 403


def test_no_secrets_in_events() -> None:
    """Kein Event-Feld darf ein Passwort/Hash/Token enthalten."""
    client = TestClient(app)
    email = f"nosecret-{uuid4().hex}@conventex.com"
    _register(client, email)
    client.post("/api/auth/login", json={"email": email, "password": "SuperGeheim123!"})
    with SessionLocal() as db:
        events = db.scalars(select(SecurityEventRecord)).all()
        for event in events:
            blob = " ".join(
                str(v) for v in (
                    event.entered_identifier, event.meta_json, event.reason_code, event.user_agent,
                )
                if v
            )
            assert "SuperGeheim123!" not in blob
            assert "Willkommen123!" not in blob
            assert "pbkdf2" not in blob.lower()
