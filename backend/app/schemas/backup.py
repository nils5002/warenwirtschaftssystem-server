from __future__ import annotations

from datetime import date, datetime
from datetime import date as DateType

from pydantic import BaseModel, Field


class BackupCategory(BaseModel):
    name: str
    normalizedName: str
    isStandard: bool
    isActive: bool
    defaultImageSourceUrl: str | None = None
    defaultImageCachedPath: str | None = None
    defaultImageMimeType: str | None = None
    defaultImageLastFetchedAt: datetime | None = None
    defaultImageStatus: str | None = None
    defaultImageFetchError: str | None = None


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
    # Security-Paket „supman": Login-/Freigabe-Metadaten. Alle optional mit
    # Defaults, damit ALTE Backups ohne diese Felder unverändert importierbar
    # bleiben und neue Backups den Zustand über einen Restore retten.
    failedLoginCount: int = 0
    lockedUntil: datetime | None = None
    lastLoginAt: datetime | None = None
    lastLoginAttemptAt: datetime | None = None
    lastLoginIp: str | None = None
    lastLoginUserAgent: str | None = None
    approvedAt: datetime | None = None
    approvedBy: str | None = None
    rejectedAt: datetime | None = None
    # Signaturfarbe (Einsatzplanung). Optional mit Default - alte Backups ohne
    # diese Felder bleiben importierbar; der Startup-Backfill vergibt dann
    # automatisch eine Farbe.
    signatureColor: str | None = None
    signatureColorSource: str | None = None


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
    productImageSourceUrl: str | None = None
    productImageCachedPath: str | None = None
    productImageMimeType: str | None = None
    productImageLastFetchedAt: datetime | None = None
    productImageStatus: str | None = None
    productImageFetchError: str | None = None
    # Fremdbestand-Felder. Alle optional mit sicheren Defaults, damit
    # ältere Backups OHNE diese Felder weiterhin importierbar bleiben
    # (jedes fehlende Asset wird dann als Eigenbestand interpretiert).
    ownershipType: str = "owned"
    sourceName: str | None = None
    availableFrom: date | None = None
    availableUntil: date | None = None
    returnDueDate: date | None = None
    returnedAt: date | None = None
    externalNote: str | None = None
    # Planungsrelevante Flags. Beide optional mit Default True, damit ältere
    # Backups OHNE diese Felder weiterhin importierbar bleiben und sich
    # abwärtskompatibel verhalten (Gerät planbar / kartendrucker-kompatibel).
    # Wichtig fuer reproduzierbare Restores: ohne Export fallen ausgeschlossene
    # Geraete bzw. inkompatible Laptops nach einem Restore faelschlich auf True.
    availableForPlanning: bool = True
    cardPrinterCompatible: bool = True
    # Schritt A: erwartetes Rückgabedatum verliehener Eigengeräte. Optional mit
    # Default None, damit ältere Backups OHNE dieses Feld weiter importierbar
    # bleiben (Availability-Logik fällt dann auf nextReturn zurück).
    expectedReturnDate: date | None = None
    # Schritt B: Planung, FÜR die das Gerät ausgegeben wurde. Optional mit Default
    # None → ältere Backups OHNE dieses Feld bleiben importierbar (keine
    # Verknüpfung, Verhalten wie Schritt A).
    assignedPlanningId: str | None = None
    # Telekompass-Zähler. Default 0 → ältere Backups OHNE dieses Feld bleiben
    # importierbar und starten bei 0.
    telecomPassBookingCountTotal: int = 0


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
    # Rückgabe-Puffer. Default 0 → Altbackups OHNE dieses Feld bleiben
    # unverändert importierbar (Verhalten wie bisher).
    returnBufferDays: int = 0
    days: list[BackupPlanningDay] = Field(default_factory=list)


class BackupUpdateNote(BaseModel):
    # Schritt E: admin-pflegbare Versionshinweise. Optional mit Defaults, damit
    # ältere Backups OHNE diese Collection weiterhin importierbar bleiben.
    id: str
    version: str
    date: DateType | None = None
    title: str | None = None
    items: list[str] = Field(default_factory=list)
    isPublished: bool = False
    publishedAt: datetime | None = None


class BackupRolePermission(BaseModel):
    # Feature „Rollen & Rechte": je gewährtem Recht eine Zeile.
    roleKey: str
    permissionKey: str


class BackupQrCodeGroup(BaseModel):
    # Sammel-QR: Gruppe + Liste der referenzierten Asset-external_ids. Alle
    # Felder mit sicheren Defaults, damit ältere Backups OHNE diese Collection
    # weiterhin importierbar bleiben.
    id: str
    name: str
    qrToken: str
    category: str
    stockType: str | None = None
    sourceName: str | None = None
    createdByUserId: str | None = None
    isActive: bool = True
    members: list[str] = Field(default_factory=list)


class BackupHandoverExecution(BaseModel):
    # Automatische Projektübergabe (Audit). Optional mit Defaults → Altbackups
    # OHNE diese Collection bleiben importierbar.
    id: str
    batchId: str
    assetId: str
    category: str
    sourcePlanningId: str
    targetPlanningId: str
    prevAssignedPlanningId: str | None = None
    prevExpectedReturnDate: DateType | None = None
    prevAssignedTo: str = "-"
    prevNextReturn: str = "-"
    executedByUserId: str | None = None
    status: str = "active"


class BackupSystemSetting(BaseModel):
    # Globale Key/Value-Systemeinstellung (z. B. Telekompass-Preis). Optional mit
    # Defaults → Altbackups OHNE diese Collection bleiben importierbar.
    key: str
    value: str = ""


class BackupTelecomPassBooking(BaseModel):
    # Telekompass-Verlaufseintrag. Optional mit Defaults → Altbackups OHNE diese
    # Collection bleiben importierbar.
    id: str
    assetId: str
    planningId: str | None = None
    quantity: int = 0
    unitPriceSnapshot: str = "0"
    totalPriceSnapshot: str = "0"
    kind: str = "booking"
    idempotencyKey: str | None = None
    createdByUserId: str | None = None


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
    # Schritt E: Default-Liste → Altbackups ohne diese Collection bleiben gültig.
    updateNotes: list[BackupUpdateNote] = Field(default_factory=list)
    # Rollenrechte: Default-Liste → Altbackups ohne diese Collection bleiben
    # gültig; beim Import werden dann die Default-Rechte geseedet.
    rolePermissions: list[BackupRolePermission] = Field(default_factory=list)
    # Sammel-QR-Gruppen: Default-Liste → Altbackups ohne diese Collection bleiben
    # gültig (keine Gruppen werden angelegt).
    qrCodeGroups: list[BackupQrCodeGroup] = Field(default_factory=list)
    # Automatische Projektübergaben (Audit): Default-Liste → Altbackups ohne diese
    # Collection bleiben gültig.
    handoverExecutions: list[BackupHandoverExecution] = Field(default_factory=list)
    # Globale Systemeinstellungen (Key/Value, z. B. Telekompass-Preis).
    systemSettings: list[BackupSystemSetting] = Field(default_factory=list)
    # Telekompass-Verlauf (Buchungen/Korrekturen je Asset).
    telecomPassBookings: list[BackupTelecomPassBooking] = Field(default_factory=list)


class BackupImportResponse(BaseModel):
    imported: dict[str, int]


class BackupClearDataResponse(BaseModel):
    success: bool
    message: str
