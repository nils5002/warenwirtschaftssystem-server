"""Gezielte Verifikation: Backup/Restore erhält Rollen-&-Rechte 1:1.

Anders als ``test_backup_role_permissions.py`` läuft diese Suite NICHT gegen die
geteilte Suite-DB, sondern gegen frisch erzeugte, voneinander isolierte
SQLite-Datenbanken (eigene Engine pro DB). So lässt sich der vollständige
Export→Leeren→Import-Zyklus prüfen, ohne den restlichen Test-/Produktivstand
anzufassen.

Geprüft wird:
- abweichend gesetzte Rechte werden exakt wiederhergestellt,
- Defaults überschreiben keine manuell gepflegten Rechte,
- ein neuer Permission-Key (qrcode.manage) wird nur ergänzt, wenn er im Backup
  fehlt — vorhandene Werte bleiben unangetastet,
- Altbackups ganz ohne ``rolePermissions`` bekommen die Defaults.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.database.base import Base
from app.domain.permissions import DEFAULT_ROLE_PERMISSIONS
from app.repositories import role_permission_repository
from app.schemas.backup import WarehouseBackupPayload
from app.services import backup_service

# Bewusst abweichende Rechte (Testfall aus dem Auftrag):
#   - Mitarbeiter: qrcode.manage = true, planning.update = false (= nicht enthalten)
#   - Projektmanager: assets.update = false (= nicht enthalten)
#   - Admin: roles.manage = true (bleibt)
MITARBEITER_PERMS = ["assets.read", "checkinout.use", "defects.report", "qrcode.manage"]
PROJEKTMANAGER_PERMS = ["planning.read", "planning.update", "assets.read", "checkinout.use"]
ADMIN_PERMS = sorted(DEFAULT_ROLE_PERMISSIONS["admin"])  # enthält roles.manage


def _new_isolated_db(tmp_path, name: str) -> sessionmaker:
    """Erzeugt eine eigenständige SQLite-DB inkl. Schema und liefert eine Factory."""
    # Lazy-Import, damit die Modelle in den Base-Metadaten registriert sind.
    from app.database import models  # noqa: F401

    engine = create_engine(
        f"sqlite:///{tmp_path / name}",
        future=True,
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


@pytest.fixture()
def source_factory(tmp_path) -> Iterator[sessionmaker]:
    """Quell-DB mit Default-Rechten und den bewusst abweichenden Werten."""
    factory = _new_isolated_db(tmp_path, "source.db")
    with factory() as db:
        role_permission_repository.seed_default_role_permissions(db)
        role_permission_repository.replace_role_permissions(db, "mitarbeiter", MITARBEITER_PERMS)
        role_permission_repository.replace_role_permissions(db, "projektmanager", PROJEKTMANAGER_PERMS)
        role_permission_repository.replace_role_permissions(db, "admin", ADMIN_PERMS)
    yield factory


def _perms(factory: sessionmaker) -> dict[str, set[str]]:
    with factory() as db:
        return role_permission_repository.all_role_permissions(db)


def test_backup_restores_custom_permissions_exactly(tmp_path, source_factory) -> None:
    # Vorbedingung: Quelle trägt genau die abweichenden Rechte.
    src = _perms(source_factory)
    assert "qrcode.manage" in src["mitarbeiter"]
    assert "planning.update" not in src["mitarbeiter"]
    assert "assets.update" not in src["projektmanager"]
    assert "roles.manage" in src["admin"]

    with source_factory() as db:
        payload = backup_service.export_backup(db)

    # In eine frische, leere DB importieren.
    target_factory = _new_isolated_db(tmp_path, "target.db")
    with target_factory() as db:
        backup_service.import_backup(db, payload)

    restored = _perms(target_factory)
    # 1:1 wiederhergestellt — keine Default-Überschreibung.
    assert restored["mitarbeiter"] == set(MITARBEITER_PERMS)
    assert restored["projektmanager"] == set(PROJEKTMANAGER_PERMS)
    assert restored["admin"] == set(ADMIN_PERMS)
    # Konkret: das manuell gesetzte qrcode.manage bleibt, planning.update bleibt false.
    assert "qrcode.manage" in restored["mitarbeiter"]
    assert "planning.update" not in restored["mitarbeiter"]
    assert "assets.update" not in restored["projektmanager"]


def test_backup_missing_new_key_is_backfilled_without_touching_others(tmp_path, source_factory) -> None:
    # Simuliert ein älteres Backup MIT rolePermissions, dem nur der neue Key fehlt.
    with source_factory() as db:
        payload = backup_service.export_backup(db)
    data = payload.model_dump(mode="json")
    data["rolePermissions"] = [
        row for row in data["rolePermissions"] if row["permissionKey"] != "qrcode.manage"
    ]
    stripped = WarehouseBackupPayload.model_validate(data)

    target_factory = _new_isolated_db(tmp_path, "target.db")
    with target_factory() as db:
        backup_service.import_backup(db, stripped)

    restored = _perms(target_factory)
    # Neuer Key wird additiv nur mit Default ergänzt: Admin true, andere false.
    assert "qrcode.manage" in restored["admin"]
    assert "qrcode.manage" not in restored.get("projektmanager", set())
    assert "qrcode.manage" not in restored.get("mitarbeiter", set())
    # Alle übrigen, manuell gesetzten Werte bleiben exakt erhalten.
    assert restored["mitarbeiter"] == set(MITARBEITER_PERMS) - {"qrcode.manage"}
    assert restored["projektmanager"] == set(PROJEKTMANAGER_PERMS)


def test_old_backup_without_role_permissions_seeds_defaults(tmp_path, source_factory) -> None:
    # Altbackup ganz ohne rolePermissions-Sektion.
    with source_factory() as db:
        payload = backup_service.export_backup(db)
    data = payload.model_dump(mode="json")
    data.pop("rolePermissions", None)
    legacy = WarehouseBackupPayload.model_validate(data)

    target_factory = _new_isolated_db(tmp_path, "target.db")
    with target_factory() as db:
        result = backup_service.import_backup(db, legacy)
    assert result.imported["rolePermissions"] == 0

    restored = _perms(target_factory)
    assert restored["admin"] == set(DEFAULT_ROLE_PERMISSIONS["admin"])
    assert restored["projektmanager"] == set(DEFAULT_ROLE_PERMISSIONS["projektmanager"])
    assert restored["mitarbeiter"] == set(DEFAULT_ROLE_PERMISSIONS["mitarbeiter"])
