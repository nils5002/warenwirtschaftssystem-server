"""Tests für DELETE /api/wms/categories/{id}.

Deckt RBAC und den 409-Konflikt-Pfad ab:

1. Admin darf eine unbenutzte Kategorie löschen.
2. Techniker (intern auf admin gemappt) darf löschen.
3. Projektmanager darf löschen.
4. Mitarbeiter / Junior dürfen NICHT löschen → 403.
5. Eine Kategorie mit zugeordneten Assets kann nicht gelöscht werden → 409.
6. Eine nicht existierende Kategorie liefert 404.
"""

from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from .auth_helpers import auth_headers


def _headers(role: str, user_id: str | None = None) -> dict[str, str]:
    return auth_headers(TestClient(app), role, user_id=user_id)


def _create_category(client: TestClient, name: str) -> dict:
    res = client.post("/api/wms/categories", headers=_headers("Admin"), json={"name": name})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body.get("id") is not None, "Backend muss id liefern"
    return body


def _list_categories(client: TestClient) -> list[dict]:
    res = client.get("/api/wms/categories", headers=_headers("Admin"))
    assert res.status_code == 200
    return res.json()


def test_admin_can_delete_unused_category() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:6]
    name = f"DelKat-Admin-{suffix}"
    cat = _create_category(client, name)

    delete_res = client.delete(f"/api/wms/categories/{cat['id']}", headers=_headers("Admin"))
    assert delete_res.status_code == 200, delete_res.text
    assert delete_res.json()["deleted"] is True

    remaining = _list_categories(client)
    assert all(item["name"] != name for item in remaining), "Kategorie muss nach Delete weg sein"


def test_techniker_can_delete_unused_category() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:6]
    name = f"DelKat-Tech-{suffix}"
    cat = _create_category(client, name)

    delete_res = client.delete(
        f"/api/wms/categories/{cat['id']}",
        headers=_headers("Techniker", user_id=f"tech-cat-{suffix}"),
    )
    assert delete_res.status_code == 200, delete_res.text


def test_projektmanager_can_delete_unused_category() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:6]
    name = f"DelKat-PM-{suffix}"
    cat = _create_category(client, name)

    delete_res = client.delete(
        f"/api/wms/categories/{cat['id']}",
        headers=_headers("Projektmanager", user_id=f"pm-cat-{suffix}"),
    )
    assert delete_res.status_code == 200, delete_res.text


def test_mitarbeiter_cannot_delete_category() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:6]
    name = f"DelKat-Emp-{suffix}"
    cat = _create_category(client, name)
    try:
        denied = client.delete(
            f"/api/wms/categories/{cat['id']}",
            headers=_headers("Mitarbeiter", user_id=f"emp-cat-{suffix}"),
        )
        assert denied.status_code == 403

        denied_junior = client.delete(
            f"/api/wms/categories/{cat['id']}",
            headers=_headers("Junior", user_id=f"jun-cat-{suffix}"),
        )
        assert denied_junior.status_code == 403
    finally:
        # Aufräumen — die Kategorie wurde nicht gelöscht.
        client.delete(f"/api/wms/categories/{cat['id']}", headers=_headers("Admin"))


def test_category_with_assets_cannot_be_deleted_returns_409() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:6]
    name = f"DelKat-Used-{suffix}"
    cat = _create_category(client, name)

    asset_payload = {
        "id": f"asset-cat-{suffix}",
        "name": f"Cat Asset {suffix}",
        "category": name,
        "location": "Testlager",
        "status": "Verfuegbar",
        "assignedTo": "-",
        "nextReturn": "-",
        "tagNumber": f"CAT-{suffix}",
        "serialNumber": f"CAT-SN-{suffix}",
        "qrCode": "",
        "maintenanceState": "Neu",
        "notes": "",
        "lastCheckout": "-",
        "nextReservation": "-",
    }
    asset_res = client.post("/api/wms/assets", headers=_headers("Admin"), json=asset_payload)
    assert asset_res.status_code == 200, asset_res.text

    try:
        # Versuche zu löschen — muss 409 mit verständlicher Meldung liefern.
        denied = client.delete(f"/api/wms/categories/{cat['id']}", headers=_headers("Admin"))
        assert denied.status_code == 409, denied.text
        detail = denied.json().get("detail", "")
        # Backend-Wortlaut: "Kategorie kann nicht gelöscht werden, weil noch X Gerät(e) damit verknüpft sind."
        assert "nicht gelöscht" in detail or "verknüpft" in detail

        # Auch Projektmanager bekommt 409 — gleicher Fachregel-Schutz.
        denied_pm = client.delete(
            f"/api/wms/categories/{cat['id']}",
            headers=_headers("Projektmanager", user_id=f"pm-conflict-{suffix}"),
        )
        assert denied_pm.status_code == 409
    finally:
        # Asset löschen → Kategorie wird wieder löschbar.
        client.delete(f"/api/wms/assets/{asset_payload['id']}", headers=_headers("Admin"))
        client.delete(f"/api/wms/categories/{cat['id']}", headers=_headers("Admin"))


def test_delete_non_existing_category_returns_404() -> None:
    client = TestClient(app)
    res = client.delete("/api/wms/categories/9999999", headers=_headers("Admin"))
    assert res.status_code == 404
