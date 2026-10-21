"""Companion App: Kopplung per QR + PC-Bestaetigung und widerrufbare Geraetesitzungen.

Zentrale Zusicherungen:
* Ohne ausdrueckliche Bestaetigung am PC entsteht keine Sitzung.
* Ein QR-Code ist kurzlebig und genau einmal einloesbar.
* Jedes Geraet ist einzeln widerrufbar — der Widerruf wirkt sofort, andere
  Geraete und der Desktop bleiben unberuehrt.
* Desktop- und Handy-Logout melden sich nicht gegenseitig ab; Sicherheits-
  ereignisse (Passwort, Rolle, Deaktivierung, Companion aus) beenden alles.
* Bestehende Rollen/Rechte gelten fuer Geraete unveraendert.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database.models import CompanionDeviceRecord, CompanionPairingRecord, UserRecord
from app.database.session import SessionLocal
from app.main import app
from app.services import companion_service as companion
from app.services.rate_limiter import (
    companion_claim_rate_limiter,
    companion_pairing_start_rate_limiter,
    companion_poll_rate_limiter,
    companion_session_rate_limiter,
)

from .auth_helpers import auth_headers, ensure_auth_user

CSRF = {"X-Requested-With": "XMLHttpRequest"}


@pytest.fixture(autouse=True)
def _reset_limiters():
    for limiter in (
        companion_claim_rate_limiter,
        companion_pairing_start_rate_limiter,
        companion_poll_rate_limiter,
        companion_session_rate_limiter,
    ):
        limiter.reset_all()
    yield


def _uid(prefix: str = "comp") -> str:
    return f"usr-{prefix}-{uuid4().hex[:8]}"


class Pc:
    """Angemeldeter Desktop-Benutzer (Bearer, wie ein API-Client)."""

    def __init__(self, role: str = "Admin", user_id: str | None = None):
        self.user_id = user_id or _uid()
        self.client = TestClient(app)
        self.headers = {**auth_headers(self.client, role, user_id=self.user_id), **CSRF}

    def enable(self, enabled: bool = True):
        res = self.client.put("/api/companion/settings", headers=self.headers, json={"enabled": enabled})
        assert res.status_code == 200, res.text
        return res.json()

    def start(self):
        res = self.client.post("/api/companion/pairing", headers=self.headers)
        assert res.status_code == 200, res.text
        return res.json()

    def status(self, pairing_id: str):
        return self.client.get(f"/api/companion/pairing/{pairing_id}", headers=self.headers)

    def decide(self, pairing_id: str, action: str):
        return self.client.post(f"/api/companion/pairing/{pairing_id}/{action}", headers=self.headers)


def _phone() -> TestClient:
    client = TestClient(app, headers={"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1"})
    client.cookies.clear()
    return client


def _cookie(client: TestClient, name: str) -> str | None:
    for cookie in client.cookies.jar:
        if cookie.name == name and cookie.value:
            return cookie.value
    return None


def _pair(pc: Pc) -> TestClient:
    """Kompletter, erfolgreicher Kopplungsablauf; liefert das Handy."""
    started = pc.start()
    phone = _phone()
    claim = phone.post("/api/companion/pairing-claim", headers=CSRF, json={"code": started["pairingCode"]})
    assert claim.status_code == 200, claim.text
    assert pc.decide(started["pairingId"], "approve").status_code == 200
    done = phone.post("/api/companion/pairing-claim/complete", headers=CSRF)
    assert done.status_code == 200, done.text
    return phone


def _device_id(phone: TestClient) -> str:
    return _cookie(phone, "wms_device").split(".", 1)[0]


# --- Grundzustand --------------------------------------------------------------


def test_settings_require_authentication() -> None:
    client = TestClient(app)
    client.cookies.clear()
    assert client.get("/api/companion/settings").status_code == 401
    assert client.post("/api/companion/pairing", headers=CSRF).status_code == 401


def test_companion_is_disabled_by_default_and_pairing_needs_it() -> None:
    pc = Pc()
    body = pc.client.get("/api/companion/settings", headers=pc.headers).json()
    assert body["enabled"] is False and body["devices"] == []
    res = pc.client.post("/api/companion/pairing", headers=pc.headers)
    assert res.status_code == 409


# --- Kompletter Ablauf ------------------------------------------------------------


def test_full_pairing_flow_creates_separate_device_session() -> None:
    pc = Pc()
    pc.enable()
    started = pc.start()
    assert started["expiresInSeconds"] <= 120
    assert len(started["pairingCode"]) >= 40

    phone = _phone()
    claim = phone.post("/api/companion/pairing-claim", headers=CSRF, json={"code": started["pairingCode"]})
    assert claim.status_code == 200
    body = claim.json()
    assert body["accountEmail"].count("*") >= 1  # maskiert
    assert len(body["matchCode"]) == 6

    status = pc.status(started["pairingId"]).json()
    assert status["status"] == "claimed"
    assert status["matchCode"] == body["matchCode"]  # gleicher Abgleichcode
    assert status["deviceName"] == "iPhone"

    # Ohne PC-Bestaetigung keine Sitzung.
    early = phone.post("/api/companion/pairing-claim/complete", headers=CSRF)
    assert early.status_code == 409
    assert _cookie(phone, "wms_device") is None

    assert pc.decide(started["pairingId"], "approve").status_code == 200
    done = phone.post("/api/companion/pairing-claim/complete", headers=CSRF)
    assert done.status_code == 200
    assert done.json()["deviceId"].startswith("dev-")
    assert "permissions" in done.json()["user"]
    assert _cookie(phone, "wms_device") and _cookie(phone, "wms_auth")
    assert _cookie(phone, "wms_pairing") is None

    me = phone.get("/api/auth/me")
    assert me.status_code == 200 and me.json()["deviceId"] == done.json()["deviceId"]
    assert phone.get("/api/wms/overview").status_code == 200  # gleiche API wie der Desktop

    devices = pc.client.get("/api/companion/settings", headers=pc.headers).json()["devices"]
    assert [d["id"] for d in devices] == [done.json()["deviceId"]]
    # Weder Secrets noch Hashes in Antworten.
    assert "secret" not in str(devices).lower()
    # Desktop weiterhin angemeldet.
    assert pc.client.get("/api/auth/me", headers=pc.headers).status_code == 200


def test_qr_code_is_single_use() -> None:
    pc = Pc()
    pc.enable()
    started = pc.start()
    first = _phone().post("/api/companion/pairing-claim", headers=CSRF, json={"code": started["pairingCode"]})
    assert first.status_code == 200
    second = _phone().post("/api/companion/pairing-claim", headers=CSRF, json={"code": started["pairingCode"]})
    assert second.status_code == 410


def test_expired_qr_code_is_rejected() -> None:
    pc = Pc()
    pc.enable()
    started = pc.start()
    with SessionLocal() as db:
        pairing = db.scalar(select(CompanionPairingRecord).where(CompanionPairingRecord.external_id == started["pairingId"]))
        pairing.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        db.commit()
    res = _phone().post("/api/companion/pairing-claim", headers=CSRF, json={"code": started["pairingCode"]})
    assert res.status_code == 410
    assert pc.status(started["pairingId"]).json()["status"] == "expired"


def test_unknown_code_gives_same_answer_as_used_code() -> None:
    res = _phone().post("/api/companion/pairing-claim", headers=CSRF, json={"code": "x" * 43})
    assert res.status_code == 410


def test_rejected_pairing_never_creates_a_session() -> None:
    pc = Pc()
    pc.enable()
    started = pc.start()
    phone = _phone()
    phone.post("/api/companion/pairing-claim", headers=CSRF, json={"code": started["pairingCode"]})
    assert pc.decide(started["pairingId"], "reject").status_code == 200
    assert phone.get("/api/companion/pairing-claim/status").json()["status"] == "rejected"
    assert phone.post("/api/companion/pairing-claim/complete", headers=CSRF).status_code == 409
    # Einmal entschieden ist entschieden.
    assert pc.decide(started["pairingId"], "approve").status_code == 409


def test_complete_works_only_once() -> None:
    pc = Pc()
    pc.enable()
    started = pc.start()
    phone = _phone()
    phone.post("/api/companion/pairing-claim", headers=CSRF, json={"code": started["pairingCode"]})
    pairing_cookie = _cookie(phone, "wms_pairing")
    pc.decide(started["pairingId"], "approve")
    assert phone.post("/api/companion/pairing-claim/complete", headers=CSRF).status_code == 200
    # Wiederholung mit demselben Handy-Nachweis -> keine zweite Sitzung.
    replay = _phone()
    replay.cookies.set("wms_pairing", pairing_cookie, path="/api/companion")
    assert replay.post("/api/companion/pairing-claim/complete", headers=CSRF).status_code in {404, 409}
    with SessionLocal() as db:
        count = len(companion.active_devices(db, pc.user_id))
    assert count == 1


def test_new_pairing_cancels_previous_open_one() -> None:
    pc = Pc()
    pc.enable()
    first = pc.start()
    pc.start()
    assert pc.status(first["pairingId"]).json()["status"] == "cancelled"
    res = _phone().post("/api/companion/pairing-claim", headers=CSRF, json={"code": first["pairingCode"]})
    assert res.status_code == 410


# --- Fremde Konten / Geraete-Sitzungen --------------------------------------------


def test_foreign_pairing_and_devices_are_invisible() -> None:
    owner = Pc()
    owner.enable()
    started = owner.start()
    _phone().post("/api/companion/pairing-claim", headers=CSRF, json={"code": started["pairingCode"]})
    stranger = Pc()
    stranger.enable()
    assert stranger.status(started["pairingId"]).status_code == 404
    assert stranger.decide(started["pairingId"], "approve").status_code == 404

    owner.decide(started["pairingId"], "reject")
    phone = _pair(owner)
    device_id = _device_id(phone)
    res = stranger.client.delete(f"/api/companion/devices/{device_id}", headers=stranger.headers)
    assert res.status_code == 404
    assert phone.get("/api/auth/me").status_code == 200


def test_device_session_cannot_start_or_approve_pairings() -> None:
    pc = Pc()
    pc.enable()
    phone = _pair(pc)
    assert phone.post("/api/companion/pairing", headers=CSRF).status_code == 403
    started = pc.start()
    _phone().post("/api/companion/pairing-claim", headers=CSRF, json={"code": started["pairingCode"]})
    assert phone.post(f"/api/companion/pairing/{started['pairingId']}/approve", headers=CSRF).status_code == 403


# --- Widerruf ----------------------------------------------------------------------


def test_revoking_one_device_keeps_other_device_and_desktop() -> None:
    pc = Pc()
    pc.enable()
    phone_a = _pair(pc)
    phone_b = _pair(pc)
    device_a = _device_id(phone_a)
    res = pc.client.delete(f"/api/companion/devices/{device_a}", headers=pc.headers)
    assert res.status_code == 200 and res.json()["revoked"] == 1
    # Sofort gesperrt — trotz noch nicht abgelaufenem Access-Token.
    assert phone_a.get("/api/wms/overview").status_code == 401
    assert phone_a.post("/api/companion/session/refresh", headers=CSRF).status_code == 401
    assert phone_b.get("/api/wms/overview").status_code == 200
    assert pc.client.get("/api/auth/me", headers=pc.headers).status_code == 200


def test_revoke_all_devices() -> None:
    pc = Pc()
    pc.enable()
    phones = [_pair(pc), _pair(pc)]
    res = pc.client.post("/api/companion/devices/revoke-all", headers=pc.headers)
    assert res.json()["revoked"] == 2
    assert all(p.get("/api/auth/me").status_code == 401 for p in phones)
    assert pc.client.get("/api/auth/me", headers=pc.headers).status_code == 200


def test_disabling_companion_revokes_everything_immediately() -> None:
    pc = Pc()
    pc.enable()
    phone = _pair(pc)
    started = pc.start()
    body = pc.enable(False)
    assert body["enabled"] is False
    assert phone.get("/api/auth/me").status_code == 401
    assert pc.status(started["pairingId"]).json()["status"] == "cancelled"
    # Wieder einschalten belebt alte Geraete NICHT.
    pc.enable(True)
    assert phone.get("/api/auth/me").status_code == 401
    assert phone.post("/api/companion/session/refresh", headers=CSRF).status_code == 401


def test_desktop_logout_keeps_phone_and_phone_logout_keeps_desktop() -> None:
    pc = Pc()
    pc.enable()
    phone = _pair(pc)
    # Handy meldet sich ab -> nur dieses Geraet ist weg.
    assert phone.post("/api/auth/logout").status_code == 200
    assert pc.client.get("/api/auth/me", headers=pc.headers).status_code == 200
    assert phone.post("/api/companion/session/refresh", headers=CSRF).status_code == 401

    phone2 = _pair(pc)
    # Desktop meldet sich ab -> Handy-Access-Token (alte token_version) faellt,
    # aber die Geraetesitzung erneuert sich ohne neue Kopplung.
    assert pc.client.post("/api/auth/logout", headers=pc.headers).status_code == 200
    assert phone2.get("/api/auth/me").status_code == 401
    assert phone2.post("/api/companion/session/refresh", headers=CSRF).status_code == 200
    assert phone2.get("/api/auth/me").status_code == 200


@pytest.mark.parametrize("event", ["password_reset", "role_change", "deactivate", "admin_revoke"])
def test_security_events_revoke_all_devices(event) -> None:
    pc = Pc(role="Mitarbeiter")
    pc.enable()
    phone = _pair(pc)
    admin = Pc(role="Admin")
    if event == "password_reset":
        res = admin.client.post(f"/api/wms/users/{pc.user_id}/reset-password", headers=admin.headers, json={"newPassword": "NeuesPasswort123!"})
    elif event == "role_change":
        res = admin.client.patch(f"/api/wms/users/{pc.user_id}", headers=admin.headers, json={"role": "Projektmanager"})
    elif event == "deactivate":
        res = admin.client.post(f"/api/wms/users/{pc.user_id}/lock", headers=admin.headers)
    else:
        res = admin.client.post(f"/api/wms/users/{pc.user_id}/revoke-sessions", headers=admin.headers)
    assert res.status_code == 200, res.text
    assert phone.get("/api/auth/me").status_code == 401
    assert phone.post("/api/companion/session/refresh", headers=CSRF).status_code == 401
    with SessionLocal() as db:
        assert companion.active_devices(db, pc.user_id) == []


# --- Erneuerung + Secret-Rotation ---------------------------------------------------


def test_refresh_rotates_secret_and_detects_reuse() -> None:
    pc = Pc()
    pc.enable()
    phone = _pair(pc)
    old_cookie = _cookie(phone, "wms_device")
    assert phone.post("/api/companion/session/refresh", headers=CSRF).status_code == 200
    new_cookie = _cookie(phone, "wms_device")
    assert new_cookie != old_cookie

    # Paralleler Request mit dem gerade abgeloesten Secret: kulant.
    twin = _phone()
    twin.cookies.set("wms_device", old_cookie, path="/api/companion")
    assert twin.post("/api/companion/session/refresh", headers=CSRF).status_code == 200

    # Spaeter wiederverwendet -> Diebstahlverdacht -> Geraet gesperrt.
    with SessionLocal() as db:
        device = db.scalar(select(CompanionDeviceRecord).where(CompanionDeviceRecord.external_id == _device_id(phone)))
        device.secret_rotated_at = datetime.now(UTC) - timedelta(minutes=5)
        db.commit()
    thief = _phone()
    thief.cookies.set("wms_device", old_cookie, path="/api/companion")
    assert thief.post("/api/companion/session/refresh", headers=CSRF).status_code == 401
    # Auch das legitime Geraet ist jetzt aus Sicherheitsgruenden gesperrt.
    assert phone.post("/api/companion/session/refresh", headers=CSRF).status_code == 401
    assert phone.get("/api/auth/me").status_code == 401


def test_refresh_without_or_with_forged_cookie_is_rejected() -> None:
    assert _phone().post("/api/companion/session/refresh", headers=CSRF).status_code == 401
    forged = _phone()
    forged.cookies.set("wms_device", "dev-0000000000000000." + "a" * 43, path="/api/companion")
    assert forged.post("/api/companion/session/refresh", headers=CSRF).status_code == 401


def test_device_access_token_is_short_lived() -> None:
    assert companion.DEVICE_ACCESS_TOKEN_SECONDS <= 15 * 60


# --- RBAC + CSRF + Herkunft -----------------------------------------------------------


def test_device_has_exactly_the_role_rights_of_its_user() -> None:
    pc = Pc(role="Mitarbeiter")
    pc.enable()
    phone = _pair(pc)
    assert phone.get("/api/wms/users").status_code == 403
    assert phone.get("/api/admin/email/settings").status_code == 403


def test_cookie_writes_need_csrf_header_and_trusted_origin() -> None:
    email, password = ensure_auth_user(role="Admin", user_id=_uid("csrf"))
    browser = TestClient(app)
    assert browser.post("/api/auth/login", json={"email": email, "password": password}).status_code == 200
    assert browser.put("/api/companion/settings", json={"enabled": True}).status_code == 403
    foreign = browser.put(
        "/api/companion/settings", json={"enabled": True},
        headers={**CSRF, "Origin": "https://evil.example.com"},
    )
    assert foreign.status_code == 403
    ok = browser.put(
        "/api/companion/settings", json={"enabled": True},
        headers={**CSRF, "Origin": "http://testserver"},
    )
    assert ok.status_code == 200
    # Handy-Einloesung ebenfalls nur mit Header.
    assert _phone().post("/api/companion/pairing-claim", json={"code": "x" * 43}).status_code == 403


def test_claim_is_rate_limited() -> None:
    phone = _phone()
    codes = [phone.post("/api/companion/pairing-claim", headers=CSRF, json={"code": "y" * 43}).status_code for _ in range(21)]
    assert codes[:20] == [410] * 20
    assert codes[20] == 429


# --- Restore -------------------------------------------------------------------------


def test_backup_import_never_restores_device_sessions() -> None:
    pc = Pc()
    pc.enable()
    phone = _pair(pc)
    export = pc.client.get("/api/wms/backup/export", headers=pc.headers)
    assert export.status_code == 200
    assert "wms_device" not in export.text and "secret_hash" not in export.text
    files = {"file": ("backup.json", export.content, "application/json")}
    assert pc.client.post("/api/wms/backup/import", headers=pc.headers, files=files).status_code == 200
    with SessionLocal() as db:
        assert db.scalar(select(CompanionDeviceRecord)) is None
        user = db.scalar(select(UserRecord).where(UserRecord.external_id == pc.user_id))
    assert phone.post("/api/companion/session/refresh", headers=CSRF).status_code == 401
    assert user is None or user.companion_enabled is False


def test_user_agent_description_is_coarse() -> None:
    assert companion.describe_user_agent("Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120 Mobile") == ("Android", "Android · Chrome")
    assert companion.describe_user_agent(None) == ("Smartphone", None)
