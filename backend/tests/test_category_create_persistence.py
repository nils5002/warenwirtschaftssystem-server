"""Regressionstest für die F5-Persistenz neu angelegter Kategorien.

Hintergrund: Eine im Kategorien-Modul angelegte Kategorie verschwand nach
einem Browser-Reload (F5), weil das Frontend sie nur in den lokalen
React-State schrieb und nie ``POST /api/wms/categories`` aufrief. Der Fix
ruft den Endpoint jetzt auf — diese Tests sichern den Backend-Kontrakt,
auf den sich das Frontend dabei verlässt:

1. Eine angelegte Kategorie taucht in einem frischen ``GET`` wieder auf
   (= Verhalten nach F5/Reload).
2. Doppelte Kategorien werden mit 409 abgelehnt.
3. Synonyme wie "Notebook" werden mit 409 auf die kanonische Kategorie
   verwiesen statt als neue Kategorie angelegt zu werden.
4. Die Standardkategorien bleiben unverändert vorhanden.
"""

from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient

from app.domain.categories import CANONICAL_CATEGORIES
from app.main import app
from .auth_helpers import auth_headers


def _headers(role: str = "Admin", user_id: str | None = None) -> dict[str, str]:
    return auth_headers(TestClient(app), role, user_id=user_id)


def _list_names(client: TestClient) -> list[str]:
    res = client.get("/api/wms/categories", headers=_headers())
    assert res.status_code == 200, res.text
    return [item["name"] for item in res.json()]


def test_created_category_survives_reload() -> None:
    """Anlegen → frisches GET liefert die Kategorie weiterhin (F5-Szenario)."""
    client = TestClient(app)
    suffix = uuid4().hex[:6]
    name = f"Test-Kategorie-F5-{suffix}"

    create_res = client.post("/api/wms/categories", headers=_headers(), json={"name": name})
    assert create_res.status_code == 200, create_res.text
    category_id = create_res.json()["id"]
    assert category_id is not None

    try:
        # Ein neuer TestClient entspricht einem frischen Browser nach F5:
        # gelesen wird derselbe persistente Backend-Stand.
        reloaded = TestClient(app)
        assert name in _list_names(reloaded), "Kategorie muss nach Reload erhalten bleiben"
    finally:
        client.delete(f"/api/wms/categories/{category_id}", headers=_headers())


def test_duplicate_category_is_rejected() -> None:
    """Eine bereits vorhandene Kategorie kann nicht doppelt angelegt werden."""
    client = TestClient(app)
    suffix = uuid4().hex[:6]
    name = f"Dup-Kategorie-{suffix}"

    first = client.post("/api/wms/categories", headers=_headers(), json={"name": name})
    assert first.status_code == 200, first.text
    category_id = first.json()["id"]

    try:
        second = client.post("/api/wms/categories", headers=_headers(), json={"name": name})
        assert second.status_code == 409, second.text
    finally:
        client.delete(f"/api/wms/categories/{category_id}", headers=_headers())


def test_alias_category_is_redirected_to_canonical() -> None:
    """"Notebook" wird nicht angelegt, sondern auf "Laptop" verwiesen (409)."""
    client = TestClient(app)
    res = client.post("/api/wms/categories", headers=_headers(), json={"name": "Notebook"})
    assert res.status_code == 409, res.text
    assert "Laptop" in res.json().get("detail", "")
    # Es darf keine Kategorie namens "Notebook" entstanden sein.
    assert "Notebook" not in _list_names(client)


def test_standard_categories_remain_available() -> None:
    """Die kanonischen Standardkategorien bleiben unverändert abrufbar."""
    client = TestClient(app)
    names = set(_list_names(client))
    for canonical in CANONICAL_CATEGORIES:
        assert canonical in names, f"Standardkategorie fehlt: {canonical}"
