from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from ..domain.conflict_classification import ConflictReason, ConflictSeverity


PlanningStatus = Literal["Entwurf", "Geplant", "Bestaetigt", "Abgeschlossen", "Storniert"]
AvailabilityState = Literal["green", "yellow", "red"]
HandoverStatusValue = Literal["none", "planned", "missing_link", "organizational"]


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


class ConflictBadge(BaseModel):
    """Ein einzelnes Schweregrad-Badge (Primaer oder Sekundaer)."""

    severity: ConflictSeverity
    reason: ConflictReason
    label: str


class PlanningConflictDetail(BaseModel):
    """Eine einzelne Konfliktzelle (Tag x Kategorie) mit Schweregrad-Einordnung.

    Additiv zu ``missingItems``: ``missingItems`` bleibt unveraendert (eine Zeile
    je Kategorie, schlimmster Tag), ``conflicts`` haelt jede Konfliktzelle
    einzeln samt Klassifikation. Aendert nicht, was als Konflikt zaehlt — die
    Anzahl harter Eintraege entspricht ``openConflictCount``.
    """

    categoryKey: str
    conflictDay: date
    shortageReason: ConflictReason
    conflictSeverity: ConflictSeverity
    conflictLabel: str
    unresolvedShortageQty: int
    # Globale konkurrierende Tagesmenge (Summe über ALLE Planungen) und der an
    # diesem Tag/dieser Kategorie nutzbare Bestand. Additiv — speisen die
    # Konfliktursachen-Gruppierung. NICHT der Eigenbedarf dieser Planung.
    totalRequiredQty: int = 0
    usableStock: int = 0
    handoverCoverageQty: int = 0
    handoverStatus: HandoverStatusValue = "none"
    handoverEnabled: bool = False
    excludedQty: int = 0
    excludedFromPlanningQty: int = 0
    cardPrinterRequiredQty: int = 0
    cardPrinterUpliftQty: int = 0
    secondary: list[ConflictBadge] = Field(default_factory=list)


class ConflictGroupDay(BaseModel):
    """Tagesdetail innerhalb einer Konfliktursache."""

    date: date
    requiredQty: int
    usableStock: int
    missingQty: int
    affectedPlanningIds: list[str] = Field(default_factory=list)


class ConflictGroup(BaseModel):
    """Eine fachliche Konfliktursache — gebündelt über mehrere Planungen.

    Mehrere technische Konflikte (Tag x Kategorie x Planung) können dieselbe
    Ursache haben (z. B. ein gemeinsamer Pool-Engpass an aufeinanderfolgenden
    Tagen). Eine ConflictGroup fasst die zusammenhängenden Konfliktzellen einer
    Kategorie zusammen. Rein additiv: ändert ``openConflictCount`` nicht — die
    Summe von ``totalConflictEvents`` über alle Gruppen entspricht exakt
    ``openConflictCount``.
    """

    id: str
    categoryKey: str
    dateFrom: date
    dateTo: date
    maxMissingQty: int
    totalConflictEvents: int
    affectedPlanningCount: int
    affectedPlanningIds: list[str] = Field(default_factory=list)
    affectedPlanningLabels: list[str] = Field(default_factory=list)
    days: list[ConflictGroupDay] = Field(default_factory=list)


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
    # Additiv (Konfliktanzeige-Verbesserung): je Konfliktzelle ein klassifizierter
    # Eintrag. Anzahl harter Eintraege == openConflictCount. Alte Clients ignorieren
    # das Feld; neue Clients nutzen es fuer die kompakte Konfliktliste der Karte.
    conflicts: list[PlanningConflictDetail] = Field(default_factory=list)


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
    # Mindestbedarf-Kopplung Kartendrucker → Laptop (1:1). Auf Laptop-Zeilen
    # gesetzt: Anzahl Kartendrucker an diesem Tag (informativ). Auf allen
    # anderen Kategorien 0.
    cardPrinterRequiredQty: int = 0
    # Differenz, um die der Laptop-Bedarf wegen der Kartendrucker-Kopplung
    # angehoben wurde. > 0 triggert den UI-Hinweis "Für N Kartendrucker
    # werden mindestens N kompatible Laptops benötigt".
    cardPrinterUpliftQty: int = 0
    # Schweregrad-Einordnung (additiv, Konfliktanzeige-Verbesserung). Bei reinen
    # grünen Zellen bleiben diese Felder None/leer. Bei einer Konfliktzelle bzw.
    # einer erklärenden Kontextzeile liefert der zentrale Klassifikator
    # (domain/conflict_classification.py) Primär-Severity + Sekundär-Badges.
    conflictDay: date | None = None
    shortageReason: ConflictReason | None = None
    conflictSeverity: ConflictSeverity | None = None
    conflictLabel: str | None = None
    secondary: list[ConflictBadge] = Field(default_factory=list)


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
