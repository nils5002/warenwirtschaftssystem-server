from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


PlanningStatus = Literal["Entwurf", "Geplant", "Bestaetigt", "Abgeschlossen", "Storniert"]
AvailabilityState = Literal["green", "yellow", "red"]


class PlanningItemPayload(BaseModel):
    categoryKey: str = Field(min_length=1, max_length=120)
    qty: int = Field(ge=0)
    notes: str | None = None


class PlanningDayPayload(BaseModel):
    planningDate: date
    weekday: str | None = None
    items: list[PlanningItemPayload] = Field(default_factory=list)


class PlanningUpsertPayload(BaseModel):
    id: str | None = None
    customerName: str = Field(min_length=1, max_length=160)
    projectName: str = Field(min_length=1, max_length=180)
    eventName: str | None = Field(default=None, max_length=180)
    projectManagerUserId: str | None = Field(default=None, max_length=64)
    calendarWeek: int | None = Field(default=None, ge=1, le=53)
    startDate: date
    endDate: date
    notes: str = ""
    status: PlanningStatus = "Entwurf"
    days: list[PlanningDayPayload] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_date_range(self) -> "PlanningUpsertPayload":
        if self.endDate < self.startDate:
            raise ValueError("endDate darf nicht vor startDate liegen")
        return self


class PlanningStatusUpdatePayload(BaseModel):
    status: PlanningStatus


class PlanningItemResponse(BaseModel):
    id: int
    categoryKey: str
    qty: int
    notes: str | None = None


class PlanningDayResponse(BaseModel):
    id: int
    planningDate: date
    weekday: str
    items: list[PlanningItemResponse] = Field(default_factory=list)


class PlanningResponse(BaseModel):
    id: str
    customerName: str
    projectName: str
    eventName: str | None = None
    projectManagerUserId: str | None = None
    calendarWeek: int | None = None
    startDate: date
    endDate: date
    notes: str
    status: PlanningStatus
    templateSourcePlanningId: str | None = None
    createdAt: datetime
    updatedAt: datetime
    days: list[PlanningDayResponse] = Field(default_factory=list)


class PlanningListItem(BaseModel):
    id: str
    customerName: str
    projectName: str
    eventName: str | None = None
    projectManagerUserId: str | None = None
    calendarWeek: int | None = None
    startDate: date
    endDate: date
    status: PlanningStatus
    updatedAt: datetime


class PlanningAvailabilityItem(BaseModel):
    planningDate: date
    weekday: str
    categoryKey: str
    requestedQty: int
    totalStock: int
    usableStock: int
    alreadyPlanned: int
    remainingQty: int
    availabilityState: AvailabilityState
    shortageQty: int


class PlanningAvailabilityCategorySummary(BaseModel):
    categoryKey: str
    requestedTotal: int
    maxRequestedPerDay: int
    totalStock: int
    usableStock: int


class PlanningAvailabilityResponse(BaseModel):
    planningId: str
    periodStart: date
    periodEnd: date
    items: list[PlanningAvailabilityItem] = Field(default_factory=list)
    categorySummary: list[PlanningAvailabilityCategorySummary] = Field(default_factory=list)

