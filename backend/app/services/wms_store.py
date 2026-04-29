from __future__ import annotations

"""
LEGACY JSON persistence store.

This module is kept for transition support only.
Active WMS endpoints use the SQL-backed repository/service layer.
"""

import json
from pathlib import Path
from threading import RLock
from typing import Any, Dict, List, TypeVar

from ..wms_models import (
    ActivityItem,
    AssetItem,
    LocationItem,
    MaintenanceItem,
    ReservationItem,
    UserItem,
    WmsOverviewResponse,
)

T = TypeVar("T")


def _build_qr_code(asset_id: str, tag_number: str) -> str:
    return f"WMS|{asset_id}|{tag_number}"


def _normalize_asset(asset: AssetItem) -> AssetItem:
    qr_code = (asset.qrCode or "").strip()
    if qr_code:
        return asset
    return asset.model_copy(update={"qrCode": _build_qr_code(asset.id, asset.tagNumber)})


def _seed_overview() -> WmsOverviewResponse:
    return WmsOverviewResponse(
        assets=[
            AssetItem(
                id="asset-001",
                name="MacBook Pro 14 M3",
                category="Laptop",
                location="Hauptlager",
                status="Verfuegbar",
                assignedTo="-",
                nextReturn="-",
                tagNumber="HW-1001",
                serialNumber="C02XJ1A9MD6T",
                qrCode="WMS|asset-001|HW-1001",
                maintenanceState="Geprueft am 03.03.2026",
                notes="Standard-Deployment, 16 GB RAM, 512 GB SSD.",
                lastCheckout="28.02.2026",
                nextReservation="12.03.2026 - Marketing Team",
            ),
            AssetItem(
                id="asset-002",
                name="Epson WorkForce Pro",
                category="Drucker",
                location="Buero",
                status="Ausgegeben",
                assignedTo="IT-Support",
                nextReturn="10.03.2026",
                tagNumber="HW-1042",
                serialNumber="EP-7XA2-441",
                qrCode="WMS|asset-002|HW-1042",
                maintenanceState="Toner tauschen geplant",
                notes="Nutzt Duplex standardmaessig, WLAN deaktiviert.",
                lastCheckout="05.03.2026",
                nextReservation="11.03.2026 - Finance",
            ),
            AssetItem(
                id="asset-003",
                name="Zebra DS2278",
                category="QR-Code-Scanner",
                location="Eventlager",
                status="Reserviert",
                assignedTo="Event-Team Nord",
                nextReturn="13.03.2026",
                tagNumber="HW-2104",
                serialNumber="ZB-442-98XA",
                qrCode="WMS|asset-003|HW-2104",
                maintenanceState="Alles OK",
                notes="Wireless Docking Station inklusive.",
                lastCheckout="20.02.2026",
                nextReservation="09.03.2026 - Messe Hamburg",
            ),
            AssetItem(
                id="asset-004",
                name="Honeywell CT30 XP",
                category="QR-Code-Scanner",
                location="Fahrzeug 2",
                status="Unterwegs",
                assignedTo="Roadshow Team",
                nextReturn="09.03.2026",
                tagNumber="HW-3109",
                serialNumber="HWL-CT30-771",
                qrCode="WMS|asset-004|HW-3109",
                maintenanceState="Batterie 84%",
                notes="Transportkoffer mit Ladegeraet beigelegt.",
                lastCheckout="02.03.2026",
                nextReservation="15.03.2026 - Service Team",
            ),
            AssetItem(
                id="asset-005",
                name="iPad Air 11",
                category="iPad",
                location="Ausseneinsatz",
                status="In Wartung",
                assignedTo="Werkstatt",
                nextReturn="Unbekannt",
                tagNumber="HW-1217",
                serialNumber="IPA-4TH-2026",
                qrCode="WMS|asset-005|HW-1217",
                maintenanceState="Displayreparatur laeuft",
                notes="Display gesprungen nach Event-Aufbau.",
                lastCheckout="21.02.2026",
                nextReservation="-",
            ),
            AssetItem(
                id="asset-006",
                name="Dell Latitude 7440",
                category="Laptop",
                location="Hauptlager",
                status="Defekt",
                assignedTo="-",
                nextReturn="-",
                tagNumber="HW-1129",
                serialNumber="DL-7440-991",
                qrCode="WMS|asset-006|HW-1129",
                maintenanceState="Mainboard pruefen",
                notes="Startet nicht mehr, Boot-Loop.",
                lastCheckout="11.02.2026",
                nextReservation="-",
            ),
        ],
        activities=[
            ActivityItem(
                id="act-1",
                title="Check-out abgeschlossen",
                detail="MacBook Pro 14 M3 wurde an Design Team ausgegeben.",
                timestamp="Heute, 08:42",
                assetId="asset-001",
            ),
            ActivityItem(
                id="act-2",
                title="Rueckgabe erhalten",
                detail="Zebra DS2278 eingelagert und geprueft.",
                timestamp="Heute, 09:16",
                assetId="asset-003",
            ),
            ActivityItem(
                id="act-3",
                title="Defekt gemeldet",
                detail="Dell Latitude 7440 startet nicht mehr.",
                timestamp="Heute, 10:05",
                assetId="asset-006",
            ),
        ],
        reservations=[
            ReservationItem(
                id="res-2001",
                requestedBy="Anna Weiss",
                team="Marketing Team",
                period="12.03.2026 - 14.03.2026",
                assets=["MacBook Pro 14 M3", "Samsung Galaxy Tab S9"],
                status="Bestaetigt",
                location="Messe Berlin",
            ),
            ReservationItem(
                id="res-2002",
                requestedBy="Luca Berger",
                team="Event-Team Nord",
                period="09.03.2026 - 13.03.2026",
                assets=["Zebra DS2278", "Atem Mini Pro ISO"],
                status="Aktiv",
                location="Hamburg Messehalle A2",
            ),
        ],
        maintenanceItems=[
            MaintenanceItem(
                id="mnt-01",
                assetName="iPad Air 11",
                issue="Displaybruch links unten",
                reportedAt="04.03.2026",
                dueDate="11.03.2026",
                priority="Hoch",
                status="In Arbeit",
                comment="Ersatzteil bestellt, Einbau fuer Dienstag geplant.",
                location="Werkstatt",
            ),
            MaintenanceItem(
                id="mnt-02",
                assetName="Dell Latitude 7440",
                issue="Boot-Loop / kein POST",
                reportedAt="06.03.2026",
                dueDate="12.03.2026",
                priority="Kritisch",
                status="Offen",
                comment="Diagnose durch externen Service erforderlich.",
                location="Hauptlager",
            ),
        ],
        locations=[
            LocationItem(
                name="Hauptlager",
                capacity="220 Slots",
                assignedAssets=128,
                availableAssets=87,
                manager="Nils Kramer",
            ),
            LocationItem(
                name="Eventlager",
                capacity="140 Slots",
                assignedAssets=91,
                availableAssets=21,
                manager="Lara Meier",
            ),
            LocationItem(
                name="Buero",
                capacity="70 Slots",
                assignedAssets=52,
                availableAssets=9,
                manager="Office IT",
            ),
        ],
        users=[
            UserItem(
                id="usr-01",
                name="Nils Kramer",
                email="nils.kramer@atlasops.io",
                role="Admin",
                lastActive="Heute, 11:25",
                status="Aktiv",
            ),
            UserItem(
                id="usr-02",
                name="Lara Meier",
                email="lara.meier@atlasops.io",
                role="Lager / Logistik",
                lastActive="Heute, 10:58",
                status="Aktiv",
            ),
        ],
    )


class WmsStore:
    def __init__(self, db_path: Path):
        self._db_path = db_path
        self._lock = RLock()
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        if not self._db_path.exists():
            self._data = _seed_overview()
            self._ensure_asset_qr_locked()
            self._save_locked()
        else:
            self._data = self._load_or_seed()
            with self._lock:
                if self._ensure_asset_qr_locked():
                    self._save_locked()

    def _load_or_seed(self) -> WmsOverviewResponse:
        try:
            payload = json.loads(self._db_path.read_text(encoding="utf-8"))
            return WmsOverviewResponse.model_validate(payload)
        except Exception:
            data = _seed_overview()
            self._data = data
            self._save_locked()
            return data

    def _save_locked(self) -> None:
        self._db_path.write_text(
            json.dumps(self._data.model_dump(), ensure_ascii=True, indent=2),
            encoding="utf-8",
        )

    def overview(self) -> WmsOverviewResponse:
        with self._lock:
            self._ensure_asset_qr_locked()
            return WmsOverviewResponse.model_validate(self._data.model_dump())

    def list_assets(self) -> List[AssetItem]:
        return self.overview().assets

    def get_asset(self, asset_id: str) -> AssetItem | None:
        with self._lock:
            for item in self._data.assets:
                if item.id == asset_id:
                    return item
        return None

    def upsert_asset(self, asset: AssetItem) -> AssetItem:
        with self._lock:
            normalized = _normalize_asset(asset)
            self._upsert_by_id(self._data.assets, normalized)
            self._save_locked()
            return normalized

    def delete_asset(self, asset_id: str) -> bool:
        with self._lock:
            changed = self._delete_by_id(self._data.assets, asset_id)
            if changed:
                self._save_locked()
            return changed

    def list_reservations(self) -> List[ReservationItem]:
        return self.overview().reservations

    def upsert_reservation(self, reservation: ReservationItem) -> ReservationItem:
        with self._lock:
            self._upsert_by_id(self._data.reservations, reservation)
            self._save_locked()
            return reservation

    def delete_reservation(self, reservation_id: str) -> bool:
        with self._lock:
            changed = self._delete_by_id(self._data.reservations, reservation_id)
            if changed:
                self._save_locked()
            return changed

    def list_maintenance(self) -> List[MaintenanceItem]:
        return self.overview().maintenanceItems

    def upsert_maintenance(self, maintenance: MaintenanceItem) -> MaintenanceItem:
        with self._lock:
            self._upsert_by_id(self._data.maintenanceItems, maintenance)
            self._save_locked()
            return maintenance

    def delete_maintenance(self, maintenance_id: str) -> bool:
        with self._lock:
            changed = self._delete_by_id(self._data.maintenanceItems, maintenance_id)
            if changed:
                self._save_locked()
            return changed

    def list_users(self) -> List[UserItem]:
        return self.overview().users

    def upsert_user(self, user: UserItem) -> UserItem:
        with self._lock:
            self._upsert_by_id(self._data.users, user)
            self._save_locked()
            return user

    def delete_user(self, user_id: str) -> bool:
        with self._lock:
            changed = self._delete_by_id(self._data.users, user_id)
            if changed:
                self._save_locked()
            return changed

    def list_locations(self) -> List[LocationItem]:
        return self.overview().locations

    def upsert_location(self, location: LocationItem) -> LocationItem:
        with self._lock:
            updated = False
            for idx, item in enumerate(self._data.locations):
                if item.name == location.name:
                    self._data.locations[idx] = location
                    updated = True
                    break
            if not updated:
                self._data.locations.append(location)
            self._save_locked()
            return location

    def delete_location(self, name: str) -> bool:
        with self._lock:
            before = len(self._data.locations)
            self._data.locations = [item for item in self._data.locations if item.name != name]
            changed = len(self._data.locations) != before
            if changed:
                self._save_locked()
            return changed

    def list_activities(self) -> List[ActivityItem]:
        return self.overview().activities

    def upsert_activity(self, activity: ActivityItem) -> ActivityItem:
        with self._lock:
            self._upsert_by_id(self._data.activities, activity)
            self._save_locked()
            return activity

    def delete_activity(self, activity_id: str) -> bool:
        with self._lock:
            changed = self._delete_by_id(self._data.activities, activity_id)
            if changed:
                self._save_locked()
            return changed

    @staticmethod
    def _upsert_by_id(items: List[T], candidate: T) -> None:
        candidate_id = getattr(candidate, "id")
        for idx, item in enumerate(items):
            if getattr(item, "id") == candidate_id:
                items[idx] = candidate
                return
        items.append(candidate)

    @staticmethod
    def _delete_by_id(items: List[T], item_id: str) -> bool:
        before = len(items)
        items[:] = [item for item in items if getattr(item, "id") != item_id]
        return len(items) != before

    def _ensure_asset_qr_locked(self) -> bool:
        changed = False
        for idx, asset in enumerate(self._data.assets):
            normalized = _normalize_asset(asset)
            if normalized.qrCode != asset.qrCode:
                self._data.assets[idx] = normalized
                changed = True
        return changed
