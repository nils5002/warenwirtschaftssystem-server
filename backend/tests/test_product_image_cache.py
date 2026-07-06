"""Tests für das serverseitige Produktbild-Caching (Assets + Kategorien).

Abgedeckt:

1. ``try_sync_product_image``: Abruffehler → Status ``failed`` + Fehlermeldung
   (kein Raise); syntaktisch ungültige URL → HTTP 400.
2. Asset-Upsert mit toter Bild-URL blockiert den Save NICHT (Regression:
   Checkout/Checkin laufen über denselben Upsert).
3. Kategorie-PATCH mit toter URL → 200 + Status ``failed``.
4. Auslieferung über den neuen ``/api/wms/product-images/...``-Pfad und den
   ``/media/...``-Alias; Traversal-/Fremdnamen → 404.
5. Refresh-Endpoints („Bild neu laden") reparieren fehlende Cache-Dateien;
   RBAC: Mitarbeiter → 403.
6. ``recache_missing_images`` (Selbstheilung/Backfill): Dry-Run mutiert
   nichts, Apply lädt fehlende Dateien neu.

Alle Downloads sind gemockt (kein Netzwerkzugriff); der Cache liegt pro Test
in ``tmp_path``.
"""

from __future__ import annotations

from io import BytesIO
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image

from app.database.session import SessionLocal
from app.main import app
from app.services import product_image_service

from .auth_helpers import auth_headers


def _headers(client: TestClient, role: str) -> dict[str, str]:
    return auth_headers(client, role)


def _png_bytes() -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (8, 8), color=(200, 30, 30)).save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.fixture()
def image_cache(tmp_path, monkeypatch):
    """Cache-Verzeichnis nach tmp_path umbiegen und DNS-Check abschalten."""
    asset_dir = tmp_path / "assets"
    asset_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(product_image_service, "_asset_cache_dir", lambda: asset_dir)
    monkeypatch.setattr(product_image_service, "_assert_public_host", lambda hostname: None)
    return tmp_path


@pytest.fixture()
def working_download(monkeypatch):
    monkeypatch.setattr(
        product_image_service,
        "_download_bytes",
        lambda source_url: (_png_bytes(), "image/png"),
    )


@pytest.fixture()
def dead_download(monkeypatch):
    def _fail(source_url: str):
        raise HTTPException(status_code=400, detail="Produktbild konnte nicht heruntergeladen werden.")

    monkeypatch.setattr(product_image_service, "_download_bytes", _fail)


def _asset_payload(suffix: str, **extra) -> dict:
    payload = {
        "id": f"asset-img-{suffix}",
        "name": f"Bild-Testgerät {suffix}",
        "category": "Laptop",
        "location": "Testlager",
        "status": "Verfuegbar",
        "assignedTo": "-",
        "nextReturn": "-",
        "tagNumber": f"IMG-{suffix}",
        "serialNumber": f"SN-IMG-{suffix}",
        "qrCode": "",
        "maintenanceState": "Neu",
        "notes": "",
        "lastCheckout": "-",
        "nextReservation": "-",
    }
    payload.update(extra)
    return payload


def _create_category(client: TestClient, name: str) -> dict:
    res = client.post("/api/wms/categories", headers=_headers(client, "Admin"), json={"name": name})
    assert res.status_code == 200, res.text
    return res.json()


# --- try_sync_product_image ------------------------------------------------


def test_try_sync_returns_failed_instead_of_raising(image_cache, dead_download) -> None:
    payload = product_image_service.try_sync_product_image("https://example.test/bild.png")
    assert payload["fetch_status"] == "failed"
    assert payload["cached_path"] is None
    assert payload["fetch_error"]
    assert payload["source_url"] == "https://example.test/bild.png"


def test_try_sync_rejects_invalid_url_with_400(image_cache) -> None:
    with pytest.raises(HTTPException) as exc_info:
        product_image_service.try_sync_product_image("ftp://example.test/bild.png")
    assert exc_info.value.status_code == 400


def test_try_sync_success_writes_webp(image_cache, working_download) -> None:
    payload = product_image_service.try_sync_product_image("https://example.test/ok.png")
    assert payload["fetch_status"] == "ready"
    assert payload["cached_path"].endswith(".webp")
    assert product_image_service.cached_file_exists(payload["cached_path"])


# --- Asset-Upsert ------------------------------------------------------------


def test_asset_save_succeeds_despite_dead_image_url(image_cache, dead_download) -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    payload = _asset_payload(suffix, productImageSourceUrl="https://example.test/tot.png")

    res = client.post("/api/wms/assets", headers=_headers(client, "Admin"), json=payload)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["productImageStatus"] == "failed"
    assert body["productImageFetchError"]
    assert body["productImageUrl"] is None
    assert body["productImageSourceUrl"] == "https://example.test/tot.png"
    # Übrige Felder wurden trotz Bildfehler gespeichert.
    assert body["name"] == payload["name"]


def test_asset_save_caches_image_and_serves_it(image_cache, working_download) -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    payload = _asset_payload(suffix, productImageSourceUrl=f"https://example.test/{suffix}.png")

    res = client.post("/api/wms/assets", headers=_headers(client, "Admin"), json=payload)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["productImageStatus"] == "ready"
    assert body["productImageUrl"].startswith("/api/wms/product-images/assets/")

    image_res = client.get(body["productImageUrl"])
    assert image_res.status_code == 200
    assert image_res.headers["content-type"] == "image/webp"

    # Alter /media-Pfad bleibt als Alias funktionsfähig.
    alias_url = body["productImageUrl"].replace("/api/wms/product-images/", "/media/product-images/")
    alias_res = client.get(alias_url)
    assert alias_res.status_code == 200


def test_product_image_route_rejects_foreign_names(image_cache) -> None:
    client = TestClient(app)
    res = client.get("/api/wms/product-images/assets/does-not-exist.webp")
    assert res.status_code == 404
    res = client.get("/api/wms/product-images/assets/..%5C..%5Csecret.webp")
    assert res.status_code == 404


# --- Kategorie-Standardbild ---------------------------------------------------


def test_category_patch_with_dead_url_stores_failed_status(image_cache, dead_download) -> None:
    client = TestClient(app)
    category = _create_category(client, f"BildKat-{uuid4().hex[:6]}")

    res = client.patch(
        f"/api/wms/categories/{category['id']}",
        headers=_headers(client, "Admin"),
        json={"defaultImageSourceUrl": "https://example.test/tot.png"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["defaultImageStatus"] == "failed"
    assert body["defaultImageFetchError"]
    assert body["defaultImageUrl"] is None


def test_category_refresh_repairs_missing_cache_file(image_cache, working_download) -> None:
    client = TestClient(app)
    category = _create_category(client, f"BildKat-{uuid4().hex[:6]}")

    saved = client.patch(
        f"/api/wms/categories/{category['id']}",
        headers=_headers(client, "Admin"),
        json={"defaultImageSourceUrl": f"https://example.test/{uuid4().hex}.png"},
    )
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["defaultImageStatus"] == "ready"
    cached_name = body["defaultImageUrl"].rsplit("/", 1)[-1]

    # Cache-Datei "verschwindet" (Redeploy/Restore-Szenario).
    cache_file = image_cache / "categories" / cached_name
    assert cache_file.is_file()
    cache_file.unlink()
    assert client.get(body["defaultImageUrl"]).status_code == 404

    refreshed = client.post(
        f"/api/wms/categories/{category['id']}/default-image/refresh",
        headers=_headers(client, "Admin"),
    )
    assert refreshed.status_code == 200, refreshed.text
    assert refreshed.json()["defaultImageStatus"] == "ready"
    assert client.get(refreshed.json()["defaultImageUrl"]).status_code == 200


def test_refresh_endpoints_enforce_rbac(image_cache, working_download) -> None:
    client = TestClient(app)
    category = _create_category(client, f"BildKat-{uuid4().hex[:6]}")

    res = client.post(
        f"/api/wms/categories/{category['id']}/default-image/refresh",
        headers=_headers(client, "Mitarbeiter"),
    )
    assert res.status_code == 403

    suffix = uuid4().hex[:8]
    asset = _asset_payload(suffix, productImageSourceUrl=f"https://example.test/{suffix}.png")
    created = client.post("/api/wms/assets", headers=_headers(client, "Admin"), json=asset)
    assert created.status_code == 200

    res = client.post(
        f"/api/wms/assets/{asset['id']}/product-image/refresh",
        headers=_headers(client, "Mitarbeiter"),
    )
    assert res.status_code == 403

    res = client.post(
        f"/api/wms/assets/{asset['id']}/product-image/refresh",
        headers=_headers(client, "Admin"),
    )
    assert res.status_code == 200
    assert res.json()["productImageStatus"] == "ready"


def test_asset_refresh_without_source_url_returns_400(image_cache) -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    asset = _asset_payload(suffix)
    created = client.post("/api/wms/assets", headers=_headers(client, "Admin"), json=asset)
    assert created.status_code == 200

    res = client.post(
        f"/api/wms/assets/{asset['id']}/product-image/refresh",
        headers=_headers(client, "Admin"),
    )
    assert res.status_code == 400


# --- Selbstheilung / Backfill -------------------------------------------------


def test_recache_missing_images_dry_run_and_apply(image_cache, working_download) -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    asset = _asset_payload(suffix, productImageSourceUrl=f"https://example.test/{suffix}.png")
    created = client.post("/api/wms/assets", headers=_headers(client, "Admin"), json=asset)
    assert created.status_code == 200, created.text
    cached_name = created.json()["productImageUrl"].rsplit("/", 1)[-1]

    cache_file = image_cache / "assets" / cached_name
    assert cache_file.is_file()
    cache_file.unlink()

    with SessionLocal() as db:
        dry = product_image_service.recache_missing_images(db, apply=False)
    assert not cache_file.is_file(), "Dry-Run darf nichts neu laden"
    assert any(
        d["action"] == "wuerde neu laden" and d["name"] == asset["name"]
        for d in dry["details"]
    )

    with SessionLocal() as db:
        applied = product_image_service.recache_missing_images(db, apply=True)
    assert cache_file.is_file(), "Apply muss die fehlende Datei neu laden"
    assert int(applied["refetched"]) >= 1

    fetched = client.get(f"/api/wms/assets/{asset['id']}", headers=_headers(client, "Admin"))
    assert fetched.status_code == 200
    assert fetched.json()["productImageStatus"] == "ready"
