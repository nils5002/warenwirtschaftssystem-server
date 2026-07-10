"""Login-Hintergrundbilder: Admin-Verwaltung (Upload/Aktivieren/Löschen/
Deaktivieren) mit serverseitiger Rollenprüfung, öffentlicher Read-only-Endpunkt
ohne Anmeldung, und Backup/Restore-Integration inkl. Altbackup-Kompatibilität.
"""

from __future__ import annotations

import io
import json

from fastapi.testclient import TestClient
from PIL import Image

from app.main import app
from .auth_helpers import auth_headers


def _headers(client: TestClient, role: str = "Admin", user_id: str | None = None) -> dict[str, str]:
    return auth_headers(client, role, user_id=user_id)


def _reset(client: TestClient) -> None:
    res = client.post("/api/wms/backup/reset-for-import", headers=_headers(client))
    assert res.status_code == 200, res.text


def _png_bytes(color: tuple[int, int, int] = (30, 60, 120), size=(320, 200)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, color).save(buffer, format="PNG")
    return buffer.getvalue()


def _upload(client: TestClient, name: str = "hintergrund.png", color=(30, 60, 120)) -> dict:
    res = client.post(
        "/api/wms/admin/login-backgrounds",
        headers=_headers(client),
        files={"file": (name, io.BytesIO(_png_bytes(color)), "image/png")},
    )
    assert res.status_code == 200, res.text
    return res.json()


def test_upload_activates_and_reencodes_to_webp() -> None:
    client = TestClient(app)
    _reset(client)
    created = _upload(client, "mein-bild.png")
    assert created["isActive"] is True
    assert created["mimeType"] == "image/webp"
    assert created["originalName"] == "mein-bild.png"
    assert created["width"] > 0 and created["height"] > 0
    assert created["sizeBytes"] > 0
    assert created["url"].startswith("/api/wms/login-backgrounds/file/")


def test_public_branding_and_file_are_reachable_without_auth() -> None:
    client = TestClient(app)
    _reset(client)
    created = _upload(client)

    # Frischer Client OHNE Login → leerer Cookie-Jar, echte anonyme Sicht.
    public = TestClient(app)
    branding = public.get("/api/wms/login-branding")
    assert branding.status_code == 200, branding.text
    url = branding.json()["backgroundUrl"]
    assert url == created["url"]

    # Öffentliche Datei: ebenfalls ohne Auth abrufbar, liefert WEBP.
    file_res = public.get(url)
    assert file_res.status_code == 200, file_res.text
    assert file_res.headers["content-type"] == "image/webp"


def test_activating_one_deactivates_others() -> None:
    client = TestClient(app)
    _reset(client)
    first = _upload(client, "a.png", color=(200, 30, 30))
    second = _upload(client, "b.png", color=(30, 200, 30))
    # Zweiter Upload ist automatisch aktiv, erster damit inaktiv.
    listing = client.get("/api/wms/admin/login-backgrounds", headers=_headers(client)).json()
    active_ids = [item["id"] for item in listing if item["isActive"]]
    assert active_ids == [second["id"]]

    # Ersten wieder aktivieren.
    res = client.patch(
        f"/api/wms/admin/login-backgrounds/{first['id']}/activate", headers=_headers(client)
    )
    assert res.status_code == 200, res.text
    listing = client.get("/api/wms/admin/login-backgrounds", headers=_headers(client)).json()
    active_ids = [item["id"] for item in listing if item["isActive"]]
    assert active_ids == [first["id"]]


def test_deactivate_all_clears_public_branding() -> None:
    client = TestClient(app)
    _reset(client)
    _upload(client)
    res = client.post("/api/wms/admin/login-backgrounds/deactivate", headers=_headers(client))
    assert res.status_code == 200, res.text
    assert client.get("/api/wms/login-branding").json()["backgroundUrl"] is None


def test_delete_removes_and_frees_public_branding() -> None:
    client = TestClient(app)
    _reset(client)
    created = _upload(client)
    url = created["url"]
    res = client.delete(
        f"/api/wms/admin/login-backgrounds/{created['id']}", headers=_headers(client)
    )
    assert res.status_code == 200, res.text
    assert client.get("/api/wms/login-branding").json()["backgroundUrl"] is None
    # Datei ist entfernt → öffentlicher Datei-Abruf liefert 404 (kein Crash).
    assert client.get(url).status_code == 404


def test_upload_rejects_non_image() -> None:
    client = TestClient(app)
    _reset(client)
    res = client.post(
        "/api/wms/admin/login-backgrounds",
        headers=_headers(client),
        files={"file": ("boese.txt", io.BytesIO(b"kein bild"), "text/plain")},
    )
    assert res.status_code == 400, res.text


def test_non_admin_cannot_manage_backgrounds() -> None:
    client = TestClient(app)
    _reset(client)
    worker = _headers(client, "Mitarbeiter", user_id="usr-lbg-worker")
    assert client.get("/api/wms/admin/login-backgrounds", headers=worker).status_code == 403
    upload = client.post(
        "/api/wms/admin/login-backgrounds",
        headers=worker,
        files={"file": ("x.png", io.BytesIO(_png_bytes()), "image/png")},
    )
    assert upload.status_code == 403, upload.text


def test_public_endpoints_do_not_expose_gallery() -> None:
    client = TestClient(app)
    _reset(client)
    _upload(client)
    # Frischer Client OHNE Login (leerer Cookie-Jar): der Galerie-Endpunkt
    # liefert 401/403 — niemals die Liste.
    public = TestClient(app)
    res = public.get("/api/wms/admin/login-backgrounds")
    assert res.status_code in {401, 403}, res.text


def test_path_traversal_is_blocked() -> None:
    client = TestClient(app)
    _reset(client)
    assert client.get("/api/wms/login-backgrounds/file/..%2f..%2fsecret").status_code == 404
    assert client.get("/api/wms/login-backgrounds/file/not-a-valid-name.png").status_code == 404


def test_uploaded_by_name_is_recorded() -> None:
    client = TestClient(app)
    _reset(client)
    created = _upload(client)
    assert created["uploadedByName"]  # Anzeigename des Admins ist gesetzt


def test_backup_roundtrip_and_legacy_backup_without_field() -> None:
    client = TestClient(app)
    _reset(client)
    created = _upload(client)

    backup = client.get("/api/wms/backup/export", headers=_headers(client)).json()
    exported = [b for b in backup["loginBackgrounds"] if b["id"] == created["id"]]
    assert exported and exported[0]["isActive"] is True

    def _import(payload: dict) -> None:
        reset = client.post("/api/wms/backup/reset-for-import", headers=_headers(client))
        assert reset.status_code == 200, reset.text
        res = client.post(
            "/api/wms/backup/import",
            headers=_headers(client),
            files={
                "file": ("backup.json", io.BytesIO(json.dumps(payload).encode("utf-8")), "application/json")
            },
        )
        assert res.status_code == 200, res.text

    # Restore stellt die aktive Zuweisung wieder her (Datei liegt weiter im Volume).
    _import(backup)
    assert client.get("/api/wms/login-branding").json()["backgroundUrl"] == created["url"]

    # Altbackup ohne die Collection bleibt importierbar → keine Hintergründe.
    legacy = json.loads(json.dumps(backup))
    legacy.pop("loginBackgrounds", None)
    _import(legacy)
    assert client.get("/api/wms/login-branding").json()["backgroundUrl"] is None
    assert client.get("/api/wms/admin/login-backgrounds", headers=_headers(client)).json() == []
