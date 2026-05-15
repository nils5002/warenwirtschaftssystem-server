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
    handoverEnabled: bool = False
    linkedPlanningId: str | None = Field(default=None, max_length=64)
    handoverNote: str | None = Field(default=None, max_length=400)


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
    handoverEnabled: bool = False
    linkedPlanningId: str | None = None
    linkedPlanningLabel: str | None = None
    handoverNote: str | None = None


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


class PlanningListHandoverSummary(BaseModel):
    direction: Literal["outgoing", "incoming", "mixed"]
    partnerPlanningId: str | None = None
    partnerPlanningLabel: str | None = None
    partnerPlanningCount: int = 0
    categoryKeys: list[str] = Field(default_factory=list)


class PlanningListMissingItem(BaseModel):
    categoryKey: str
    missingQty: int
    requiredQty: int = 0
    availableQty: int = 0


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
    handoverSummary: PlanningListHandoverSummary | None = None
    openConflictCount: int = 0
    missingItems: list[PlanningListMissingItem] = Field(default_factory=list)


class PlanningAvailabilityItem(BaseModel):
    planningDate: date
    weekday: str
    categoryKey: str
    requestedQty: int
    totalStock: int
    usableStock: int
    alreadyPlanned: int
    remainingQty: int
    currentPlanningQty: int = 0
    otherPlannedQty: int = 0
    totalPlannedQtyForDateCategory: int = 0
    remainingAfterAllPlanning: int = 0
    availabilityState: AvailabilityState
    shortageQty: int
    hasGlobalShortage: bool = False
    affectedPlanningIds: list[str] = Field(default_factory=list)
    handoverEnabled: bool = False
    linkedPlanningId: str | None = None
    linkedPlanningLabel: str | None = None
    handoverNote: str | None = None
    # "organizational" markiert eine bewusst dokumentierte Übergabe zwischen
    # zwei Planungen OHNE Zeitraum-Überlapp (z. B. Südwestfalen → PSD HT). Sie
    # entlastet keinen Konflikt (handoverCoveredQty bleibt 0), bleibt aber
    # sichtbar, damit die Verbindung in der UI nachvollziehbar ist.
    handoverStatus: Literal["none", "planned", "missing_link", "organizational"] = "none"
    handoverCoveredQty: int = 0
    shortageAfterHandoverQty: int = 0
    # Anzahl Geräte, die für DIESE Bedarfszeile vom Bestand ausgeschlossen
    # wurden (z. B. Kartendrucker-inkompatible Laptops in Projekten mit
    # Kartendrucker). Ist 0 für alle Kategorien/Projekte, die keine
    # Inkompatibilität triggern — Frontend kann das Feld optional ignorieren.
    excludedQty: int = 0
    # Anzahl Geräte, die GLOBAL aus der Einsatzplanung ausgeschlossen sind
    # (available_for_planning=False, z. B. interne Server-Laptops). Wird VOR
    # dem Kartendrucker-Filter berechnet — das heißt, ein global
    # ausgeschlossenes Gerät zählt nie auch noch zusätzlich in excludedQty.
    excludedFromPlanningQty: int = 0


class PlanningAvailabilityCategorySummary(BaseModel):
    categoryKey: str
    requestedTotal: int
    maxRequestedPerDay: int
    totalStock: int
    usableStock: int
    # Repräsentativwert (Maximum über alle Tage) der für diese Bedarfszeile
    # ausgeschlossenen Geräte. Default 0 = keine Einschränkung.
    excludedFromUsable: int = 0
    # Repräsentativwert (Maximum über alle Tage) der global aus der Planung
    # ausgeschlossenen Geräte dieser Kategorie.
    excludedFromPlanningTotal: int = 0


class PlanningAvailabilityResponse(BaseModel):
    planningId: str
    periodStart: date
    periodEnd: date
    items: list[PlanningAvailabilityItem] = Field(default_factory=list)
    categorySummary: list[PlanningAvailabilityCategorySummary] = Field(default_factory=list)
