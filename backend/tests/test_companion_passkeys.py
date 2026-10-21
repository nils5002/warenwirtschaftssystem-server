"""Passkey-Entsperrung der Companion App — mit echten WebAuthn-Signaturen.

Der Software-Authenticator (tests/webauthn_helpers.py) erzeugt gueltige
P-256-Attestationen/-Assertions; die Pruefung uebernimmt py_webauthn wie in
Produktion. Getestet wird insbesondere die SERVERSEITIGE Sperrwirkung.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.database.models import CompanionDeviceRecord
from app.database.session import SessionLocal

from .test_companion import CSRF, Pc, _device_id, _pair, _reset_limiters  # noqa: F401 — Fixture
from .webauthn_helpers import SoftAuthenticator

ORIGIN = "http://localhost:4173"  # = FRONTEND_URL der Testumgebung (conftest)
RP_ID = "localhost"
HEADERS = {**CSRF, "Origin": ORIGIN}


def _register(phone, authenticator: SoftAuthenticator, **kwargs):
    options = phone.post("/api/companion/passkey/register/options", headers=HEADERS)
    assert options.status_code == 200, options.text
    opts = options.json()["options"]
    assert opts["authenticatorSelection"]["userVerification"] == "required"
    assert opts["rp"]["id"] == RP_ID
    return phone.post(
        "/api/companion/passkey/register/verify",
        headers=HEADERS,
        json={"credential": authenticator.register(opts, **kwargs)},
    )


def _lock(phone) -> None:
    """Simuliert abgelaufenes Entsperr-Fenster (z. B. App nach Pause geoeffnet)."""
    with SessionLocal() as db:
        device = db.scalar(select(CompanionDeviceRecord).where(CompanionDeviceRecord.external_id == _device_id(phone)))
        device.unlocked_until = datetime.now(UTC) - timedelta(seconds=1)
        db.commit()


def _unlock(phone, authenticator: SoftAuthenticator, **kwargs):
    options = phone.post("/api/companion/unlock/options", headers=HEADERS)
    assert options.status_code == 200, options.text
    opts = options.json()["options"]
    assert opts["userVerification"] == "required"
    return phone.post(
        "/api/companion/unlock/verify",
        headers=HEADERS,
        json={"credential": authenticator.assert_(opts, **kwargs)},
    )


def _paired_with_passkey():
    pc = Pc()
    pc.enable()
    phone = _pair(pc)
    authenticator = SoftAuthenticator(RP_ID, ORIGIN)
    res = _register(phone, authenticator)
    assert res.status_code == 200, res.text
    assert res.json()["passkeyRegistered"] is True
    return pc, phone, authenticator


def test_passkey_registration_requires_device_session() -> None:
    pc = Pc()
    pc.enable()
    res = pc.client.post("/api/companion/passkey/register/options", headers={**pc.headers, "Origin": ORIGIN})
    assert res.status_code == 403


def test_device_without_passkey_is_never_locked() -> None:
    pc = Pc()
    pc.enable()
    phone = _pair(pc)
    _lock(phone)
    assert phone.get("/api/auth/me").status_code == 200


def test_lock_has_real_server_side_effect_and_unlock_restores_access() -> None:
    pc, phone, authenticator = _paired_with_passkey()
    assert phone.get("/api/wms/overview").status_code == 200

    _lock(phone)
    # Gesperrt: kein API-Zugriff mehr, auch nicht mit noch gueltigem Token.
    assert phone.get("/api/wms/overview").status_code == 401
    refresh = phone.post("/api/companion/session/refresh", headers=HEADERS)
    assert refresh.status_code == 423
    assert refresh.json()["locked"] is True

    res = _unlock(phone, authenticator)
    assert res.status_code == 200, res.text
    assert phone.get("/api/wms/overview").status_code == 200
    # Desktop war nie betroffen.
    assert pc.client.get("/api/auth/me", headers=pc.headers).status_code == 200


def test_invalid_signature_is_rejected_and_challenge_cannot_be_replayed() -> None:
    _pc, phone, authenticator = _paired_with_passkey()
    _lock(phone)
    options = phone.post("/api/companion/unlock/options", headers=HEADERS).json()["options"]
    bad = authenticator.assert_(options, tamper=True)
    assert phone.post("/api/companion/unlock/verify", headers=HEADERS, json={"credential": bad}).status_code == 400
    # Die Challenge ist verbraucht: selbst eine gueltige Antwort darauf zaehlt nicht.
    good = authenticator.assert_(options)
    assert phone.post("/api/companion/unlock/verify", headers=HEADERS, json={"credential": good}).status_code == 400
    assert phone.post("/api/companion/session/refresh", headers=HEADERS).status_code == 423


def test_user_verification_is_required() -> None:
    pc = Pc()
    pc.enable()
    phone = _pair(pc)
    authenticator = SoftAuthenticator(RP_ID, ORIGIN)
    assert _register(phone, authenticator, user_verified=False).status_code == 400

    _pc2, phone2, authenticator2 = _paired_with_passkey()
    _lock(phone2)
    assert _unlock(phone2, authenticator2, user_verified=False).status_code == 400


def test_wrong_origin_is_rejected() -> None:
    _pc, phone, authenticator = _paired_with_passkey()
    _lock(phone)
    # Fremde Herkunft im Header -> schon die Anfrage wird abgelehnt.
    foreign = phone.post("/api/companion/unlock/options", headers={**CSRF, "Origin": "https://evil.example.com"})
    assert foreign.status_code == 403
    # Richtige Herkunft im Header, aber Assertion fuer eine andere Origin.
    assert _unlock(phone, authenticator, origin="https://evil.example.com").status_code == 400


def test_expired_challenge_is_rejected() -> None:
    _pc, phone, authenticator = _paired_with_passkey()
    _lock(phone)
    options = phone.post("/api/companion/unlock/options", headers=HEADERS).json()["options"]
    with SessionLocal() as db:
        device = db.scalar(select(CompanionDeviceRecord).where(CompanionDeviceRecord.external_id == _device_id(phone)))
        device.webauthn_challenge_expires_at = datetime.now(UTC) - timedelta(seconds=1)
        db.commit()
    res = phone.post("/api/companion/unlock/verify", headers=HEADERS, json={"credential": authenticator.assert_(options)})
    assert res.status_code == 400


def test_signature_counter_replay_is_rejected() -> None:
    _pc, phone, authenticator = _paired_with_passkey()
    _lock(phone)
    assert _unlock(phone, authenticator).status_code == 200
    _lock(phone)
    assert _unlock(phone, authenticator, reuse_counter=True).status_code == 400


def test_passkey_of_other_device_cannot_unlock() -> None:
    pc, phone_a, authenticator_a = _paired_with_passkey()
    phone_b = _pair(pc)
    authenticator_b = SoftAuthenticator(RP_ID, ORIGIN)
    assert _register(phone_b, authenticator_b).status_code == 200
    _lock(phone_b)
    options = phone_b.post("/api/companion/unlock/options", headers=HEADERS).json()["options"]
    # Passkey von Geraet A gegen die Challenge von Geraet B.
    stolen = authenticator_a.assert_(options)
    assert phone_b.post("/api/companion/unlock/verify", headers=HEADERS, json={"credential": stolen}).status_code == 400
    assert phone_a.get("/api/auth/me").status_code == 200


def test_revoked_device_cannot_unlock() -> None:
    pc, phone, _authenticator = _paired_with_passkey()
    _lock(phone)
    pc.client.delete(f"/api/companion/devices/{_device_id(phone)}", headers=pc.headers)
    assert phone.post("/api/companion/unlock/options", headers=HEADERS).status_code == 401


def test_session_info_reports_passkey() -> None:
    _pc, phone, _authenticator = _paired_with_passkey()
    body = phone.get("/api/companion/session").json()
    assert body["passkeyRegistered"] is True
    assert "public" not in str(body).lower()
