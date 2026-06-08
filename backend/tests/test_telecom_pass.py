"""Telekompass-Erfassung für LTE-Router bei der Rückgabe/Einlagerung.

Deckt die Fachregeln ab:
- Erfassung nur für LTE-Router (andere Kategorien werden abgewiesen).
- Rückgabe mit 0 Buchungen funktioniert, ohne den Zähler zu verändern.
- Buchungen erhöhen den Asset-Zähler; mehrere Rückgaben addieren korrekt.
- Negative Anzahl wird abgelehnt.
- Preisänderung nur für Admin.
- Verlauf speichert quantity + Preis-Snapshots.
- Doppelte Rückgabe (gleicher Idempotenz-Schlüssel) zählt nicht doppelt.
- Backup/Restore erhält Zähler, Verlauf und globale Einstellung.
"""

from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from .auth_helpers import auth_headers


def _headers(client: TestClient, role: str, user_id: str | None = None) -> dict[str, str]:
    return auth_headers(client, role, user_id=user_id)


def _reset(client: TestClient) -> None:
    res = client.post("/api/wms/backup/reset-for-import", headers=_headers(client, "Admin"))
    assert res.status_code == 200, res.text


def _asset_payload(suffix: str, category: str, index: int = 0) -> dict:
    return {
        "id": f"asset-tp-{suffix}-{index}",
        "name": f"{category} {suffix}-{index}",
        "category": category,
        "location": "Hauptlager",
        "status": "Verfuegbar",
        "assignedTo": "-",
        "nextReturn": "-",
        "tagNumber": f"TAG-TP-{suffix}-{index}",
        "serialNumber": f"SN-TP-{suffix}-{index}",
        "qrCode": "",
        "maintenanceState": "Neu",
        "notes": "",
        "lastCheckout": "-",
        "nextReservation": "-",
    }


def _create_asset(client: TestClient, suffix: str, category: str, index: int = 0) -> dict:
    res = client.post(
        "/api/wms/assets", headers=_headers(client, "Admin"), json=_asset_payload(suffix, category, index)
    )
    assert res.status_code == 200, res.text
    return res.json()


def _set_price(client: TestClient, price: float) -> None:
    res = client.put(
        "/api/wms/telecom-pass/settings",
        headers=_headers(client, "Admin"),
        json={"unitPrice": price},
    )
    assert res.status_code == 200, res.text


# --------------------------------------------------------------------------- #


def test_booking_rejected_for_non_lte_router() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)
    asset = _create_asset(client, suffix, "Laptop")
    res = client.post(
        f"/api/wms/assets/{asset['id']}/telecom-pass-booking",
        headers=_headers(client, "Admin"),
        json={"quantity": 2},
    )
    assert res.status_code == 400, res.text


def test_lte_router_return_with_zero_bookings_keeps_counter() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)
    asset = _create_asset(client, suffix, "LTE-Router")
    res = client.post(
        f"/api/wms/assets/{asset['id']}/telecom-pass-booking",
        headers=_headers(client, "Admin"),
        json={"quantity": 0},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["asset"]["telecomPassBookingCountTotal"] == 0
    assert body["booking"] is None


def test_lte_router_booking_increments_counter() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)
    asset = _create_asset(client, suffix, "LTE-Router")
    res = client.post(
        f"/api/wms/assets/{asset['id']}/telecom-pass-booking",
        headers=_headers(client, "Admin"),
        json={"quantity": 3},
    )
    assert res.status_code == 200, res.text
    assert res.json()["asset"]["telecomPassBookingCountTotal"] == 3


def test_multiple_returns_accumulate() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)
    asset = _create_asset(client, suffix, "LTE-Router")
    headers = _headers(client, "Admin")
    client.post(
        f"/api/wms/assets/{asset['id']}/telecom-pass-booking",
        headers=headers,
        json={"quantity": 3, "idempotencyKey": f"k-{suffix}-1"},
    )
    res = client.post(
        f"/api/wms/assets/{asset['id']}/telecom-pass-booking",
        headers=headers,
        json={"quantity": 2, "idempotencyKey": f"k-{suffix}-2"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["asset"]["telecomPassBookingCountTotal"] == 5


def test_negative_quantity_rejected() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)
    asset = _create_asset(client, suffix, "LTE-Router")
    res = client.post(
        f"/api/wms/assets/{asset['id']}/telecom-pass-booking",
        headers=_headers(client, "Admin"),
        json={"quantity": -1},
    )
    assert res.status_code == 422, res.text


def test_price_change_admin_only() -> None:
    client = TestClient(app)
    _reset(client)
    forbidden = client.put(
        "/api/wms/telecom-pass/settings",
        headers=_headers(client, "Mitarbeiter", user_id="tp-mitarbeiter"),
        json={"unitPrice": 5.0},
    )
    assert forbidden.status_code == 403, forbidden.text

    allowed = client.put(
        "/api/wms/telecom-pass/settings",
        headers=_headers(client, "Admin"),
        json={"unitPrice": 4.5},
    )
    assert allowed.status_code == 200, allowed.text
    assert allowed.json()["unitPrice"] == 4.5

    # Lesen darf jeder eingeloggte Nutzer.
    read = client.get(
        "/api/wms/telecom-pass/settings",
        headers=_headers(client, "Mitarbeiter", user_id="tp-mitarbeiter"),
    )
    assert read.status_code == 200, read.text
    assert read.json()["unitPrice"] == 4.5


def test_history_records_quantity_and_price_snapshots() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)
    _set_price(client, 2.5)
    asset = _create_asset(client, suffix, "LTE-Router")
    res = client.post(
        f"/api/wms/assets/{asset['id']}/telecom-pass-booking",
        headers=_headers(client, "Admin"),
        json={"quantity": 4, "idempotencyKey": f"hist-{suffix}"},
    )
    assert res.status_code == 200, res.text
    booking = res.json()["booking"]
    assert booking["quantity"] == 4
    assert booking["unitPriceSnapshot"] == 2.5
    assert booking["totalPriceSnapshot"] == 10.0
    assert booking["kind"] == "booking"

    history = client.get(
        f"/api/wms/assets/{asset['id']}/telecom-pass-bookings",
        headers=_headers(client, "Admin"),
    )
    assert history.status_code == 200, history.text
    rows = history.json()
    assert len(rows) == 1
    assert rows[0]["quantity"] == 4


def test_duplicate_idempotency_key_does_not_double_count() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)
    asset = _create_asset(client, suffix, "LTE-Router")
    headers = _headers(client, "Admin")
    key = f"dup-{suffix}"
    first = client.post(
        f"/api/wms/assets/{asset['id']}/telecom-pass-booking",
        headers=headers,
        json={"quantity": 3, "idempotencyKey": key},
    )
    assert first.status_code == 200, first.text
    assert first.json()["asset"]["telecomPassBookingCountTotal"] == 3
    assert first.json()["duplicate"] is False

    second = client.post(
        f"/api/wms/assets/{asset['id']}/telecom-pass-booking",
        headers=headers,
        json={"quantity": 3, "idempotencyKey": key},
    )
    assert second.status_code == 200, second.text
    assert second.json()["asset"]["telecomPassBookingCountTotal"] == 3
    assert second.json()["duplicate"] is True


def test_admin_correction_sets_absolute_count() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)
    asset = _create_asset(client, suffix, "LTE-Router")
    headers = _headers(client, "Admin")
    client.post(
        f"/api/wms/assets/{asset['id']}/telecom-pass-booking",
        headers=headers,
        json={"quantity": 5, "idempotencyKey": f"corr-{suffix}"},
    )
    res = client.put(
        f"/api/wms/assets/{asset['id']}/telecom-pass-count",
        headers=headers,
        json={"total": 2},
    )
    assert res.status_code == 200, res.text
    assert res.json()["asset"]["telecomPassBookingCountTotal"] == 2
    # Korrektur ist nicht für Mitarbeiter erlaubt.
    forbidden = client.put(
        f"/api/wms/assets/{asset['id']}/telecom-pass-count",
        headers=_headers(client, "Mitarbeiter", user_id="tp-mitarbeiter"),
        json={"total": 9},
    )
    assert forbidden.status_code == 403, forbidden.text


def test_backup_restore_preserves_counter_history_and_setting() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    _reset(client)
    _set_price(client, 7.5)
    asset = _create_asset(client, suffix, "LTE-Router")
    admin = _headers(client, "Admin")
    client.post(
        f"/api/wms/assets/{asset['id']}/telecom-pass-booking",
        headers=admin,
        json={"quantity": 3, "idempotencyKey": f"bk-{suffix}"},
    )

    export = client.get("/api/wms/backup/export", headers=admin)
    assert export.status_code == 200, export.text
    payload = export.json()
    assert any(s["key"] == "telecom_pass_unit_price" for s in payload["systemSettings"])
    assert len(payload["telecomPassBookings"]) == 1

    # Preis verändern, dann Restore -> Wert muss wieder 7.5 sein.
    _set_price(client, 1.0)
    import json as _json

    files = {"file": ("backup.json", _json.dumps(payload).encode("utf-8"), "application/json")}
    imp = client.post("/api/wms/backup/import", headers=admin, files=files)
    assert imp.status_code == 200, imp.text

    settings = client.get("/api/wms/telecom-pass/settings", headers=admin)
    assert settings.json()["unitPrice"] == 7.5

    restored = client.get(f"/api/wms/assets/{asset['id']}", headers=admin)
    assert restored.status_code == 200, restored.text
    assert restored.json()["telecomPassBookingCountTotal"] == 3

    history = client.get(
        f"/api/wms/assets/{asset['id']}/telecom-pass-bookings", headers=admin
    )
    assert len(history.json()) == 1
