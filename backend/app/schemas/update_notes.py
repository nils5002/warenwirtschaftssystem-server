"""Schritt E: Schemas für admin-pflegbare Update-Notes (Versionshinweise)."""

from __future__ import annotations

from datetime import date as DateType, datetime

from pydantic import BaseModel, field_validator


def _clean_items(value: list[str]) -> list[str]:
    cleaned = [str(item).strip() for item in value if str(item).strip()]
    if not cleaned:
        raise ValueError("Mindestens ein Punkt ist erforderlich.")
    return cleaned


def _clean_version(value: str) -> str:
    cleaned = str(value).strip()
    if not cleaned:
        raise ValueError("Version darf nicht leer sein.")
    return cleaned


class UpdateNoteResponse(BaseModel):
    id: str
    version: str
    date: DateType | None = None
    title: str | None = None
    items: list[str]
    isPublished: bool
    publishedAt: datetime | None = None
    createdAt: datetime
    updatedAt: datetime


class UpdateNoteCreatePayload(BaseModel):
    version: str
    date: DateType | None = None
    title: str | None = None
    items: list[str]

    @field_validator("version")
    @classmethod
    def _v(cls, value: str) -> str:
        return _clean_version(value)

    @field_validator("items")
    @classmethod
    def _i(cls, value: list[str]) -> list[str]:
        return _clean_items(value)


class UpdateNoteUpdatePayload(BaseModel):
    version: str | None = None
    date: DateType | None = None
    title: str | None = None
    items: list[str] | None = None

    @field_validator("version")
    @classmethod
    def _v(cls, value: str | None) -> str | None:
        return _clean_version(value) if value is not None else None

    @field_validator("items")
    @classmethod
    def _i(cls, value: list[str] | None) -> list[str] | None:
        return _clean_items(value) if value is not None else None
