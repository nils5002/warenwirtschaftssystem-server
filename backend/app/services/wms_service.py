from __future__ import annotations

import logging
from pathlib import Path

from sqlalchemy.orm import Session

from fastapi import HTTPException

from datetime import date

from ..config.settings import get_settings
from ..repositories import category_repository, wms_repository
from ..schemas.wms import (
    ActivityItem,
    AssetItem,
    BulkAssetDeleteResponse,
    BulkAssetDeleteResultItem,
    BulkUserDeleteResponse,
    BulkUserDeleteResultItem,
    ExternalPoolCreatePayload,
    CategoryItem,
    LocationCleanupResponse,
    LocationItem,
    MaintenanceItem,
    ReservationItem,
    UserPasswordResetResponse,
    UserUpdatePayload,
    UserItem,
    WmsOverviewResponse,
)
from . import overview_cache

logger = logging.getLogger("cloud_web.wms")


class WmsService:
    """Domain orchestration for WMS data backed by the SQL database."""

    @staticmethod
    def overview(db: Session) -> WmsOverviewResponse:
        # Kurzlebiger Prozess-Cache (services/overview_cache.py): mehrere
        # gleichzeitig pollende Clients teilen sich EINE Berechnung pro
        # TTL-Fenster, statt den Single-Worker-Endpoint zu serialisieren.
        # Invalidierung erfolgt automatisch nach jeder Schreibtransaktion.
        return overview_cache.get_or_build(
            lambda: wms_repository.get_overview(db),
            get_settings().overview_cache_ttl_seconds,
        )

    @staticmethod
    def list_assets(db: Session) -> list[AssetItem]:
        return wms_repository.list_assets(db)

    @staticmethod
    def get_asset(db: Session, asset_id: str) -> AssetItem | None:
        return wms_repository.get_asset(db, asset_id)

    @staticmethod
    def upsert_asset(db: Session, asset: AssetItem, *, actor_user_id: str | None = None) -> AssetItem:
        return wms_repository.upsert_asset(db, asset, actor_user_id=actor_user_id)

    @staticmethod
    def delete_asset(db: Session, asset_id: str) -> bool:
        return wms_repository.delete_asset(db, asset_id)

    @staticmethod
    def bulk_delete_assets(
        db: Session,
        asset_ids: list[str],
        *,
        actor_role: str,
    ) -> BulkAssetDeleteResponse:
        unique_ids: list[str] = []
        seen: set[str] = set()
        for raw in asset_ids or []:
            if not isinstance(raw, str):
                continue
            trimmed = raw.strip()
            if not trimmed or trimmed in seen:
                continue
            seen.add(trimmed)
            unique_ids.append(trimmed)

        results: list[BulkAssetDeleteResultItem] = []
        deleted_count = 0
        skipped_count = 0
        for asset_id in unique_ids:
            asset = wms_repository.get_asset(db, asset_id)
            if asset is None:
                results.append(
                    BulkAssetDeleteResultItem(
                        assetId=asset_id,
                        deleted=False,
                        reason="Gerät nicht gefunden.",
                    )
                )
                skipped_count += 1
                continue

            is_external = asset.ownershipType in {"rented", "borrowed", "external"}
            if actor_role == "projektmanager" and not is_external:
                results.append(
                    BulkAssetDeleteResultItem(
                        assetId=asset_id,
                        deleted=False,
                        reason="Projektmanager dürfen nur Fremdbestand löschen.",
                    )
                )
                skipped_count += 1
                continue

            if is_external and asset.status == "Verliehen":
                results.append(
                    BulkAssetDeleteResultItem(
                        assetId=asset_id,
                        deleted=False,
                        reason="Dieses Gerät ist aktuell ausgegeben und kann erst nach Rücknahme gelöscht werden.",
                    )
                )
                skipped_count += 1
                continue

            deleted = wms_repository.delete_asset(db, asset_id)
            if deleted:
                results.append(BulkAssetDeleteResultItem(assetId=asset_id, deleted=True))
                deleted_count += 1
            else:
                results.append(
                    BulkAssetDeleteResultItem(
                        assetId=asset_id,
                        deleted=False,
                        reason="Gerät nicht gefunden.",
                    )
                )
                skipped_count += 1

        return BulkAssetDeleteResponse(
            deletedCount=deleted_count,
            skippedCount=skipped_count,
            results=results,
        )

    @staticmethod
    def create_external_pool(db: Session, payload: ExternalPoolCreatePayload) -> list[str]:
        """Erzeugt eine Charge Fremdbestand-Geräte (Miet/Leih/Extern)."""
        return wms_repository.create_external_pool(
            db,
            category=payload.category,
            ownership_type=payload.ownershipType,
            count=payload.count,
            name_prefix=payload.namePrefix,
            location=payload.location,
            available_from=payload.availableFrom,
            available_until=payload.availableUntil,
            return_due_date=payload.returnDueDate,
            source_name=payload.sourceName,
            external_note=payload.externalNote,
        )

    @staticmethod
    def mark_asset_returned(
        db: Session,
        asset_id: str,
        *,
        returned_at: date | None = None,
    ) -> AssetItem:
        """Markiert ein Fremdbestand-Gerät als zurückgegeben."""
        return wms_repository.mark_asset_returned(db, asset_id, returned_at=returned_at)

    @staticmethod
    def list_reservations(db: Session) -> list[ReservationItem]:
        return wms_repository.list_reservations(db)

    @staticmethod
    def upsert_reservation(db: Session, reservation: ReservationItem) -> ReservationItem:
        return wms_repository.upsert_reservation(db, reservation)

    @staticmethod
    def delete_reservation(db: Session, reservation_id: str) -> bool:
        return wms_repository.delete_reservation(db, reservation_id)

    @staticmethod
    def list_maintenance(db: Session) -> list[MaintenanceItem]:
        return wms_repository.list_maintenance(db)

    @staticmethod
    def upsert_maintenance(db: Session, maintenance: MaintenanceItem) -> MaintenanceItem:
        return wms_repository.upsert_maintenance(db, maintenance)

    @staticmethod
    def delete_maintenance(db: Session, maintenance_id: str) -> bool:
        return wms_repository.delete_maintenance(db, maintenance_id)

    @staticmethod
    def list_locations(db: Session) -> list[LocationItem]:
        return wms_repository.list_locations(db)

    @staticmethod
    def list_categories(db: Session) -> list[CategoryItem]:
        return category_repository.list_categories(db)

    @staticmethod
    def create_category(db: Session, name: str) -> CategoryItem:
        return category_repository.create_category(db, name)

    @staticmethod
    def update_category_default_image(
        db: Session,
        category_id: int,
        source_url: str | None,
    ) -> CategoryItem:
        return category_repository.update_category_default_image(db, category_id, source_url)

    @staticmethod
    def refresh_category_default_image(db: Session, category_id: int) -> CategoryItem:
        return category_repository.refresh_category_default_image(db, category_id)

    @staticmethod
    def refresh_asset_product_image(db: Session, asset_id: str) -> AssetItem:
        return wms_repository.refresh_asset_product_image(db, asset_id)

    @staticmethod
    def delete_category(db: Session, category_id: int) -> dict[str, object]:
        return category_repository.delete_category(db, category_id)

    @staticmethod
    def upsert_location(db: Session, location: LocationItem) -> LocationItem:
        return wms_repository.upsert_location(db, location)

    @staticmethod
    def delete_location(db: Session, name: str) -> bool:
        return wms_repository.delete_location(db, name)

    @staticmethod
    def cleanup_unused_locations(db: Session, *, keep_name: str = "Hauptlager") -> LocationCleanupResponse:
        kept_location, deleted_locations, skipped_locations = wms_repository.cleanup_unused_locations(
            db,
            keep_name=keep_name,
        )
        return LocationCleanupResponse(
            keptLocation=kept_location,
            deletedLocations=deleted_locations,
            skippedLocations=skipped_locations,
        )

    @staticmethod
    def list_users(db: Session) -> list[UserItem]:
        return wms_repository.list_users(db)

    @staticmethod
    def upsert_user(db: Session, user: UserItem) -> UserItem:
        return wms_repository.upsert_user(db, user)

    @staticmethod
    def update_user(
        db: Session,
        user_id: str,
        payload: UserUpdatePayload,
        *,
        actor_user_id: str | None = None,
    ) -> UserItem:
        return wms_repository.update_user(
            db,
            user_id,
            name=payload.name,
            email=payload.email,
            role=payload.role,
            status=payload.status,
            department=payload.department,
            location=payload.location,
            signature_color=payload.signatureColor,
            actor_user_id=actor_user_id,
        )

    @staticmethod
    def reset_user_password(
        db: Session,
        user_id: str,
        *,
        new_password: str | None = None,
        generate_temporary: bool = False,
    ) -> UserPasswordResetResponse:
        temporary_password = wms_repository.reset_user_password(
            db,
            user_id,
            new_password=new_password,
            generate_temporary=generate_temporary,
        )
        return UserPasswordResetResponse(temporaryPassword=temporary_password)

    @staticmethod
    def delete_user(db: Session, user_id: str, actor_user_id: str | None = None) -> bool:
        return wms_repository.delete_user(db, user_id, actor_user_id=actor_user_id)

    @staticmethod
    def approve_user(db: Session, user_id: str, actor_user_id: str | None = None) -> UserItem:
        return wms_repository.approve_user(db, user_id, actor_user_id=actor_user_id)

    @staticmethod
    def reject_user(db: Session, user_id: str, actor_user_id: str | None = None) -> UserItem:
        return wms_repository.reject_user(db, user_id, actor_user_id=actor_user_id)

    @staticmethod
    def lock_user(db: Session, user_id: str, actor_user_id: str | None = None) -> UserItem:
        return wms_repository.lock_user(db, user_id, actor_user_id=actor_user_id)

    @staticmethod
    def unlock_user(db: Session, user_id: str, actor_user_id: str | None = None) -> UserItem:
        return wms_repository.unlock_user(db, user_id, actor_user_id=actor_user_id)

    @staticmethod
    def get_user_security_info(db: Session, user_id: str):
        return wms_repository.get_user_security_info(db, user_id)

    @staticmethod
    def bulk_delete_users(
        db: Session,
        user_ids: list[str],
        actor_user_id: str | None = None,
    ) -> BulkUserDeleteResponse:
        unique_ids: list[str] = []
        seen: set[str] = set()
        for raw in user_ids or []:
            if not isinstance(raw, str):
                continue
            trimmed = raw.strip()
            if not trimmed or trimmed in seen:
                continue
            seen.add(trimmed)
            unique_ids.append(trimmed)

        results: list[BulkUserDeleteResultItem] = []
        deleted_count = 0
        skipped_count = 0
        for user_id in unique_ids:
            try:
                deleted = wms_repository.delete_user(db, user_id, actor_user_id=actor_user_id)
            except HTTPException as exc:
                results.append(
                    BulkUserDeleteResultItem(
                        userId=user_id,
                        deleted=False,
                        reason=str(exc.detail),
                    )
                )
                skipped_count += 1
                continue
            if deleted:
                results.append(BulkUserDeleteResultItem(userId=user_id, deleted=True))
                deleted_count += 1
            else:
                results.append(
                    BulkUserDeleteResultItem(
                        userId=user_id,
                        deleted=False,
                        reason="Benutzer nicht gefunden.",
                    )
                )
                skipped_count += 1
        return BulkUserDeleteResponse(
            deletedCount=deleted_count,
            skippedCount=skipped_count,
            results=results,
        )

    @staticmethod
    def list_activities(db: Session) -> list[ActivityItem]:
        return wms_repository.list_activities(db)

    @staticmethod
    def upsert_activity(db: Session, activity: ActivityItem) -> ActivityItem:
        return wms_repository.upsert_activity(db, activity)

    @staticmethod
    def delete_activity(db: Session, activity_id: str) -> bool:
        return wms_repository.delete_activity(db, activity_id)

    @staticmethod
    def seed_from_legacy_json_if_needed(db: Session, legacy_path: Path) -> None:
        category_repository.seed_standard_categories(db)
        if wms_repository.has_wms_data(db):
            return
        result = wms_repository.seed_from_legacy_json(db, legacy_path)
        if result["created"] > 0:
            logger.info("WMS legacy seed imported %s records from %s", result["created"], legacy_path)
