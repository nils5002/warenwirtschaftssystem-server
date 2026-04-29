"""
Legacy compatibility wrapper.

Prefer `app.repositories.asset_repository`.
"""

from ..repositories.asset_repository import (  # noqa: F401
    create_asset,
    delete_asset,
    get_asset,
    list_assets,
    update_asset,
)

