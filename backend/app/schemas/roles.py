"""Schemas für die Admin-Seite „Rollen & Rechte".

Beschreiben ausschließlich Rollen-Rechte-Daten. Keine Hardware-, Planungs-
oder Benutzerprofile.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class PermissionDefSchema(BaseModel):
    key: str
    label: str
    group: str


class PermissionGroupSchema(BaseModel):
    group: str
    label: str
    permissions: list[PermissionDefSchema] = Field(default_factory=list)


class PermissionCatalogResponse(BaseModel):
    groups: list[PermissionGroupSchema] = Field(default_factory=list)


class RolePermissionsItem(BaseModel):
    roleKey: str  # admin | projektmanager | mitarbeiter
    label: str  # "Admin" | "Projektmanager" | "Mitarbeiter"
    permissions: list[str] = Field(default_factory=list)


class RolesResponse(BaseModel):
    roles: list[RolePermissionsItem] = Field(default_factory=list)


class RolePermissionsUpdatePayload(BaseModel):
    permissions: list[str] = Field(default_factory=list)
