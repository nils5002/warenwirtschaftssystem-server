"""Tests der E-Mail-Bestaetigung nach der Selbst-Registrierung.

Grundsaetze dieser Suite:
* Es wird NIE ein echter SMTP-Versand ausgeloest — ``email_service.send_mail``
  ist in jedem Test durch einen Recorder ersetzt (``_mailbox``).
* Die SMTP-/FRONTEND_URL-Konfiguration wird pro Test ueber ein ueberschriebenes
  ``Settings``-Objekt gesetzt, nicht ueber echte Zugangsdaten.
* Der Bestaetigungstoken wird aus der abgefangenen Mail gelesen — also genau
  auf dem Weg, den auch ein echter Benutzer geht.
"""
from __future__ import annotations

import re
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config.settings import Settings, get_settings
from app.database.models import EmailVerificationTokenRecord, SecurityEventRecord, UserRecord
from app.database.session import SessionLocal
from app.main import app
from app.services import email_service, email_verification_service as verification
from app.services import mail_config_service as mail_config
from app.services import security_event_service as sec
from app.services.rate_limiter import (
    verification_confirm_rate_limiter,
    verification_email_rate_limiter,
    verification_resend_rate_limiter,
)

from .auth_helpers import auth_headers

PASSWORD = "Willkommen123!"
FRONTEND_URL = "https://warehouse.test.local"


# --- Testinfrastruktur --------------------------------------------------------


class _Mailbox:
    """Faengt Mailversand ab — ersetzt ``email_service.send_mail`` vollstaendig."""

    def __init__(self, *, fail: bool = False) -> None:
        self.messages: list[dict] = []
        self.fail = fail

    def __call__(self, **kwargs) -> None:
        if self.fail:
            raise email_service.MailDeliveryError("SMTP-Versand fehlgeschlagen.")
        self.messages.append(kwargs)

    @property
    def last(self) -> dict:
        assert self.messages, "Es wurde keine E-Mail versendet"
        return self.messages[-1]

    def token(self) -> str:
        """Liest den Token aus dem Bestaetigungslink der letzten Mail."""
        return _extract_token(self.last["text_body"])


def _smtp_settings(**overrides) -> Settings:
    base = get_settings()
    values = base.model_dump()
    values.update(
        {
            "app_env": "production",
            "frontend_url": FRONTEND_URL,
            "smtp_enabled": True,
            "smtp_host": "smtp.test.local",
            "smtp_port": 587,
            "smtp_username": "mailer@test.local",
            "smtp_password": "not-a-real-secret",
            "smtp_from_email": "noreply@test.local",
            "smtp_from_name": "Warehouse-System",
            "smtp_security": "starttls",
        }
    )
    values.update(overrides)
    return Settings(**values)


@contextmanager
def _mail_env(monkeypatch, *, mailbox: _Mailbox | None = None, **setting_overrides):
    """Aktiviert SMTP + FRONTEND_URL und haengt einen Mail-Recorder ein."""
    box = mailbox or _Mailbox()
    settings = _smtp_settings(**setting_overrides)
    monkeypatch.setattr(email_service, "get_settings", lambda: settings)
    monkeypatch.setattr(verification, "get_settings", lambda: settings)
    monkeypatch.setattr(email_service, "send_mail", box)
    yield box


def _extract_token(text_body: str) -> str:
    match = re.search(rf"{re.escape(FRONTEND_URL)}\S+", text_body)
    assert match, "Kein Bestaetigungslink in der Mail gefunden"
    query = parse_qs(urlsplit(match.group(0)).query)
    assert "token" in query, "Bestaetigungslink ohne Token"
    return query["token"][0]


def _register(client: TestClient, email: str, *, name: str = "Verify Probe"):
    # Eindeutige XFF je Aufruf: sonst greift der Register-Rate-Limiter quer.
    return client.post(
        "/api/auth/register",
        headers={"X-Forwarded-For": f"reg-{uuid4().hex}"},
        json={"name": name, "email": email, "password": PASSWORD},
    )


def _resend(client: TestClient, email: str):
    return client.post(
        "/api/auth/resend-verification",
        headers={"X-Forwarded-For": f"res-{uuid4().hex}"},
        json={"email": email},
    )


def _confirm(client: TestClient, token: str):
    return client.post(
        "/api/auth/verify-email",
        headers={"X-Forwarded-For": f"cfm-{uuid4().hex}"},
        json={"token": token},
    )


def _user(email: str) -> UserRecord | None:
    with SessionLocal() as db:
        return db.scalar(select(UserRecord).where(UserRecord.email.ilike(email)))


def _approve(client: TestClient, email: str) -> None:
    """Admin-Freigabe ueber den echten Endpunkt."""
    user = _user(email)
    assert user is not None
    res = client.post(
        f"/api/wms/users/{user.external_id}/approve",
        headers=auth_headers(client, "Admin"),
    )
    assert res.status_code == 200, res.text


def _events(email: str, event_type: str) -> list[SecurityEventRecord]:
    with SessionLocal() as db:
        return list(
            db.scalars(
                select(SecurityEventRecord).where(
                    SecurityEventRecord.event_type == event_type,
                    SecurityEventRecord.entered_identifier == email.lower(),
                )
            ).all()
        )


@pytest.fixture(autouse=True)
def _email_verification_mode():
    """Diese Suite prueft Modus B — also wird er hier explizit aktiviert.

    Der Serverdefault ist seit der SMTP-Verwaltung bewusst der klassische
    Ablauf (nur Admin-Freigabe); er wird in tests/test_registration_modes.py
    geprueft. Nach jedem Test wird wieder auf den Default zurueckgestellt,
    damit sich die Suiten nicht gegenseitig beeinflussen.
    """
    with SessionLocal() as db:
        mail_config.set_registration_mode(db, mail_config.MODE_EMAIL_VERIFICATION)
    yield
    with SessionLocal() as db:
        mail_config.set_registration_mode(db, mail_config.MODE_CLASSIC)


@pytest.fixture(autouse=True)
def _reset_verification_limiters():
    limiters = (
        verification_confirm_rate_limiter,
        verification_email_rate_limiter,
        verification_resend_rate_limiter,
    )
    for limiter in limiters:
        limiter.reset_all()
    yield
    for limiter in limiters:
        limiter.reset_all()


def _unique_email(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex}@conventex.com"


# --- Registrierung + Versand ---------------------------------------------------


def test_registration_sends_verification_mail(monkeypatch) -> None:
    client = TestClient(app)
    email = _unique_email("verify-send")

    with _mail_env(monkeypatch) as mailbox:
        res = _register(client, email)

    assert res.status_code == 201, res.text
    body = res.json()
    assert body["emailSent"] is True
    assert body["emailHint"] is None

    assert len(mailbox.messages) == 1
    message = mailbox.last
    assert message["to_email"] == email
    assert message["subject"] == "Warehouse-System – E-Mail-Adresse bestätigen"
    # Text-Alternative UND HTML-Teil muessen vorhanden sein.
    assert message["text_body"].strip()
    assert "<html" in (message["html_body"] or "").lower()
    # Link kommt ausschliesslich aus der vertrauenswuerdigen FRONTEND_URL.
    assert f"{FRONTEND_URL}/registrierung-bestaetigen?token=" in message["text_body"]

    user = _user(email)
    assert user is not None
    assert user.email_verification_required is True
    assert user.email_verified_at is None
    # Konto bleibt bis zur Admin-Freigabe inaktiv.
    assert user.is_active is False
    assert _events(email, sec.EMAIL_VERIFICATION_SENT)


def test_registration_without_smtp_reports_failure(monkeypatch) -> None:
    """SMTP nicht konfiguriert: Registrierung darf NICHT als versendet gelten."""
    client = TestClient(app)
    email = _unique_email("verify-nosmtp")
    settings = _smtp_settings(smtp_enabled=False)
    monkeypatch.setattr(email_service, "get_settings", lambda: settings)
    monkeypatch.setattr(verification, "get_settings", lambda: settings)

    res = _register(client, email)

    assert res.status_code == 201
    body = res.json()
    assert body["emailSent"] is False
    assert body["emailHint"]
    # Das Konto existiert trotzdem — der Admin kann den Versand nachholen.
    assert _user(email) is not None
    # Ohne Versandweg wird auch kein Token ausgestellt (sonst liefe er
    # unbemerkt ab, waehrend niemand ihn je erhalten hat).
    with SessionLocal() as db:
        user = db.scalar(select(UserRecord).where(UserRecord.email.ilike(email)))
        tokens = db.scalars(
            select(EmailVerificationTokenRecord).where(
                EmailVerificationTokenRecord.user_external_id == user.external_id
            )
        ).all()
    assert tokens == []


def test_registration_with_smtp_error_reports_failure(monkeypatch) -> None:
    """Zustellfehler: ehrliche Rueckmeldung statt falscher Erfolgsanzeige."""
    client = TestClient(app)
    email = _unique_email("verify-smtperr")

    with _mail_env(monkeypatch, mailbox=_Mailbox(fail=True)):
        res = _register(client, email)

    assert res.status_code == 201
    body = res.json()
    assert body["emailSent"] is False
    assert body["emailHint"]
    assert _events(email, sec.EMAIL_VERIFICATION_SEND_FAILED)
    # Die Registrierung selbst ist durch — ein Resend muss moeglich sein.
    assert _user(email) is not None


def test_duplicate_registration_creates_no_second_account(monkeypatch) -> None:
    client = TestClient(app)
    email = _unique_email("verify-dup")

    with _mail_env(monkeypatch) as mailbox:
        first = _register(client, email)
        second = _register(client, email, name="Jemand Anders")

    assert first.status_code == 201
    assert second.status_code == 201
    # Nach aussen identische Antwort (Anti-Enumeration).
    assert first.json()["message"] == second.json()["message"]
    assert second.json()["emailSent"] is True

    with SessionLocal() as db:
        accounts = db.scalars(select(UserRecord).where(UserRecord.email.ilike(email))).all()
    assert len(accounts) == 1
    assert accounts[0].name == "Verify Probe"  # Name wurde NICHT ueberschrieben
    # Die zweite Registrierung hat den Link erneut geschickt (legitimer Fall
    # "Mail nicht angekommen") — und damit den ersten Token entwertet.
    assert len(mailbox.messages) == 2


def test_registration_disabled_blocks_before_any_mail(monkeypatch) -> None:
    client = TestClient(app)
    email = _unique_email("verify-closed")
    with SessionLocal() as db:
        sec.set_registration_enabled(db, False)
    try:
        with _mail_env(monkeypatch) as mailbox:
            res = _register(client, email)
        assert res.status_code == 403
        assert mailbox.messages == []
        assert _user(email) is None
    finally:
        with SessionLocal() as db:
            sec.set_registration_enabled(db, True)


def test_honeypot_still_discards_silently(monkeypatch) -> None:
    client = TestClient(app)
    email = _unique_email("verify-bot")
    with _mail_env(monkeypatch) as mailbox:
        res = client.post(
            "/api/auth/register",
            headers={"X-Forwarded-For": f"reg-{uuid4().hex}"},
            json={
                "name": "Bot",
                "email": email,
                "password": PASSWORD,
                "website": "http://spam.example",
            },
        )
    assert res.status_code == 201
    assert mailbox.messages == []
    assert _user(email) is None


# --- Token einloesen -----------------------------------------------------------


def test_verify_email_then_admin_approval_allows_login(monkeypatch) -> None:
    """Der vollstaendige Ablauf — beide Bedingungen muessen erfuellt sein."""
    client = TestClient(app)
    email = _unique_email("verify-full")

    with _mail_env(monkeypatch) as mailbox:
        assert _register(client, email).status_code == 201
        token = mailbox.token()

    # 1) Vor der Bestaetigung: Login unmoeglich.
    blocked = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert blocked.status_code == 403
    assert _events(email, sec.LOGIN_BLOCKED_EMAIL_UNVERIFIED)

    # 2) E-Mail bestaetigen — gibt das Konto NICHT frei.
    confirmed = _confirm(client, token)
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "verified"
    assert confirmed.json()["accountActive"] is False
    user = _user(email)
    assert user.email_verified_at is not None
    assert user.is_active is False

    still_blocked = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert still_blocked.status_code == 403

    # 3) Admin-Freigabe — jetzt (und erst jetzt) klappt der Login.
    _approve(client, email)
    login = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert login.status_code == 200, login.text
    assert login.json()["accessToken"]
    assert _events(email, sec.EMAIL_VERIFICATION_CONFIRMED)


def test_admin_approval_alone_does_not_bypass_verification(monkeypatch) -> None:
    """Die Admin-Freigabe darf das Verifizierungs-Gate nicht aushebeln."""
    client = TestClient(app)
    email = _unique_email("verify-bypass")
    with _mail_env(monkeypatch):
        assert _register(client, email).status_code == 201

    _approve(client, email)
    assert _user(email).is_active is True

    res = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert res.status_code == 403
    assert "E-Mail" in res.json()["detail"]


def test_invalid_token_is_rejected() -> None:
    client = TestClient(app)
    res = _confirm(client, "offensichtlich-kein-gueltiger-token-aber-lang-genug")
    assert res.status_code == 400
    assert "ungültig" in res.json()["detail"].lower()


def test_token_can_only_be_used_once(monkeypatch) -> None:
    client = TestClient(app)
    email = _unique_email("verify-once")
    with _mail_env(monkeypatch) as mailbox:
        assert _register(client, email).status_code == 201
        token = mailbox.token()

    assert _confirm(client, token).status_code == 200
    second = _confirm(client, token)
    assert second.status_code == 400


def test_expired_token_is_rejected(monkeypatch) -> None:
    client = TestClient(app)
    email = _unique_email("verify-expired")
    with _mail_env(monkeypatch) as mailbox:
        assert _register(client, email).status_code == 201
        token = mailbox.token()

    # Ablauf kuenstlich in die Vergangenheit ziehen.
    with SessionLocal() as db:
        record = db.scalar(
            select(EmailVerificationTokenRecord).where(
                EmailVerificationTokenRecord.token_hash == verification.token_hash(token)
            )
        )
        record.expires_at = datetime.now(UTC) - timedelta(minutes=1)
        db.commit()

    res = _confirm(client, token)
    assert res.status_code == 410
    assert "abgelaufen" in res.json()["detail"].lower()
    assert _user(email).email_verified_at is None


def test_resend_invalidates_previous_token(monkeypatch) -> None:
    client = TestClient(app)
    email = _unique_email("verify-resend")
    with _mail_env(monkeypatch) as mailbox:
        assert _register(client, email).status_code == 201
        first_token = mailbox.token()

        resend = _resend(client, email)
        assert resend.status_code == 200
        assert resend.json()["emailSent"] is True
        second_token = mailbox.token()

    assert first_token != second_token
    # Der alte Link ist sofort tot — nicht erst nach Ablauf.
    assert _confirm(client, first_token).status_code == 400
    assert _confirm(client, second_token).status_code == 200


def test_resend_for_unknown_email_is_generic(monkeypatch) -> None:
    """Keine Account-Enumeration: unbekannt und bekannt antworten identisch."""
    client = TestClient(app)
    known = _unique_email("verify-known")
    unknown = _unique_email("verify-unknown")

    with _mail_env(monkeypatch) as mailbox:
        assert _register(client, known).status_code == 201
        mailbox.messages.clear()

        known_res = _resend(client, known)
        unknown_res = _resend(client, unknown)

    assert known_res.status_code == unknown_res.status_code == 200
    assert known_res.json()["message"] == unknown_res.json()["message"]
    assert known_res.json()["emailSent"] == unknown_res.json()["emailSent"] is True
    # Trotz identischer Antwort ging nur an das existierende Konto eine Mail.
    assert [m["to_email"] for m in mailbox.messages] == [known]


def test_resend_is_rate_limited_per_email(monkeypatch) -> None:
    client = TestClient(app)
    email = _unique_email("verify-flood")
    with _mail_env(monkeypatch):
        assert _register(client, email).status_code == 201
        statuses = [_resend(client, email).status_code for _ in range(6)]
    # Irgendwann greift die Bremse — sonst waere Mail-Bombing moeglich.
    assert 429 in statuses


def test_verified_account_resend_sends_nothing(monkeypatch) -> None:
    client = TestClient(app)
    email = _unique_email("verify-done")
    with _mail_env(monkeypatch) as mailbox:
        assert _register(client, email).status_code == 201
        assert _confirm(client, mailbox.token()).status_code == 200
        mailbox.messages.clear()

        res = _resend(client, email)

    assert res.status_code == 200
    assert res.json()["emailSent"] is True  # generische Antwort
    assert mailbox.messages == []


# --- Rueckwaertskompatibilitaet -------------------------------------------------


def test_existing_users_are_not_locked_out() -> None:
    """Bestandskonten tragen keine Verifizierungspflicht und bleiben nutzbar."""
    client = TestClient(app)
    # auth_headers legt ein Konto direkt an (wie ein Bestands-/Adminkonto).
    headers = auth_headers(client, "Admin", user_id=f"usr-legacy-{uuid4().hex[:8]}")
    assert headers["Authorization"].startswith("Bearer ")

    me = client.get("/api/auth/me", headers=headers)
    assert me.status_code == 200

    with SessionLocal() as db:
        user = db.scalar(select(UserRecord).where(UserRecord.email == me.json()["email"]))
    assert user.email_verification_required is False
    assert user.email_verified_at is None


def test_admin_created_user_needs_no_verification() -> None:
    client = TestClient(app)
    headers = auth_headers(client, "Admin")
    email = _unique_email("verify-adminmade")
    created = client.post(
        "/api/wms/users",
        headers=headers,
        json={
            "id": "",
            "name": "Vom Admin angelegt",
            "email": email,
            "role": "Mitarbeiter",
            "lastActive": "Neu",
            "status": "Aktiv",
        },
    )
    assert created.status_code == 200, created.text
    assert created.json()["emailVerificationPending"] is False
    assert created.json()["emailVerificationRequired"] is False


def test_user_list_exposes_verification_state(monkeypatch) -> None:
    client = TestClient(app)
    email = _unique_email("verify-list")
    with _mail_env(monkeypatch) as mailbox:
        assert _register(client, email).status_code == 201
        token = mailbox.token()

    headers = auth_headers(client, "Admin")

    def _entry() -> dict:
        res = client.get("/api/wms/users", headers=headers)
        assert res.status_code == 200
        item = next((u for u in res.json() if u["email"].lower() == email), None)
        assert item is not None
        return item

    pending = _entry()
    assert pending["emailVerificationRequired"] is True
    assert pending["emailVerificationPending"] is True
    assert pending["emailVerifiedAt"] is None
    # Freigabe- und Verifizierungszustand ueberschreiben sich nicht gegenseitig.
    assert pending["status"] == "Wartet auf Freigabe"

    assert _confirm(client, token).status_code == 200
    verified = _entry()
    assert verified["emailVerificationPending"] is False
    assert verified["emailVerifiedAt"]
    assert verified["status"] == "Wartet auf Freigabe"

    _approve(client, email)
    approved = _entry()
    assert approved["status"] == "Aktiv"
    assert approved["emailVerificationPending"] is False


def test_admin_can_trigger_resend(monkeypatch) -> None:
    client = TestClient(app)
    email = _unique_email("verify-adminresend")
    with _mail_env(monkeypatch) as mailbox:
        assert _register(client, email).status_code == 201
        mailbox.messages.clear()
        user = _user(email)

        res = client.post(
            f"/api/wms/users/{user.external_id}/resend-verification",
            headers=auth_headers(client, "Admin"),
        )
        assert res.status_code == 200, res.text
        assert res.json()["sent"] is True
        assert [m["to_email"] for m in mailbox.messages] == [email]

        # Nach der Bestaetigung steht nichts mehr aus -> klarer 409.
        assert _confirm(client, mailbox.token()).status_code == 200
        again = client.post(
            f"/api/wms/users/{user.external_id}/resend-verification",
            headers=auth_headers(client, "Admin"),
        )
        assert again.status_code == 409


def test_admin_resend_requires_permission(monkeypatch) -> None:
    client = TestClient(app)
    email = _unique_email("verify-rbac")
    with _mail_env(monkeypatch):
        assert _register(client, email).status_code == 201
    user = _user(email)
    res = client.post(
        f"/api/wms/users/{user.external_id}/resend-verification",
        headers=auth_headers(client, "Mitarbeiter"),
    )
    assert res.status_code == 403


# --- Geheimhaltung -------------------------------------------------------------


def test_token_is_never_stored_in_clear_text(monkeypatch) -> None:
    client = TestClient(app)
    email = _unique_email("verify-hash")
    with _mail_env(monkeypatch) as mailbox:
        assert _register(client, email).status_code == 201
        token = mailbox.token()

    with SessionLocal() as db:
        user = db.scalar(select(UserRecord).where(UserRecord.email.ilike(email)))
        records = db.scalars(
            select(EmailVerificationTokenRecord).where(
                EmailVerificationTokenRecord.user_external_id == user.external_id
            )
        ).all()
        assert len(records) == 1
        assert records[0].token_hash != token
        assert records[0].token_hash == verification.token_hash(token)


def test_no_token_or_url_in_logs(monkeypatch, caplog) -> None:
    client = TestClient(app)
    email = _unique_email("verify-logs")
    with caplog.at_level("DEBUG"):
        with _mail_env(monkeypatch) as mailbox:
            assert _register(client, email).status_code == 201
            token = mailbox.token()
        assert _confirm(client, token).status_code == 200

    logged = "\n".join(record.getMessage() for record in caplog.records)
    assert token not in logged
    assert "/registrierung-bestaetigen" not in logged
    assert PASSWORD not in logged


def test_security_events_carry_no_token(monkeypatch) -> None:
    client = TestClient(app)
    email = _unique_email("verify-events")
    with _mail_env(monkeypatch) as mailbox:
        assert _register(client, email).status_code == 201
        token = mailbox.token()
    assert _confirm(client, token).status_code == 200

    with SessionLocal() as db:
        rows = db.scalars(
            select(SecurityEventRecord).where(
                SecurityEventRecord.event_type.in_(
                    (sec.EMAIL_VERIFICATION_SENT, sec.EMAIL_VERIFICATION_CONFIRMED)
                )
            )
        ).all()
        serialized = " ".join(
            f"{r.entered_identifier} {r.reason_code} {r.meta_json} {r.path}" for r in rows
        )
    assert token not in serialized


# --- Konfigurationshaerte ------------------------------------------------------


def test_plain_smtp_is_blocked_in_production() -> None:
    settings = _smtp_settings(smtp_security="none", app_env="production")
    with pytest.raises(email_service.MailNotConfiguredError):
        email_service.load_config(settings)


def test_plain_smtp_allowed_in_development() -> None:
    settings = _smtp_settings(smtp_security="none", app_env="development")
    config = email_service.load_config(settings)
    assert config.security == "none"


def test_http_frontend_url_is_rejected_in_production() -> None:
    settings = _smtp_settings(frontend_url="http://warehouse.test.local")
    with pytest.raises(verification.VerificationConfigError):
        verification.frontend_base_url(settings)


def test_missing_frontend_url_blocks_send() -> None:
    settings = _smtp_settings(frontend_url=None, base_url=None)
    with SessionLocal() as db:
        assert verification.configuration_problem(db, settings) is not None


def test_mask_email_hides_local_part() -> None:
    assert email_service.mask_email("max.mustermann@example.com") == "m***@example.com"
    assert email_service.mask_email(None) == "?"
