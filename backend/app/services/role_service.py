"""Fachlogik der Admin-Seite „Rollen & Rechte".

Verändert ausschließlich die Tabelle ``role_permissions``. Enthält den
Aussperr-Schutz: das Recht ``roles.manage`` darf nie der letzten haltenden
Rolle entzogen werden, sonst könnte niemand mehr Rechte vergeben.
"""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..domain.permissions import (
    GROUP_LABELS,
    GROUP_ORDER,
    PERMISSION_CATALOG,
    PERMISSION_ROLES_MANAGE,
    ROLE_KEYS,
    is_valid_role_key,
    sanitize_permission_keys,
)
from ..repositories import role_permission_repository as repo
from ..schemas.roles import (
    PermissionCatalogResponse,
    PermissionDefSchema,
    PermissionGroupSchema,
    RolePermissionsItem,
    RolesResponse,
)

# Anzeige-Labels der Rollen (Topbar/UI verwenden diese großgeschriebene Form).
ROLE_LABELS: dict[str, str] = {
    "admin": "Admin",
    "projektmanager": "Projektmanager",
    "mitarbeiter": "Mitarbeiter",
}


class RoleService:
    @staticmethod
    def get_catalog() -> PermissionCatalogResponse:
        groups: list[PermissionGroupSchema] = []
        for group_key in GROUP_ORDER:
            perms = [
                PermissionDefSchema(key=p.key, label=p.label, group=p.group)
                for p in PERMISSION_CATALOG
                if p.group == group_key
            ]
            if perms:
                groups.append(
                    PermissionGroupSchema(
                        group=group_key,
                        label=GROUP_LABELS.get(group_key, group_key),
                        permissions=perms,
                    )
                )
        return PermissionCatalogResponse(groups=groups)

    @staticmethod
    def list_roles(db: Session) -> RolesResponse:
        mapping = repo.all_role_permissions(db)
        roles = [
            RolePermissionsItem(
                roleKey=role_key,
                label=ROLE_LABELS.get(role_key, role_key),
                permissions=sanitize_permission_keys(list(mapping.get(role_key, set()))),
            )
            for role_key in ROLE_KEYS
        ]
        return RolesResponse(roles=roles)

    @staticmethod
    def effective_permissions(db: Session, role_key: str) -> list[str]:
        """Sanitisierte, katalog-sortierte Rechte einer Rolle (für /auth/me)."""
        return sanitize_permission_keys(list(repo.permissions_for_role(db, role_key)))

    @staticmethod
    def update_role_permissions(
        db: Session, role_key: str, requested: list[str]
    ) -> RolePermissionsItem:
        if not is_valid_role_key(role_key):
            raise HTTPException(status_code=404, detail="Unbekannte Rolle.")

        clean = sanitize_permission_keys(requested)

        # Aussperr-Schutz: nach der Änderung muss mindestens eine Rolle das
        # Recht roles.manage behalten. Rein rollenbasiert berechnet — deckt
        # auch „Admin entzieht sich selbst das Recht" ab.
        holders = repo.roles_with_permission(db, PERMISSION_ROLES_MANAGE)
        will_have = holders - {role_key}
        if PERMISSION_ROLES_MANAGE in clean:
            will_have = will_have | {role_key}
        if not will_have:
            raise HTTPException(
                status_code=409,
                detail=(
                    "Mindestens eine Rolle muss das Recht zum Verwalten von Rollen "
                    "und Rechten behalten. Sonst könnte niemand mehr Rechte vergeben."
                ),
            )

        repo.replace_role_permissions(db, role_key, clean)
        return RolePermissionsItem(
            roleKey=role_key,
            label=ROLE_LABELS.get(role_key, role_key),
            permissions=clean,
        )
