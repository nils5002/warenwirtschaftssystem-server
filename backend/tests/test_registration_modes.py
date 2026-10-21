"""Tests der SMTP-Verwaltung und der beiden Registrierungsverfahren.

Schwerpunkt — und wichtigste Zusicherung dieser Suite: **Der klassische
Registrierungsablauf mit reiner Admin-Freigabe funktioniert ohne jede
SMTP-Konfiguration vollstaendig.**

Es wird nie ein echter SMTP-Server angesprochen: Verbindungstest und Versand
sind in jedem Test durch Mocks ersetzt.
"""
from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config.settings import Settings, get_settings
from app.database.models import MailSettingsRecord, SecurityEventRecord, UserRecord
from app.database.session import SessionLocal
from app.main import app
from app.services import email_service, secret_store
from app.services import mail_config_service as mail_config
from app.services import security_event_service as sec
from app.services.rate_limiter import mail_test_rate_limiter, register_rate_limiter

from .auth_helpers import auth_headers

PASSWORD = "Willkommen123!"


# --- Hilfen -------------------------------------------------------------------


def _unique_email(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex}@conventex.com"


def _register(client: TestClient, email: str, *, name: str = "Mode Probe"):
    return client.post(
        "/api/auth/register",
        headers={"X-Forwarded-For": f"mode-{uuid4().hex}"},
        json={"name": name, "email": email, "password": PASSWORD},
    )


def _user(email: str) -> UserRecord | None:
    with SessionLocal() as db:
        return db.scalar(select(UserRecord).where(UserRecord.email.ilike(email)))


def _mail_record() -> MailSettingsRecord | None:
    with SessionLocal() as db:
        return db.scalar(select(MailSettingsRecord).order_by(MailSettingsRecord.id.asc()))


def _valid_settings_payload(**overrides) -> dict:
    payload = {
        "enabled": True,
        "host": "smtp.test.local",
        "port": 587,
        "security": "starttls",
        "username": "mailer@test.local",
        "password": "super-geheim-123",
        "fromEmail": "noreply@test.local",
        "fromName": "Warehouse-System",
        "timeoutSeconds": 15,
        "verificationExpiryHours": 24,
    }
    payload.update(overrides)
    return payload


def _configure_smtp(client: TestClient, **overrides):
    return client.put(
        "/api/admin/email/settings",
        headers=auth_headers(client, "Admin"),
        json=_valid_settings_payload(**overrides),
    )


def _make_smtp_work(client: TestClient, monkeypatch) -> None:
    """Bringt SMTP in den Zustand "getestet + Test-Mail angenommen"."""
    assert _configure_smtp(client).status_code == 200
    monkeypatch.setattr(email_service, "test_connection", lambda config: None)
    monkeypatch.setattr(email_service, "send_mail", lambda **kwargs: None)
    headers = auth_headers(client, "Admin")
    assert client.post("/api/admin/email/test-connection", headers=headers).json()["success"]
    sent = client.post(
        "/api/admin/email/send-test", headers=headers, json={"recipient": "admin@test.local"}
    )
    assert sent.json()["success"] is True


def _reset_mail_state() -> None:
    with SessionLocal() as db:
        db.query(MailSettingsRecord).delete()
        db.commit()
        mail_config.set_registration_mode(db, mail_config.MODE_CLASSIC)


@pytest.fixture(autouse=True)
def _clean_mail_state():
    """Jeder Test startet ohne SMTP-Konfiguration und im klassischen Modus."""
    mail_test_rate_limiter.reset_all()
    register_rate_limiter.reset_all()
    _reset_mail_state()
    yield
    _reset_mail_state()
    mail_test_rate_limiter.reset_all()


def _production_settings(**overrides) -> Settings:
    values = get_settings().model_dump()
    values.update({"app_env": "production", "frontend_url": "https://wms.test.local"})
    values.update(overrides)
    return Settings(**values)


# --- Modus A: klassische Registrierung ohne SMTP ------------------------------


def test_classic_registration_without_smtp_end_to_end() -> None:
    """Der komplette Ablauf ohne jede SMTP-Konfiguration.

    Registrierung -> wartet auf Freigabe -> Admin gibt frei -> Login klappt.
    Das ist die wichtigste Zusicherung des gesamten Pakets.
    """
    client = TestClient(app)
    email = _unique_email("classic")

    # Vorbedingung: Es gibt wirklich keine nutzbare SMTP-Konfiguration.
    with SessionLocal() as db:
        assert mail_config.resolve(db).usable is False
        assert mail_config.get_registration_mode(db) == mail_config.MODE_CLASSIC

    registered = _register(client, email)
    assert registered.status_code == 201, registered.text
    body = registered.json()
    assert body["verificationRequired"] is False
    # Im klassischen Modus gibt es keinen Mailversand -> auch keinen Fehler.
    assert body["emailSent"] is True
    assert body["emailHint"] is None
    assert "Freigabe" in body["message"]

    user = _user(email)
    assert user is not None
    assert user.is_active is False
    assert user.status == "Wartet auf Freigabe"
    # Entscheidend: KEINE Bestaetigungspflicht -> kein Verifizierungs-Gate.
    assert user.email_verification_required is False

    blocked = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert blocked.status_code == 403

    approve = client.post(
        f"/api/wms/users/{user.external_id}/approve", headers=auth_headers(client, "Admin")
    )
    assert approve.status_code == 200, approve.text

    login = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert login.status_code == 200, login.text
    assert login.json()["accessToken"]


def test_classic_registration_sends_no_mail(monkeypatch) -> None:
    client = TestClient(app)
    sent: list[dict] = []
    monkeypatch.setattr(email_service, "send_mail", lambda **kwargs: sent.append(kwargs))

    assert _register(client, _unique_email("classic-nomail")).status_code == 201
    assert sent == []


def test_classic_registration_works_even_with_broken_smtp(monkeypatch) -> None:
    """SMTP konfiguriert, aber kaputt — der klassische Ablauf bleibt unberuehrt."""
    client = TestClient(app)
    assert _configure_smtp(client, host="unerreichbar.invalid").status_code == 200

    def _explode(**kwargs):
        raise email_service.MailDeliveryError("SMTP-Versand fehlgeschlagen.")

    monkeypatch.setattr(email_service, "send_mail", _explode)

    email = _unique_email("classic-broken")
    registered = _register(client, email)
    assert registered.status_code == 201
    assert registered.json()["verificationRequired"] is False

    user = _user(email)
    assert user is not None and user.email_verification_required is False
    client.post(
        f"/api/wms/users/{user.external_id}/approve", headers=auth_headers(client, "Admin")
    )
    assert (
        client.post("/api/auth/login", json={"email": email, "password": PASSWORD}).status_code
        == 200
    )


def test_registration_switch_still_blocks_in_classic_mode() -> None:
    """Der bestehende Ein/Aus-Schalter bleibt unabhaengig vom Verfahren."""
    client = TestClient(app)
    with SessionLocal() as db:
        sec.set_registration_enabled(db, False)
    try:
        res = _register(client, _unique_email("classic-closed"))
        assert res.status_code == 403
    finally:
        with SessionLocal() as db:
            sec.set_registration_enabled(db, True)


def test_admin_created_user_unaffected_by_mode() -> None:
    client = TestClient(app)
    email = _unique_email("classic-adminmade")
    created = client.post(
        "/api/wms/users",
        headers=auth_headers(client, "Admin"),
        json={
            "id": "",
            "name": "Admin-Anlage",
            "email": email,
            "role": "Mitarbeiter",
            "lastActive": "Neu",
            "status": "Aktiv",
        },
    )
    assert created.status_code == 200, created.text
    assert created.json()["emailVerificationRequired"] is False


# --- SMTP-Verwaltung ----------------------------------------------------------


def test_mail_endpoints_require_admin() -> None:
    client = TestClient(app)
    employee = auth_headers(client, "Mitarbeiter")
    assert client.get("/api/admin/email/settings", headers=employee).status_code == 403
    assert client.get("/api/admin/email/status", headers=employee).status_code == 403
    assert (
        client.put(
            "/api/admin/email/settings", headers=employee, json=_valid_settings_payload()
        ).status_code
        == 403
    )
    assert client.post("/api/admin/email/test-connection", headers=employee).status_code == 403
    assert (
        client.post(
            "/api/admin/email/send-test", headers=employee, json={"recipient": "a@b.de"}
        ).status_code
        == 403
    )
    assert (
        client.put(
            "/api/admin/email/registration-mode",
            headers=employee,
            json={"mode": "classic_admin_approval"},
        ).status_code
        == 403
    )


def test_mail_endpoints_require_authentication() -> None:
    client = TestClient(app)
    assert client.get("/api/admin/email/settings").status_code == 401


def test_settings_are_persisted_and_password_is_encrypted() -> None:
    client = TestClient(app)
    saved = _configure_smtp(client)
    assert saved.status_code == 200, saved.text
    body = saved.json()

    # Keinerlei Geheimnis in der Antwort.
    assert "password" not in body
    assert "passwordEncrypted" not in body
    assert body["passwordSet"] is True
    assert body["host"] == "smtp.test.local"

    record = _mail_record()
    assert record is not None
    # In der DB steht NUR Chiffretext.
    assert record.password_encrypted
    assert "super-geheim-123" not in record.password_encrypted
    assert secret_store.decrypt(record.password_encrypted) == "super-geheim-123"

    # Erneutes Laden (entspricht einem Neustart) liefert denselben Stand.
    again = client.get("/api/admin/email/settings", headers=auth_headers(client, "Admin"))
    assert again.status_code == 200
    assert again.json()["passwordSet"] is True
    assert again.json()["username"] == "mailer@test.local"
    assert "password" not in again.json()


def test_empty_password_keeps_existing_secret() -> None:
    client = TestClient(app)
    assert _configure_smtp(client).status_code == 200
    before = _mail_record().password_encrypted

    # Ohne Passwortfeld speichern (typischer Formular-Roundtrip).
    payload = _valid_settings_payload()
    payload.pop("password")
    payload["fromName"] = "Neuer Name"
    updated = client.put(
        "/api/admin/email/settings", headers=auth_headers(client, "Admin"), json=payload
    )
    assert updated.status_code == 200
    assert updated.json()["fromName"] == "Neuer Name"
    assert updated.json()["passwordSet"] is True
    assert _mail_record().password_encrypted == before


def test_placeholder_password_is_not_stored() -> None:
    """Der UI-Platzhalter darf das echte Passwort nie ersetzen."""
    client = TestClient(app)
    assert _configure_smtp(client).status_code == 200
    before = _mail_record().password_encrypted

    assert _configure_smtp(client, password=mail_config.PASSWORD_PLACEHOLDER).status_code == 200
    record = _mail_record()
    assert record.password_encrypted == before
    assert secret_store.decrypt(record.password_encrypted) == "super-geheim-123"


def test_clear_password_removes_secret() -> None:
    client = TestClient(app)
    assert _configure_smtp(client).status_code == 200
    payload = _valid_settings_payload(username=None)
    payload.pop("password")
    payload["clearPassword"] = True
    cleared = client.put(
        "/api/admin/email/settings", headers=auth_headers(client, "Admin"), json=payload
    )
    assert cleared.status_code == 200
    assert cleared.json()["passwordSet"] is False
    assert _mail_record().password_encrypted is None


PROD_AUTH_SECRET = "prod-like-auth-secret-0123456789-abcdef"


def test_password_saved_without_extra_env_via_derived_key(monkeypatch) -> None:
    """Kernzusage: Ohne MAIL_CONFIG_ENCRYPTION_KEY wird trotzdem verschluesselt
    gespeichert — mit einem aus AUTH_TOKEN_SECRET abgeleiteten Schluessel."""
    client = TestClient(app)
    prod = _production_settings(
        mail_config_encryption_key=None, auth_token_secret=PROD_AUTH_SECRET
    )
    monkeypatch.setattr(secret_store, "get_settings", lambda: prod)
    res = _configure_smtp(client)
    assert res.status_code == 200, res.text
    stored = _mail_record().password_encrypted
    assert stored and "super-geheim-123" not in stored
    assert secret_store.decrypt(stored, prod) == "super-geheim-123"
    assert secret_store.key_source(prod) == secret_store.KEY_SOURCE_DERIVED


def test_saving_password_refused_without_any_usable_key(monkeypatch) -> None:
    """Platzhalter-Secret und kein expliziter Key -> kontrolliert ablehnen,
    niemals im Klartext speichern."""
    client = TestClient(app)
    monkeypatch.setattr(
        secret_store,
        "get_settings",
        lambda: _production_settings(
            mail_config_encryption_key=None, auth_token_secret="change-me-in-production"
        ),
    )
    res = _configure_smtp(client)
    assert res.status_code == 409
    assert "AUTH_TOKEN_SECRET" in res.json()["detail"]
    # Nichts wurde gespeichert -> die App laeuft unveraendert weiter.
    assert _mail_record() is None or _mail_record().password_encrypted is None


def test_unencrypted_smtp_rejected_in_production(monkeypatch) -> None:
    client = TestClient(app)
    monkeypatch.setattr(mail_config, "get_settings", lambda: _production_settings())
    res = _configure_smtp(client, security="none")
    assert res.status_code == 400
    assert "STARTTLS" in res.json()["detail"]


def test_enabling_requires_host_and_sender() -> None:
    client = TestClient(app)
    res = _configure_smtp(client, host="")
    assert res.status_code == 400
    res = _configure_smtp(client, fromEmail="")
    assert res.status_code == 400


def test_invalid_sender_address_rejected() -> None:
    client = TestClient(app)
    assert _configure_smtp(client, fromEmail="kein-postfach").status_code == 400


def test_admin_config_takes_priority_over_env(monkeypatch) -> None:
    """Prioritaet 1: vollstaendige, aktivierte Adminkonfiguration."""
    client = TestClient(app)
    env_settings = _production_settings(
        smtp_enabled=True,
        smtp_host="env.example.com",
        smtp_from_email="env@example.com",
        smtp_security="starttls",
    )
    monkeypatch.setattr(mail_config, "get_settings", lambda: env_settings)
    monkeypatch.setattr(email_service, "get_settings", lambda: env_settings)

    with SessionLocal() as db:
        from_env = mail_config.resolve(db, env_settings)
        assert from_env.source == mail_config.SOURCE_ENV
        assert from_env.config.host == "env.example.com"

    assert _configure_smtp(client).status_code == 200
    with SessionLocal() as db:
        from_admin = mail_config.resolve(db, env_settings)
        assert from_admin.source == mail_config.SOURCE_ADMIN
        assert from_admin.config.host == "smtp.test.local"


def test_disabled_admin_config_falls_back_to_env(monkeypatch) -> None:
    client = TestClient(app)
    env_settings = _production_settings(
        smtp_enabled=True,
        smtp_host="env.example.com",
        smtp_from_email="env@example.com",
    )
    monkeypatch.setattr(mail_config, "get_settings", lambda: env_settings)
    monkeypatch.setattr(email_service, "get_settings", lambda: env_settings)

    assert _configure_smtp(client, enabled=False).status_code == 200
    with SessionLocal() as db:
        resolved = mail_config.resolve(db, env_settings)
    assert resolved.source == mail_config.SOURCE_ENV
    assert resolved.config.host == "env.example.com"


def test_undecryptable_password_is_reported_not_ignored(monkeypatch) -> None:
    """Falscher Masterkey -> sichtbarer Fehler statt stillem Leerpasswort."""
    client = TestClient(app)
    assert _configure_smtp(client).status_code == 200

    # Gueltiger, aber ANDERER expliziter Key + anderes Auth-Secret: Der
    # gespeicherte Chiffretext passt zu keinem der beiden Schluessel.
    other_key = _production_settings(
        mail_config_encryption_key=secret_store.generate_key(),
        auth_token_secret="a-completely-different-auth-secret-42",
    )
    monkeypatch.setattr(secret_store, "get_settings", lambda: other_key)

    with SessionLocal() as db:
        resolved = mail_config.resolve(db, other_key)
    assert resolved.usable is False
    assert "neu eingeben" in (resolved.problem or "")


# --- Verbindungstest und Test-E-Mail ------------------------------------------


def test_connection_test_success(monkeypatch) -> None:
    client = TestClient(app)
    assert _configure_smtp(client).status_code == 200
    monkeypatch.setattr(email_service, "test_connection", lambda config: None)

    res = client.post("/api/admin/email/test-connection", headers=auth_headers(client, "Admin"))
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    assert body["connectionOk"] is True
    assert body["authenticationOk"] is True
    assert _mail_record().last_test_success is True


def test_connection_test_unreachable(monkeypatch) -> None:
    client = TestClient(app)
    assert _configure_smtp(client).status_code == 200

    def _fail(config):
        raise email_service.MailDeliveryError(
            "Verbindung zum SMTP-Server nicht moeglich (Host, Port oder Verschluesselung pruefen)."
        )

    monkeypatch.setattr(email_service, "test_connection", _fail)
    res = client.post("/api/admin/email/test-connection", headers=auth_headers(client, "Admin"))
    assert res.status_code == 200
    assert res.json()["success"] is False
    assert "Verbindung" in res.json()["message"]
    assert _mail_record().last_test_success is False


def test_connection_test_wrong_password(monkeypatch) -> None:
    client = TestClient(app)
    assert _configure_smtp(client).status_code == 200

    def _fail(config):
        raise email_service.MailDeliveryError(
            "Der SMTP-Server hat die Anmeldung abgelehnt (Benutzername oder Passwort pruefen)."
        )

    monkeypatch.setattr(email_service, "test_connection", _fail)
    res = client.post("/api/admin/email/test-connection", headers=auth_headers(client, "Admin"))
    body = res.json()
    assert body["success"] is False
    # Verbindung stand, nur die Anmeldung scheiterte.
    assert body["connectionOk"] is True
    assert "Anmeldung" in body["message"]


def test_connection_test_without_configuration() -> None:
    client = TestClient(app)
    res = client.post("/api/admin/email/test-connection", headers=auth_headers(client, "Admin"))
    assert res.status_code == 200
    assert res.json()["success"] is False


def test_send_test_mail_success(monkeypatch) -> None:
    client = TestClient(app)
    assert _configure_smtp(client).status_code == 200
    captured: list[dict] = []
    monkeypatch.setattr(email_service, "send_mail", lambda **kwargs: captured.append(kwargs))

    res = client.post(
        "/api/admin/email/send-test",
        headers=auth_headers(client, "Admin"),
        json={"recipient": "empfaenger@test.local"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["success"] is True
    assert body["accepted"] is True
    assert "Postfach" in body["message"]  # Hinweis auf fehlenden Zustellnachweis

    assert len(captured) == 1
    assert captured[0]["to_email"] == "empfaenger@test.local"
    assert captured[0]["subject"] == "Warehouse-System – SMTP-Test erfolgreich"
    assert "angenommen" in captured[0]["text_body"]
    # Die Testmail verraet nichts ueber die Serverkonfiguration.
    assert "smtp.test.local" not in captured[0]["text_body"]
    assert "mailer@test.local" not in captured[0]["text_body"]

    record = _mail_record()
    assert record.last_send_success is True
    assert record.test_mail_accepted_at is not None


def test_send_test_mail_failure(monkeypatch) -> None:
    client = TestClient(app)
    assert _configure_smtp(client).status_code == 200

    def _fail(**kwargs):
        raise email_service.MailDeliveryError("SMTP-Versand fehlgeschlagen.")

    monkeypatch.setattr(email_service, "send_mail", _fail)
    res = client.post(
        "/api/admin/email/send-test",
        headers=auth_headers(client, "Admin"),
        json={"recipient": "empfaenger@test.local"},
    )
    assert res.status_code == 200
    assert res.json()["success"] is False
    record = _mail_record()
    assert record.last_send_success is False
    assert record.test_mail_accepted_at is None


def test_send_test_rejects_invalid_recipient() -> None:
    client = TestClient(app)
    assert _configure_smtp(client).status_code == 200
    res = client.post(
        "/api/admin/email/send-test",
        headers=auth_headers(client, "Admin"),
        json={"recipient": "kein-postfach"},
    )
    assert res.status_code == 400


def test_send_test_is_rate_limited(monkeypatch) -> None:
    client = TestClient(app)
    assert _configure_smtp(client).status_code == 200
    monkeypatch.setattr(email_service, "send_mail", lambda **kwargs: None)
    headers = auth_headers(client, "Admin")
    statuses = [
        client.post(
            "/api/admin/email/send-test", headers=headers, json={"recipient": "a@test.local"}
        ).status_code
        for _ in range(12)
    ]
    assert 429 in statuses


def test_changing_configuration_resets_test_results(monkeypatch) -> None:
    """Ein Test fuer Konfiguration A darf Konfiguration B nicht freischalten."""
    client = TestClient(app)
    _make_smtp_work(client, monkeypatch)
    assert _mail_record().last_test_success is True
    assert _mail_record().test_mail_accepted_at is not None

    assert _configure_smtp(client, host="anderer.host.local").status_code == 200
    record = _mail_record()
    assert record.last_test_success is None
    assert record.test_mail_accepted_at is None


# --- Registrierungsverfahren umschalten ---------------------------------------


def test_default_mode_is_classic() -> None:
    client = TestClient(app)
    res = client.get("/api/admin/email/status", headers=auth_headers(client, "Admin"))
    assert res.status_code == 200
    assert res.json()["registrationMode"] == mail_config.MODE_CLASSIC


def test_verification_mode_cannot_be_enabled_without_smtp() -> None:
    client = TestClient(app)
    res = client.put(
        "/api/admin/email/registration-mode",
        headers=auth_headers(client, "Admin"),
        json={"mode": mail_config.MODE_EMAIL_VERIFICATION},
    )
    assert res.status_code == 409
    with SessionLocal() as db:
        assert mail_config.get_registration_mode(db) == mail_config.MODE_CLASSIC


def test_verification_mode_needs_successful_test(monkeypatch) -> None:
    """Konfiguriert allein reicht nicht — Test und Test-Mail sind Pflicht."""
    client = TestClient(app)
    assert _configure_smtp(client).status_code == 200
    headers = auth_headers(client, "Admin")

    blocked = client.put(
        "/api/admin/email/registration-mode",
        headers=headers,
        json={"mode": mail_config.MODE_EMAIL_VERIFICATION},
    )
    assert blocked.status_code == 409

    monkeypatch.setattr(email_service, "test_connection", lambda config: None)
    assert client.post("/api/admin/email/test-connection", headers=headers).json()["success"]

    # Verbindungstest allein reicht immer noch nicht.
    still_blocked = client.put(
        "/api/admin/email/registration-mode",
        headers=headers,
        json={"mode": mail_config.MODE_EMAIL_VERIFICATION},
    )
    assert still_blocked.status_code == 409

    monkeypatch.setattr(email_service, "send_mail", lambda **kwargs: None)
    assert client.post(
        "/api/admin/email/send-test", headers=headers, json={"recipient": "a@test.local"}
    ).json()["success"]

    enabled = client.put(
        "/api/admin/email/registration-mode",
        headers=headers,
        json={"mode": mail_config.MODE_EMAIL_VERIFICATION},
    )
    assert enabled.status_code == 200, enabled.text
    with SessionLocal() as db:
        assert mail_config.get_registration_mode(db) == mail_config.MODE_EMAIL_VERIFICATION


def test_switch_back_to_classic_is_always_allowed(monkeypatch) -> None:
    client = TestClient(app)
    _make_smtp_work(client, monkeypatch)
    headers = auth_headers(client, "Admin")
    assert client.put(
        "/api/admin/email/registration-mode",
        headers=headers,
        json={"mode": mail_config.MODE_EMAIL_VERIFICATION},
    ).status_code == 200

    # SMTP faellt aus — der Rueckweg muss trotzdem offen sein.
    assert _configure_smtp(client, enabled=False).status_code == 200
    back = client.put(
        "/api/admin/email/registration-mode",
        headers=headers,
        json={"mode": mail_config.MODE_CLASSIC},
    )
    assert back.status_code == 200
    with SessionLocal() as db:
        assert mail_config.get_registration_mode(db) == mail_config.MODE_CLASSIC


def test_switching_to_classic_keeps_existing_verification_duty(monkeypatch) -> None:
    """Keine stille Herabstufung: eine bestehende Pflicht bleibt bestehen."""
    client = TestClient(app)
    _make_smtp_work(client, monkeypatch)
    headers = auth_headers(client, "Admin")
    assert client.put(
        "/api/admin/email/registration-mode",
        headers=headers,
        json={"mode": mail_config.MODE_EMAIL_VERIFICATION},
    ).status_code == 200

    email = _unique_email("mode-b-user")
    assert _register(client, email).status_code == 201
    user = _user(email)
    assert user.email_verification_required is True

    # Zurueck auf den klassischen Ablauf.
    assert client.put(
        "/api/admin/email/registration-mode",
        headers=headers,
        json={"mode": mail_config.MODE_CLASSIC},
    ).status_code == 200

    # Das bestehende Konto behaelt seine Pflicht ...
    assert _user(email).email_verification_required is True
    # ... und die Admin-Freigabe umgeht sie NICHT.
    client.post(f"/api/wms/users/{user.external_id}/approve", headers=headers)
    blocked = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert blocked.status_code == 403

    # Ein danach registrierter Benutzer laeuft wieder klassisch.
    classic_email = _unique_email("after-switch")
    assert _register(client, classic_email).status_code == 201
    assert _user(classic_email).email_verification_required is False


def test_pending_verification_can_be_resent_after_outage(monkeypatch) -> None:
    """Nach einer SMTP-Stoerung muss die Bestaetigung nachholbar sein."""
    client = TestClient(app)
    _make_smtp_work(client, monkeypatch)
    headers = auth_headers(client, "Admin")
    client.put(
        "/api/admin/email/registration-mode",
        headers=headers,
        json={"mode": mail_config.MODE_EMAIL_VERIFICATION},
    )

    # Registrierung waehrend der Stoerung.
    def _fail(**kwargs):
        raise email_service.MailDeliveryError("SMTP-Versand fehlgeschlagen.")

    monkeypatch.setattr(email_service, "send_mail", _fail)
    email = _unique_email("outage")
    failed = _register(client, email)
    assert failed.status_code == 201
    assert failed.json()["emailSent"] is False
    assert _user(email).email_verification_required is True

    # SMTP laeuft wieder -> Admin kann die Bestaetigung nachschicken.
    captured: list[dict] = []
    monkeypatch.setattr(email_service, "send_mail", lambda **kwargs: captured.append(kwargs))
    resend = client.post(
        f"/api/wms/users/{_user(email).external_id}/resend-verification", headers=headers
    )
    assert resend.status_code == 200
    assert resend.json()["sent"] is True
    assert [m["to_email"] for m in captured] == [email]


def test_mode_change_is_audited(monkeypatch) -> None:
    client = TestClient(app)
    _make_smtp_work(client, monkeypatch)
    client.put(
        "/api/admin/email/registration-mode",
        headers=auth_headers(client, "Admin"),
        json={"mode": mail_config.MODE_EMAIL_VERIFICATION},
    )
    with SessionLocal() as db:
        events = db.scalars(
            select(SecurityEventRecord).where(
                SecurityEventRecord.event_type == sec.REGISTRATION_MODE_CHANGED
            )
        ).all()
    assert events
    assert any("email_verification" in (e.meta_json or "") for e in events)


def test_settings_change_is_audited_without_secrets() -> None:
    client = TestClient(app)
    assert _configure_smtp(client).status_code == 200
    with SessionLocal() as db:
        events = db.scalars(
            select(SecurityEventRecord).where(
                SecurityEventRecord.event_type == sec.MAIL_SETTINGS_UPDATED
            )
        ).all()
    assert events
    serialized = " ".join(f"{e.meta_json} {e.reason_code}" for e in events)
    assert "super-geheim-123" not in serialized
    assert "mailer@test.local" not in serialized


def test_no_secrets_in_logs(caplog, monkeypatch) -> None:
    client = TestClient(app)
    with caplog.at_level("DEBUG"):
        _make_smtp_work(client, monkeypatch)
    logged = "\n".join(record.getMessage() for record in caplog.records)
    assert "super-geheim-123" not in logged
    assert get_settings().auth_token_secret not in logged
    # Auch der abgeleitete Schluessel selbst taucht nie auf.
    derived = secret_store._derived_key(get_settings())
    assert derived is not None
    assert derived.fernet._signing_key.hex() not in logged


# --- Statusanzeige ------------------------------------------------------------


def test_status_reports_not_configured() -> None:
    client = TestClient(app)
    res = client.get("/api/admin/email/status", headers=auth_headers(client, "Admin"))
    assert res.status_code == 200
    body = res.json()
    assert body["state"] == "not_configured"
    assert body["source"] == "none"
    assert body["canSend"] is False
    assert body["canEnableVerification"] is False
    assert body["verificationBlockers"]
    assert body["secretStorageAvailable"] is True


def test_status_reports_disabled_configuration() -> None:
    client = TestClient(app)
    assert _configure_smtp(client, enabled=False).status_code == 200
    body = client.get("/api/admin/email/status", headers=auth_headers(client, "Admin")).json()
    assert body["state"] == "disabled"
    assert body["canSend"] is False


def test_status_reports_successful_test(monkeypatch) -> None:
    client = TestClient(app)
    _make_smtp_work(client, monkeypatch)
    body = client.get("/api/admin/email/status", headers=auth_headers(client, "Admin")).json()
    assert body["state"] == "test_succeeded"
    assert body["source"] == "admin"
    assert body["canSend"] is True
    assert body["canEnableVerification"] is True
    assert body["verificationBlockers"] == []
    assert body["testMailAcceptedAt"]


def test_status_contains_no_secret() -> None:
    client = TestClient(app)
    assert _configure_smtp(client).status_code == 200
    raw = client.get("/api/admin/email/status", headers=auth_headers(client, "Admin")).text
    assert "super-geheim-123" not in raw
    settings_raw = client.get(
        "/api/admin/email/settings", headers=auth_headers(client, "Admin")
    ).text
    assert "super-geheim-123" not in settings_raw
