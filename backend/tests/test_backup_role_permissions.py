"""Tests für Backup-Export/Import der Rollenrechte (Feature „Rollen & Rechte").

Auf Service-Ebene getestet (kein HTTP), da der Import die ganze DB ersetzt.
Eine autouse-Fixture sichert den DB-Stand vor und stellt ihn nach jedem Test
über einen Export/Import-Roundtrip wieder her — die geteilte Suite-DB bleibt
unverändert.
"""

from __future__ import annotations

import pytest
from sqlalchemy import delete, select

from app.database.models import RolePermissionRecord
from app.database.session import SessionLocal
from app.domain.permissions import DEFAULT_ROLE_PERMISSIONS
from app.repositories import role_permission_repository
from app.schemas.backup import WarehouseBackupPayload
from app.services import backup_service


@pytest.fixture(autouse=True)
def _snapshot_restore():
    with SessionLocal() as db:
        snapshot = backup_service.export_backup(db)
    try:
        yield
    finally:
        with SessionLocal() as db:
            backup_service.import_backup(db, snapshot)


def _role_perms() -> dict[str, set[str]]:
    with SessionLocal() as db:
        return role_permission_repository.all_role_permissions(db)


def _payload_without_role_permissions() -> WarehouseBackupPayload:
    with SessionLocal() as db:
        data = backup_service.export_backup(db).model_dump(mode="json")
    data.pop("rolePermissions", None)  # simuliert ein altes Backup
    return WarehouseBackupPayload.model_validate(data)


def test_export_includes_role_permissions() -> None:
    with SessionLocal() as db:
        payload = backup_service.export_backup(db)
    pairs = {(item.roleKey, item.permissionKey) for item in payload.rolePermissions}
    assert ("admin", "roles.manage") in pairs


def test_import_roundtrip_preserves_edited_permissions() -> None:
    # Mitarbeiter-Rechte gezielt verändern …
    with SessionLocal() as db:
        role_permission_repository.replace_role_permissions(db, "mitarbeiter", ["assets.read"])
        payload = backup_service.export_backup(db)

    # … DB leeren und aus dem Export wiederherstellen.
    with SessionLocal() as db:
        backup_service.import_backup(db, payload)

    assert _role_perms()["mitarbeiter"] == {"assets.read"}


def test_import_old_backup_without_role_permissions_seeds_defaults() -> None:
    payload = _payload_without_role_permissions()
    with SessionLocal() as db:
        result = backup_service.import_backup(db, payload)
    assert result.imported["rolePermissions"] == 0

    perms = _role_perms()
    assert perms.get("admin") == set(DEFAULT_ROLE_PERMISSIONS["admin"])
    assert perms.get("projektmanager") == set(DEFAULT_ROLE_PERMISSIONS["projektmanager"])
    assert perms.get("mitarbeiter") == set(DEFAULT_ROLE_PERMISSIONS["mitarbeiter"])


def test_import_corrupt_role_permissions_falls_back_to_defaults() -> None:
    data = _payload_without_role_permissions().model_dump(mode="json")
    # Nur ungültige Zeilen (unbekannte Rolle / unbekanntes Recht).
    data["rolePermissions"] = [
        {"roleKey": "superadmin", "permissionKey": "roles.manage"},
        {"roleKey": "admin", "permissionKey": "does.not.exist"},
    ]
    payload = WarehouseBackupPayload.model_validate(data)
    with SessionLocal() as db:
        backup_service.import_backup(db, payload)

    perms = _role_perms()
    assert perms.get("admin") == set(DEFAULT_ROLE_PERMISSIONS["admin"])
    assert perms.get("mitarbeiter") == set(DEFAULT_ROLE_PERMISSIONS["mitarbeiter"])


def test_clear_data_for_import_reseeds_defaults() -> None:
    with SessionLocal() as db:
        role_permission_repository.replace_role_permissions(db, "mitarbeiter", [])
        backup_service.clear_data_for_import(db, keep_user_id=None)

    perms = _role_perms()
    assert perms.get("mitarbeiter") == set(DEFAULT_ROLE_PERMISSIONS["mitarbeiter"])
