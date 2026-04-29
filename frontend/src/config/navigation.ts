import {
  ArchiveRestore,
  Boxes,
  CalendarRange,
  Download,
  LayoutDashboard,
  QrCode,
  Shapes,
  ShieldCheck,
  TriangleAlert,
  UserCircle2,
} from 'lucide-react';

import type { NavItem } from '../asset-ui/types';

export const navigation: NavItem[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    group: 'operations',
    hint: 'Tagesüberblick',
  },
  {
    key: 'planning',
    label: 'Einsatzplanung',
    icon: CalendarRange,
    group: 'operations',
    hint: 'Projektbedarf & Engpässe',
  },
  {
    key: 'inventory',
    label: 'Inventar',
    icon: Boxes,
    group: 'operations',
    hint: 'Assets & Verfügbarkeit',
  },
  {
    key: 'checkinCheckout',
    label: 'Ein-/Auslagerung',
    icon: ShieldCheck,
    group: 'operations',
    hint: 'Ausgabe & Rücknahme',
  },
  {
    key: 'tickets',
    label: 'Defekte / Tickets',
    icon: TriangleAlert,
    group: 'operations',
    hint: 'Schäden & Wartung',
  },
  {
    key: 'users',
    label: 'Benutzerverwaltung',
    icon: UserCircle2,
    group: 'administration',
    hint: 'Rollen & Team',
  },
  {
    key: 'categories',
    label: 'Kategorien',
    icon: Shapes,
    group: 'administration',
    hint: 'Stammdaten',
  },
  {
    key: 'importExport',
    label: 'Import / Export',
    icon: Download,
    group: 'administration',
    hint: 'Datenflüsse',
  },
  {
    key: 'backup',
    label: 'Backup',
    icon: ArchiveRestore,
    group: 'administration',
    hint: 'Sichern & Wiederherstellen',
  },
  {
    key: 'qrFunctions',
    label: 'QR-Code',
    icon: QrCode,
    group: 'administration',
    hint: 'Scanaktionen',
  },
];
