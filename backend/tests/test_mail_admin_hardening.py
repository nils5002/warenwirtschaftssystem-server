"""Haertung der E-Mail-Verwaltung: Zugriff nur fuer Admins, CSRF, Rate-Limits,
Schluesselverwaltung ohne zusaetzliche ENV und die oeffentliche WWS-Adresse.

Es wird nie ein echter SMTP-Server angesprochen (Mocks).
"""
from __future__ import annotations

import base64
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config.settings import Settings, get_settings
from app.database.models import MailSettingsRecord, UserRecord
from app.database.session import SessionLocal
from app.main import app
from app.repositories import role_permission_repository
from app.services import email_service, secret_store
from app.services import email_verification_service as verification
from app.services import mail_config_service as mail_config
from app.services.backup_service import _import_warnings
from app.schemas.backup import WarehouseBackupPayload

from .auth_helpers import auth_headers, ensure_auth_user

PASSWORD = "Willkommen123!"
CSRF = {"X-Requested-With": "XMLHttpRequest"}

# Alle administrativen Endpunkte der E-Mail-Verwaltung: (Methode, Pfad, Body)
ADMIN_ENDPOINTS = [
    ("GET", "/api/admin/email/settings", None),
    ("PUT", "/api/admin/email/settings", {"enabled": False, "host": "smtp.test.local", "port": 587, "security": "starttls"}),
    ("GET", "/api/admin/email/status", None),
    ("POST", "/api/admin/email/test-connection", {}),
    ("POST", "/api/admin/email/send-test", {"recipient": "probe@test.local"}),
    ("PUT", "/api/admin/email/registration-mode", {"mode": "classic_admin_approval"}),
]


def _settings(**overrides) -> Settings:
    values = get_settings().model_dump()
    values.update(overrides)
    return Settings(**values)


def _reset() -> None:
    with SessionLocal() as db:
        db.query(MailSettingsRecord).delete()
        db.commit()
        mail_config.set_registration_mode(db, mail_config.MODE_CLASSIC)


@pytest.fixture(autouse=True)
def _clean_state():
    _reset()
    yield
    _reset()


def _call(client: TestClient, method: str, path: str, body, headers: dict | None = None):
    return client.request(method, path, json=body, headers=headers or {})


# --- Zugriff: 401 / 403 / Admin ----------------------------------------------


@pytest.mark.parametrize("method,path,body", ADMIN_ENDPOINTS)
def test_admin_mail_endpoints_require_authentication(method, path, body) -> None:
    client = TestClient(app)
    client.cookies.clear()
    assert _call(client, method, path, body, CSRF).status_code == 401


@pytest.mark.parametrize("role", ["Projektmanager", "Mitarbeiter"])
@pytest.mark.parametrize("method,path,body", ADMIN_ENDPOINTS)
def test_admin_mail_endpoints_forbidden_for_non_admins(role, method, path, body, monkeypatch) -> None:
    client = TestClient(app)
    # Selbst wenn ein Versand moeglich waere: es darf gar nicht so weit kommen.
    monkeypatch.setattr(email_service, "send_mail", lambda **kw: pytest.fail("Versand durch Nicht-Admin"))
    monkeypatch.setattr(email_service, "test_connection", lambda c: pytest.fail("Test durch Nicht-Admin"))
    headers = {**auth_headers(client, role), **CSRF}
    assert _call(client, method, path, body, headers).status_code == 403
    # Nichts wurde gespeichert.
    with SessionLocal() as db:
        assert db.scalar(select(MailSettingsRecord)) is None
        assert mail_config.get_registration_mode(db) == mail_config.MODE_CLASSIC


@pytest.mark.parametrize("method,path,body", ADMIN_ENDPOINTS)
def test_admin_mail_endpoints_allowed_for_admin(method, path, body, monkeypatch) -> None:
    client = TestClient(app)
    monkeypatch.setattr(email_service, "send_mail", lambda **kw: None)
    monkeypatch.setattr(email_service, "test_connection", lambda c: None)
    headers = {**auth_headers(client, "Admin"), **CSRF}
    assert _call(client, method, path, body, headers).status_code == 200


def test_granted_permission_does_not_bypass_admin_role() -> None:
    """Ein im Rolleneditor gewaehrtes ``mail.manage`` hebt den Rollen-Riegel nicht auf."""
    client = TestClient(app)
    with SessionLocal() as db:
        before = sorted(role_permission_repository.permissions_for_role(db, "projektmanager"))
        role_permission_repository.replace_role_permissions(
            db, "projektmanager", before + ["mail.manage", "users.manage"]
        )
    try:
        headers = {**auth_headers(client, "Projektmanager"), **CSRF}
        for method, path, body in ADMIN_ENDPOINTS:
            assert _call(client, method, path, body, headers).status_code == 403, path
    finally:
        with SessionLocal() as db:
            role_permission_repository.replace_role_permissions(db, "projektmanager", before)


def test_resend_verification_for_other_user_is_admin_only() -> None:
    client = TestClient(app)
    email, _ = ensure_auth_user(role="Mitarbeiter", user_id=f"usr-resend-{uuid4().hex[:8]}")
    with SessionLocal() as db:
        target = db.scalar(select(UserRecord).where(UserRecord.email == email))
        target.email_verification_required = True
        target.email_verified_at = None
        db.commit()
        user_id = target.external_id
    path = f"/api/wms/users/{user_id}/resend-verification"

    anonymous = TestClient(app)
    anonymous.cookies.clear()
    assert anonymous.post(path, headers=CSRF).status_code == 401
    for role in ("Projektmanager", "Mitarbeiter"):
        assert client.post(path, headers={**auth_headers(client, role), **CSRF}).status_code == 403
    # Admin darf (SMTP fehlt -> ehrliche Rueckmeldung statt Fehler).
    res = client.post(path, headers={**auth_headers(client, "Admin"), **CSRF})
    assert res.status_code == 200
    assert res.json()["sent"] is False


def test_public_registration_endpoints_need_no_admin() -> None:
    """Oeffentliche Funktionen bleiben ohne Anmeldung erreichbar und verraten
    nichts ueber die SMTP-Konfiguration."""
    client = TestClient(app)
    client.cookies.clear()
    res = client.post(
        "/api/auth/resend-verification",
        headers={"X-Forwarded-For": f"pub-{uuid4().hex}"},
        json={"email": f"nobody-{uuid4().hex}@test.local"},
    )
    assert res.status_code == 200
    # Nur die generische Rueckmeldung — keine Konfigurationsfelder.
    assert set(res.json()) <= {"message", "emailSent", "emailHint"}
    assert "smtp.test.local" not in res.text and "password" not in res.text.lower()
    res = client.post("/api/auth/verify-email", json={"token": "x" * 40})
    assert res.status_code in {400, 410}


# --- CSRF ---------------------------------------------------------------------


def test_cookie_authenticated_write_requires_csrf_header() -> None:
    """Browser-Sitzung (Cookie) ohne X-Requested-With -> 403, mit -> 200."""
    client = TestClient(app)
    email, password = ensure_auth_user(role="Admin")
    login = client.post("/api/auth/login", json={"email": email, "password": password})
    assert login.status_code == 200
    body = {"mode": "classic_admin_approval"}
    without = client.put("/api/admin/email/registration-mode", json=body)
    assert without.status_code == 403
    assert "Sicherheits-Header" in without.json()["detail"]
    with_header = client.put("/api/admin/email/registration-mode", json=body, headers=CSRF)
    assert with_header.status_code == 200
    # Lesende Endpunkte brauchen den Header nicht.
    assert client.get("/api/admin/email/settings").status_code == 200


# --- Rate-Limit fuer Konfigurationsaenderungen ---------------------------------


def test_settings_changes_are_rate_limited() -> None:
    client = TestClient(app)
    headers = {**auth_headers(client, "Admin"), **CSRF}
    body = {"mode": "classic_admin_approval"}
    statuses = [
        client.put("/api/admin/email/registration-mode", json=body, headers=headers).status_code
        for _ in range(31)
    ]
    assert statuses[:30] == [200] * 30
    assert statuses[30] == 429


# --- Schluesselverwaltung -----------------------------------------------------


PROD_SECRET = "prod-like-auth-secret-0123456789-abcdef"


def _prod(**overrides) -> Settings:
    values = {
        "app_env": "production",
        "auth_token_secret": PROD_SECRET,
        "mail_config_encryption_key": None,
    }
    values.update(overrides)
    return _settings(**values)


def test_derived_key_is_domain_separated_from_auth_secret() -> None:
    settings = _prod()
    key = secret_store._derived_key(settings)
    assert key is not None and key.source == secret_store.KEY_SOURCE_DERIVED
    raw_key = key.fernet._signing_key + key.fernet._encryption_key
    assert PROD_SECRET.encode() not in raw_key
    assert raw_key != PROD_SECRET.encode()[:32]
    # Deterministisch: gleiche Basis -> gleicher Schluessel (Neustart-fest).
    again = secret_store._derived_key(_prod())
    token = secret_store.encrypt("smtp-pass", settings)
    assert again.fernet.decrypt(token.encode()).decode() == "smtp-pass"


def test_rotated_auth_secret_makes_password_unreadable_not_empty() -> None:
    token = secret_store.encrypt("smtp-pass", _prod())
    rotated = _prod(auth_token_secret="rotated-auth-secret-9876543210-xyz")
    with pytest.raises(secret_store.SecretDecryptionError) as exc:
        secret_store.decrypt(token, rotated)
    assert "neu eingeben" in str(exc.value)


def test_explicit_key_stays_compatible_and_has_priority() -> None:
    explicit = secret_store.generate_key()
    with_key = _prod(mail_config_encryption_key=explicit)
    assert secret_store.key_source(with_key) == secret_store.KEY_SOURCE_EXPLICIT
    # Bestehende Installation mit explizitem Key: Chiffretext bleibt lesbar.
    token_explicit = secret_store.encrypt("old-pass", with_key)
    assert secret_store.decrypt(token_explicit, with_key) == "old-pass"
    # Vorher abgeleitet gespeicherte Passwoerter bleiben ebenfalls lesbar,
    # wenn spaeter ein expliziter Key hinzukommt (keine stille Unlesbarkeit).
    token_derived = secret_store.encrypt("derived-pass", _prod())
    assert secret_store.decrypt(token_derived, with_key) == "derived-pass"


def test_invalid_explicit_key_is_reported_not_silently_replaced() -> None:
    broken = _prod(mail_config_encryption_key="not-a-fernet-key")
    with pytest.raises(secret_store.SecretKeyMissingError):
        secret_store.encrypt("x", broken)
    assert secret_store.key_source(broken) is None


def test_placeholder_auth_secret_is_never_a_key_basis_in_production() -> None:
    for weak in ("change-me-in-production", "short"):
        settings = _prod(auth_token_secret=weak)
        assert secret_store.is_available(settings) is False
        assert "AUTH_TOKEN_SECRET" in (secret_store.availability_hint(settings) or "")


def test_status_reports_key_source_and_readability() -> None:
    client = TestClient(app)
    headers = {**auth_headers(client, "Admin"), **CSRF}
    saved = client.put(
        "/api/admin/email/settings",
        headers=headers,
        json={
            "enabled": True, "host": "smtp.test.local", "port": 587, "security": "starttls",
            "username": "u", "password": "pw-123456", "fromEmail": "noreply@test.local",
        },
    )
    assert saved.status_code == 200
    assert "pw-123456" not in saved.text
    status = client.get("/api/admin/email/status", headers=headers).json()
    assert status["secretKeySource"] == "derived"
    assert status["passwordReadable"] is True
    assert "pw-123456" not in str(status)


# --- Sofortige Wirkung ohne Neustart -------------------------------------------


def test_settings_change_applies_immediately(monkeypatch) -> None:
    client = TestClient(app)
    headers = {**auth_headers(client, "Admin"), **CSRF}
    used_hosts: list[str] = []
    monkeypatch.setattr(email_service, "test_connection", lambda config: used_hosts.append(config.host))
    for host in ("smtp-a.test.local", "smtp-b.test.local"):
        assert client.put(
            "/api/admin/email/settings",
            headers=headers,
            json={"enabled": True, "host": host, "port": 587, "security": "starttls", "fromEmail": "noreply@test.local"},
        ).status_code == 200
        assert client.post("/api/admin/email/test-connection", headers=headers).json()["success"]
    assert used_hosts == ["smtp-a.test.local", "smtp-b.test.local"]


# --- Dropdown: tatsaechlicher Zustand ----------------------------------------


def test_status_tells_ui_whether_plain_smtp_is_allowed(monkeypatch) -> None:
    client = TestClient(app)
    headers = auth_headers(client, "Admin")
    assert client.get("/api/admin/email/status", headers=headers).json()["plainSmtpAllowed"] is True
    monkeypatch.setattr(mail_config, "get_settings", lambda: _prod())
    assert client.get("/api/admin/email/status", headers=headers).json()["plainSmtpAllowed"] is False


# --- Oeffentliche WWS-Adresse ------------------------------------------------


def _save_public_url(client: TestClient, url: str | None):
    return client.put(
        "/api/admin/email/settings",
        headers={**auth_headers(client, "Admin"), **CSRF},
        json={"enabled": False, "port": 587, "security": "starttls", "publicBaseUrl": url},
    )


@pytest.mark.parametrize(
    "url",
    [
        "warehouse.example.de",
        "ftp://warehouse.example.de",
        "https://user:pw@warehouse.example.de",
        "https://warehouse.example.de/?next=evil",
        "https://warehouse.example.de/#x",
        "https://",
    ],
)
def test_public_url_validation_rejects_bad_values(url) -> None:
    client = TestClient(app)
    res = _save_public_url(client, url)
    assert res.status_code == 400, url


def test_public_url_requires_https_in_production(monkeypatch) -> None:
    client = TestClient(app)
    monkeypatch.setattr(mail_config, "get_settings", lambda: _prod())
    assert _save_public_url(client, "http://warehouse.example.de").status_code == 400
    assert _save_public_url(client, "https://warehouse.example.de/").status_code == 200
    assert _save_public_url(client, "https://warehouse.example.de").json()["publicBaseUrl"] == "https://warehouse.example.de"


def test_public_url_from_admin_is_used_for_links_and_can_be_cleared(monkeypatch) -> None:
    client = TestClient(app)
    env = _settings(frontend_url="http://env-fallback.test.local")
    with SessionLocal() as db:
        assert verification.frontend_base_url(env, db) == "http://env-fallback.test.local"
        assert mail_config.public_base_url(db, env).source == mail_config.SOURCE_ENV

    assert _save_public_url(client, "https://warehouse.example.de").status_code == 200
    with SessionLocal() as db:
        assert verification.frontend_base_url(env, db) == "https://warehouse.example.de"
        link = verification.build_verification_url("tok-123", env, db)
        assert link.startswith("https://warehouse.example.de/registrierung-bestaetigen?token=")

    # Ohne Angabe (None) bleibt der Wert erhalten ...
    assert _save_public_url(client, None).json()["publicBaseUrl"] == "https://warehouse.example.de"
    # ... "" entfernt ihn bewusst -> FRONTEND_URL gilt wieder.
    assert _save_public_url(client, "").json()["publicBaseUrl"] is None
    with SessionLocal() as db:
        assert verification.frontend_base_url(env, db) == "http://env-fallback.test.local"


def test_public_url_is_never_taken_from_host_header(monkeypatch) -> None:
    client = TestClient(app)
    env = _settings(frontend_url="https://trusted.example.de")
    monkeypatch.setattr(mail_config, "get_settings", lambda: env)
    status = client.get(
        "/api/admin/email/status",
        headers={**auth_headers(client, "Admin"), "Host": "evil.example.com"},
    ).json()
    assert status["publicBaseUrl"] == "https://trusted.example.de"
    assert status["publicBaseUrlSource"] == "env"


def test_stored_http_url_after_switch_to_production_is_reported_not_replaced(monkeypatch) -> None:
    client = TestClient(app)
    assert _save_public_url(client, "http://intern.example.de").status_code == 200
    prod = _prod(frontend_url="https://env.example.de")
    with SessionLocal() as db:
        resolved = mail_config.public_base_url(db, prod)
    assert resolved.url is None
    assert resolved.source == mail_config.SOURCE_ADMIN
    assert "https" in (resolved.problem or "")


# --- Backup -------------------------------------------------------------------


def _backup_payload(mail: dict) -> WarehouseBackupPayload:
    return WarehouseBackupPayload.model_validate(
        {"version": 1, "exportedAt": "2026-10-21T12:00:00Z", "mailSettings": mail}
    )


def test_backup_restore_warns_precisely_about_password_readability() -> None:
    readable = secret_store.encrypt("pw")
    foreign = secret_store.encrypt("pw", _prod(auth_token_secret="foreign-installation-secret-123"))
    ok = _import_warnings(_backup_payload({"host": "h", "passwordEncrypted": readable}))
    bad = _import_warnings(_backup_payload({"host": "h", "passwordEncrypted": foreign}))
    assert any("lesbar" in w and "nicht lesbar" not in w for w in ok)
    assert any("nicht lesbar" in w for w in bad)
    assert all("pw" != w for w in ok + bad)


def test_backup_roundtrip_keeps_public_url_and_no_plaintext() -> None:
    client = TestClient(app)
    headers = {**auth_headers(client, "Admin"), **CSRF}
    assert client.put(
        "/api/admin/email/settings",
        headers=headers,
        json={
            "enabled": False, "host": "smtp.test.local", "port": 587, "security": "starttls",
            "password": "plain-secret-xyz", "fromEmail": "noreply@test.local",
            "publicBaseUrl": "https://warehouse.example.de",
        },
    ).status_code == 200
    export = client.get("/api/wms/backup/export", headers=headers)
    assert export.status_code == 200
    assert "plain-secret-xyz" not in export.text
    assert base64.b64encode(b"plain-secret-xyz").decode() not in export.text
    assert export.json()["mailSettings"]["publicBaseUrl"] == "https://warehouse.example.de"
