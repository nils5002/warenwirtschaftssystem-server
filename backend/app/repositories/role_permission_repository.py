"""DB-Zugriff für die admin-editierbaren Rollen-Rechte.

Schreibt ausschließlich die Tabelle ``role_permissions``. Keine Hardware-,
Planungs- oder Benutzerdaten werden verändert.
"""

from __future__ import annotations

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..database.models import RolePermissionRecord
from ..domain.permissions import DEFAULT_ROLE_PERMISSIONS, sanitize_permission_keys


def seed_default_role_permissions(db: Session) -> None:
    """Idempotent: seedet die Default-Rechte NUR, wenn die Tabelle leer ist.

    Muster wie ``category_repository.seed_standard_categories`` — sobald Zeilen
    existieren, gilt der Bestand als admin-gepflegt und wird nicht überschrieben.
    So verhalten sich bestehende Installationen nach der Migration unverändert.
    """
    existing = db.scalar(select(func.count()).select_from(RolePermissionRecord))
    if existing:
        return
    for role_key, perms in DEFAULT_ROLE_PERMISSIONS.items():
        for permission_key in sorted(perms):
            db.add(RolePermissionRecord(role_key=role_key, permission_key=permission_key))
    db.commit()


def permissions_for_role(db: Session, role_key: str) -> set[str]:
    rows = db.scalars(
        select(RolePermissionRecord.permission_key).where(
            RolePermissionRecord.role_key == role_key
        )
    ).all()
    return {value for value in rows if value}


def all_role_permissions(db: Session) -> dict[str, set[str]]:
    result: dict[str, set[str]] = {}
    for record in db.scalars(select(RolePermissionRecord)).all():
        result.setdefault(record.role_key, set()).add(record.permission_key)
    return result


def roles_with_permission(db: Session, permission_key: str) -> set[str]:
    """Welche Rollen besitzen das angegebene Recht? (für den Aussperr-Schutz)."""
    rows = db.scalars(
        select(RolePermissionRecord.role_key).where(
            RolePermissionRecord.permission_key == permission_key
        )
    ).all()
    return {value for value in rows if value}


def replace_role_permissions(db: Session, role_key: str, permission_keys: list[str]) -> None:
    """Ersetzt das komplette Recht-Set einer Rolle (delete-then-insert).

    Der Aufrufer (Service) hat ``role_key`` validiert und den Aussperr-Schutz
    geprüft. Hier werden die Keys nochmals sanitisiert (nur bekannte Keys).
    """
    clean = sanitize_permission_keys(permission_keys)
    db.execute(delete(RolePermissionRecord).where(RolePermissionRecord.role_key == role_key))
    for permission_key in clean:
        db.add(RolePermissionRecord(role_key=role_key, permission_key=permission_key))
    db.commit()
