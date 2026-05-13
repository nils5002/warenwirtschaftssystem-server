import type {
  ActivityItem,
  Asset,
  AppRole,
  CategoryItem,
  LocationItem,
  MaintenanceItem,
  ReservationItem,
  UserItem,
} from '../asset-ui/types';

const rawBase = (import.meta.env.VITE_API_BASE as string | undefined)?.trim();
const API_BASE = rawBase ? rawBase.replace(/\/+$/, '') : '';
const normalizeApiPath = (path: string): string => {
  if (!API_BASE) return path;
  const base = API_BASE.startsWith('/') ? API_BASE : `/${API_BASE}`;
  if (path === base || path.startsWith(`${base}/`)) {
    return path;
  }
  return `${base}${path}`;
};
const apiUrl = (path: string): string => normalizeApiPath(path);
const apiUrls = (path: string): string[] => {
  const primary = normalizeApiPath(path);
  return primary === path ? [path] : [primary, path];
};
const ACCESS_STORAGE_KEY = 'wms.accessContext';
const AUTH_STORAGE_KEY = 'wms.authSession';
const LOGIN_TIMEOUT_MS = 10_000;
const AUTH_ME_TIMEOUT_MS = 8_000;

type ApiAccessContext = {
  projectContext?: string;
};

export type AuthUser = {
  userId: string;
  name: string;
  email: string;
  role: AppRole;
};

export type AuthSession = {
  accessToken: string;
  tokenType: 'bearer';
  expiresIn: number;
  user: AuthUser;
};

export type AuthLoginPayload = {
  email: string;
  password: string;
};

export type AuthRegisterPayload = {
  name: string;
  email: string;
  password: string;
};

export type AuthRegisterResponse = {
  message: string;
};

export type WmsOverview = {
  assets: Asset[];
  activities: ActivityItem[];
  reservations: ReservationItem[];
  maintenanceItems: MaintenanceItem[];
  locations: LocationItem[];
  users: UserItem[];
  planningSummary?: {
    todayPlannedQty: number;
    todayShortageCount: number;
    todayShortageItems: Array<{
      categoryKey: string;
      usableStock: number;
      plannedQtyToday: number;
      remainingAfterPlanning: number;
      shortageQty: number;
    }>;
    upcomingPlannedQty: number;
    upcomingShortageCount: number;
    openConflictCount: number;
    categorySummaries: Array<{
      categoryKey: string;
      usableStock: number;
      plannedQtyToday: number;
      remainingAfterPlanning: number;
      shortageQty: number;
    }>;
  } | null;
};

export type HardwareImportRowError = {
  file_name: string;
  sheet_name: string;
  row_number: number;
  serial_number?: string | null;
  reason: string;
  raw_data: Record<string, unknown>;
};

export type HardwareImportPreviewResponse = {
  preview_id: string;
  file_name: string;
  recognized_columns: string[];
  column_mapping: Record<string, string>;
  inferred_category?: string | null;
  inferred_category_source?: string | null;
  rows_total: number;
  rows_valid: number;
  new_assets: number;
  duplicate_candidates: number;
  unresolved_category_rows: number;
  auto_generated_names: number;
  auto_generated_serials: number;
  missing_columns: string[];
  warnings: string[];
  errors: HardwareImportRowError[];
};

export type HardwareImportConfirmResponse = {
  preview_id: string;
  imported_count: number;
  updated_count: number;
  skipped_count: number;
  error_count: number;
  errors: HardwareImportRowError[];
};

export type BackupImportResponse = {
  imported: Record<string, number>;
};

export type BackupClearDataResponse = {
  success: boolean;
  message: string;
};

export type PlanningStatus = "Entwurf" | "Geplant" | "Bestätigt" | "Bestaetigt" | "Abgeschlossen" | "Storniert";

export type PlanningItemPayload = {
  categoryKey: string;
  qty: number;
  notes?: string | null;
  handoverEnabled?: boolean;
  linkedPlanningId?: string | null;
  handoverNote?: string | null;
};

export type PlanningDayPayload = {
  planningDate: string;
  weekday?: string | null;
  items: PlanningItemPayload[];
};

export type PlanningUpsertPayload = {
  id?: string | null;
  customerName: string;
  projectName: string;
  eventName?: string | null;
  projectManagerUserId?: string | null;
  calendarWeek?: number | null;
  startDate: string;
  endDate: string;
  notes: string;
  status: PlanningStatus;
  days: PlanningDayPayload[];
};

export type PlanningListMissingItem = {
  categoryKey: string;
  missingQty: number;
  requiredQty?: number;
  availableQty?: number;
};

export type PlanningListItem = {
  id: string;
  customerName: string;
  projectName: string;
  eventName?: string | null;
  projectManagerUserId?: string | null;
  calendarWeek?: number | null;
  startDate: string;
  endDate: string;
  status: PlanningStatus;
  updatedAt: string;
  handoverSummary?: {
    direction: "outgoing" | "incoming" | "mixed";
    partnerPlanningId?: string | null;
    partnerPlanningLabel?: string | null;
    partnerPlanningCount: number;
    categoryKeys: string[];
  } | null;
  openConflictCount?: number;
  missingItems?: PlanningListMissingItem[];
};

export type PlanningItemResponse = {
  id: number;
  categoryKey: string;
  qty: number;
  notes?: string | null;
  handoverEnabled?: boolean;
  linkedPlanningId?: string | null;
  linkedPlanningLabel?: string | null;
  handoverNote?: string | null;
};

export type PlanningDayResponse = {
  id: number;
  planningDate: string;
  weekday: string;
  items: PlanningItemResponse[];
};

export type PlanningResponse = {
  id: string;
  customerName: string;
  projectName: string;
  eventName?: string | null;
  projectManagerUserId?: string | null;
  calendarWeek?: number | null;
  startDate: string;
  endDate: string;
  notes: string;
  status: PlanningStatus;
  templateSourcePlanningId?: string | null;
  createdAt: string;
  updatedAt: string;
  days: PlanningDayResponse[];
};

export type PlanningAvailabilityState = "green" | "yellow" | "red";

export type PlanningAvailabilityItem = {
  planningDate: string;
  weekday: string;
  categoryKey: string;
  requestedQty: number;
  totalStock: number;
  usableStock: number;
  alreadyPlanned: number;
  remainingQty: number;
  currentPlanningQty: number;
  otherPlannedQty: number;
  totalPlannedQtyForDateCategory: number;
  remainingAfterAllPlanning: number;
  availabilityState: PlanningAvailabilityState;
  shortageQty: number;
  hasGlobalShortage: boolean;
  affectedPlanningIds: string[];
  handoverEnabled?: boolean;
  linkedPlanningId?: string | null;
  linkedPlanningLabel?: string | null;
  handoverNote?: string | null;
  handoverStatus?: "none" | "planned" | "missing_link" | "organizational";
  handoverCoveredQty?: number;
  shortageAfterHandoverQty?: number;
};

export type PlanningAvailabilityCategorySummary = {
  categoryKey: string;
  requestedTotal: number;
  maxRequestedPerDay: number;
  totalStock: number;
  usableStock: number;
};

export type PlanningAvailabilityResponse = {
  planningId: string;
  periodStart: string;
  periodEnd: string;
  items: PlanningAvailabilityItem[];
  categorySummary: PlanningAvailabilityCategorySummary[];
};

const defaultAccessContext: ApiAccessContext = {};

let currentAccessContext: ApiAccessContext = (() => {
  try {
    const raw = window.localStorage.getItem(ACCESS_STORAGE_KEY);
    if (!raw) return defaultAccessContext;
    const parsed = JSON.parse(raw) as ApiAccessContext;
    return {
      projectContext: parsed.projectContext?.trim() || undefined,
    };
  } catch {
    return defaultAccessContext;
  }
})();

let currentAuthSession: AuthSession | null = (() => {
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed?.accessToken || !parsed?.user?.userId || !parsed?.user?.role) return null;
    return parsed;
  } catch {
    return null;
  }
})();

const umlautPairs: Array<[string, string]> = [
  ['Verfuegbar', 'Verfügbar'],
  ['Verliehen', 'Verliehen'],
  ['Bestaetigt', 'Bestätigt'],
  ['Eingeschraenkt', 'Inaktiv'],
  ['Buero', 'Büro'],
  ['buero', 'büro'],
  ['Koeln', 'Köln'],
  ['koeln', 'köln'],
  ['Schaeden', 'Schäden'],
  ['schaeden', 'schäden'],
  ['Zubehoer', 'Zubehör'],
  ['zubehoer', 'zubehör'],
  ['geoeffnet', 'geöffnet'],
  ['Rueck', 'Rück'],
  ['rueck', 'rück'],
  ['ueber', 'über'],
  ['Ueber', 'Über'],
];

const outboundEnumMap: Record<string, string> = {
  Verfügbar: 'Verfuegbar',
  Verliehen: 'Verliehen',
  Bestätigt: 'Bestaetigt',
  Inaktiv: 'Inaktiv',
};

function normalizeText(value: string): string {
  let next = value;
  for (const [from, to] of umlautPairs) {
    next = next.split(from).join(to);
  }
  return next;
}

function normalizeDeep<T>(value: T): T {
  if (typeof value === 'string') {
    return normalizeText(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeDeep(item)) as T;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, current]) => [
      key,
      normalizeDeep(current),
    ]);
    return Object.fromEntries(entries) as T;
  }
  return value;
}

function normalizeOutbound<T>(value: T): T {
  if (typeof value === 'string') {
    return (outboundEnumMap[value] ?? value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeOutbound(item)) as T;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, current]) => [
      key,
      normalizeOutbound(current),
    ]);
    return Object.fromEntries(entries) as T;
  }
  return value;
}

function buildAccessHeaders(): HeadersInit {
  const headers: Record<string, string> = {};
  if (currentAuthSession?.accessToken) {
    headers.Authorization = `Bearer ${currentAuthSession.accessToken}`;
  }
  if (currentAccessContext.projectContext) {
    headers['X-Project-Context'] = currentAccessContext.projectContext;
  }
  return headers;
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = {
    ...buildAccessHeaders(),
    ...(init?.headers ?? {}),
  };
  let lastNetworkError: unknown = null;
  for (const url of apiUrls(path)) {
    try {
      return await fetch(url, {
        ...init,
        headers,
      });
    } catch (error) {
      lastNetworkError = error;
    }
  }
  throw (lastNetworkError ?? new TypeError('Network request failed.'));
}

export function getApiAccessContext(): ApiAccessContext {
  return currentAccessContext;
}

export function setApiAccessContext(context: ApiAccessContext): void {
  currentAccessContext = {
    projectContext: context.projectContext?.trim() || undefined,
  };
  try {
    window.localStorage.setItem(ACCESS_STORAGE_KEY, JSON.stringify(currentAccessContext));
  } catch {
    // ignore storage write errors
  }
}

export function getAuthSession(): AuthSession | null {
  return currentAuthSession;
}

export function setAuthSession(session: AuthSession): void {
  currentAuthSession = session;
  try {
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // ignore storage write errors
  }
}

export function clearAuthSession(): void {
  currentAuthSession = null;
  try {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // ignore storage write errors
  }
}

/**
 * Typisierter Fehler für API-Antworten. Anders als `Error` trägt diese
 * Klasse den HTTP-Statuscode mit, damit aufrufende Komponenten z. B. zwischen
 * "Backend antwortet nicht (5xx)" und "Aktion abgelehnt (4xx)" unterscheiden
 * können, ohne den Fehlertext per Regex zu parsen.
 */
export class WmsApiError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string, message: string) {
    super(message);
    this.name = 'WmsApiError';
    this.status = status;
    this.detail = detail;
  }
}

export function isWmsApiError(value: unknown): value is WmsApiError {
  return value instanceof WmsApiError;
}

export function isBackendUnreachableError(value: unknown): boolean {
  if (value instanceof WmsApiError) {
    // 5xx-Bereich (Bad Gateway, Service Unavailable, Gateway Timeout etc.)
    // sowie 0 (Netzwerkabbruch) interpretieren wir als "Backend ist gerade
    // nicht ansprechbar" — für den User ist das die relevante Aussage.
    return value.status === 0 || value.status >= 500;
  }
  // Native fetch-Fehler (TypeError) treten bei Netzwerkproblemen auf — z. B.
  // wenn der Browser den Host nicht erreicht, weil Cloudflare den Origin
  // gerade nicht bedienen kann.
  return value instanceof TypeError;
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detailMessage = '';
    try {
      const payload = (await response.json()) as {
        detail?: string | Array<{ msg?: string }>;
      };
      if (typeof payload.detail === 'string') {
        detailMessage = payload.detail;
      } else if (Array.isArray(payload.detail)) {
        const parts = payload.detail
          .map((item) => item?.msg?.trim())
          .filter(Boolean);
        detailMessage = parts.join(' | ');
      }
    } catch {
      detailMessage = '';
    }
    const baseMessage = detailMessage
      ? `WMS API Fehler (${response.status}): ${detailMessage}`
      : `WMS API Fehler (${response.status})`;
    throw new WmsApiError(response.status, detailMessage, baseMessage);
  }
  return normalizeDeep((await response.json()) as T);
}

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const response = await apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(normalizeOutbound(payload)),
  });
  return parseResponse<T>(response);
}

export async function fetchWmsOverview(): Promise<WmsOverview> {
  const response = await apiFetch('/api/wms/overview');
  return parseResponse<WmsOverview>(response);
}

export async function login(payload: AuthLoginPayload): Promise<AuthSession> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), LOGIN_TIMEOUT_MS);
  try {
    const response = await apiFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const session = await parseResponse<AuthSession>(response);
    setAuthSession(session);
    return session;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Anmeldung fehlgeschlagen: Backend nicht erreichbar oder Server antwortet nicht.');
    }
    if (error instanceof TypeError) {
      throw new Error('Anmeldung fehlgeschlagen: Backend nicht erreichbar oder Server antwortet nicht.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function fetchAuthMe(): Promise<AuthUser> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), AUTH_ME_TIMEOUT_MS);
  try {
    const response = await apiFetch('/api/auth/me', {
      signal: controller.signal,
    });
    return parseResponse<AuthUser>(response);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Sitzung konnte nicht geprüft werden: Backend antwortet nicht.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function upsertAsset(asset: Asset): Promise<Asset> {
  return postJson<Asset>('/api/wms/assets', asset);
}

export async function deleteAsset(assetId: string): Promise<{ deleted: boolean }> {
  const response = await apiFetch(`/api/wms/assets/${assetId}`, {
    method: 'DELETE',
  });
  return parseResponse<{ deleted: boolean }>(response);
}

// --- Fremdbestand: Bulk-Anlage und "Als zurückgegeben markieren" ---
export type ExternalPoolCreatePayload = {
  category: string;
  ownershipType: 'rented' | 'borrowed' | 'external';
  count: number;
  namePrefix: string;
  location?: string;
  availableFrom?: string | null;
  availableUntil?: string | null;
  returnDueDate?: string | null;
  sourceName?: string | null;
  externalNote?: string | null;
};

export type ExternalPoolCreateResponse = {
  createdAssetIds: string[];
};

export function createExternalPool(
  payload: ExternalPoolCreatePayload,
): Promise<ExternalPoolCreateResponse> {
  return postJson<ExternalPoolCreateResponse>('/api/wms/assets/external-pool', payload);
}

export function markAssetReturned(
  assetId: string,
  returnedAt?: string | null,
): Promise<Asset> {
  return postJson<Asset>(`/api/wms/assets/${assetId}/mark-returned`, {
    returnedAt: returnedAt ?? null,
  });
}

// Holt die Kategorien-Stammdaten aus dem Backend (mit ids), damit das
// Frontend für Delete die richtige id mitschicken kann. Die abgeleitete
// "Kategorien aus vorhandenen Assets"-Liste im Controller hat keine ids.
export async function listCategories(): Promise<CategoryItem[]> {
  const response = await apiFetch('/api/wms/categories');
  return parseResponse<CategoryItem[]>(response);
}

// Löscht eine Kategorie. Wirft mit verständlicher Meldung, wenn die
// Kategorie noch von Geräten verwendet wird (Backend liefert HTTP 409).
export async function deleteCategory(categoryId: number): Promise<{ deleted: boolean; id: number }> {
  const response = await apiFetch(`/api/wms/categories/${categoryId}`, {
    method: 'DELETE',
  });
  return parseResponse<{ deleted: boolean; id: number }>(response);
}

export function upsertReservation(reservation: ReservationItem): Promise<ReservationItem> {
  return postJson<ReservationItem>('/api/wms/reservations', reservation);
}

export function upsertMaintenance(item: MaintenanceItem): Promise<MaintenanceItem> {
  return postJson<MaintenanceItem>('/api/wms/maintenance', item);
}

export function upsertLocation(location: LocationItem): Promise<LocationItem> {
  return postJson<LocationItem>('/api/wms/locations', location);
}

export function upsertUser(user: UserItem): Promise<UserItem> {
  return postJson<UserItem>('/api/wms/users', user);
}

export async function register(payload: AuthRegisterPayload): Promise<AuthRegisterResponse> {
  const response = await apiFetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseResponse<AuthRegisterResponse>(response);
}

export type UserPasswordResetPayload = {
  newPassword?: string;
  generateTemporary?: boolean;
};

export type UserPasswordResetResponse = {
  temporaryPassword?: string | null;
};

export function resetUserPassword(
  userId: string,
  payload: UserPasswordResetPayload,
): Promise<UserPasswordResetResponse> {
  return postJson<UserPasswordResetResponse>(`/api/wms/users/${userId}/reset-password`, payload);
}

export async function deleteUser(userId: string): Promise<{ deleted: boolean }> {
  const response = await apiFetch(`/api/wms/users/${userId}`, {
    method: 'DELETE',
  });
  return parseResponse<{ deleted: boolean }>(response);
}

export type BulkUserDeleteResultItem = {
  userId: string;
  deleted: boolean;
  reason?: string | null;
};

export type BulkUserDeleteResponse = {
  deletedCount: number;
  skippedCount: number;
  results: BulkUserDeleteResultItem[];
};

export function deleteUsersBulk(userIds: string[]): Promise<BulkUserDeleteResponse> {
  return postJson<BulkUserDeleteResponse>('/api/wms/users/bulk-delete', { userIds });
}

export function upsertActivity(activity: ActivityItem): Promise<ActivityItem> {
  return postJson<ActivityItem>('/api/wms/activities', activity);
}

export async function previewHardwareImport(file: File): Promise<HardwareImportPreviewResponse> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await apiFetch('/api/wms/import/preview', {
    method: 'POST',
    body: formData,
  });
  return parseResponse<HardwareImportPreviewResponse>(response);
}

export async function confirmHardwareImport(previewId: string): Promise<HardwareImportConfirmResponse> {
  return postJson<HardwareImportConfirmResponse>('/api/wms/import/confirm', { preview_id: previewId });
}

export async function downloadHardwareImportTemplate(): Promise<Blob> {
  const response = await apiFetch('/api/wms/import/template');
  if (!response.ok) {
    throw new WmsApiError(response.status, '', `WMS API Fehler (${response.status})`);
  }
  return response.blob();
}

export async function downloadAdminLogs(): Promise<{ blob: Blob; fileName: string }> {
  const response = await apiFetch('/api/wms/admin/logs/download');
  if (!response.ok) {
    // Detail aus dem Body lesen, damit der 403/404-Fall im UI eine
    // präzise Meldung bekommt statt eines generischen Texts.
    let detailMessage = '';
    try {
      const payload = (await response.json()) as { detail?: string };
      if (typeof payload.detail === 'string') {
        detailMessage = payload.detail;
      }
    } catch {
      detailMessage = '';
    }
    const baseMessage = detailMessage
      ? `WMS API Fehler (${response.status}): ${detailMessage}`
      : `WMS API Fehler (${response.status})`;
    throw new WmsApiError(response.status, detailMessage, baseMessage);
  }
  const contentDisposition = response.headers.get('content-disposition') || '';
  const fileNameMatch = /filename="([^"]+)"/i.exec(contentDisposition);
  const fallback = `wms-logs-${new Date().toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '-')}.zip`;
  const fileName = fileNameMatch?.[1] || fallback;
  return { blob: await response.blob(), fileName };
}

export async function downloadWarehouseBackup(): Promise<{ blob: Blob; fileName: string }> {
  const response = await apiFetch('/api/wms/backup/export');
  if (!response.ok) {
    throw new WmsApiError(response.status, '', `WMS API Fehler (${response.status})`);
  }
  const contentDisposition = response.headers.get('content-disposition') || '';
  const fileNameMatch = /filename="([^"]+)"/i.exec(contentDisposition);
  const fileName = fileNameMatch?.[1] || `warehouse-backup-${new Date().toISOString().slice(0, 16).replace('T', '-')}.json`;
  return { blob: await response.blob(), fileName };
}

export async function restoreWarehouseBackup(file: File): Promise<BackupImportResponse> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await apiFetch('/api/wms/backup/import', {
    method: 'POST',
    body: formData,
  });
  return parseResponse<BackupImportResponse>(response);
}

export async function clearWarehouseDataForImport(): Promise<BackupClearDataResponse> {
  const response = await apiFetch('/api/wms/backup/reset-for-import', {
    method: 'POST',
  });
  return parseResponse<BackupClearDataResponse>(response);
}

export async function listPlannings(filters?: {
  status?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<PlanningListItem[]> {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.fromDate) params.set("fromDate", filters.fromDate);
  if (filters?.toDate) params.set("toDate", filters.toDate);
  const query = params.toString();
  const response = await apiFetch(`/api/wms/planning${query ? `?${query}` : ""}`);
  return parseResponse<PlanningListItem[]>(response);
}

export async function getPlanning(planningId: string): Promise<PlanningResponse> {
  const response = await apiFetch(`/api/wms/planning/${planningId}`);
  return parseResponse<PlanningResponse>(response);
}

export async function createPlanning(payload: PlanningUpsertPayload): Promise<PlanningResponse> {
  return postJson<PlanningResponse>("/api/wms/planning", payload);
}

export async function updatePlanning(planningId: string, payload: PlanningUpsertPayload): Promise<PlanningResponse> {
  const response = await apiFetch(`/api/wms/planning/${planningId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(normalizeOutbound(payload)),
  });
  return parseResponse<PlanningResponse>(response);
}

export function updatePlanningViaPost(planningId: string, payload: PlanningUpsertPayload): Promise<PlanningResponse> {
  return postJson<PlanningResponse>(`/api/wms/planning/${planningId}`, payload);
}

export function duplicatePlanning(planningId: string): Promise<PlanningResponse> {
  return postJson<PlanningResponse>(`/api/wms/planning/${planningId}/duplicate`, {});
}

export function updatePlanningStatus(
  planningId: string,
  status: PlanningStatus,
): Promise<PlanningResponse> {
  return postJson<PlanningResponse>(`/api/wms/planning/${planningId}/status`, { status });
}

export async function deletePlanning(planningId: string): Promise<{ deleted: boolean }> {
  const response = await apiFetch(`/api/wms/planning/${planningId}`, {
    method: "DELETE",
  });
  return parseResponse<{ deleted: boolean }>(response);
}

export async function getPlanningAvailability(planningId: string): Promise<PlanningAvailabilityResponse> {
  const response = await apiFetch(`/api/wms/planning/${planningId}/availability`);
  return parseResponse<PlanningAvailabilityResponse>(response);
}
