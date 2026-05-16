from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..config.settings import get_settings
from ..database.session import get_db
from ..services.auth_service import authenticate_token
from ..services.job_manager import JobManager

RoleName = Literal["admin", "projektmanager", "mitarbeiter"]


@dataclass(frozen=True)
class AccessContext:
    role: RoleName
    user_id: str | None
    project_contexts: tuple[str, ...]


def _normalize_role(value: str | None) -> RoleName:
    normalized = (value or "").strip().lower()
    if normalized in {"admin", "techniker", "administrator"}:
        return "admin"
    if normalized in {"projektmanager", "projectmanager", "project_manager"}:
        return "projektmanager"
    if normalized in {"mitarbeiter", "junior", "lager", "lager / logistik", "event-team", "event team"}:
        return "mitarbeiter"
    return "mitarbeiter"


def _parse_project_contexts(value: str | None) -> tuple[str, ...]:
    if not value:
        return tuple()
    parts = [item.strip() for item in value.split(",")]
    return tuple(item for item in parts if item)


def get_access_context(
    request: Request,
    db: Session = Depends(get_db),
) -> AccessContext:
    project_contexts = _parse_project_contexts(request.headers.get("x-project-context"))
    auth_header = request.headers.get("authorization", "").strip()
    if auth_header.lower().startswith("bearer "):
        token = auth_header[7:].strip()
        if not token:
            raise HTTPException(status_code=401, detail="Nicht authentifiziert.")
        # authenticate_token prueft zusaetzlich serverseitig die token_version
        # — abgemeldete/invalidierte Tokens werden hier mit 401 abgewiesen.
        user = authenticate_token(db, token)
        return AccessContext(
            role=_normalize_role(user.role),
            user_id=user.userId,
            project_contexts=project_contexts,
        )
    settings = get_settings()
    if not settings.allow_legacy_header_auth:
        raise HTTPException(status_code=401, detail="Nicht authentifiziert.")
    role_header = request.headers.get("x-user-role")
    role = _normalize_role(role_header)
    user_id = (request.headers.get("x-user-id") or "").strip() or None
    if not role_header or not role:
        raise HTTPException(status_code=401, detail="Nicht authentifiziert.")
    return AccessContext(role=role, user_id=user_id, project_contexts=project_contexts)


def require_roles(context: AccessContext, *allowed: RoleName) -> None:
    if context.role not in allowed:
        raise HTTPException(status_code=403, detail="Keine Berechtigung für diese Aktion.")


def require_project_scope(context: AccessContext) -> None:
    if context.role == "admin":
        return
    if context.role == "projektmanager" and context.user_id:
        return
    if context.project_contexts:
        return
    raise HTTPException(
        status_code=403,
        detail="Kein Projektkontext vorhanden. Bitte Projektkontext auswählen.",
    )


def get_job_manager(request: Request) -> JobManager:
    manager = getattr(request.app.state, "job_manager", None)
    if manager is None:
        raise HTTPException(status_code=500, detail="Job manager is not initialized")
    return manager
