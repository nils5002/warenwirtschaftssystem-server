from __future__ import annotations

from datetime import date, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database.models import UserRecord
from app.database.session import SessionLocal
from app.main import app


def _headers(role: str, user_id: str | None = None, project_context: str | None = None) -> dict[str, str]:
    headers = {"X-User-Role": role}
    if user_id:
        headers["X-User-Id"] = user_id
    if project_context:
        headers["X-Project-Context"] = project_context
    return headers


def _set_users_status(user_ids: list[str], status: str) -> None:
    if not user_ids:
        return
    with SessionLocal() as db:
        records = db.scalars(select(UserRecord).where(UserRecord.external_id.in_(user_ids))).all()
        for record in records:
            record.status = status
        db.commit()


def test_admin_can_manage_users_but_projectmanager_cannot() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    payload = {
        "id": f"usr-rbac-{suffix}",
        "name": f"RBAC User {suffix}",
        "email": f"rbac.{suffix}@example.local",
        "role": "Mitarbeiter",
        "lastActive": "Neu",
        "status": "Aktiv",
        "department": "QA",
        "location": "Berlin",
    }

    admin_res = client.post("/api/wms/users", headers=_headers("Admin"), json=payload)
    assert admin_res.status_code == 200

    denied_res = client.post("/api/wms/users", headers=_headers("Projektmanager"), json=payload)
    assert denied_res.status_code == 403


def test_checkout_and_checkin_activity_contains_server_side_actor() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    actor_id = f"usr-actor-{suffix}"
    actor_payload = {
        "id": actor_id,
        "name": f"Audit Actor {suffix}",
        "email": f"audit.actor.{suffix}@example.local",
        "role": "Admin",
        "lastActive": "Neu",
        "status": "Aktiv",
        "department": "Ops",
        "location": "Berlin",
    }
    actor_created = client.post("/api/wms/users", headers=_headers("Admin"), json=actor_payload)
    assert actor_created.status_code == 200

    asset_payload = {
        "id": f"asset-audit-{suffix}",
        "name": f"Audit Asset {suffix}",
        "category": "Notebook",
        "location": "Testlager",
        "status": "Verfuegbar",
        "assignedTo": "-",
        "nextReturn": "-",
        "tagNumber": f"TAG-AUD-{suffix}",
        "serialNumber": f"SN-AUD-{suffix}",
        "qrCode": "",
        "maintenanceState": "Neu",
        "notes": "",
        "lastCheckout": "-",
        "nextReservation": "-",
    }
    created_asset = client.post("/api/wms/assets", headers=_headers("Admin", user_id=actor_id), json=asset_payload)
    assert created_asset.status_code == 200

    checkout_payload = {**created_asset.json(), "status": "Verliehen", "assignedTo": "Team Audit · Projekt A"}
    checkout = client.post("/api/wms/assets", headers=_headers("Admin", user_id=actor_id), json=checkout_payload)
    assert checkout.status_code == 200

    checkin_payload = {**checkout.json(), "status": "Verfuegbar", "assignedTo": "-", "nextReturn": "-", "nextReservation": "-"}
    checkin = client.post("/api/wms/assets", headers=_headers("Admin", user_id=actor_id), json=checkin_payload)
    assert checkin.status_code == 200

    activities = client.get("/api/wms/activities", headers=_headers("Admin", user_id=actor_id))
    assert activities.status_code == 200
    relevant = [item for item in activities.json() if item.get("assetId") == asset_payload["id"]]
    assert any(item.get("title") == "Checkout gebucht" and actor_id in item.get("detail", "") for item in relevant)
    assert any(item.get("title") == "Checkin gebucht" and actor_id in item.get("detail", "") for item in relevant)


def test_mitarbeiter_can_checkout_but_not_modify_asset_masterdata() -> None:
    client = TestClient(app)
    overview = client.get("/api/wms/overview", headers=_headers("Admin"))
    assert overview.status_code == 200
    assets = overview.json()["assets"]
    assert assets, "Test benötigt mindestens ein Asset"
    asset = next(
        (
            item
            for item in assets
            if str(item.get("status", "")).lower() in {"verfuegbar", "verfügbar"}
        ),
        None,
    )
    if asset is None:
        suffix = uuid4().hex[:8]
        payload = {
            "id": f"asset-rbac-checkout-{suffix}",
            "name": f"Checkout Probe {suffix}",
            "category": "Notebook",
            "location": "Testlager",
            "status": "Verfuegbar",
            "assignedTo": "-",
            "nextReturn": "-",
            "tagNumber": f"TAG-CHK-{suffix}",
            "serialNumber": f"SN-CHK-{suffix}",
            "qrCode": "",
            "maintenanceState": "Neu",
            "notes": "",
            "lastCheckout": "-",
            "nextReservation": "-",
        }
        created = client.post("/api/wms/assets", headers=_headers("Admin"), json=payload)
        assert created.status_code == 200
        asset = created.json()

    checkout_payload = {
        **asset,
        "status": "Verliehen",
        "assignedTo": "Mitarbeiter Test · Projekt RBAC",
        "nextReturn": "morgen",
    }
    checkout_res = client.post("/api/wms/assets", headers=_headers("Mitarbeiter"), json=checkout_payload)
    assert checkout_res.status_code == 200

    blocked_payload = {**checkout_payload, "name": f"{asset['name']} (hacked)"}
    blocked_res = client.post("/api/wms/assets", headers=_headers("Mitarbeiter"), json=blocked_payload)
    assert blocked_res.status_code == 403


def test_only_admin_can_delete_asset() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    payload = {
        "id": f"asset-rbac-{suffix}",
        "name": f"Delete Probe {suffix}",
        "category": "Notebook",
        "location": "Testlager",
        "status": "Verfuegbar",
        "assignedTo": "-",
        "nextReturn": "-",
        "tagNumber": f"TAG-{suffix}",
        "serialNumber": f"SN-{suffix}",
        "qrCode": "",
        "maintenanceState": "Neu",
        "notes": "",
        "lastCheckout": "-",
        "nextReservation": "-",
    }
    create_res = client.post("/api/wms/assets", headers=_headers("Admin"), json=payload)
    assert create_res.status_code == 200

    denied = client.delete(f"/api/wms/assets/{payload['id']}", headers=_headers("Mitarbeiter"))
    assert denied.status_code == 403

    allowed = client.delete(f"/api/wms/assets/{payload['id']}", headers=_headers("Admin"))
    assert allowed.status_code == 200


def test_only_admin_can_delete_users_and_delete_is_hard_persistent() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    payload = {
        "id": f"usr-delete-{suffix}",
        "name": f"Delete User {suffix}",
        "email": f"delete.{suffix}@example.local",
        "role": "Mitarbeiter",
        "lastActive": "Neu",
        "status": "Aktiv",
        "department": "QA",
        "location": "Berlin",
    }

    created = client.post("/api/wms/users", headers=_headers("Admin"), json=payload)
    assert created.status_code == 200

    denied = client.delete(f"/api/wms/users/{payload['id']}", headers=_headers("Projektmanager", user_id="pm-rbac"))
    assert denied.status_code == 403

    allowed = client.delete(f"/api/wms/users/{payload['id']}", headers=_headers("Admin", user_id="admin-rbac"))
    assert allowed.status_code == 200
    assert allowed.json()["deleted"] is True

    with SessionLocal() as db:
        record = db.scalar(select(UserRecord).where(UserRecord.external_id == payload["id"]))
        assert record is None

    overview = client.get("/api/wms/overview", headers=_headers("Admin", user_id="admin-rbac"))
    assert overview.status_code == 200
    listed = next((item for item in overview.json()["users"] if item["id"] == payload["id"]), None)
    assert listed is None


def test_bulk_delete_users_is_hard_persistent() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    payloads = [
        {
            "id": f"usr-bulk-{suffix}-1",
            "name": f"Bulk User A {suffix}",
            "email": f"bulk.a.{suffix}@example.local",
            "role": "Mitarbeiter",
            "lastActive": "Neu",
            "status": "Aktiv",
            "department": "QA",
            "location": "Berlin",
        },
        {
            "id": f"usr-bulk-{suffix}-2",
            "name": f"Bulk User B {suffix}",
            "email": f"bulk.b.{suffix}@example.local",
            "role": "Mitarbeiter",
            "lastActive": "Neu",
            "status": "Inaktiv",
            "department": "QA",
            "location": "Berlin",
        },
    ]
    for payload in payloads:
        created = client.post("/api/wms/users", headers=_headers("Admin"), json=payload)
        assert created.status_code == 200

    bulk = client.post(
        "/api/wms/users/bulk-delete",
        headers=_headers("Admin", user_id="admin-rbac"),
        json={"userIds": [payloads[0]["id"], payloads[1]["id"]]},
    )
    assert bulk.status_code == 200
    assert bulk.json()["deletedCount"] == 2
    assert bulk.json()["skippedCount"] == 0

    with SessionLocal() as db:
        remaining = db.scalars(
            select(UserRecord).where(UserRecord.external_id.in_([payloads[0]["id"], payloads[1]["id"]]))
        ).all()
        assert remaining == []

    overview = client.get("/api/wms/overview", headers=_headers("Admin", user_id="admin-rbac"))
    assert overview.status_code == 200
    ids = {item["id"] for item in overview.json()["users"]}
    assert payloads[0]["id"] not in ids
    assert payloads[1]["id"] not in ids


def test_admin_cannot_delete_self_user() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    payload = {
        "id": f"usr-self-{suffix}",
        "name": f"Self Delete {suffix}",
        "email": f"self.{suffix}@example.local",
        "role": "Admin",
        "lastActive": "Neu",
        "status": "Aktiv",
        "department": "Ops",
        "location": "Berlin",
    }

    created = client.post("/api/wms/users", headers=_headers("Admin"), json=payload)
    assert created.status_code == 200

    blocked = client.delete(f"/api/wms/users/{payload['id']}", headers=_headers("Admin", user_id=payload["id"]))
    assert blocked.status_code == 409
    assert "eigenen Benutzer" in blocked.json().get("detail", "")


def test_last_active_admin_cannot_be_deleted() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    payload = {
        "id": f"usr-last-admin-{suffix}",
        "name": f"Last Admin {suffix}",
        "email": f"lastadmin.{suffix}@example.local",
        "role": "Admin",
        "lastActive": "Neu",
        "status": "Aktiv",
        "department": "Ops",
        "location": "Berlin",
    }

    created = client.post("/api/wms/users", headers=_headers("Admin"), json=payload)
    assert created.status_code == 200

    deactivated_admin_ids: list[str] = []
    try:
        with SessionLocal() as db:
            users = db.scalars(select(UserRecord)).all()
            for user in users:
                role = str(user.role or "").strip().lower()
                status = str(user.status or "").strip().lower()
                if user.external_id == payload["id"]:
                    continue
                if role in {"admin", "techniker", "administrator"} and status in {"aktiv", "active"}:
                    user.status = "Inaktiv"
                    deactivated_admin_ids.append(user.external_id)
            db.commit()

        blocked = client.delete(
            f"/api/wms/users/{payload['id']}",
            headers=_headers("Admin", user_id=f"auditor-{suffix}"),
        )
        assert blocked.status_code == 409
        assert "letzte aktive Admin" in blocked.json().get("detail", "")
    finally:
        _set_users_status(deactivated_admin_ids, "Aktiv")
        _set_users_status([payload["id"]], "Inaktiv")


def test_planning_permissions_and_project_scope() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:6]
    today = date.today()
    payload = {
        "customerName": f"Kunde RBAC {suffix}",
        "projectName": f"Projekt RBAC {suffix}",
        "eventName": "E2E RBAC",
        "projectManagerUserId": f"pm-{suffix}",
        "calendarWeek": today.isocalendar().week,
        "startDate": today.isoformat(),
        "endDate": (today + timedelta(days=1)).isoformat(),
        "notes": "RBAC Testplanung",
        "status": "Entwurf",
        "days": [
            {
                "planningDate": today.isoformat(),
                "weekday": "Montag",
                "items": [{"categoryKey": "Laptop", "qty": 1, "notes": None}],
            }
        ],
    }

    denied_create = client.post("/api/wms/planning", headers=_headers("Mitarbeiter"), json=payload)
    assert denied_create.status_code == 403

    created = client.post(
        "/api/wms/planning",
        headers=_headers("Projektmanager", user_id=f"pm-{suffix}"),
        json=payload,
    )
    assert created.status_code == 200
    planning_id = created.json()["id"]

    no_scope_list = client.get("/api/wms/planning", headers=_headers("Mitarbeiter"))
    assert no_scope_list.status_code == 403

    scoped_list = client.get("/api/wms/planning", headers=_headers("Mitarbeiter", project_context=f"Projekt RBAC {suffix}"))
    assert scoped_list.status_code == 200
    assert any(item["id"] == planning_id for item in scoped_list.json())

    cleanup = client.delete(f"/api/wms/planning/{planning_id}", headers=_headers("Admin"))
    assert cleanup.status_code == 200
