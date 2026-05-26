"""Tests für die Admin-Seite "Label-Prüfung" (serverseitige Prüfrunden).

Deckt ab: Admin-Only-RBAC, matched/duplicate/unknown-Scans, Persistenz über
einen erneuten GET ("Reload"), Reseed-Stabilität über den stabilen Key sowie
Archivierung. Es werden ausschließlich Audit-Tabellen geschrieben.
"""

from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database.models import AssetRecord
from app.database.session import SessionLocal
from app.main import app

from .auth_helpers import auth_headers


def _admin(client: TestClient) -> dict[str, str]:
    return auth_headers(client, "Admin")


def _make_asset() -> tuple[str, str, str]:
    """Legt ein Test-Asset direkt an. Gibt (external_id, serial, tag) zurück."""
    suffix = uuid4().hex[:8]
    external_id = f"asset-test-{suffix}"
    serial = f"SN-TEST-{suffix}"
    tag = f"INV-TEST-{suffix}"
    with SessionLocal() as db:
        record = AssetRecord(
            external_id=external_id,
            name=f"Test-Gerät {suffix}",
            category="Laptop",
            location="Lager",
            tag_number=tag,
            serial_number=serial,
        )
        db.add(record)
        db.commit()
    return external_id, serial, tag


def _create_session(client: TestClient, name: str | None = None) -> dict:
    body = {"name": name or f"Prüfrunde {uuid4().hex[:6]}"}
    res = client.post("/api/wms/label-audit/sessions", headers=_admin(client), json=body)
    assert res.status_code == 200, res.text
    return res.json()


def _scan(client: TestClient, session_id: str, value: str) -> dict:
    res = client.post(
        f"/api/wms/label-audit/sessions/{session_id}/scan",
        headers=_admin(client),
        json={"scanValue": value},
    )
    assert res.status_code == 200, res.text
    return res.json()


def test_rbac_admin_only() -> None:
    client = TestClient(app)
    for role in ("Mitarbeiter", "Projektmanager"):
        headers = auth_headers(client, role)
        assert client.get("/api/wms/label-audit/sessions", headers=headers).status_code == 403
        assert client.get("/api/wms/label-audit/sessions/active", headers=headers).status_code == 403
        assert (
            client.post(
                "/api/wms/label-audit/sessions", headers=headers, json={"name": "X"}
            ).status_code
            == 403
        )


def test_active_session_is_created_and_reused() -> None:
    client = TestClient(app)
    first = client.get("/api/wms/label-audit/sessions/active", headers=_admin(client))
    assert first.status_code == 200, first.text
    again = client.get("/api/wms/label-audit/sessions/active", headers=_admin(client))
    assert again.status_code == 200
    # Solange nicht archiviert / keine neue Runde gestartet wurde, bleibt es
    # dieselbe aktive Runde.
    assert first.json()["id"] == again.json()["id"]
    assert first.json()["status"] == "active"


def test_matched_duplicate_unknown_scans() -> None:
    client = TestClient(app)
    external_id, serial, _tag = _make_asset()
    session = _create_session(client)
    sid = session["id"]

    # 1) Erkennung über die Seriennummer → matched, zählt als geprüft.
    matched = _scan(client, sid, serial)
    assert matched["scan"]["scanKind"] == "matched"
    assert matched["scan"]["assetId"] == external_id
    assert matched["session"]["summary"]["checked"] == 1
    assert external_id in matched["session"]["checkedAssetIds"]

    # 2) Erneuter Scan desselben Assets → duplicate, kein Doppelzählen.
    dup = _scan(client, sid, serial)
    assert dup["scan"]["scanKind"] == "duplicate"
    assert dup["session"]["summary"]["checked"] == 1
    assert dup["session"]["summary"]["duplicates"] == 1

    # 3) Unbekannter Rohwert → unknown, Rohwert gespeichert.
    unknown_value = f"NOPE-{uuid4().hex[:6]}"
    unknown = _scan(client, sid, unknown_value)
    assert unknown["scan"]["scanKind"] == "unknown"
    assert unknown["scan"]["assetId"] is None
    assert unknown["scan"]["scanValue"] == unknown_value
    assert unknown["session"]["summary"]["unknown"] == 1
    assert unknown["session"]["summary"]["checked"] == 1


def test_persists_across_reload() -> None:
    client = TestClient(app)
    external_id, serial, _tag = _make_asset()
    session = _create_session(client)
    sid = session["id"]
    _scan(client, sid, serial)

    # "Reload": die Runde frisch vom Server holen → bleibt geprüft.
    reloaded = client.get(f"/api/wms/label-audit/sessions/{sid}", headers=_admin(client))
    assert reloaded.status_code == 200
    body = reloaded.json()
    assert body["summary"]["checked"] == 1
    assert external_id in body["checkedAssetIds"]


def test_reseed_keeps_check_via_stable_key() -> None:
    client = TestClient(app)
    external_id, serial, _tag = _make_asset()
    session = _create_session(client)
    sid = session["id"]
    _scan(client, sid, serial)

    # Reimport simulieren: dieselbe Seriennummer, aber NEUE external_id.
    new_external_id = f"asset-reseed-{uuid4().hex[:8]}"
    with SessionLocal() as db:
        record = db.scalar(select(AssetRecord).where(AssetRecord.external_id == external_id))
        assert record is not None
        record.external_id = new_external_id
        db.commit()

    reloaded = client.get(f"/api/wms/label-audit/sessions/{sid}", headers=_admin(client))
    assert reloaded.status_code == 200
    body = reloaded.json()
    # Trotz geänderter id bleibt das Gerät über den stabilen Key (Seriennummer)
    # als geprüft erkennbar — jetzt unter der neuen id.
    assert body["summary"]["checked"] == 1
    assert new_external_id in body["checkedAssetIds"]
    assert external_id not in body["checkedAssetIds"]


def test_archive_blocks_further_scans() -> None:
    client = TestClient(app)
    _external_id, serial, _tag = _make_asset()
    session = _create_session(client)
    sid = session["id"]
    _scan(client, sid, serial)

    archived = client.post(
        f"/api/wms/label-audit/sessions/{sid}/archive", headers=_admin(client)
    )
    assert archived.status_code == 200
    assert archived.json()["status"] == "archived"

    # In eine archivierte Runde darf nicht weiter gescannt werden.
    blocked = client.post(
        f"/api/wms/label-audit/sessions/{sid}/scan",
        headers=_admin(client),
        json={"scanValue": serial},
    )
    assert blocked.status_code == 409


def test_starting_new_session_archives_previous_active() -> None:
    client = TestClient(app)
    first = _create_session(client, name="Runde A")
    second = _create_session(client, name="Runde B")
    assert first["id"] != second["id"]

    # Die zuvor aktive Runde wurde archiviert; aktiv ist jetzt die neue.
    active = client.get("/api/wms/label-audit/sessions/active", headers=_admin(client))
    assert active.status_code == 200
    assert active.json()["id"] == second["id"]

    refetched_first = client.get(
        f"/api/wms/label-audit/sessions/{first['id']}", headers=_admin(client)
    )
    assert refetched_first.status_code == 200
    assert refetched_first.json()["status"] == "archived"
