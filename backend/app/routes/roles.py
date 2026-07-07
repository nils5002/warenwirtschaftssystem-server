"""Admin-Endpunkte für „Rollen & Rechte" (admin-editierbare Rollenrechte).

Alle Endpunkte sind über das Recht ``roles.manage`` geschützt (serverseitig
erzwungen). Sie schreiben ausschließlich die Tabelle ``role_permissions`` —
keine Hardware-, Planungs-, Defekt- oder Benutzerdaten.

- GET  /api/wms/admin/permissions            → Permission-Katalog (deutsche Labels)
- GET  /api/wms/admin/roles                  → Rollen mit gewährten Rechten
- PUT  /api/wms/admin/roles/{role_key}/permissions → Rechte einer Rolle ersetzen
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from ..database.session import get_db
from ..routes.dependencies import AccessContext, get_access_context, require_permission
from ..schemas.roles import (
    PermissionCatalogResponse,
    RolePermissionsItem,
    RolePermissionsUpdatePayload,
    RolesResponse,
)
from ..services import security_event_service as sec
from ..services.role_service import RoleService

router = APIRouter(prefix="/api/wms/admin", tags=["WMS Roles & Permissions"])


@router.get("/permissions", response_model=PermissionCatalogResponse)
def get_permission_catalog(
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> PermissionCatalogResponse:
    require_permission(context, db, "roles.manage")
    return RoleService.get_catalog()


@router.get("/roles", response_model=RolesResponse)
def list_roles(
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> RolesResponse:
    require_permission(context, db, "roles.manage")
    return RoleService.list_roles(db)


@router.put("/roles/{role_key}/permissions", response_model=RolePermissionsItem)
def update_role_permissions(
    role_key: str,
    payload: RolePermissionsUpdatePayload,
    request: Request,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> RolePermissionsItem:
    require_permission(context, db, "roles.manage")
    result = RoleService.update_role_permissions(db, role_key, payload.permissions)
    # Audit: Rechteänderungen sind sicherheitsrelevant (wer hat welcher Rolle
    # welche Rechte gegeben) — Security-Paket „supman".
    sec.record_event(
        db, sec.PERMISSION_CHANGED, request=request, success=True,
        actor_id=context.user_id,
        meta={"roleKey": role_key, "permissions": sorted(payload.permissions or [])},
    )
    return result
