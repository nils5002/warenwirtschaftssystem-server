"""Tests fuer serverseitige Token-Invalidierung via token_version (Paket B2).

Abgedeckt:
* Ein gueltiger Token besteht die token_version-Pruefung.
* Logout, Passwort-Reset, Rollenwechsel und Deaktivierung invalidieren
  bestehende Tokens sofort (401).
* Nach einer Invalidierung liefert ein neuer Login wieder einen gueltigen Token.
* Logout ist idempotent (fehlender/kaputter Token -> kein Fehler).
* Eine nicht passende token_version wird abgewiesen.
* Die Invalidierung wirkt nur auf den betroffenen Benutzer.
"""

from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from app.schemas.auth import AuthUserInfo
from app.services.auth_service import issue_access_token

from .auth_helpers import auth_headers, ensure_auth_user


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_user_and_login(client: TestClient, role: str = "Mitarbeiter") -> tuple[str, str, str, str]:
    """Legt einen frischen, isolierten Benutzer an und loggt ihn ein.

    Liefert (user_id, email, password, token).
    """
    user_id = f"usr-tv-{uuid4().hex[:10]}"
    email, password = ensure_auth_user(role, user_id=user_id)
    res = client.post("/api/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200, res.text
    return user_id, email, password, res.json()["accessToken"]


# -----------------------------------------------------------------------------
# Gueltiger Token
# -----------------------------------------------------------------------------
def test_valid_token_passes_token_version_check() -> None:
    client = TestClient(app)
    user_id, _email, _password, token = _make_user_and_login(client)
    me = client.get("/api/auth/me", headers=_auth(token))
    assert me.status_code == 200
    assert me.json()["userId"] == user_id


# -----------------------------------------------------------------------------
# Logout invalidiert den Token
# -----------------------------------------------------------------------------
def test_logout_invalidates_existing_token() -> None:
    client = TestClient(app)
    _user_id, _email, _password, token = _make_user_and_login(client)
    auth = _auth(token)
    assert client.get("/api/auth/me", headers=auth).status_code == 200

    assert client.post("/api/auth/logout", headers=auth).status_code == 200

    # Der alte Token ist jetzt serverseitig ungueltig.
    assert client.get("/api/auth/me", headers=auth).status_code == 401
    assert client.get("/api/wms/overview", headers=auth).status_code == 401


def test_logout_is_idempotent_with_invalid_or_missing_token() -> None:
    client = TestClient(app)
    # Ohne Token.
    assert client.post("/api/auth/logout").status_code == 200
    # Mit kaputtem Token.
    assert client.post(
        "/api/auth/logout",
        headers={"Authorization": "Bearer kaputt.token"},
    ).status_code == 200


# -----------------------------------------------------------------------------
# Passwort-Reset invalidiert den Token
# -----------------------------------------------------------------------------
def test_password_reset_invalidates_existing_token() -> None:
    client = TestClient(app)
    user_id, _email, _password, token = _make_user_and_login(client)
    auth = _auth(token)
    assert client.get("/api/auth/me", headers=auth).status_code == 200

    reset = client.post(
        f"/api/wms/users/{user_id}/reset-password",
        headers=auth_headers(client, "Admin"),
        json={"newPassword": "NeuesPasswort123!"},
    )
    assert reset.status_code == 200, reset.text

    assert client.get("/api/auth/me", headers=auth).status_code == 401


# -----------------------------------------------------------------------------
# Rollenwechsel invalidiert den Token
# -----------------------------------------------------------------------------
def test_role_change_invalidates_existing_token() -> None:
    client = TestClient(app)
    user_id, _email, _password, token = _make_user_and_login(client, role="Mitarbeiter")
    auth = _auth(token)
    assert client.get("/api/auth/me", headers=auth).status_code == 200

    changed = client.patch(
        f"/api/wms/users/{user_id}",
        headers=auth_headers(client, "Admin"),
        json={"role": "Projektmanager"},
    )
    assert changed.status_code == 200, changed.text

    assert client.get("/api/auth/me", headers=auth).status_code == 401


# -----------------------------------------------------------------------------
# Deaktivierung invalidiert den Token
# -----------------------------------------------------------------------------
def test_deactivation_invalidates_existing_token() -> None:
    client = TestClient(app)
    user_id, _email, _password, token = _make_user_and_login(client)
    auth = _auth(token)
    assert client.get("/api/auth/me", headers=auth).status_code == 200

    deactivated = client.patch(
        f"/api/wms/users/{user_id}",
        headers=auth_headers(client, "Admin"),
        json={"status": "Inaktiv"},
    )
    assert deactivated.status_code == 200, deactivated.text

    assert client.get("/api/auth/me", headers=auth).status_code == 401


# -----------------------------------------------------------------------------
# Neuer Login nach Invalidierung funktioniert wieder
# -----------------------------------------------------------------------------
def test_relogin_after_invalidation_yields_working_token() -> None:
    client = TestClient(app)
    _user_id, email, password, token = _make_user_and_login(client)
    auth = _auth(token)

    client.post("/api/auth/logout", headers=auth)
    assert client.get("/api/auth/me", headers=auth).status_code == 401

    relogin = client.post("/api/auth/login", json={"email": email, "password": password})
    assert relogin.status_code == 200
    new_token = relogin.json()["accessToken"]
    assert client.get("/api/auth/me", headers=_auth(new_token)).status_code == 200


# -----------------------------------------------------------------------------
# token_version-Mismatch wird abgewiesen
# -----------------------------------------------------------------------------
def test_token_version_mismatch_is_rejected() -> None:
    client = TestClient(app)
    user_id = f"usr-tv-mismatch-{uuid4().hex[:8]}"
    email, _password = ensure_auth_user("Admin", user_id=user_id)
    info = AuthUserInfo(userId=user_id, name="TV Probe", email=email, role="Admin")

    # Frisch angelegter Benutzer hat token_version 0.
    stale = issue_access_token(info, token_version=999)
    assert client.get("/api/auth/me", headers=_auth(stale)).status_code == 401

    fresh = issue_access_token(info, token_version=0)
    assert client.get("/api/auth/me", headers=_auth(fresh)).status_code == 200


# -----------------------------------------------------------------------------
# Invalidierung wirkt nur auf den betroffenen Benutzer
# -----------------------------------------------------------------------------
def test_invalidation_is_scoped_to_one_user() -> None:
    client = TestClient(app)
    _id_a, _email_a, _pw_a, token_a = _make_user_and_login(client)
    _id_b, _email_b, _pw_b, token_b = _make_user_and_login(client)
    auth_a, auth_b = _auth(token_a), _auth(token_b)
    assert client.get("/api/auth/me", headers=auth_a).status_code == 200
    assert client.get("/api/auth/me", headers=auth_b).status_code == 200

    # Logout von Benutzer A invalidiert ausschliesslich A.
    client.post("/api/auth/logout", headers=auth_a)
    assert client.get("/api/auth/me", headers=auth_a).status_code == 401
    assert client.get("/api/auth/me", headers=auth_b).status_code == 200
