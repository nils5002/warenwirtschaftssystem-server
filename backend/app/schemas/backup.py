from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field


class BackupCategory(BaseModel):
    name: str
    normalizedName: str
    isStandard: bool
    isActive: bool


class BackupUser(BaseModel):
    id: str
    name: str
    email: str
    role: str
    lastActive: str
    status: str
    department: str | None = None
    location: str | None = None
    passwordHash: str | None = None


class BackupAsset(BaseModel):
    id: str
    name: str
    category: str
    location: str
    status: str
    assignedTo: str
    nextReturn: str
    tagNumber: str
    serialNumber: str
    model: str | None = None
    ipAddress: str | None = None
    macLan: str | None = None
    macWlan: str | None = None
    qrCode: str = ""
    maintenanceState: str = ""
    notes: str = ""
    lastCheckout: str = "-"
    nextReservation: str = "-"
    sourceFile: str | None = None


class BackupActivity(BaseModel):
    id: str
    title: str
    detail: str
    timestamp: str
    assetId: str | None = None


class BackupReservation(BaseModel):
    id: str
    requestedBy: str
    team: str
    period: str
    assets: list[str] = Field(default_factory=list)
    status: str
    location: str


class BackupMaintenance(BaseModel):
    id: str
    assetName: str
    issue: str
    reportedAt: str
    dueDate: str
    priority: str
    status: str
    comment: str = ""
    location: str


class BackupLocation(BaseModel):
    name: str
    capacity: str
    assignedAssets: int
    availableAssets: int
    manager: str


class BackupPlanningItem(BaseModel):
    categoryKey: str
    qty: int
    notes: str | None = None
    handoverEnabled: bool = False
    linkedPlanningId: str | None = None
    handoverNote: str | None = None


class BackupPlanningDay(BaseModel):
    planningDate: date
    weekday: str
    items: list[BackupPlanningItem] = Field(default_factory=list)


class BackupPlanning(BaseModel):
    id: str
    customerName: str
    projectName: str
    eventName: str | None = None
    projectManagerUserId: str | None = None
    calendarWeek: int | None = None
    startDate: date
    endDate: date
    notes: str
    status: str
    templateSourcePlanningId: str | None = None
    days: list[BackupPlanningDay] = Field(default_factory=list)


class WarehouseBackupPayload(BaseModel):
    version: int = 1
    exportedAt: datetime
    categories: list[BackupCategory] = Field(default_factory=list)
    users: list[BackupUser] = Field(default_factory=list)
    assets: list[BackupAsset] = Field(default_factory=list)
    activities: list[BackupActivity] = Field(default_factory=list)
    reservations: list[BackupReservation] = Field(default_factory=list)
    maintenanceItems: list[BackupMaintenance] = Field(default_factory=list)
    locations: list[BackupLocation] = Field(default_factory=list)
    plannings: list[BackupPlanning] = Field(default_factory=list)


class BackupImportResponse(BaseModel):
    imported: dict[str, int]
