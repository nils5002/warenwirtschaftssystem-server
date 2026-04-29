import type { AppPage } from '../asset-ui/types';

const CANONICAL_PAGE_PATHS: Record<AppPage, string> = {
  dashboard: '/dashboard',
  planning: '/einsatzplanung',
  inventory: '/inventar',
  checkinCheckout: '/ein-auslagerung',
  tickets: '/tickets',
  users: '/benutzer',
  categories: '/kategorien',
  importExport: '/import-export',
  backup: '/backup',
  qrFunctions: '/qr-funktionen',
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
};

export function normalizePathname(pathname: string): string {
  const decoded = decodeURIComponent(pathname || '/');
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
