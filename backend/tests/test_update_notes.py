"""Schritt E: admin-pflegbare Update-Notes (Endpoints + Backup-Roundtrip)."""

from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient

from app.database.session import SessionLocal
from app.main import app
from app.schemas.backup import WarehouseBackupPayload, BackupUpdateNote
from app.services import backup_service
from .auth_helpers import auth_headers


def _admin(client: TestClient) -> dict[str, str]:
    return auth_headers(client, "Admin")


def _create(client: TestClient, version: str, items: list[str], *, title: str | None = None) -> dict:
    body = {"version": version, "items": items}
    if title is not None:
        body["title"] = title
    res = client.post("/api/wms/admin/update-notes", headers=_admin(client), json=body)
    assert res.status_code == 200, res.text
    return res.json()


def test_admin_can_create_draft() -> None:
    client = TestClient(app)
    v = f"9.{uuid4().hex[:4]}.0"
    note = _create(client, v, ["Punkt A", "Punkt B"], title="Titel")
    assert note["version"] == v
    assert note["items"] == ["Punkt A", "Punkt B"]
    assert note["isPublished"] is False
    assert note["publishedAt"] is None
    assert note["id"].startswith("upd-")


def test_non_admin_cannot_write_but_can_read_latest() -> None:
    client = TestClient(app)
    body = {"version": "9.9.9", "items": ["x"]}
    # Schreiben/Verwalten nur Admin.
    assert client.post("/api/wms/admin/update-notes", headers=auth_headers(client, "Mitarbeiter"), json=body).status_code == 403
    assert client.post("/api/wms/admin/update-notes", headers=auth_headers(client, "Projektmanager"), json=body).status_code == 403
    assert client.get("/api/wms/admin/update-notes", headers=auth_headers(client, "Mitarbeiter")).status_code == 403
    # Lesen des latest darf jeder (eingeloggte) Nutzer.
    assert client.get("/api/wms/update-notes/latest", headers=auth_headers(client, "Mitarbeiter")).status_code == 200


def test_latest_returns_most_recently_published_and_excludes_drafts() -> None:
    client = TestClient(app)
    a = _create(client, f"7.{uuid4().hex[:4]}.0", ["alt"])
    b = _create(client, f"7.{uuid4().hex[:4]}.0", ["neu"])
    draft = _create(client, f"7.{uuid4().hex[:4]}.0", ["entwurf"])  # bleibt Entwurf

    # A veröffentlichen, dann B → B hat das jüngste published_at.
    assert client.post(f"/api/wms/admin/update-notes/{a['id']}/publish", headers=_admin(client)).status_code == 200
    pub_b = client.post(f"/api/wms/admin/update-notes/{b['id']}/publish", headers=_admin(client))
    assert pub_b.status_code == 200
    assert pub_b.json()["isPublished"] is True
    assert pub_b.json()["publishedAt"] is not None

    latest = client.get("/api/wms/update-notes/latest", headers=_admin(client))
    assert latest.status_code == 200
    data = latest.json()
    assert data is not None
    assert data["id"] == b["id"]           # jüngste veröffentlichte
    assert data["id"] != draft["id"]       # Entwurf nie latest


def test_validation_rejects_empty_items_and_version() -> None:
    client = TestClient(app)
    assert client.post("/api/wms/admin/update-notes", headers=_admin(client),
                       json={"version": "1.0.0", "items": []}).status_code == 422
    assert client.post("/api/wms/admin/update-notes", headers=_admin(client),
                       json={"version": "1.0.0", "items": ["  "]}).status_code == 422
    assert client.post("/api/wms/admin/update-notes", headers=_admin(client),
                       json={"version": "   ", "items": ["x"]}).status_code == 422


def test_items_roundtrip_and_update() -> None:
    client = TestClient(app)
    note = _create(client, f"6.{uuid4().hex[:4]}.0", ["eins", "zwei"])
    # Bearbeiten: items + titel ändern.
    res = client.put(f"/api/wms/admin/update-notes/{note['id']}", headers=_admin(client),
                     json={"items": ["eins", "zwei", "drei"], "title": "Neu"})
    assert res.status_code == 200, res.text
    assert res.json()["items"] == ["eins", "zwei", "drei"]
    assert res.json()["title"] == "Neu"
    # Unbekannte id -> 404.
    assert client.put("/api/wms/admin/update-notes/upd-nope", headers=_admin(client),
                      json={"title": "x"}).status_code == 404


def test_backup_roundtrip_and_legacy_compat() -> None:
    # Altbackup OHNE updateNotes-Collection bleibt importierbar.
    legacy = WarehouseBackupPayload(version=1, exportedAt="2026-01-01T00:00:00Z")
    assert legacy.updateNotes == []
    # BackupUpdateNote ohne optionale Felder parst.
    bn = BackupUpdateNote(id="upd-x", version="1.0.0")
    assert bn.items == [] and bn.isPublished is False

    # Export enthält eine angelegte Note.
    client = TestClient(app)
    note = _create(client, f"5.{uuid4().hex[:4]}.0", ["backup-test"])
    client.post(f"/api/wms/admin/update-notes/{note['id']}/publish", headers=_admin(client))
    with SessionLocal() as db:
        exported = backup_service.export_backup(db)
    ours = [n for n in exported.updateNotes if n.id == note["id"]]
    assert ours and ours[0].items == ["backup-test"] and ours[0].isPublished is True
