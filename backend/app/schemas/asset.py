from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class AssetBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    category: str = Field(..., min_length=1, max_length=120)
    location: str = Field(..., min_length=1, max_length=120)
    status: str = Field(default="Verfuegbar", max_length=64)
    assigned_to: str = Field(default="-", max_length=120)
    next_return: str = Field(default="-", max_length=120)
    tag_number: str = Field(..., min_length=1, max_length=64)
    serial_number: str = Field(..., min_length=1, max_length=128)
    device_model: str | None = Field(default=None, max_length=255)
    ip_address: str | None = Field(default=None, max_length=64)
    mac_lan: str | None = Field(default=None, max_length=32)
    mac_wlan: str | None = Field(default=None, max_length=32)
    qr_code: str = Field(default="", max_length=255)
    maintenance_state: str = Field(default="", max_length=255)
    notes: str = Field(default="")
    last_checkout: str = Field(default="-", max_length=120)
    next_reservation: str = Field(default="-", max_length=120)
    source_file: str | None = Field(default=None, max_length=255)


class AssetCreate(AssetBase):
    external_id: str | None = Field(default=None, max_length=64)


class AssetUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    category: str | None = Field(default=None, min_length=1, max_length=120)
    location: str | None = Field(default=None, min_length=1, max_length=120)
    status: str | None = Field(default=None, max_length=64)
    assigned_to: str | None = Field(default=None, max_length=120)
    next_return: str | None = Field(default=None, max_length=120)
    device_model: str | None = Field(default=None, max_length=255)
    ip_address: str | None = Field(default=None, max_length=64)
    mac_lan: str | None = Field(default=None, max_length=32)
    mac_wlan: str | None = Field(default=None, max_length=32)
    maintenance_state: str | None = Field(default=None, max_length=255)
    notes: str | None = None
    last_checkout: str | None = Field(default=None, max_length=120)
    next_reservation: str | None = Field(default=None, max_length=120)
    source_file: str | None = Field(default=None, max_length=255)


class AssetRead(AssetBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    external_id: str | None = None
    created_at: datetime
    updated_at: datetime
