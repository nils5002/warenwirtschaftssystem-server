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


# ---------------------------------------------------------------------------
# Admin-Bearbeitung: Prüfrunde editieren
# ---------------------------------------------------------------------------

def test_rbac_admin_only_for_edits() -> None:
    """Non-Admins dürfen weder Sessions noch Scans bearbeiten (403)."""
    client = TestClient(app)
    session = _create_session(client)
    sid = session["id"]
    scan = _scan(client, sid, "irgendwas")["scan"]
    scan_id = scan["id"]

    for role in ("Mitarbeiter", "Projektmanager"):
        headers = auth_headers(client, role)
        assert (
            client.patch(
                f"/api/wms/label-audit/sessions/{sid}",
                headers=headers,
                json={"name": "Hack"},
            ).status_code
            == 403
        )
        assert (
            client.patch(
                f"/api/wms/label-audit/sessions/{sid}/scans/{scan_id}",
                headers=headers,
                json={"ignored": True},
            ).status_code
            == 403
        )


def test_edit_session_name_and_note() -> None:
    client = TestClient(app)
    session = _create_session(client, name="Alt")
    sid = session["id"]

    res = client.patch(
        f"/api/wms/label-audit/sessions/{sid}",
        headers=_admin(client),
        json={"name": "Neu", "note": "Korrektur-Notiz"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["name"] == "Neu"
    assert body["note"] == "Korrektur-Notiz"


def test_reactivation_rejected_when_other_active_exists() -> None:
    client = TestClient(app)
    first = _create_session(client, name="Runde 1")
    # Zweite Runde wird aktiv, erste automatisch archiviert.
    _second = _create_session(client, name="Runde 2")

    # Erste (archivierte) reaktivieren → abgelehnt, weil Runde 2 aktiv ist.
    res = client.patch(
        f"/api/wms/label-audit/sessions/{first['id']}",
        headers=_admin(client),
        json={"status": "active"},
    )
    assert res.status_code == 409

    # Sie bleibt archiviert.
    refetch = client.get(
        f"/api/wms/label-audit/sessions/{first['id']}", headers=_admin(client)
    )
    assert refetch.json()["status"] == "archived"


def test_archive_and_reactivate_when_no_other_active() -> None:
    client = TestClient(app)
    session = _create_session(client, name="Solo")
    sid = session["id"]

    # Archivieren via PATCH.
    archived = client.patch(
        f"/api/wms/label-audit/sessions/{sid}",
        headers=_admin(client),
        json={"status": "archived"},
    )
    assert archived.status_code == 200
    assert archived.json()["status"] == "archived"

    # Keine andere aktive Runde → Reaktivierung erlaubt.
    reactivated = client.patch(
        f"/api/wms/label-audit/sessions/{sid}",
        headers=_admin(client),
        json={"status": "active"},
    )
    assert reactivated.status_code == 200
    assert reactivated.json()["status"] == "active"


# ---------------------------------------------------------------------------
# Admin-Bearbeitung: Scans korrigieren
# ---------------------------------------------------------------------------

def test_ignore_scan_excludes_from_summary() -> None:
    client = TestClient(app)
    _external_id, serial, _tag = _make_asset()
    session = _create_session(client)
    sid = session["id"]
    matched = _scan(client, sid, serial)
    scan_id = matched["scan"]["id"]
    assert matched["session"]["summary"]["checked"] == 1

    # Scan ignorieren → zählt nicht mehr als geprüft, dafür ignored=1.
    res = client.patch(
        f"/api/wms/label-audit/sessions/{sid}/scans/{scan_id}",
        headers=_admin(client),
        json={"ignored": True, "ignoreReason": "Fehlscan"},
    )
    assert res.status_code == 200, res.text
    summary = res.json()["session"]["summary"]
    assert summary["checked"] == 0
    assert summary["ignored"] == 1
    assert res.json()["scan"]["ignored"] is True
    assert res.json()["scan"]["ignoreReason"] == "Fehlscan"


def test_unignore_scan_restores_summary() -> None:
    client = TestClient(app)
    _external_id, serial, _tag = _make_asset()
    session = _create_session(client)
    sid = session["id"]
    scan_id = _scan(client, sid, serial)["scan"]["id"]

    client.patch(
        f"/api/wms/label-audit/sessions/{sid}/scans/{scan_id}",
        headers=_admin(client),
        json={"ignored": True},
    )
    res = client.patch(
        f"/api/wms/label-audit/sessions/{sid}/scans/{scan_id}",
        headers=_admin(client),
        json={"ignored": False},
    )
    assert res.status_code == 200
    summary = res.json()["session"]["summary"]
    assert summary["checked"] == 1
    assert summary["ignored"] == 0
    assert res.json()["scan"]["ignored"] is False


def test_assign_unknown_scan_to_asset() -> None:
    client = TestClient(app)
    external_id, serial, tag = _make_asset()
    session = _create_session(client)
    sid = session["id"]

    # Unbekannter Scan.
    unknown_value = f"NOPE-{uuid4().hex[:6]}"
    unknown = _scan(client, sid, unknown_value)
    scan_id = unknown["scan"]["id"]
    assert unknown["scan"]["scanKind"] == "unknown"
    assert unknown["session"]["summary"]["checked"] == 0

    # Nachträglich dem Asset zuordnen.
    res = client.patch(
        f"/api/wms/label-audit/sessions/{sid}/scans/{scan_id}",
        headers=_admin(client),
        json={"assetId": external_id, "correctionNote": "manuell zugeordnet"},
    )
    assert res.status_code == 200, res.text
    scan = res.json()["scan"]
    assert scan["scanKind"] == "corrected"
    assert scan["assetId"] == external_id
    assert scan["serialNumber"] == serial
    assert scan["tagNumber"] == tag
    # Rohwert bleibt erhalten.
    assert scan["scanValue"] == unknown_value
    # Zählt jetzt als geprüft.
    summary = res.json()["session"]["summary"]
    assert summary["checked"] == 1
    assert summary["unknown"] == 0
    assert external_id in res.json()["session"]["checkedAssetIds"]


def test_assign_to_already_checked_asset_becomes_duplicate() -> None:
    client = TestClient(app)
    external_id, serial, _tag = _make_asset()
    session = _create_session(client)
    sid = session["id"]

    # Asset regulär prüfen.
    _scan(client, sid, serial)
    # Unbekannten Scan erfassen und demselben Asset zuordnen.
    unknown = _scan(client, sid, f"NOPE-{uuid4().hex[:6]}")
    scan_id = unknown["scan"]["id"]
    res = client.patch(
        f"/api/wms/label-audit/sessions/{sid}/scans/{scan_id}",
        headers=_admin(client),
        json={"assetId": external_id},
    )
    assert res.status_code == 200, res.text
    # Key war bereits geprüft → Korrektur wird als duplicate markiert, nicht doppelt gezählt.
    assert res.json()["scan"]["scanKind"] == "duplicate"
    summary = res.json()["session"]["summary"]
    assert summary["checked"] == 1
    assert summary["duplicates"] == 1


def test_assign_unknown_asset_returns_404() -> None:
    client = TestClient(app)
    session = _create_session(client)
    sid = session["id"]
    scan_id = _scan(client, sid, f"NOPE-{uuid4().hex[:6]}")["scan"]["id"]

    res = client.patch(
        f"/api/wms/label-audit/sessions/{sid}/scans/{scan_id}",
        headers=_admin(client),
        json={"assetId": "does-not-exist-xyz"},
    )
    assert res.status_code == 404


def test_scan_edit_does_not_touch_asset_data() -> None:
    """Ignorieren/Zuordnen verändert keinerlei echte Hardwaredaten."""
    client = TestClient(app)
    external_id, serial, tag = _make_asset()

    def _asset_snapshot() -> tuple:
        with SessionLocal() as db:
            record = db.scalar(
                select(AssetRecord).where(AssetRecord.external_id == external_id)
            )
            assert record is not None
            return (record.name, record.category, record.status, record.serial_number, record.tag_number)

    before = _asset_snapshot()

    session = _create_session(client)
    sid = session["id"]
    # Unknown-Scan dem Asset zuordnen + ignorieren.
    scan_id = _scan(client, sid, f"NOPE-{uuid4().hex[:6]}")["scan"]["id"]
    client.patch(
        f"/api/wms/label-audit/sessions/{sid}/scans/{scan_id}",
        headers=_admin(client),
        json={"assetId": external_id, "note": "x", "ignored": True, "ignoreReason": "y"},
    )

    assert _asset_snapshot() == before
