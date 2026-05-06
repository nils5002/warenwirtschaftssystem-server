from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


AssetStatus = Literal[
    "Verfuegbar",
    "Verliehen",
    "In Wartung",
    "Defekt",
    "Reserviert",
    "Ausgegeben",
    "Unterwegs",
    "Verloren",
]
ReservationStatus = Literal["Angefragt", "Bestaetigt", "Aktiv", "Abgeschlossen", "Storniert"]
MaintenancePriority = Literal["Niedrig", "Mittel", "Hoch", "Kritisch"]
MaintenanceStatus = Literal[
    "Offen",
    "In Bearbeitung",
    "Erledigt",
    "In Arbeit",
    "Wartet auf Teile",
    "Abgeschlossen",
]
UserRole = Literal["Admin", "Projektmanager", "Mitarbeiter"]
UserStatus = Literal["Aktiv", "Inaktiv", "Wartet auf Freigabe"]


class AssetItem(BaseModel):
    id: str
    name: str
    category: str
    location: str
    status: AssetStatus
    assignedTo: str
    nextReturn: str
    tagNumber: str
    serialNumber: str
    model: Optional[str] = None
    ipAddress: Optional[str] = None
    macLan: Optional[str] = None
    macWlan: Optional[str] = None
    qrCode: str = ""
    maintenanceState: str
    notes: str
    lastCheckout: str
    nextReservation: str
    sourceFile: Optional[str] = None


class ActivityItem(BaseModel):
    id: str
    title: str
    detail: str
    timestamp: str
    assetId: Optional[str] = None


class ReservationItem(BaseModel):
    id: str
    requestedBy: str
    team: str
    period: str
    assets: list[str]
    status: ReservationStatus
    location: str


class MaintenanceItem(BaseModel):
    id: str
    assetName: str
    issue: str
    reportedAt: str
    dueDate: str
    priority: MaintenancePriority
    status: MaintenanceStatus
    comment: str
    location: str


class LocationItem(BaseModel):
    name: str
    capacity: str
    assignedAssets: int
    availableAssets: int
    manager: str


class CategoryItem(BaseModel):
    id: int | None = None
    name: str
    isStandard: bool = False
    isActive: bool = True


class CategoryCreatePayload(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class UserItem(BaseModel):
    id: str
    name: str
    email: str
    role: UserRole
    lastActive: str
    status: UserStatus
    createdAt: Optional[str] = None
    department: Optional[str] = None
    location: Optional[str] = None


class UserUpdatePayload(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    email: Optional[str] = Field(default=None, min_length=3, max_length=255)
    role: Optional[UserRole] = None
    status: Optional[UserStatus] = None
    isActive: Optional[bool] = None
    department: Optional[str] = Field(default=None, max_length=120)
    location: Optional[str] = Field(default=None, max_length=120)


class UserPasswordResetPayload(BaseModel):
    newPassword: Optional[str] = Field(default=None, min_length=8, max_length=128)
    generateTemporary: bool = False


class UserPasswordResetResponse(BaseModel):
    temporaryPassword: Optional[str] = None


class BulkUserDeletePayload(BaseModel):
    userIds: list[str] = Field(default_factory=list)


class BulkUserDeleteResultItem(BaseModel):
    userId: str
    deleted: bool
    reason: Optional[str] = None


class BulkUserDeleteResponse(BaseModel):
    deletedCount: int
    skippedCount: int
    results: list[BulkUserDeleteResultItem] = Field(default_factory=list)


class PlanningSummaryCategoryItem(BaseModel):
    categoryKey: str
    usableStock: int
    plannedQtyToday: int
    remainingAfterPlanning: int
    shortageQty: int


class PlanningSummaryItem(BaseModel):
    todayPlannedQty: int
    todayShortageCount: int
    todayShortageItems: list[PlanningSummaryCategoryItem] = Field(default_factory=list)
    upcomingPlannedQty: int
    upcomingShortageCount: int
    openConflictCount: int = 0
    categorySummaries: list[PlanningSummaryCategoryItem] = Field(default_factory=list)


class WmsOverviewResponse(BaseModel):
    assets: list[AssetItem] = Field(default_factory=list)
    activities: list[ActivityItem] = Field(default_factory=list)
    reservations: list[ReservationItem] = Field(default_factory=list)
    maintenanceItems: list[MaintenanceItem] = Field(default_factory=list)
    locations: list[LocationItem] = Field(default_factory=list)
    categories: list[CategoryItem] = Field(default_factory=list)
    users: list[UserItem] = Field(default_factory=list)
    planningSummary: PlanningSummaryItem | None = None
