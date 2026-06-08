import type { AppPage, AppRole } from '../asset-ui/types';

// Seiten, deren Sichtbarkeit über editierbare Rechte gesteuert wird. Die
// übrigen Seiten (Dashboard, Massendruck, Import, Label-Prüfung,
// Update-Notizen, Fremdbestand) bleiben rollenbasiert (legacyVisible).
export const PAGE_PERMISSION: Partial<Record<AppPage, string>> = {
  inventory: 'assets.read',
  categories: 'categories.manage',
  planning: 'planning.read',
  checkinCheckout: 'checkinout.use',
  tickets: 'defects.report',
  qrFunctions: 'qrcode.manage',
  backup: 'backup.manage',
  users: 'users.manage',
  rolesPermissions: 'roles.manage',
};

// Heutiges, hartkodiertes Rollen-Verhalten als sicherer Fallback — greift, wenn
// das Backend (noch) keine effektiven Rechte liefert.
export function legacyVisible(key: AppPage, role: AppRole): boolean {
  if (role === 'Admin') return true;
  if (role === 'Projektmanager') {
    return !['users', 'importExport', 'backup', 'qrFunctions', 'massPrint', 'labelAudit', 'updateNotes', 'rolesPermissions', 'telecomPass'].includes(key);
  }
  // Mitarbeiter / Junior: kein Verwaltungszugriff inkl. Fremdbestand.
  return !['users', 'categories', 'importExport', 'backup', 'massPrint', 'labelAudit', 'externalPool', 'updateNotes', 'rolesPermissions', 'telecomPass'].includes(key);
}

// Kanonische "darf diese Rolle/dieser Nutzer Seite X sehen?"-Prüfung — exakt
// die Logik aus App.tsx (visibleNavigation): liegen effektive Rechte vor,
// entscheiden sie; sonst greift die bisherige Rollenlogik. Wird sowohl für die
// Navigationsfilterung als auch für klickbare Dashboard-Kacheln genutzt.
export function canAccessPage(page: AppPage, permissions: string[] | undefined, role: AppRole): boolean {
  if (!Array.isArray(permissions)) {
    return legacyVisible(page, role);
  }
  const required = PAGE_PERMISSION[page];
  return required ? permissions.includes(required) : legacyVisible(page, role);
}
