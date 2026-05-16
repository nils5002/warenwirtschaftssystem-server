"""Regressionstests fuer Security-Audit Paket A.

Abgedeckt:
1. Die ehemals unauthentifizierten Router /api/db/assets, /api/jobs und
   /api/llm sind nicht mehr erreichbar.
2. ``verify_auth_secret`` bricht einen Produktivstart mit Default-Secret ab.
3. Login verraet nicht, ob eine E-Mail existiert (Account-Enumeration).
4. Registrierung verraet nicht, ob eine E-Mail bereits vergeben ist.
5. Manipulierte und abgelaufene Tokens werden mit 401 abgewiesen.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.config.settings import Settings
from app.main import app
from app.schemas.auth import AuthUserInfo
from app.services.auth_service import (
    DEFAULT_AUTH_SECRET,
    issue_access_token,
    verify_auth_secret,
)

from .auth_helpers import auth_headers, ensure_auth_user


# -----------------------------------------------------------------------------
# 1. Ehemals unauthentifizierte Router sind nicht mehr erreichbar
# -----------------------------------------------------------------------------
def test_db_assets_router_is_not_exposed() -> None:
    client = TestClient(app)
    # Ohne Token: das ungeschuetzte Asset-CRUD darf produktiv nicht
    # erreichbar sein. Router wurde deregistriert -> 404.
    assert client.get("/api/db/assets").status_code in {401, 404}
    assert client.post("/api/db/assets", json={}).status_code in {401, 404}
    assert client.put("/api/db/assets/1", json={}).status_code in {401, 404}
    assert client.delete("/api/db/assets/1").status_code in {401, 404}


def test_jobs_router_is_not_exposed() -> None:
    client = TestClient(app)
    assert client.post("/api/jobs", json={}).status_code in {401, 404}
    assert client.get(f"/api/jobs/{uuid4().hex}").status_code in {401, 404}


def test_llm_router_is_not_exposed() -> None:
    client = TestClient(app)
    # Der SSRF-faehige base-Parameter darf gar nicht erst erreichbar sein.
    assert client.get("/api/llm/models?base=http://169.254.169.254").status_code in {401, 404}


def test_wms_asset_path_still_works_for_admin() -> None:
    """Der regulaere, geschuetzte WMS-Asset-Pfad bleibt funktionsfaehig."""
    client = TestClient(app)
    res = client.get("/api/wms/assets", headers=auth_headers(client, "Admin"))
    assert res.status_code == 200


# -----------------------------------------------------------------------------
# 2. Auth-Secret-Schutzpruefung
# -----------------------------------------------------------------------------
def test_verify_auth_secret_blocks_default_secret_outside_dev() -> None:
    settings = Settings(app_env="production", auth_token_secret=DEFAULT_AUTH_SECRET)
    with pytest.raises(RuntimeError):
        verify_auth_secret(settings)


def test_verify_auth_secret_blocks_empty_secret_outside_dev() -> None:
    settings = Settings(app_env="staging", auth_token_secret="   ")
    with pytest.raises(RuntimeError):
        verify_auth_secret(settings)


def test_verify_auth_secret_allows_real_secret_in_production() -> None:
    settings = Settings(app_env="production", auth_token_secret="s3cret-" + uuid4().hex)
    # Darf NICHT werfen.
    verify_auth_secret(settings)


def test_verify_auth_secret_only_warns_in_development() -> None:
    settings = Settings(app_env="development", auth_token_secret=DEFAULT_AUTH_SECRET)
    # Dev-Umgebung: nur Warnung, kein Abbruch.
    verify_auth_secret(settings)


# -----------------------------------------------------------------------------
# 3. Login verraet keine Konto-Existenz
# -----------------------------------------------------------------------------
def test_login_does_not_leak_account_existence() -> None:
    client = TestClient(app)
    # Bekannter, aktiver Benutzer — aber mit falschem Passwort.
    known_email, _ = ensure_auth_user(role="Admin", user_id=f"usr-enum-{uuid4().hex[:8]}")
    wrong_password = client.post(
        "/api/auth/login",
        json={"email": known_email, "password": "definitiv-falsch"},
    )
    # Voellig unbekannte E-Mail.
    unknown = client.post(
        "/api/auth/login",
        json={"email": f"missing-{uuid4().hex}@tests.local", "password": "definitiv-falsch"},
    )
    assert wrong_password.status_code == 401
    assert unknown.status_code == 401
    # Identische Antwort -> kein Unterschied zwischen "Passwort falsch" und
    # "E-Mail unbekannt".
    assert wrong_password.json()["detail"] == unknown.json()["detail"]


# -----------------------------------------------------------------------------
# 4. Registrierung verraet keine bereits vergebene E-Mail
# -----------------------------------------------------------------------------
def test_register_does_not_reveal_existing_email() -> None:
    client = TestClient(app)
    email = f"reg-enum-{uuid4().hex}@tests.local"
    first = client.post(
        "/api/auth/register",
        json={"name": "Reg Enum Eins", "email": email, "password": "Willkommen123!"},
    )
    assert first.status_code in {200, 201}
    # Zweite Registrierung mit derselben E-Mail: gleiche Antwort, kein 409.
    second = client.post(
        "/api/auth/register",
        json={"name": "Reg Enum Zwei", "email": email, "password": "Willkommen123!"},
    )
    assert second.status_code == first.status_code
    assert second.json() == first.json()


# -----------------------------------------------------------------------------
# 5. Token-Validierung: manipuliert und abgelaufen -> 401
# -----------------------------------------------------------------------------
def test_tampered_token_is_rejected() -> None:
    client = TestClient(app)
    headers = auth_headers(client, "Admin")
    token = headers["Authorization"].split(" ", 1)[1]
    last = token[-1]
    tampered = token[:-1] + ("A" if last != "A" else "B")
    res = client.get(
        "/api/wms/overview",
        headers={"Authorization": f"Bearer {tampered}"},
    )
    assert res.status_code == 401


def test_expired_token_is_rejected() -> None:
    client = TestClient(app)
    user = AuthUserInfo(
        userId="usr-expired-token",
        name="Expired Token",
        email="expired@tests.local",
        role="Admin",
    )
    expired = issue_access_token(user, expires_in=-3600)
    res = client.get(
        "/api/wms/overview",
        headers={"Authorization": f"Bearer {expired}"},
    )
    assert res.status_code == 401
