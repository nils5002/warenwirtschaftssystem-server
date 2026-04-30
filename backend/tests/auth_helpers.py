from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy import select

from app.database.models import UserRecord
from app.database.session import SessionLocal
from app.services.auth_service import hash_password, normalize_role_for_db

TEST_PASSWORD = "TestPass123!"


def _role_title(role: str) -> str:
    raw = role.strip().lower()
    if raw in {"admin", "techniker", "administrator"}:
        return "Admin"
    if raw in {"projektmanager", "projectmanager", "project manager"}:
        return "Projektmanager"
    return "Mitarbeiter"


def _build_email(external_id: str) -> str:
    safe = "".join(ch if ch.isalnum() else "-" for ch in external_id.lower()).strip("-") or uuid4().hex[:12]
    return f"{safe}@tests.local"


def ensure_auth_user(role: str, user_id: str | None = None) -> tuple[str, str]:
    _ensure_test_schema_compat()
    external_id = (user_id or f"usr-test-{role.strip().lower()}").strip()
    email = _build_email(external_id)
    db_role = normalize_role_for_db(role)
    status = "Aktiv"
    with SessionLocal() as db:
        user = db.scalar(select(UserRecord).where(UserRecord.external_id == external_id))
        if user is None:
            user = db.scalar(select(UserRecord).where(UserRecord.email.ilike(email)))
        if user is None:
            user = UserRecord(
                external_id=external_id,
                name=f"Test {_role_title(role)} {external_id[-6:]}",
                email=email,
                password_hash=hash_password(TEST_PASSWORD),
                role=db_role,
                is_active=True,
                status=status,
                last_active="Neu",
            )
            db.add(user)
        else:
            user.external_id = external_id
            user.email = email
            user.role = db_role
            user.is_active = True
            user.status = status
            user.password_hash = hash_password(TEST_PASSWORD)
        db.commit()
    return email, TEST_PASSWORD


def _ensure_test_schema_compat() -> None:
    with SessionLocal() as db:
        planning_item_columns = [row[1] for row in db.execute(text("PRAGMA table_info(planning_items)")).fetchall()]
        if "handover_enabled" not in planning_item_columns:
            db.execute(text("ALTER TABLE planning_items ADD COLUMN handover_enabled BOOLEAN DEFAULT 0"))
        if "linked_planning_external_id" not in planning_item_columns:
            db.execute(text("ALTER TABLE planning_items ADD COLUMN linked_planning_external_id VARCHAR(64)"))
        if "handover_note" not in planning_item_columns:
            db.execute(text("ALTER TABLE planning_items ADD COLUMN handover_note TEXT"))
        db.commit()


def auth_headers(
    client: TestClient,
    role: str,
    user_id: str | None = None,
    project_context: str | None = None,
) -> dict[str, str]:
    email, password = ensure_auth_user(role=role, user_id=user_id)
    login = client.post("/api/auth/login", json={"email": email, "password": password})
    assert login.status_code == 200, login.text
    token = login.json()["accessToken"]
    headers = {"Authorization": f"Bearer {token}"}
    if project_context:
        headers["X-Project-Context"] = project_context
    return headers
