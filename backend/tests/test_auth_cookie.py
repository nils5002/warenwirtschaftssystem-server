"""Tests fuer die Cookie-basierte Authentifizierung (Security-Audit Paket B4).

Umstellung von localStorage-Bearer-Token auf ein HttpOnly Secure SameSite
Cookie. Abgedeckt:
* Login setzt ein HttpOnly-/SameSite=Lax-Cookie mit korrektem Pfad/Ablauf.
* Das Secure-Flag haengt am Schema: aus ueber HTTP (lokale Entwicklung),
  an ueber HTTPS.
* Das Cookie authentifiziert sowohl /api/auth/me als auch geschuetzte
  WMS-Endpunkte — ganz ohne Authorization-Header.
* Der Authorization-Header funktioniert weiterhin (Rueckwaertskompatibilitaet
  fuer API-/Test-Clients) und hat Vorrang vor dem Cookie.
* Logout loescht das Cookie und invalidiert den darin transportierten Token
  serverseitig (token_version, Paket B2 bleibt wirksam).
* Ohne Cookie und ohne Header bleibt der Zugriff gesperrt.
"""

from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from app.routes.dependencies import AUTH_COOKIE_NAME
from app.services.auth_service import AUTH_TOKEN_EXPIRY_SECONDS

from .auth_helpers import ensure_auth_user


def _set_cookie_lines(response) -> list[str]:
    """Liefert alle rohen Set-Cookie-Header der Antwort."""
    return [
        value
        for key, value in response.headers.multi_items()
        if key.lower() == "set-cookie"
    ]


def _auth_cookie_line(response) -> str:
    """Liefert den rohen Set-Cookie-Header des Auth-Cookies (oder '')."""
    for line in _set_cookie_lines(response):
        if line.startswith(f"{AUTH_COOKIE_NAME}="):
            return line
    return ""


def _login(client: TestClient, role: str = "Admin"):
    """Legt einen frischen Benutzer an und loggt ihn ein."""
    user_id = f"usr-b4-{uuid4().hex[:10]}"
    email, password = ensure_auth_user(role, user_id=user_id)
    res = client.post("/api/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200, res.text
    return user_id, res


# -----------------------------------------------------------------------------
# Login setzt das HttpOnly-Cookie
# -----------------------------------------------------------------------------
def test_login_sets_httponly_lax_cookie() -> None:
    client = TestClient(app)
    _user_id, res = _login(client)

    cookie = _auth_cookie_line(res).lower()
    assert cookie, "Login hat kein Auth-Cookie gesetzt"
    assert "httponly" in cookie
    assert "samesite=lax" in cookie
    assert "path=/" in cookie
    assert f"max-age={AUTH_TOKEN_EXPIRY_SECONDS}" in cookie


def test_login_cookie_not_secure_over_plain_http() -> None:
    # TestClient spricht standardmaessig HTTP -> kein Secure-Flag, sonst
    # wuerde der Login in der lokalen HTTP-Entwicklung nicht funktionieren.
    client = TestClient(app)
    _user_id, res = _login(client)
    assert "secure" not in _auth_cookie_line(res).lower()


def test_login_cookie_is_secure_over_https() -> None:
    # Ueber HTTPS muss das Secure-Flag gesetzt sein.
    client = TestClient(app, base_url="https://testserver")
    _user_id, res = _login(client)
    assert "secure" in _auth_cookie_line(res).lower()


def test_login_still_returns_token_in_body() -> None:
    # Rueckwaertskompatibilitaet: API-/Test-Clients lesen den Token weiterhin
    # aus dem Body und nutzen ihn als Bearer-Header.
    client = TestClient(app)
    _user_id, res = _login(client)
    assert res.json()["accessToken"]


# -----------------------------------------------------------------------------
# Das Cookie authentifiziert (ohne Authorization-Header)
# -----------------------------------------------------------------------------
def test_cookie_authenticates_auth_me() -> None:
    client = TestClient(app)
    user_id, _res = _login(client)
    # Kein Authorization-Header — nur das vom Login gesetzte Cookie im Jar.
    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["userId"] == user_id


def test_cookie_authenticates_protected_wms_endpoint() -> None:
    client = TestClient(app)
    _login(client, role="Admin")
    res = client.get("/api/wms/overview")
    assert res.status_code == 200


# -----------------------------------------------------------------------------
# Authorization-Header bleibt gueltig und hat Vorrang
# -----------------------------------------------------------------------------
def test_bearer_header_still_authenticates() -> None:
    client = TestClient(app)
    _user_id, res = _login(client)
    token = res.json()["accessToken"]
    # Frischer Client ohne Cookie-Jar -> es zaehlt allein der Header.
    bare = TestClient(app)
    me = bare.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200


def test_authorization_header_takes_precedence_over_cookie() -> None:
    # Cookie gehoert Benutzer A, Header traegt den Token von Benutzer B.
    client = TestClient(app)
    id_a, _res_a = _login(client)

    other = TestClient(app)
    id_b, res_b = _login(other)
    token_b = res_b.json()["accessToken"]

    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token_b}"})
    assert me.status_code == 200
    # Der Header gewinnt -> Benutzer B, nicht der Cookie-Benutzer A.
    assert me.json()["userId"] == id_b
    assert id_a != id_b


# -----------------------------------------------------------------------------
# Logout loescht das Cookie und invalidiert den Token
# -----------------------------------------------------------------------------
def test_logout_clears_auth_cookie() -> None:
    client = TestClient(app)
    _login(client)

    logout = client.post("/api/auth/logout")
    assert logout.status_code == 200
    # Loesch-Cookie: leerer Wert + sofortiger Ablauf.
    cleared = _auth_cookie_line(logout).lower()
    assert cleared, "Logout hat kein Loesch-Cookie gesetzt"
    assert "max-age=0" in cleared


def test_logout_invalidates_cookie_token() -> None:
    client = TestClient(app)
    _user_id, _res = _login(client)
    # Den im Cookie transportierten Token vor dem Logout sichern.
    stale_token = client.cookies.get(AUTH_COOKIE_NAME)
    assert stale_token

    assert client.post("/api/auth/logout").status_code == 200

    # Selbst wenn ein Client das alte Cookie behaelt und erneut sendet:
    # token_version wurde erhoeht -> der Token ist serverseitig ungueltig.
    client.cookies.set(AUTH_COOKIE_NAME, stale_token)
    me = client.get("/api/auth/me")
    assert me.status_code == 401


# -----------------------------------------------------------------------------
# Ohne Cookie und ohne Header bleibt der Zugriff gesperrt
# -----------------------------------------------------------------------------
def test_no_cookie_no_header_is_unauthorized() -> None:
    client = TestClient(app)
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/wms/overview").status_code == 401
