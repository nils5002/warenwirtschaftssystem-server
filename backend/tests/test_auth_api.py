from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app


def test_login_and_me_roundtrip() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    email = f"auth.smoke.{suffix}@example.local"
    password = "Willkommen123!"

    register = client.post(
        "/api/auth/register",
        json={"name": f"Auth Smoke {suffix}", "email": email, "password": password},
    )
    assert register.status_code in {200, 201}

    users_res = client.get("/api/wms/users", headers={"X-User-Role": "Admin"})
    assert users_res.status_code == 200
    user = next((item for item in users_res.json() if item.get("email", "").lower() == email), None)
    assert user is not None

    activate = client.patch(
        f"/api/wms/users/{user['id']}",
        headers={"X-User-Role": "Admin"},
        json={"status": "Aktiv"},
    )
    assert activate.status_code == 200

    login = client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
    )
    assert login.status_code == 200
    token = login.json()["accessToken"]
    assert token

    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    payload = me.json()
    assert payload["email"].lower() == email
    assert payload["userId"] == user["id"]


def test_protected_wms_endpoint_requires_auth() -> None:
    client = TestClient(app)
    unauthorized = client.get("/api/wms/overview")
    assert unauthorized.status_code == 401
