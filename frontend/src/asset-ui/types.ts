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
  | 'tickets'
  | 'importExport'
  | 'backup'
  | 'users';

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

