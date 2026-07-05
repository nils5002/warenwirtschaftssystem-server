import type { LucideIcon } from 'lucide-react';

export type AssetStatus =
  | 'Verfügbar'
  | 'Verliehen'
  | 'In Wartung'
  | 'Defekt';

export type ReservationStatus =
  | 'Angefragt'
  | 'Bestätigt'
  | 'Aktiv'
  | 'Abgeschlossen'
  | 'Storniert';

export type MaintenancePriority = 'Niedrig' | 'Mittel' | 'Hoch' | 'Kritisch';

export type MaintenanceStatus = 'Offen' | 'In Bearbeitung' | 'Erledigt';

export type AppPage =
  | 'dashboard'
  | 'inventory'
  | 'externalPool'
  | 'categories'
  | 'planning'
  | 'assetDetail'
  | 'checkinCheckout'
  | 'qrFunctions'
  | 'massPrint'
  | 'labelAudit'
  | 'tickets'
  | 'importExport'
  | 'backup'
  | 'users'
  | 'updateNotes'
  | 'rolesPermissions'
  | 'telecomPass';

export type AppRole = 'Admin' | 'Projektmanager' | 'Mitarbeiter';

export type NavItem = {
  key: AppPage;
  label: string;
  icon: LucideIcon;
  group?: 'operations' | 'administration';
  hint?: string;
};

// Bestandsart des Assets:
//   owned     = Eigenbestand (Default für alle bestehenden Geräte)
//   rented    = Mietgerät
//   borrowed  = Leihgerät
//   external  = Externes Gerät (z. B. Kunden-Hardware)
export type OwnershipType = 'owned' | 'rented' | 'borrowed' | 'external';

export type Asset = {
  id: string;
  name: string;
  category: string;
  location: string;
  status: AssetStatus;
  assignedTo: string;
  nextReturn: string;
  tagNumber: string;
  serialNumber: string;
  model?: string;
  ipAddress?: string;
  macLan?: string;
  macWlan?: string;
  qrCode?: string;
  maintenanceState: string;
  notes: string;
  lastCheckout: string;
  nextReservation: string;
  sourceFile?: string;
  productImageUrl?: string | null;
  productImageSourceUrl?: string | null;
  productImageStatus?: string | null;
  // Fremdbestand-Felder (alle optional). Bestehende Eigenbestand-Geräte
  // ohne diese Felder verhalten sich unverändert (Default = owned).
  ownershipType?: OwnershipType;
  sourceName?: string | null;
  availableFrom?: string | null;
  availableUntil?: string | null;
  returnDueDate?: string | null;
  returnedAt?: string | null;
  externalNote?: string | null;
  // Default true. Wird in der Planungs-Verfügbarkeit ausgewertet, wenn die
  // Planung mindestens einen Kartendrucker fordert: inkompatible Laptops
  // (z. B. MacBook Neo) werden dann vom nutzbaren Bestand ausgeschlossen.
  cardPrinterCompatible?: boolean;
  // Default true. False = Asset bleibt im Inventar sichtbar/bearbeitbar,
  // wird aber in der Einsatzplanung komplett ignoriert (z. B. interne
  // Server-Laptops). Greift global VOR der Kartendrucker-Logik.
  availableForPlanning?: boolean;
  // Schritt B: external_id der Planung, FÜR die das Gerät ausgegeben wurde.
  // Wird beim Checkout gesetzt (wenn ein Planungsprojekt gewählt wurde) und
  // beim Checkin serverseitig wieder geleert.
  assignedPlanningId?: string | null;
  // Erwartete Rückgabe aus der Fachlogik. Für die Detailansicht relevant,
  // aber im generischen Bearbeiten bewusst read-only.
  expectedReturnDate?: string | null;
  // Telekompass: kumulierte Buchungsanzahl (fachlich nur für LTE-Router). Wird
  // ausschließlich über den Telekompass-Endpunkt gepflegt, nie über den
  // generischen Asset-Upsert. Default 0.
  telecomPassBookingCountTotal?: number;
};

// --- Label-Prüfung (serverseitige Audit-Prüfrunden) ---
export type LabelAuditScanKind = 'matched' | 'duplicate' | 'unknown' | 'corrected';
export type LabelAuditSessionStatus = 'active' | 'archived';

export type LabelAuditScan = {
  id: string;
  scanValue: string;
  scanKind: LabelAuditScanKind;
  assetId?: string | null;
  assetStableKey?: string | null;
  assetLabel?: string | null;
  category?: string | null;
  serialNumber?: string | null;
  tagNumber?: string | null;
  scannedAt: string;
  scannedByUserId?: string | null;
  // Admin-Korrektur-Felder.
  note?: string | null;
  ignored?: boolean;
  ignoreReason?: string | null;
};

export type LabelAuditSummary = {
  total: number;
  checked: number;
  open: number;
  duplicates: number;
  unknown: number;
  // Ignorierte (soft-deletete) Scans — zählen nicht in checked/open.
  ignored?: number;
};

export type LabelAuditSession = {
  id: string;
  name: string;
  status: LabelAuditSessionStatus;
  note?: string | null;
  createdAt: string;
  updatedAt: string;
  createdByUserId?: string | null;
  summary: LabelAuditSummary;
  recentScans: LabelAuditScan[];
  // Aktuelle Asset-IDs, die in dieser Runde als geprüft gelten (server-seitig
  // über den stabilen Key gegen den aktuellen Bestand aufgelöst).
  checkedAssetIds: string[];
};

export type LabelAuditSessionListItem = {
  id: string;
  name: string;
  status: LabelAuditSessionStatus;
  note?: string | null;
  createdAt: string;
  updatedAt: string;
  summary: LabelAuditSummary;
};

export type LabelAuditScanResult = {
  scan: LabelAuditScan;
  session: LabelAuditSession;
};

export type ActivityItem = {
  id: string;
  title: string;
  detail: string;
  timestamp: string;
  assetId?: string;
};

export type ReservationItem = {
  id: string;
  requestedBy: string;
  team: string;
  period: string;
  assets: string[];
  status: ReservationStatus;
  location: string;
};

export type MaintenanceItem = {
  id: string;
  assetName: string;
  issue: string;
  reportedAt: string;
  dueDate: string;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  comment: string;
  location: string;
};

export type LocationItem = {
  name: string;
  capacity: string;
  assignedAssets: number;
  availableAssets: number;
  manager: string;
};

export type UserItem = {
  id: string;
  name: string;
  email: string;
  role: 'Admin' | 'Projektmanager' | 'Mitarbeiter' | 'Junior';
  lastActive: string;
  status: 'Aktiv' | 'Inaktiv';
  department?: string;
  location?: string;
};

export type CategoryItem = {
  // Backend liefert id für gespeicherte Kategorien. Bei lokal vorgemerkten
  // Kategorien (z. B. aus Asset-Ableitung) kann sie noch fehlen.
  id?: number;
  name: string;
  isActive?: boolean;
  isStandard?: boolean;
};

