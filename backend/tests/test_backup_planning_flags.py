"""Tests für Backup/Restore der planungsrelevanten Asset-Flags.

Sichert ab, dass `available_for_planning` und `card_printer_compatible`
vollständig exportiert UND importiert werden. Ohne diese Felder fielen sie
nach einem Restore auf den DB-Default True zurück — ein Restore lieferte dann
andere Verfügbarkeits-/Konfliktzahlen als der Live-Server.

Abgedeckt:
1. Export enthält beide Felder.
2. Restore erhält available_for_planning = False (card_printer_compatible
   bleibt davon unberührt).
3. Restore erhält card_printer_compatible = False (available_for_planning
   bleibt davon unberührt).
4. Altes Backup OHNE diese Felder importiert weiterhin erfolgreich und setzt
   beide Defaults auf True (Abwärtskompatibilität).
"""

from __future__ import annotations

import io
import json
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from .auth_helpers import auth_headers


def _headers(client: TestClient) -> dict[str, str]:
    return auth_headers(client, "Admin")


def _asset_payload(
    suffix: str,
    *,
    available_for_planning: bool,
    card_printer_compatible: bool,
) -> dict:
    """Eigenbestand-Laptop mit explizit gesetzten Planungs-Flags."""
    return {
        "id": f"asset-flags-{suffix}",
        "name": f"Flag Asset {suffix}",
        "category": "Laptop",
        "location": "Hauptlager",
        "status": "Verfuegbar",
        "assignedTo": "-",
        "nextReturn": "-",
        "tagNumber": f"FLAG-{suffix}",
        "serialNumber": f"FLAG-SN-{suffix}",
        "qrCode": "",
        "maintenanceState": "Neu",
        "notes": "",
        "lastCheckout": "-",
        "nextReservation": "-",
        "availableForPlanning": available_for_planning,
        "cardPrinterCompatible": card_printer_compatible,
    }


def _create_asset(client: TestClient, headers: dict[str, str], payload: dict) -> str:
    res = client.post("/api/wms/assets", headers=headers, json=payload)
    assert res.status_code == 200, res.text
    return payload["id"]


def _export(client: TestClient, headers: dict[str, str]) -> dict:
    res = client.get("/api/wms/backup/export", headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


def _reset_and_import(
    client: TestClient,
    headers: dict[str, str],
    payload: dict,
    suffix: str,
) -> None:
    """Daten bereinigen und das übergebene Backup wieder importieren."""
    reset = client.post("/api/wms/backup/reset-for-import", headers=headers)
    assert reset.status_code == 200, reset.text
    backup_bytes = json.dumps(payload).encode("utf-8")
    res = client.post(
        "/api/wms/backup/import",
        headers=headers,
        files={
            "file": (
                f"backup-flags-{suffix}.json",
                io.BytesIO(backup_bytes),
                "application/json",
            )
        },
    )
    assert res.status_code == 200, res.text


def _get_asset(client: TestClient, asset_id: str) -> dict:
    res = client.get(f"/api/wms/assets/{asset_id}", headers=_headers(client))
    assert res.status_code == 200, res.text
    return res.json()


# -----------------------------------------------------------------------------
# Test 1: Export enthält beide Planungs-Flags
# -----------------------------------------------------------------------------
def test_export_includes_planning_flags() -> None:
    client = TestClient(app)
    headers = _headers(client)
    suffix = uuid4().hex[:6]
    asset_id = _create_asset(
        client,
        headers,
        _asset_payload(suffix, available_for_planning=False, card_printer_compatible=False),
    )

    backup = _export(client, headers)
    backup_asset = next((a for a in backup["assets"] if a["id"] == asset_id), None)
    assert backup_asset is not None, "Asset muss im Backup-Export enthalten sein"
    assert "availableForPlanning" in backup_asset, "Feld availableForPlanning fehlt im Export"
    assert "cardPrinterCompatible" in backup_asset, "Feld cardPrinterCompatible fehlt im Export"
    assert backup_asset["availableForPlanning"] is False
    assert backup_asset["cardPrinterCompatible"] is False


# -----------------------------------------------------------------------------
# Test 2: Restore erhält available_for_planning = False
# -----------------------------------------------------------------------------
def test_restore_preserves_available_for_planning_false() -> None:
    client = TestClient(app)
    headers = _headers(client)
    suffix = uuid4().hex[:6]
    asset_id = _create_asset(
        client,
        headers,
        _asset_payload(suffix, available_for_planning=False, card_printer_compatible=True),
    )

    backup = _export(client, headers)
    _reset_and_import(client, headers, backup, suffix)

    after = _get_asset(client, asset_id)
    assert after["availableForPlanning"] is False, (
        "available_for_planning muss nach Restore False bleiben"
    )
    # Das zweite Flag darf dabei nicht verfälscht werden.
    assert after["cardPrinterCompatible"] is True


# -----------------------------------------------------------------------------
# Test 3: Restore erhält card_printer_compatible = False
# -----------------------------------------------------------------------------
def test_restore_preserves_card_printer_compatible_false() -> None:
    client = TestClient(app)
    headers = _headers(client)
    suffix = uuid4().hex[:6]
    asset_id = _create_asset(
        client,
        headers,
        _asset_payload(suffix, available_for_planning=True, card_printer_compatible=False),
    )

    backup = _export(client, headers)
    _reset_and_import(client, headers, backup, suffix)

    after = _get_asset(client, asset_id)
    assert after["cardPrinterCompatible"] is False, (
        "card_printer_compatible muss nach Restore False bleiben"
    )
    # Das zweite Flag darf dabei nicht verfälscht werden.
    assert after["availableForPlanning"] is True


# -----------------------------------------------------------------------------
# Test 4: Altes Backup OHNE die Felder bleibt importierbar (Defaults = True)
# -----------------------------------------------------------------------------
def test_legacy_backup_without_flags_imports_with_defaults() -> None:
    client = TestClient(app)
    headers = _headers(client)
    suffix = uuid4().hex[:6]
    asset_id = _create_asset(
        client,
        headers,
        _asset_payload(suffix, available_for_planning=False, card_printer_compatible=False),
    )

    backup = _export(client, headers)
    # Altes Backup-Format simulieren: beide Felder bei ALLEN Assets entfernen.
    for asset in backup["assets"]:
        asset.pop("availableForPlanning", None)
        asset.pop("cardPrinterCompatible", None)

    _reset_and_import(client, headers, backup, suffix)

    after = _get_asset(client, asset_id)
    # Felder fehlten im Backup -> abwärtskompatible Defaults greifen.
    assert after["availableForPlanning"] is True, (
        "Fehlendes availableForPlanning muss beim Restore auf True defaulten"
    )
    assert after["cardPrinterCompatible"] is True, (
        "Fehlendes cardPrinterCompatible muss beim Restore auf True defaulten"
    )
