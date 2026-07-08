import type { AppPage } from '../asset-ui/types';

const CANONICAL_PAGE_PATHS: Record<AppPage, string> = {
  dashboard: '/dashboard',
  planning: '/einsatzplanung',
  inventory: '/inventar',
  externalPool: '/fremdbestand',
  checkinCheckout: '/ein-auslagerung',
  tickets: '/tickets',
  users: '/benutzer',
  categories: '/kategorien',
  importExport: '/import-export',
  backup: '/backup',
  qrFunctions: '/qr-funktionen',
  massPrint: '/massendruck',
  labelAudit: '/label-pruefung',
  updateNotes: '/update-notizen',
  rolesPermissions: '/rollen-rechte',
  telecomPass: '/telekompass',
  securityLogs: '/sicherheit-protokolle',
  assetDetail: '/inventar',
};

const PATH_ALIASES: Record<string, AppPage> = {
  '/': 'dashboard',
  '/dashboard': 'dashboard',

  '/einsatzplanung': 'planning',
  '/planung': 'planning',
  '/planning': 'planning',

  '/inventar': 'inventory',
  '/inventory': 'inventory',

  '/fremdbestand': 'externalPool',
  '/external-pool': 'externalPool',
  '/externalpool': 'externalPool',

  '/ein-auslagerung': 'checkinCheckout',
  '/checkin-checkout': 'checkinCheckout',
  '/checkincheckout': 'checkinCheckout',

  '/tickets': 'tickets',
  '/defekte': 'tickets',

  '/benutzer': 'users',
  '/users': 'users',

  '/kategorien': 'categories',
  '/categories': 'categories',

  '/import-export': 'importExport',
  '/importexport': 'importExport',

  '/backup': 'backup',

  '/qr-funktionen': 'qrFunctions',
  '/qr-code': 'qrFunctions',
  '/qrcode': 'qrFunctions',
  '/massendruck': 'massPrint',

  '/label-pruefung': 'labelAudit',
  '/label-pruefen': 'labelAudit',
  '/labelaudit': 'labelAudit',

  '/update-notizen': 'updateNotes',
  '/updatenotes': 'updateNotes',

  '/rollen-rechte': 'rolesPermissions',
  '/rollen-und-rechte': 'rolesPermissions',
  '/rollen': 'rolesPermissions',
  '/roles': 'rolesPermissions',

  '/telekompass': 'telecomPass',
  '/telecom-pass': 'telecomPass',

  '/sicherheit-protokolle': 'securityLogs',
  '/sicherheit': 'securityLogs',
  '/security-logs': 'securityLogs',
};

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // Fehlerhaft encodete Pfade (z. B. einzelnes '%') nicht crashen lassen —
    // der rohe Wert läuft dann in den Dashboard-Fallback.
    return value;
  }
}

export function normalizePathname(pathname: string): string {
  const decoded = safeDecode(pathname || '/');
  const withLeadingSlash = decoded.startsWith('/') ? decoded : `/${decoded}`;
  const compact = withLeadingSlash.replace(/\/{2,}/g, '/').trim().toLowerCase();
  if (compact.length <= 1) return '/';
  return compact.endsWith('/') ? compact.replace(/\/+$/, '') || '/' : compact;
}

export function canonicalPathForPage(page: AppPage): string {
  return CANONICAL_PAGE_PATHS[page];
}

export function resolvePageFromPath(pathname: string): {
  page: AppPage;
  normalizedPath: string;
  canonicalPath: string;
} {
  const normalizedPath = normalizePathname(pathname);
  const page = PATH_ALIASES[normalizedPath] ?? 'dashboard';
  return {
    page,
    normalizedPath,
    canonicalPath: canonicalPathForPage(page),
  };
}

export type RouteParams = {
  assetId?: string;
  planningId?: string;
};

export type RouteMatch = {
  page: AppPage;
  params: RouteParams;
  normalizedPath: string;
  canonicalPath: string;
};

// Seiten, deren URL ein Detail-Segment tragen darf (/inventar/:assetId,
// /einsatzplanung/:planningId). Das Param-Segment wird bewusst NICHT
// lowercased/normalisiert — IDs müssen zeichengetreu erhalten bleiben.
const DETAIL_PARAM_BY_PAGE: Partial<Record<AppPage, keyof RouteParams>> = {
  inventory: 'assetId',
  planning: 'planningId',
};

export function assetDetailPath(assetId: string): string {
  return `${CANONICAL_PAGE_PATHS.inventory}/${encodeURIComponent(assetId)}`;
}

export function planningDetailPath(planningId: string): string {
  return `${CANONICAL_PAGE_PATHS.planning}/${encodeURIComponent(planningId)}`;
}

// Vollständige Routen-Auflösung inkl. parametrisierter Detail-Routen.
// Ergänzt resolvePageFromPath (das nur ganze Pfade gegen die Alias-Tabelle
// matcht) um zweisegmentige Pfade; unbekannte Pfade fallen wie bisher auf
// das Dashboard zurück.
export function resolveRoute(pathname: string): RouteMatch {
  // Erst in Segmente teilen, dann pro Segment dekodieren — sonst würde ein
  // encodeter Slash in einer ID (%2F) fälschlich als Pfadtrenner gelesen.
  const rawSegments = (pathname || '/').replace(/\/{2,}/g, '/').split('/').filter(Boolean);

  if (rawSegments.length === 2) {
    const basePage = PATH_ALIASES[`/${safeDecode(rawSegments[0]).toLowerCase()}`];
    const paramKey = basePage ? DETAIL_PARAM_BY_PAGE[basePage] : undefined;
    const param = safeDecode(rawSegments[1]);
    if (basePage && paramKey && param) {
      const canonicalBase = CANONICAL_PAGE_PATHS[basePage];
      return {
        // Asset-Details rendern als eigene Seite (assetDetail); das
        // Planungs-Detail bleibt Teil der Planungsseite (URL-gesteuertes Modal).
        page: paramKey === 'assetId' ? 'assetDetail' : basePage,
        params: { [paramKey]: param },
        normalizedPath: `${canonicalBase}/${param}`,
        canonicalPath: `${canonicalBase}/${encodeURIComponent(param)}`,
      };
    }
  }

  const { page, normalizedPath, canonicalPath } = resolvePageFromPath(pathname);
  return { page, params: {}, normalizedPath, canonicalPath };
}
