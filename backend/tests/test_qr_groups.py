"""Tests für Sammel-QR (Gruppen-QR über vorhandene Fremdbestand-Assets).

Abgedeckt:
1. Gruppe aus vorhandenen Fremdbestand-Assets erstellen (+ Ablehnungen:
   Eigenbestand, gemischte Kategorien).
2. Auflösen per Token liefert Gruppe + korrekte verfügbar/verliehen-Zahlen
   (zurückgegebene/defekte Geräte zählen nicht als verfügbar).
3. Ausgabe mit Stückzahl bucht automatisch N verfügbare Assets; zu hohe
   Stückzahl wird abgelehnt.
4. Rücknahme mit Stückzahl nimmt automatisch N verliehene Assets zurück; zu
   hohe Stückzahl wird abgelehnt.
5. Keine doppelte Zählung in der Einsatzplanung: die Gruppe erzeugt keinen
   Bestand; eine Ausgabe senkt den nutzbaren Bestand um genau die Stückzahl.
6. Backup/Restore erhält Gruppen + Zuordnungen; Altbackups ohne diese
   Collection bleiben importierbar.

Isolation: Jeder Test registriert eine EIGENE, eindeutige Kategorie und legt
seinen Fremdbestand nur darin an. So verfälschen die hinterlassenen Testgeräte
keine kategoriebezogenen Bestandszählungen anderer Tests (die Suite teilt sich
eine Session-DB).
"""

from __future__ import annotations

import io
import json
from datetime import date, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from .auth_helpers import auth_headers


def _admin(client: TestClient) -> dict[str, str]:
    return auth_headers(client, "Admin")


def _register_category(client: TestClient, headers: dict[str, str], suffix: str) -> str:
    """Legt eine eindeutige Testkategorie an und liefert ihren kanonischen Namen."""
    name = f"TestKat-{suffix}"
    res = client.post("/api/wms/categories", headers=headers, json={"name": name})
    assert res.status_code == 200, res.text
    return res.json()["name"]


def _external_asset_payload(
    suffix: str,
    idx: int,
    *,
    category: str,
    ownership_type: str = "rented",
    available_until: str | None = None,
    status: str = "Verfuegbar",
) -> dict:
    today = date.today()
    return {
        "id": f"asset-grp-{suffix}-{idx}",
        "name": f"Miet-Gerät {suffix}-{idx}",
        "category": category,
        "location": "Fremdbestand",
        "status": status,
        "assignedTo": "-",
        "nextReturn": "-",
        "tagNumber": f"GRP-{suffix}-{idx}",
        "serialNumber": f"GRP-SN-{suffix}-{idx}",
        "qrCode": "",
        "maintenanceState": "",
        "notes": "",
        "lastCheckout": "-",
        "nextReservation": "-",
        "ownershipType": ownership_type,
        "availableFrom": today.isoformat(),
        "availableUntil": available_until or (today + timedelta(days=60)).isoformat(),
    }


def _create_asset(client: TestClient, headers: dict[str, str], payload: dict) -> str:
    res = client.post("/api/wms/assets", headers=headers, json=payload)
    assert res.status_code == 200, res.text
    return payload["id"]


def _create_external_assets(
    client: TestClient,
    headers: dict[str, str],
    suffix: str,
    count: int,
    *,
    category: str,
    available_until: str | None = None,
) -> list[str]:
    return [
        _create_asset(
            client,
            headers,
            _external_asset_payload(
                suffix, idx, category=category, available_until=available_until
            ),
        )
        for idx in range(count)
    ]


def _create_group(
    client: TestClient,
    headers: dict[str, str],
    *,
    name: str,
    category: str,
    asset_ids: list[str],
    stock_type: str | None = "rented",
):
    return client.post(
        "/api/wms/qr-groups",
        headers=headers,
        json={
            "name": name,
            "category": category,
            "stockType": stock_type,
            "assetIds": asset_ids,
        },
    )


def _get_asset(client: TestClient, headers: dict[str, str], asset_id: str) -> dict:
    res = client.get(f"/api/wms/assets/{asset_id}", headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


# -----------------------------------------------------------------------------
# Test 1: Gruppe erstellen + Ablehnungen
# -----------------------------------------------------------------------------
def test_create_group_from_existing_external_assets() -> None:
    client = TestClient(app)
    admin = _admin(client)
    suffix = uuid4().hex[:8]
    category = _register_category(client, admin, suffix)
    asset_ids = _create_external_assets(client, admin, suffix, 3, category=category)

    res = _create_group(
        client, admin, name="Miet-iPads Sammelbuchung", category=category, asset_ids=asset_ids
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["memberCount"] == 3
    assert body["availableCount"] == 3
    assert body["loanedCount"] == 0
    assert body["qrCode"].startswith("GROUP:")
    assert body["qrToken"] and body["qrCode"].endswith(body["qrToken"])


def test_create_group_rejects_owned_asset() -> None:
    client = TestClient(app)
    admin = _admin(client)
    suffix = uuid4().hex[:8]
    category = _register_category(client, admin, suffix)
    rented = _create_external_assets(client, admin, suffix, 2, category=category)
    owned = _create_asset(
        client,
        admin,
        _external_asset_payload(suffix, 99, category=category, ownership_type="owned"),
    )

    res = _create_group(
        client, admin, name="Mix", category=category, asset_ids=[*rented, owned]
    )
    assert res.status_code == 400, res.text


def test_create_group_rejects_mixed_categories() -> None:
    client = TestClient(app)
    admin = _admin(client)
    suffix = uuid4().hex[:8]
    cat_a = _register_category(client, admin, f"{suffix}-a")
    cat_b = _register_category(client, admin, f"{suffix}-b")
    asset_a = _create_asset(client, admin, _external_asset_payload(suffix, 0, category=cat_a))
    asset_b = _create_asset(client, admin, _external_asset_payload(suffix, 1, category=cat_b))

    res = _create_group(
        client, admin, name="Mix", category=cat_a, asset_ids=[asset_a, asset_b]
    )
    assert res.status_code == 400, res.text


# -----------------------------------------------------------------------------
# Test 2: Scan/Resolve erkennt Sammel-QR und liefert korrekte Mengen
# -----------------------------------------------------------------------------
def test_resolve_group_counts_exclude_returned_and_defect() -> None:
    client = TestClient(app)
    admin = _admin(client)
    suffix = uuid4().hex[:8]
    category = _register_category(client, admin, suffix)
    asset_ids = _create_external_assets(client, admin, suffix, 4, category=category)
    group = _create_group(
        client, admin, name="Resolve Test", category=category, asset_ids=asset_ids
    ).json()

    # Ein Gerät als zurückgegeben markieren, eines auf Defekt setzen.
    ret = client.post(f"/api/wms/assets/{asset_ids[0]}/mark-returned", headers=admin, json={})
    assert ret.status_code == 200, ret.text
    defect_payload = _external_asset_payload(suffix, 1, category=category, status="Defekt")
    upd = client.post("/api/wms/assets", headers=admin, json=defect_payload)
    assert upd.status_code == 200, upd.text

    res = client.get(f"/api/wms/qr-groups/resolve/{group['qrToken']}", headers=admin)
    assert res.status_code == 200, res.text
    resolved = res.json()["group"]
    assert resolved["memberCount"] == 4
    assert resolved["availableCount"] == 2  # 4 - 1 zurückgegeben - 1 defekt
    assert resolved["loanedCount"] == 0


# -----------------------------------------------------------------------------
# Test 3: Ausgabe mit Stückzahl
# -----------------------------------------------------------------------------
def test_bulk_checkout_books_quantity() -> None:
    client = TestClient(app)
    admin = _admin(client)
    suffix = uuid4().hex[:8]
    category = _register_category(client, admin, suffix)
    asset_ids = _create_external_assets(client, admin, suffix, 5, category=category)
    group = _create_group(
        client, admin, name="Ausgabe Test", category=category, asset_ids=asset_ids
    ).json()

    res = client.post(
        f"/api/wms/qr-groups/{group['id']}/checkout",
        headers=admin,
        json={"quantity": 2, "assignee": "Team Nord", "projectName": "Messe Hamburg"},
    )
    assert res.status_code == 200, res.text
    result = res.json()
    assert result["bookedCount"] == 2
    assert len(result["bookedAssetIds"]) == 2

    loaned = [
        aid for aid in asset_ids if _get_asset(client, admin, aid)["status"] == "Verliehen"
    ]
    assert len(loaned) == 2

    # Zu hohe Stückzahl wird abgelehnt (nur noch 3 verfügbar).
    too_many = client.post(
        f"/api/wms/qr-groups/{group['id']}/checkout",
        headers=admin,
        json={"quantity": 10},
    )
    assert too_many.status_code == 400, too_many.text


# -----------------------------------------------------------------------------
# Test 4: Rücknahme mit Stückzahl
# -----------------------------------------------------------------------------
def test_bulk_checkin_returns_quantity() -> None:
    client = TestClient(app)
    admin = _admin(client)
    suffix = uuid4().hex[:8]
    category = _register_category(client, admin, suffix)
    asset_ids = _create_external_assets(client, admin, suffix, 3, category=category)
    group = _create_group(
        client, admin, name="Rücknahme Test", category=category, asset_ids=asset_ids
    ).json()

    out = client.post(
        f"/api/wms/qr-groups/{group['id']}/checkout",
        headers=admin,
        json={"quantity": 3, "projectName": "Projekt X"},
    )
    assert out.status_code == 200, out.text

    back = client.post(
        f"/api/wms/qr-groups/{group['id']}/checkin",
        headers=admin,
        json={"quantity": 2},
    )
    assert back.status_code == 200, back.text
    assert back.json()["bookedCount"] == 2

    statuses = [_get_asset(client, admin, aid)["status"] for aid in asset_ids]
    assert statuses.count("Verfuegbar") == 2
    assert statuses.count("Verliehen") == 1

    # Mehr zurücknehmen als verliehen → Fehler (nur noch 1 verliehen).
    too_many = client.post(
        f"/api/wms/qr-groups/{group['id']}/checkin",
        headers=admin,
        json={"quantity": 5},
    )
    assert too_many.status_code == 400, too_many.text


def test_delete_group_removes_group() -> None:
    client = TestClient(app)
    admin = _admin(client)
    suffix = uuid4().hex[:8]
    category = _register_category(client, admin, suffix)
    asset_ids = _create_external_assets(client, admin, suffix, 2, category=category)
    group = _create_group(
        client, admin, name="Delete Test", category=category, asset_ids=asset_ids
    ).json()

    deleted = client.delete(f"/api/wms/qr-groups/{group['id']}", headers=admin)
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["deleted"] is True

    listing = client.get("/api/wms/qr-groups", headers=admin)
    assert listing.status_code == 200, listing.text
    assert all(item["id"] != group["id"] for item in listing.json())

    resolved = client.get(f"/api/wms/qr-groups/resolve/{group['qrToken']}", headers=admin)
    assert resolved.status_code == 404, resolved.text


def test_delete_group_rejects_when_members_are_loaned() -> None:
    client = TestClient(app)
    admin = _admin(client)
    suffix = uuid4().hex[:8]
    category = _register_category(client, admin, suffix)
    asset_ids = _create_external_assets(client, admin, suffix, 2, category=category)
    group = _create_group(
        client, admin, name="Delete Loaned Test", category=category, asset_ids=asset_ids
    ).json()

    out = client.post(
        f"/api/wms/qr-groups/{group['id']}/checkout",
        headers=admin,
        json={"quantity": 1, "projectName": "Projekt Delete"},
    )
    assert out.status_code == 200, out.text

    deleted = client.delete(f"/api/wms/qr-groups/{group['id']}", headers=admin)
    assert deleted.status_code == 409, deleted.text
    assert "verliehen" in deleted.json()["detail"]


# -----------------------------------------------------------------------------
# Test 5: Keine doppelte Zählung in der Einsatzplanung
# -----------------------------------------------------------------------------
def _usable_for_category(
    client: TestClient, headers: dict[str, str], planning_id: str, category: str
) -> int:
    res = client.get(f"/api/wms/planning/{planning_id}/availability", headers=headers)
    assert res.status_code == 200, res.text
    items = res.json()["items"]
    return sum(item["usableStock"] for item in items if item["categoryKey"] == category)


def test_planning_does_not_double_count_group() -> None:
    client = TestClient(app)
    admin = _admin(client)
    suffix = uuid4().hex[:8]
    category = _register_category(client, admin, suffix)
    planning_date = date.today() + timedelta(days=7)
    asset_ids = _create_external_assets(client, admin, suffix, 5, category=category)

    planning_payload = {
        "customerName": f"Kunde Grp {suffix}",
        "projectName": f"Projekt Grp {suffix}",
        "eventName": "Sammel-QR",
        "calendarWeek": planning_date.isocalendar().week,
        "startDate": planning_date.isoformat(),
        "endDate": planning_date.isoformat(),
        "notes": "",
        "status": "Entwurf",
        "days": [
            {
                "planningDate": planning_date.isoformat(),
                "weekday": "Montag",
                "items": [{"categoryKey": category, "qty": 1, "notes": None}],
            }
        ],
    }
    created = client.post("/api/wms/planning", headers=admin, json=planning_payload)
    assert created.status_code == 200, created.text
    planning_id = created.json()["id"]

    # Eigene Kategorie → Basiswert ist genau die Anzahl angelegter Geräte.
    usable_before = _usable_for_category(client, admin, planning_id, category)
    assert usable_before == 5

    group = _create_group(
        client, admin, name="Planungs-Test", category=category, asset_ids=asset_ids
    ).json()

    # Die reine Existenz der Gruppe darf den nutzbaren Bestand NICHT verändern.
    usable_after_group = _usable_for_category(client, admin, planning_id, category)
    assert usable_after_group == usable_before, "Sammel-QR darf keinen zusätzlichen Bestand erzeugen"

    # Ausgabe von 2 Geräten senkt den nutzbaren Bestand um genau 2.
    res = client.post(
        f"/api/wms/qr-groups/{group['id']}/checkout",
        headers=admin,
        json={"quantity": 2},
    )
    assert res.status_code == 200, res.text

    usable_after_checkout = _usable_for_category(client, admin, planning_id, category)
    assert usable_after_checkout == usable_before - 2, (
        "Ausgabe über Sammel-QR muss nutzbaren Bestand um genau die Stückzahl senken"
    )


# -----------------------------------------------------------------------------
# Test 6: Backup/Restore erhält Gruppen + Zuordnungen; Altbackup bleibt gültig
# -----------------------------------------------------------------------------
def _export(client: TestClient, headers: dict[str, str]) -> dict:
    res = client.get("/api/wms/backup/export", headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


def _reset_and_import(client: TestClient, headers: dict[str, str], payload: dict, suffix: str) -> None:
    reset = client.post("/api/wms/backup/reset-for-import", headers=headers)
    assert reset.status_code == 200, reset.text
    backup_bytes = json.dumps(payload).encode("utf-8")
    res = client.post(
        "/api/wms/backup/import",
        headers=headers,
        files={"file": (f"backup-grp-{suffix}.json", io.BytesIO(backup_bytes), "application/json")},
    )
    assert res.status_code == 200, res.text


def test_backup_restore_preserves_groups_and_members() -> None:
    client = TestClient(app)
    admin = _admin(client)
    suffix = uuid4().hex[:8]
    category = _register_category(client, admin, suffix)
    asset_ids = _create_external_assets(client, admin, suffix, 3, category=category)
    group = _create_group(
        client, admin, name="Backup Test", category=category, asset_ids=asset_ids
    ).json()

    backup = _export(client, admin)
    assert "qrCodeGroups" in backup
    backup_group = next((g for g in backup["qrCodeGroups"] if g["id"] == group["id"]), None)
    assert backup_group is not None, "Gruppe muss im Backup enthalten sein"
    assert sorted(backup_group["members"]) == sorted(asset_ids)

    _reset_and_import(client, admin, backup, suffix)

    # Gruppe per Token weiterhin auflösbar, Mitglieder erhalten.
    resolved = client.get(f"/api/wms/qr-groups/resolve/{group['qrToken']}", headers=_admin(client))
    assert resolved.status_code == 200, resolved.text
    body = resolved.json()["group"]
    assert body["memberCount"] == 3
    assert body["availableCount"] == 3


def test_legacy_backup_without_groups_still_imports() -> None:
    client = TestClient(app)
    admin = _admin(client)
    suffix = uuid4().hex[:8]
    category = _register_category(client, admin, suffix)
    asset_ids = _create_external_assets(client, admin, suffix, 2, category=category)
    group = _create_group(
        client, admin, name="Legacy Test", category=category, asset_ids=asset_ids
    ).json()

    backup = _export(client, admin)
    # Altes Backup-Format simulieren: Collection komplett entfernen.
    backup.pop("qrCodeGroups", None)

    _reset_and_import(client, admin, backup, suffix)

    # Import muss erfolgreich sein; die Gruppe existiert danach nicht mehr.
    listing = client.get("/api/wms/qr-groups", headers=_admin(client))
    assert listing.status_code == 200, listing.text
    assert all(g["id"] != group["id"] for g in listing.json())
