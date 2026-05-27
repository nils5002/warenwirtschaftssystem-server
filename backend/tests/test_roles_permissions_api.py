"""Tests für die Admin-Seite „Rollen & Rechte" (admin-editierbare Rollenrechte).

Deckt ab: roles.manage-RBAC, Default-Rechte (heutiges Verhalten 1:1),
Set-Ersetzung, Aussperr-Schutz, Verwerfen unbekannter Keys, data-driven
Enforcement eines konvertierten Endpunkts und effektive Rechte in /auth/me.

Die Suite teilt sich eine persistente DB — die autouse-Fixture stellt nach
jedem Test die Default-Rollenrechte wieder her.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.database.models import RolePermissionRecord
from app.database.session import SessionLocal
from app.domain.permissions import ALL_PERMISSION_KEYS, DEFAULT_ROLE_PERMISSIONS
from app.main import app
from app.repositories import role_permission_repository

from .auth_helpers import auth_headers


def _reseed_defaults() -> None:
    with SessionLocal() as db:
        db.execute(delete(RolePermissionRecord))
        db.commit()
        role_permission_repository.seed_default_role_permissions(db)


@pytest.fixture(autouse=True)
def _reset_role_permissions():
    _reseed_defaults()
    yield
    _reseed_defaults()


def _admin(client: TestClient) -> dict[str, str]:
    return auth_headers(client, "Admin")


def test_permissions_catalog_requires_roles_manage() -> None:
    client = TestClient(app)
    ok = client.get("/api/wms/admin/permissions", headers=_admin(client))
    assert ok.status_code == 200, ok.text
    groups = ok.json()["groups"]
    assert groups, "Katalog darf nicht leer sein"
    all_keys = {perm["key"] for group in groups for perm in group["permissions"]}
    assert "roles.manage" in all_keys
    # deutsche Labels vorhanden, keine technischen Keys als Label
    labels = {perm["label"] for group in groups for perm in group["permissions"]}
    assert "Rollen & Rechte verwalten" in labels

    for role in ("Mitarbeiter", "Projektmanager"):
        forbidden = client.get("/api/wms/admin/permissions", headers=auth_headers(client, role))
        assert forbidden.status_code == 403


def test_list_roles_returns_defaults() -> None:
    client = TestClient(app)
    res = client.get("/api/wms/admin/roles", headers=_admin(client))
    assert res.status_code == 200, res.text
    roles = {role["roleKey"]: set(role["permissions"]) for role in res.json()["roles"]}
    assert roles["admin"] == set(ALL_PERMISSION_KEYS)
    assert roles["projektmanager"] == set(DEFAULT_ROLE_PERMISSIONS["projektmanager"])
    assert roles["mitarbeiter"] == set(DEFAULT_ROLE_PERMISSIONS["mitarbeiter"])


def test_non_admin_cannot_list_or_update() -> None:
    client = TestClient(app)
    for role in ("Mitarbeiter", "Projektmanager"):
        headers = auth_headers(client, role)
        assert client.get("/api/wms/admin/roles", headers=headers).status_code == 403
        assert (
            client.put(
                "/api/wms/admin/roles/mitarbeiter/permissions",
                headers=headers,
                json={"permissions": ["assets.read"]},
            ).status_code
            == 403
        )


def test_update_replaces_permission_set() -> None:
    client = TestClient(app)
    res = client.put(
        "/api/wms/admin/roles/mitarbeiter/permissions",
        headers=_admin(client),
        json={"permissions": ["assets.read"]},
    )
    assert res.status_code == 200, res.text
    assert res.json()["permissions"] == ["assets.read"]

    reread = client.get("/api/wms/admin/roles", headers=_admin(client))
    roles = {role["roleKey"]: role["permissions"] for role in reread.json()["roles"]}
    assert roles["mitarbeiter"] == ["assets.read"]


def test_update_drops_unknown_permission_keys() -> None:
    client = TestClient(app)
    res = client.put(
        "/api/wms/admin/roles/projektmanager/permissions",
        headers=_admin(client),
        json={"permissions": ["assets.read", "does.not.exist"]},
    )
    assert res.status_code == 200, res.text
    assert res.json()["permissions"] == ["assets.read"]


def test_update_unknown_role_returns_404() -> None:
    client = TestClient(app)
    res = client.put(
        "/api/wms/admin/roles/superadmin/permissions",
        headers=_admin(client),
        json={"permissions": ["assets.read"]},
    )
    assert res.status_code == 404


def test_lockout_blocks_removing_last_roles_manage() -> None:
    client = TestClient(app)
    # Nur admin hält roles.manage (Default) → Entzug muss scheitern.
    res = client.put(
        "/api/wms/admin/roles/admin/permissions",
        headers=_admin(client),
        json={"permissions": ["assets.read"]},
    )
    assert res.status_code == 409
    # admin behält das Recht weiterhin.
    reread = client.get("/api/wms/admin/roles", headers=_admin(client))
    roles = {role["roleKey"]: set(role["permissions"]) for role in reread.json()["roles"]}
    assert "roles.manage" in roles["admin"]


def test_lockout_allows_when_other_role_holds_roles_manage() -> None:
    client = TestClient(app)
    # roles.manage zusätzlich dem Projektmanager geben …
    grant = client.put(
        "/api/wms/admin/roles/projektmanager/permissions",
        headers=_admin(client),
        json={"permissions": ["roles.manage"]},
    )
    assert grant.status_code == 200, grant.text
    # … nun darf admin es abgeben, weil PM es hält.
    res = client.put(
        "/api/wms/admin/roles/admin/permissions",
        headers=_admin(client),
        json={"permissions": ["assets.read", "users.manage"]},
    )
    assert res.status_code == 200, res.text


def test_permission_enforcement_is_data_driven() -> None:
    # Read-only demonstriert: Der Zugriff hängt jetzt an den editierbaren
    # Rechten, nicht mehr an einer fixen Rollenabfrage (keine DB-Verschmutzung).
    client = TestClient(app)
    pm = auth_headers(client, "Projektmanager")
    # Default: PM hat kein users.manage → GET /users ist gesperrt.
    assert client.get("/api/wms/users", headers=pm).status_code == 403
    # users.manage dem PM geben → derselbe Benutzer darf jetzt zugreifen.
    grant = client.put(
        "/api/wms/admin/roles/projektmanager/permissions",
        headers=_admin(client),
        json={"permissions": ["users.manage"]},
    )
    assert grant.status_code == 200, grant.text
    assert client.get("/api/wms/users", headers=pm).status_code == 200


def test_auth_me_includes_effective_permissions() -> None:
    client = TestClient(app)
    admin = client.get("/api/auth/me", headers=_admin(client))
    assert admin.status_code == 200, admin.text
    assert "roles.manage" in admin.json()["permissions"]

    emp = client.get("/api/auth/me", headers=auth_headers(client, "Mitarbeiter"))
    assert emp.status_code == 200
    perms = set(emp.json()["permissions"])
    assert "assets.read" in perms
    assert "users.manage" not in perms


def test_ensure_backfills_missing_key_with_defaults() -> None:
    # Simuliert eine bestehende Installation, die den neuen Key noch nicht kennt:
    # qrcode.manage komplett aus der Tabelle entfernen …
    with SessionLocal() as db:
        db.execute(
            delete(RolePermissionRecord).where(
                RolePermissionRecord.permission_key == "qrcode.manage"
            )
        )
        db.commit()
        # … additiv nachtragen.
        role_permission_repository.ensure_default_permissions_present(db, ["qrcode.manage"])
        perms = role_permission_repository.all_role_permissions(db)
    # Admin bekommt das Recht, PM/Mitarbeiter nicht.
    assert "qrcode.manage" in perms["admin"]
    assert "qrcode.manage" not in perms.get("projektmanager", set())
    assert "qrcode.manage" not in perms.get("mitarbeiter", set())


def test_ensure_does_not_override_manual_state() -> None:
    # Key ist bereits (irgendwo) vorhanden → gilt als gepflegt. Selbst wenn eine
    # Rolle ihn bewusst NICHT hat, darf ensure ihn nicht nachtragen.
    with SessionLocal() as db:
        role_permission_repository.replace_role_permissions(
            db, "mitarbeiter", ["assets.read"]
        )
        # admin behält qrcode.manage (Default) → Key existiert in der Tabelle.
        role_permission_repository.ensure_default_permissions_present(db, ["qrcode.manage"])
        perms = role_permission_repository.all_role_permissions(db)
    assert perms["mitarbeiter"] == {"assets.read"}
    assert "qrcode.manage" in perms["admin"]


def test_seed_is_idempotent_after_edit() -> None:
    client = TestClient(app)
    client.put(
        "/api/wms/admin/roles/mitarbeiter/permissions",
        headers=_admin(client),
        json={"permissions": ["assets.read"]},
    )
    # Erneutes Seeden darf bestehende (gepflegte) Rechte NICHT überschreiben.
    with SessionLocal() as db:
        role_permission_repository.seed_default_role_permissions(db)
    reread = client.get("/api/wms/admin/roles", headers=_admin(client))
    roles = {role["roleKey"]: role["permissions"] for role in reread.json()["roles"]}
    assert roles["mitarbeiter"] == ["assets.read"]
