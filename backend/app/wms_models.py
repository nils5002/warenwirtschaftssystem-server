"""
Legacy compatibility module.

Prefer importing from `app.schemas.wms`.
"""

from .schemas.wms import (  # noqa: F401
    ActivityItem,
    AssetItem,
    LocationItem,
    MaintenanceItem,
    ReservationItem,
    UserItem,
    WmsOverviewResponse,
)

