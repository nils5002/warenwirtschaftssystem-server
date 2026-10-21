import type {
  ActivityItem,
  Asset,
  AppRole,
  CategoryItem,
  LabelAuditScanResult,
  LabelAuditSession,
  LabelAuditSessionListItem,
  LabelAuditSessionStatus,
  LocationItem,
  MaintenanceItem,
  ReservationItem,
  SecurityEventItem,
  SecuritySummary,
  UserItem,
  UserSecurityInfo,
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
  // Effektive Rechte-Keys der Rolle (Feature „Rollen & Rechte"). Optional →
  // sicher, falls ein älteres Backend das Feld nicht liefert.
  permissions?: string[];
  // Gesetzt, wenn die Sitzung über ein gekoppeltes Companion-Gerät läuft.
  deviceId?: string | null;
};

/**
 * Antwortform von POST /api/auth/login.
 *
 * Seit Security-Audit Paket B4 setzt das Backend den Auth-Token zusaetzlich
 * als HttpOnly-Cookie. Der Browser-Client verwendet `accessToken`/`expiresIn`
 * NICHT mehr — die Authentifizierung laeuft ueber das Cookie, das der Browser
 * automatisch mitschickt. Die Felder bleiben optional typisiert, weil das
 * Backend sie fuer API-/Test-Clients weiterhin mitliefert.
 */
type AuthLoginResponseBody = {
  accessToken?: string;
  tokenType?: string;
  expiresIn?: number;
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
  // Honeypot-Feld (für Menschen unsichtbar, bleibt leer). Füllt ein Bot es
  // aus, verwirft das Backend die Registrierung still.
  website?: string;
};

export type AuthRegisterResponse = {
  message: string;
  // Galt für diese Registrierung das Verfahren mit E-Mail-Bestätigung?
  // Optional typisiert → ein älteres Backend ohne das Feld wird als
  // klassischer Ablauf behandelt (sichere Annahme).
  verificationRequired?: boolean;
  // Ob die Bestätigungsmail tatsächlich rausgegangen ist. Optional typisiert,
  // damit ein älteres Backend ohne das Feld weiterhin funktioniert (dann gilt
  // der Versand als erfolgt — das war vor diesem Feature der Normalfall).
  emailSent?: boolean;
  emailHint?: string | null;
};

export type AuthVerifyEmailResponse = {
  status: 'verified' | 'already_verified';
  message: string;
  // true, sobald der Admin das Konto zusätzlich freigegeben hat.
  accountActive: boolean;
};

export type AuthResendVerificationResponse = {
  message: string;
  emailSent?: boolean;
  emailHint?: string | null;
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
    // Additiv: fachliche Konfliktursachen. Alte Clients ignorieren die Felder.
    conflictGroups?: ConflictGroup[];
    conflictCauseCount?: number;
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
  // On-Site-Verantwortlicher (optional, unabhaengig vom Projektverantwortlichen).
  onSiteResponsibleUserId?: string | null;
  calendarWeek?: number | null;
  startDate: string;
  endDate: string;
  notes: string;
  status: PlanningStatus;
  // Rückgabe-Puffer in Tagen (0-3). Blockiert den Bestand zusätzlich nach dem
  // Projektende. Optional → ältere Clients/Payloads bleiben kompatibel (Default 0).
  returnBufferDays?: number;
  days: PlanningDayPayload[];
};

export type PlanningListMissingItem = {
  categoryKey: string;
  missingQty: number;
  requiredQty?: number;
  availableQty?: number;
};

// Schweregrad-Klassifikation einer Konfliktzelle (Backend:
// app/domain/conflict_classification.py). Additiv — alte Responses ohne diese
// Felder bleiben gültig.
export type PlanningConflictSeverity =
  | "kompatible_laptops_fehlen"
  | "teilweise_geloest"
  | "handover_review"
  | "nicht_planbare_ausgeschlossen"
  | "echter_engpass"
  | "hinweis";

export type PlanningConflictReason =
  | "compat_laptops_missing"
  | "handover_partial"
  | "handover_review"
  | "non_plannable_excluded"
  | "real_shortage"
  | "context";

export type ConflictBadge = {
  severity: PlanningConflictSeverity;
  reason: PlanningConflictReason;
  label: string;
};

export type PlanningConflictDetail = {
  categoryKey: string;
  conflictDay: string;
  shortageReason: PlanningConflictReason;
  conflictSeverity: PlanningConflictSeverity;
  conflictLabel: string;
  unresolvedShortageQty: number;
  totalRequiredQty?: number;
  usableStock?: number;
  handoverCoverageQty?: number;
  handoverStatus?: "none" | "planned" | "missing_link" | "organizational";
  handoverEnabled?: boolean;
  excludedQty?: number;
  excludedFromPlanningQty?: number;
  cardPrinterRequiredQty?: number;
  cardPrinterUpliftQty?: number;
  secondary?: ConflictBadge[];
};

// Fachliche Konfliktursache — bündelt zusammenhängende technische Konflikte
// (Tag x Kategorie x Planung) zu einer gemeinsamen Ursache. Additiv; ändert
// openConflictCount nicht.
export type ConflictGroupDay = {
  date: string;
  requiredQty: number;
  usableStock: number;
  missingQty: number;
  affectedPlanningIds: string[];
};

// Regelbasierter Lösungs-Hinweis zu einer Konfliktursache (Backend-erzeugt).
export type RecommendationType =
  | 'procurement'
  | 'planning_adjustment'
  | 'handover'
  | 'schedule'
  | 'data_quality';

export type RecommendationPriority = 'high' | 'medium' | 'low';

export type Recommendation = {
  type: RecommendationType;
  priority: RecommendationPriority;
  title: string;
  description: string;
  suggestedQty?: number | null;
  affectedPlanningIds?: string[];
};

export type ConflictGroup = {
  id: string;
  categoryKey: string;
  dateFrom: string;
  dateTo: string;
  maxMissingQty: number;
  totalConflictEvents: number;
  affectedPlanningCount: number;
  affectedPlanningIds: string[];
  affectedPlanningLabels: string[];
  days: ConflictGroupDay[];
  recommendations?: Recommendation[];
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
  returnBufferDays?: number;
  handoverSummary?: {
    direction: "outgoing" | "incoming" | "mixed";
    partnerPlanningId?: string | null;
    partnerPlanningLabel?: string | null;
    partnerPlanningCount: number;
    categoryKeys: string[];
  } | null;
  openConflictCount?: number;
  missingItems?: PlanningListMissingItem[];
  // Additiv: je Konfliktzelle (Tag x Kategorie) ein klassifizierter Eintrag.
  // Anzahl harter Einträge entspricht openConflictCount.
  conflicts?: PlanningConflictDetail[];
  // Additiv (Kalender-Zeitleiste): Bedarf + Ausgabestand direkt in der Liste,
  // damit der Kalender keine Detail-Roundtrips pro Planung braucht.
  totalQty?: number;
  categoryTotals?: Array<{ categoryKey: string; qty: number }>;
  assignedCount?: number;
  handoverNeedsReview?: boolean;
  // Verantwortlicher (projectManagerUserId) inkl. Signaturfarbe/Initialen.
  responsibleUser?: {
    id: string;
    name: string;
    initials: string;
    signatureColor: string;
  } | null;
  // On-Site-Verantwortlicher (vor Ort) - gleiche aufgeloeste Struktur.
  onSiteResponsibleUser?: {
    id: string;
    name: string;
    initials: string;
    signatureColor: string;
  } | null;
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

export type IncomingHandoverRef = {
  planningDate: string;
  categoryKey: string;
  partnerPlanningId: string;
  partnerPlanningLabel?: string | null;
  qty?: number;
  note?: string | null;
};

export type PlanningResponse = {
  id: string;
  customerName: string;
  projectName: string;
  eventName?: string | null;
  projectManagerUserId?: string | null;
  onSiteResponsibleUserId?: string | null;
  calendarWeek?: number | null;
  startDate: string;
  endDate: string;
  notes: string;
  status: PlanningStatus;
  templateSourcePlanningId?: string | null;
  returnBufferDays?: number;
  createdAt: string;
  updatedAt: string;
  days: PlanningDayResponse[];
  incomingHandovers?: IncomingHandoverRef[];
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
  // Anzahl Geräte, die für diese Bedarfszeile vom Bestand ausgeschlossen
  // wurden (z. B. Kartendrucker-inkompatible Laptops). 0 sonst.
  excludedQty?: number;
  // Anzahl Geräte, die GLOBAL aus der Einsatzplanung ausgeschlossen sind
  // (availableForPlanning=false, z. B. interne Server-Laptops). 0 sonst.
  excludedFromPlanningQty?: number;
  // Mindestbedarf-Kopplung Kartendrucker → Laptop (1:1).
  // cardPrinterRequiredQty: Anzahl Kartendrucker an diesem Tag (informativ,
  //   nur auf Laptop-Zeilen > 0).
  // cardPrinterUpliftQty: Differenz, um die der Laptop-Bedarf wegen der
  //   Kopplung angehoben wurde — > 0 triggert den UI-Hinweis.
  cardPrinterRequiredQty?: number;
  cardPrinterUpliftQty?: number;
  // Schweregrad-Einordnung (additiv). Bei reinen grünen Zellen null/leer.
  conflictDay?: string | null;
  shortageReason?: PlanningConflictReason | null;
  conflictSeverity?: PlanningConflictSeverity | null;
  conflictLabel?: string | null;
  secondary?: ConflictBadge[];
};

export type PlanningAvailabilityCategorySummary = {
  categoryKey: string;
  requestedTotal: number;
  maxRequestedPerDay: number;
  totalStock: number;
  usableStock: number;
  excludedFromUsable?: number;
  excludedFromPlanningTotal?: number;
};

export type PlanningAvailabilityResponse = {
  planningId: string;
  periodStart: string;
  periodEnd: string;
  items: PlanningAvailabilityItem[];
  categorySummary: PlanningAvailabilityCategorySummary[];
  incomingHandovers?: IncomingHandoverRef[];
};

// Schritt C: geplant vs. ausgegeben + zugeordnete Geräte (reine Anzeige).
export type PlanningAssignedCategory = {
  categoryKey: string;
  plannedQty: number;
  assignedQty: number;
  differenceQty: number;
};

export type PlanningAssignedAsset = {
  id: string;
  name: string;
  category: string;
  status: string;
  model?: string | null;
  serialNumber: string;
  tagNumber: string;
  qrCode?: string;
  assignedTo: string;
  expectedReturnDate?: string | null;
  assignedPlanningId?: string | null;
};

export type PlanningAssignedAssetsResponse = {
  planningId: string;
  plannedTotal: number;
  assignedTotal: number;
  differenceTotal: number;
  categories: PlanningAssignedCategory[];
  assets: PlanningAssignedAsset[];
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

/**
 * In-Memory-Auth-Status (Security-Audit Paket B4).
 *
 * Der Auth-Token liegt NICHT mehr im localStorage, sondern in einem
 * HttpOnly-Cookie, das der Browser automatisch mitschickt und das fuer
 * JavaScript unsichtbar ist. Im Frontend wird daher nur noch das
 * (unkritische) Benutzerprofil gehalten — rein im Speicher, ohne Persistenz.
 * Nach einem echten Reload ist `currentUser` zunaechst `null`; der
 * Login-Status wird dann ueber GET /api/auth/me anhand des Cookies neu
 * ermittelt.
 */
let currentUser: AuthUser | null = null;

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
  // Kein Authorization-Header mehr (Paket B4): der Auth-Token reist als
  // HttpOnly-Cookie, das der Browser bei same-origin-Requests automatisch
  // anhaengt. Der Projektkontext ist nicht sicherheitskritisch und bleibt
  // ein expliziter Header.
  if (currentAccessContext.projectContext) {
    headers['X-Project-Context'] = currentAccessContext.projectContext;
  }
  // CSRF-Schutz: Schreibende Admin-Endpunkte verlangen diesen Header bei
  // Cookie-Authentifizierung. Fremde Seiten koennen ihn nicht setzen
  // (Formulare gar nicht, fetch nur mit CORS-Preflight, der scheitert).
  headers['X-Requested-With'] = 'XMLHttpRequest';
  return headers;
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const response = await rawApiFetch(path, init);
  if (response.status !== 401 || !shouldTryDeviceRefresh(path)) {
    return response;
  }
  // Companion-Gerät: Das kurzlebige Access-Token ist abgelaufen oder wurde
  // (z. B. durch einen Desktop-Logout) ungültig — mit dem Geräte-Cookie still
  // erneuern und die Anfrage genau einmal wiederholen.
  const outcome = await refreshDeviceSession();
  if (outcome.kind === 'ok') {
    return rawApiFetch(path, init);
  }
  if (outcome.kind === 'locked') {
    notifyCompanionLocked();
    return outcome.response;
  }
  return response;
}

// --- Companion-Gerätesitzung ------------------------------------------------

type DeviceRefreshOutcome =
  | { kind: 'ok'; session: CompanionSession }
  | { kind: 'locked'; response: Response }
  | { kind: 'none' };

let deviceRefreshInFlight: Promise<DeviceRefreshOutcome> | null = null;
// Kein Geräte-Cookie vorhanden (normale Browser-Sitzung): nicht bei jedem 401
// erneut nachfragen.
let deviceRefreshUnavailableUntil = 0;
const DEVICE_REFRESH_NEGATIVE_CACHE_MS = 60_000;

function shouldTryDeviceRefresh(path: string): boolean {
  if (path.startsWith('/api/companion/')) return false;
  if (path === '/api/auth/login' || path === '/api/auth/logout') return false;
  return Date.now() >= deviceRefreshUnavailableUntil;
}

/** Nach Kopplung/Login wieder sofort einen Erneuerungsversuch zulassen. */
export function resetDeviceRefreshState(): void {
  deviceRefreshUnavailableUntil = 0;
}

/**
 * Erneuert die Gerätesitzung (rotiert das Geräte-Secret).
 *
 * Bewusst "single flight": Mehrere gleichzeitig abgelehnte Requests teilen
 * sich EINEN Erneuerungsversuch — parallele Rotationen würden sonst als
 * Wiederverwendung eines alten Secrets gewertet.
 */
export function refreshDeviceSession(): Promise<DeviceRefreshOutcome> {
  if (deviceRefreshInFlight) return deviceRefreshInFlight;
  deviceRefreshInFlight = (async (): Promise<DeviceRefreshOutcome> => {
    try {
      const response = await rawApiFetch('/api/companion/session/refresh', { method: 'POST' });
      if (response.ok) {
        const session = normalizeDeep((await response.json()) as CompanionSession);
        setCurrentUser(session.user);
        return { kind: 'ok', session };
      }
      if (response.status === 423) {
        return { kind: 'locked', response };
      }
      deviceRefreshUnavailableUntil = Date.now() + DEVICE_REFRESH_NEGATIVE_CACHE_MS;
      return { kind: 'none' };
    } catch {
      return { kind: 'none' };
    } finally {
      window.setTimeout(() => {
        deviceRefreshInFlight = null;
      }, 0);
    }
  })();
  return deviceRefreshInFlight;
}

let companionLockedHandler: (() => void) | null = null;

/** App-Komponente registriert hier den Wechsel auf den Sperrbildschirm. */
export function setCompanionLockedHandler(handler: (() => void) | null): void {
  companionLockedHandler = handler;
}

function notifyCompanionLocked(): void {
  try {
    companionLockedHandler?.();
  } catch {
    // Handler-Fehler dürfen den Request-Fehlerpfad nicht stören.
  }
}

async function rawApiFetch(path: string, init?: RequestInit): Promise<Response> {
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
        // Das HttpOnly-Auth-Cookie bei jedem Request mitschicken. Bei
        // same-origin ist das zwar der fetch-Default, wird hier aber explizit
        // gesetzt, damit der Auth-Pfad nicht von einer (geaenderten)
        // Default-Policy abhaengt.
        credentials: 'same-origin',
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

/** Liefert das aktuell im Speicher gehaltene Benutzerprofil (oder null). */
export function getCurrentUser(): AuthUser | null {
  return currentUser;
}

function setCurrentUser(user: AuthUser): void {
  currentUser = user;
}

/**
 * Verwirft den lokalen Auth-Status.
 *
 * Loescht NUR das in-memory Benutzerprofil — das HttpOnly-Cookie ist fuer
 * JavaScript ohnehin nicht erreichbar und wird serverseitig (Logout-Endpoint)
 * bzw. durch Ablauf entfernt.
 */
export function clearCurrentUser(): void {
  currentUser = null;
}

/**
 * Zentrales 401-Handling (Security-Audit Paket A).
 *
 * Antwortet das Backend mit 401 (Token abgelaufen, ungültig oder
 * widerrufen), wird die lokale Session verworfen und die registrierte
 * App-Komponente informiert, damit sie sauber auf den Login-State
 * zurückwechselt — statt mit ungültigem Token weiterzulaufen.
 */
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

function notifyUnauthorized(): void {
  if (!unauthorizedHandler) return;
  try {
    unauthorizedHandler();
  } catch {
    // Handler-Fehler dürfen den ursprünglichen Request-Fehlerpfad nicht stören.
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
    if (response.status === 401) {
      // Token ungültig/abgelaufen/widerrufen: lokalen Auth-Status verwerfen
      // und die App zurück in den Login-State zwingen, statt
      // unauthentifiziert weiterzulaufen.
      clearCurrentUser();
      notifyUnauthorized();
    }
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

async function putJson<T>(path: string, payload: unknown): Promise<T> {
  const response = await apiFetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(normalizeOutbound(payload)),
  });
  return parseResponse<T>(response);
}

async function patchJson<T>(path: string, payload: unknown): Promise<T> {
  const response = await apiFetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(normalizeOutbound(payload)),
  });
  return parseResponse<T>(response);
}

export async function fetchWmsOverview(signal?: AbortSignal): Promise<WmsOverview> {
  // Optionales AbortSignal: der Aufrufer kann einen noch laufenden
  // Overview-Request abbrechen, sobald ein neuer ihn ersetzt.
  const response = await apiFetch('/api/wms/overview', signal ? { signal } : undefined);
  return parseResponse<WmsOverview>(response);
}

export async function login(payload: AuthLoginPayload): Promise<AuthUser> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), LOGIN_TIMEOUT_MS);
  try {
    const response = await apiFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    // Das Backend setzt bei Erfolg das HttpOnly-Auth-Cookie. Hier wird nur
    // das Benutzerprofil aus der Antwort uebernommen — der Token im Body
    // wird vom Browser-Client bewusst ignoriert und nicht gespeichert.
    const body = await parseResponse<AuthLoginResponseBody>(response);
    setCurrentUser(body.user);
    return body.user;
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
    const user = await parseResponse<AuthUser>(response);
    // Profil aktuell halten, damit getCurrentUser() nach einem Reload
    // wieder den eingeloggten Benutzer kennt.
    setCurrentUser(user);
    return user;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Sitzung konnte nicht geprüft werden: Backend antwortet nicht.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

/**
 * Meldet den Benutzer ab.
 *
 * Serverseitig (Paket B2/B4): erhoeht die token_version — wodurch jeder
 * ausgestellte Token ungueltig wird — und loescht das HttpOnly-Auth-Cookie.
 * Der Logout-Endpunkt ist idempotent; ein Fehler oder Timeout hier darf das
 * Abmelden NICHT blockieren, daher wird der lokale Auth-Status in jedem Fall
 * (auch im Fehlerpfad) verworfen.
 */
export async function logout(): Promise<void> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), AUTH_ME_TIMEOUT_MS);
  try {
    if (currentUser?.deviceId) {
      // Companion-Gerät: nur diese Gerätesitzung beenden (inkl. Geräte-Cookie);
      // Desktop und andere Geräte bleiben angemeldet.
      await rawApiFetch('/api/companion/session/logout', { method: 'POST', signal: controller.signal });
    }
    await apiFetch('/api/auth/logout', { method: 'POST', signal: controller.signal });
  } catch {
    // Bewusst ignoriert — das lokale Logout passiert in jedem Fall.
  } finally {
    window.clearTimeout(timeout);
    clearCurrentUser();
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

export type BulkAssetDeleteResultItem = {
  assetId: string;
  deleted: boolean;
  reason?: string | null;
};

export type BulkAssetDeleteResponse = {
  deletedCount: number;
  skippedCount: number;
  results: BulkAssetDeleteResultItem[];
};

export function deleteAssetsBulk(assetIds: string[]): Promise<BulkAssetDeleteResponse> {
  return postJson<BulkAssetDeleteResponse>('/api/wms/assets/bulk-delete', { assetIds });
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

// --- Sammel-QR (Gruppen-QR für vorhandene Fremdbestand-Assets) ---
export type QrGroupStockType = 'rented' | 'borrowed' | 'external';

export type QrGroup = {
  id: string;
  name: string;
  qrToken: string;
  // Im QR-Code zu kodierender Wert ("GROUP:<token>").
  qrCode: string;
  category: string;
  stockType?: QrGroupStockType | null;
  sourceName?: string | null;
  isActive: boolean;
  memberCount: number;
  availableCount: number;
  loanedCount: number;
  createdAt?: string | null;
};

export type QrGroupCreatePayload = {
  name: string;
  category: string;
  stockType?: QrGroupStockType | null;
  sourceName?: string | null;
  assetIds: string[];
};

export type QrGroupBookingResult = {
  groupId: string;
  requestedCount: number;
  bookedCount: number;
  bookedAssetIds: string[];
  message: string;
};

export async function listQrGroups(): Promise<QrGroup[]> {
  const response = await apiFetch('/api/wms/qr-groups');
  return parseResponse<QrGroup[]>(response);
}

export function createQrGroup(payload: QrGroupCreatePayload): Promise<QrGroup> {
  return postJson<QrGroup>('/api/wms/qr-groups', payload);
}

export async function resolveQrGroup(token: string): Promise<QrGroup> {
  const response = await apiFetch(`/api/wms/qr-groups/resolve/${encodeURIComponent(token)}`);
  const data = await parseResponse<{ group: QrGroup }>(response);
  return data.group;
}

export function qrGroupCheckout(
  groupId: string,
  payload: {
    quantity: number;
    assignee?: string | null;
    projectName?: string | null;
    planningId?: string | null;
    dueDate?: string | null;
    note?: string | null;
  },
): Promise<QrGroupBookingResult> {
  return postJson<QrGroupBookingResult>(
    `/api/wms/qr-groups/${encodeURIComponent(groupId)}/checkout`,
    payload,
  );
}

export function qrGroupCheckin(
  groupId: string,
  payload: { quantity: number; projectName?: string | null; condition?: string | null },
): Promise<QrGroupBookingResult> {
  return postJson<QrGroupBookingResult>(
    `/api/wms/qr-groups/${encodeURIComponent(groupId)}/checkin`,
    payload,
  );
}

export function deactivateQrGroup(groupId: string): Promise<QrGroup> {
  return postJson<QrGroup>(`/api/wms/qr-groups/${encodeURIComponent(groupId)}/deactivate`, {});
}

export async function deleteQrGroup(groupId: string): Promise<{ deleted: boolean }> {
  const response = await apiFetch(`/api/wms/qr-groups/${encodeURIComponent(groupId)}`, {
    method: 'DELETE',
  });
  return parseResponse<{ deleted: boolean }>(response);
}

// --- Telekompass (LTE-Router) ---
export type TelecomPassSettings = {
  unitPrice: number;
};

export type TelecomPassBookingItem = {
  id: string;
  assetId: string;
  planningId?: string | null;
  quantity: number;
  unitPriceSnapshot: number;
  totalPriceSnapshot: number;
  kind: 'booking' | 'correction';
  createdAt?: string | null;
  createdByUserId?: string | null;
};

export type TelecomPassBookingResult = {
  asset: Asset;
  booking?: TelecomPassBookingItem | null;
  duplicate: boolean;
};

export async function getTelecomPassSettings(): Promise<TelecomPassSettings> {
  const response = await apiFetch('/api/wms/telecom-pass/settings');
  return parseResponse<TelecomPassSettings>(response);
}

export function updateTelecomPassSettings(unitPrice: number): Promise<TelecomPassSettings> {
  return putJson<TelecomPassSettings>('/api/wms/telecom-pass/settings', { unitPrice });
}

export function recordTelecomPassBooking(
  assetId: string,
  payload: { quantity: number; idempotencyKey?: string | null; planningId?: string | null },
): Promise<TelecomPassBookingResult> {
  return postJson<TelecomPassBookingResult>(
    `/api/wms/assets/${encodeURIComponent(assetId)}/telecom-pass-booking`,
    payload,
  );
}

export async function listTelecomPassBookings(assetId: string): Promise<TelecomPassBookingItem[]> {
  const response = await apiFetch(
    `/api/wms/assets/${encodeURIComponent(assetId)}/telecom-pass-bookings`,
  );
  return parseResponse<TelecomPassBookingItem[]>(response);
}

export function correctTelecomPassCount(
  assetId: string,
  total: number,
): Promise<TelecomPassBookingResult> {
  return putJson<TelecomPassBookingResult>(
    `/api/wms/assets/${encodeURIComponent(assetId)}/telecom-pass-count`,
    { total },
  );
}

// Holt die Kategorien-Stammdaten aus dem Backend (mit ids), damit das
// Frontend für Delete die richtige id mitschicken kann. Die abgeleitete
// "Kategorien aus vorhandenen Assets"-Liste im Controller hat keine ids.
export async function listCategories(): Promise<CategoryItem[]> {
  const response = await apiFetch('/api/wms/categories');
  return parseResponse<CategoryItem[]>(response);
}

// Legt eine neue Kategorie serverseitig an (POST /api/wms/categories).
// Das Backend ist die Quelle der Wahrheit: nur so bleibt die Kategorie
// nach einem Reload erhalten (GET /api/wms/categories). Die Antwort trägt
// die vergebene id, sodass die Kategorie sofort löschbar ist. Bei einem
// Alias/Duplikat antwortet das Backend mit HTTP 409, bei leerem Namen mit
// 422 — die Meldung steht jeweils im detail.
export function createCategory(name: string): Promise<CategoryItem> {
  return postJson<CategoryItem>('/api/wms/categories', { name });
}

export function updateCategory(
  categoryId: number,
  payload: { defaultImageSourceUrl?: string | null },
): Promise<CategoryItem> {
  return patchJson<CategoryItem>(`/api/wms/categories/${categoryId}`, payload);
}

// „Bild neu laden": erzwingt einen erneuten serverseitigen Download des
// Kategorie-Standardbilds aus der gespeicherten Quell-URL. Antwort trägt den
// aktualisierten Status (ready/failed) inkl. Fehlermeldung.
export function refreshCategoryDefaultImage(categoryId: number): Promise<CategoryItem> {
  return postJson<CategoryItem>(
    `/api/wms/categories/${categoryId}/default-image/refresh`,
    {},
  );
}

// „Bild neu laden" für ein einzelnes Asset (Produktbild).
export function refreshAssetProductImage(assetId: string): Promise<Asset> {
  return postJson<Asset>(
    `/api/wms/assets/${encodeURIComponent(assetId)}/product-image/refresh`,
    {},
  );
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

export type LocationCleanupResponse = {
  keptLocation: string;
  deletedLocations: string[];
  skippedLocations: string[];
};

export function cleanupUnusedLocations(): Promise<LocationCleanupResponse> {
  return postJson<LocationCleanupResponse>('/api/wms/locations/cleanup-unused', {});
}

export function upsertUser(user: UserItem): Promise<UserItem> {
  return postJson<UserItem>('/api/wms/users', user);
}

// Signaturfarbe eines Benutzers setzen oder auf Automatik zuruecksetzen
// (nur Admin; nur Paletten-Werte, Reset vergibt die am wenigsten genutzte
// Farbe neu).
export async function updateUserSignature(
  userId: string,
  payload: { signatureColor?: string; reset?: boolean },
): Promise<UserItem> {
  const body = payload.reset
    ? { resetSignatureColor: true }
    : { signatureColor: payload.signatureColor };
  const response = await apiFetch(`/api/wms/users/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseResponse<UserItem>(response);
}

export async function register(payload: AuthRegisterPayload): Promise<AuthRegisterResponse> {
  const response = await apiFetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseResponse<AuthRegisterResponse>(response);
}

/**
 * Löst einen E-Mail-Bestätigungstoken ein.
 *
 * Bewusst POST (und nicht der Link-Aufruf selbst): Der Token landet damit
 * weder in Server-/Proxy-Logs noch in der Browser-History. Die aufrufende
 * Seite entfernt ihn zusätzlich sofort aus der Adresszeile.
 */
export async function verifyEmail(token: string): Promise<AuthVerifyEmailResponse> {
  const response = await apiFetch('/api/auth/verify-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  return parseResponse<AuthVerifyEmailResponse>(response);
}

/** Fordert einen neuen Bestätigungslink an (Antwort ist immer generisch). */
export async function resendVerification(email: string): Promise<AuthResendVerificationResponse> {
  const response = await apiFetch('/api/auth/resend-verification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return parseResponse<AuthResendVerificationResponse>(response);
}

export type UserVerificationResendResponse = {
  sent: boolean;
  message: string;
  hint?: string | null;
};

/** Admin-Aktion: Bestätigungs-E-Mail für ein wartendes Konto erneut senden. */
export function resendUserVerification(userId: string): Promise<UserVerificationResendResponse> {
  return postJson<UserVerificationResendResponse>(
    `/api/wms/users/${userId}/resend-verification`,
    {},
  );
}

// --- Adminbereich: E-Mail-Einstellungen (SMTP) --------------------------------
// Grundregel: Der Client sieht NIE ein SMTP-Passwort. `passwordSet` sagt nur,
// ob eines hinterlegt ist; gesendet wird es ausschließlich beim Ändern.

export type MailSecurity = 'starttls' | 'ssl' | 'none';
export type RegistrationMode = 'classic_admin_approval' | 'email_verification';
export type MailConfigSource = 'admin' | 'env' | 'none';

export type MailSettings = {
  enabled: boolean;
  host?: string | null;
  port: number;
  security: MailSecurity;
  username?: string | null;
  passwordSet: boolean;
  fromEmail?: string | null;
  fromName?: string | null;
  timeoutSeconds: number;
  verificationExpiryHours: number;
  // Öffentliche WWS-Adresse aus der Administration (null = FRONTEND_URL gilt).
  publicBaseUrl?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
};

export type MailSettingsInput = {
  enabled: boolean;
  host: string;
  port: number;
  security: MailSecurity;
  username: string;
  // Weglassen = gespeichertes Passwort bleibt unverändert.
  password?: string;
  clearPassword?: boolean;
  fromEmail: string;
  fromName: string;
  timeoutSeconds: number;
  verificationExpiryHours: number;
  // '' = Admin-Wert entfernen (FRONTEND_URL gilt wieder).
  publicBaseUrl: string;
};

export type MailStatusState =
  | 'not_configured'
  | 'disabled'
  | 'configured'
  | 'test_succeeded'
  | 'connection_failed'
  | 'send_failed';

export type MailStatus = {
  state: MailStatusState;
  source: MailConfigSource;
  canSend: boolean;
  problem?: string | null;
  lastTestAt?: string | null;
  lastTestSuccess?: boolean | null;
  lastTestError?: string | null;
  lastSendAt?: string | null;
  lastSendSuccess?: boolean | null;
  lastSendError?: string | null;
  testMailAcceptedAt?: string | null;
  registrationMode: RegistrationMode;
  registrationEnabled: boolean;
  canEnableVerification: boolean;
  verificationBlockers: string[];
  secretStorageAvailable: boolean;
  secretStorageHint?: string | null;
  // Herkunft des Schlüssels für das SMTP-Passwort (nie der Schlüssel selbst).
  secretKeySource?: 'derived' | 'explicit' | null;
  // null = kein Passwort gespeichert.
  passwordReadable?: boolean | null;
  frontendUrlReady: boolean;
  frontendUrlHint?: string | null;
  publicBaseUrl?: string | null;
  publicBaseUrlSource: MailConfigSource;
  verificationExpiryHours: number;
  plainSmtpAllowed: boolean;
};

export type MailTestConnectionResult = {
  success: boolean;
  message: string;
  connectionOk: boolean;
  authenticationOk: boolean;
};

export type MailSendTestResult = MailTestConnectionResult & { accepted: boolean };

export type RegistrationModeResult = {
  mode: RegistrationMode;
  message: string;
};

export async function fetchMailSettings(): Promise<MailSettings> {
  return parseResponse<MailSettings>(await apiFetch('/api/admin/email/settings'));
}

export async function saveMailSettings(payload: MailSettingsInput): Promise<MailSettings> {
  const response = await apiFetch('/api/admin/email/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseResponse<MailSettings>(response);
}

export async function fetchMailStatus(): Promise<MailStatus> {
  return parseResponse<MailStatus>(await apiFetch('/api/admin/email/status'));
}

export function testMailConnection(): Promise<MailTestConnectionResult> {
  return postJson<MailTestConnectionResult>('/api/admin/email/test-connection', {});
}

export function sendMailTest(recipient: string): Promise<MailSendTestResult> {
  return postJson<MailSendTestResult>('/api/admin/email/send-test', { recipient });
}

export async function updateRegistrationMode(
  mode: RegistrationMode,
): Promise<RegistrationModeResult> {
  const response = await apiFetch('/api/admin/email/registration-mode', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  return parseResponse<RegistrationModeResult>(response);
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

// --- Sicherheit & Protokolle (Security-Paket „supman") ----------------------

export function approveUser(userId: string): Promise<UserItem> {
  return postJson<UserItem>(`/api/wms/users/${userId}/approve`, {});
}

export function rejectUser(userId: string): Promise<UserItem> {
  return postJson<UserItem>(`/api/wms/users/${userId}/reject`, {});
}

export function lockUser(userId: string): Promise<UserItem> {
  return postJson<UserItem>(`/api/wms/users/${userId}/lock`, {});
}

export function unlockUser(userId: string): Promise<UserItem> {
  return postJson<UserItem>(`/api/wms/users/${userId}/unlock`, {});
}

export function revokeUserSessions(userId: string): Promise<{ ok: boolean }> {
  return postJson<{ ok: boolean }>(`/api/wms/users/${userId}/revoke-sessions`, {});
}

export async function fetchUserSecurityInfo(userId: string): Promise<UserSecurityInfo> {
  const response = await apiFetch(`/api/wms/users/${userId}/security`);
  return parseResponse<UserSecurityInfo>(response);
}

export type SecurityEventFilters = {
  type?: string;
  user?: string;
  ip?: string;
  severity?: string;
  success?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

function securityEventQuery(filters: SecurityEventFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && `${value}`.trim() !== '') {
      params.set(key, `${value}`);
    }
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

export async function listSecurityEvents(
  filters: SecurityEventFilters = {},
): Promise<{ items: SecurityEventItem[]; total: number }> {
  const response = await apiFetch(`/api/wms/admin/security-events${securityEventQuery(filters)}`);
  return parseResponse<{ items: SecurityEventItem[]; total: number }>(response);
}

export async function fetchSecuritySummary(since?: string): Promise<SecuritySummary> {
  const query = since ? `?since=${encodeURIComponent(since)}` : '';
  const response = await apiFetch(`/api/wms/admin/security-events/summary${query}`);
  return parseResponse<SecuritySummary>(response);
}

export async function downloadSecurityEventsCsv(
  filters: SecurityEventFilters = {},
): Promise<{ blob: Blob; fileName: string }> {
  const response = await apiFetch(`/api/wms/admin/security-events/export${securityEventQuery(filters)}`);
  if (!response.ok) {
    throw new WmsApiError(response.status, '', `WMS API Fehler (${response.status})`);
  }
  const contentDisposition = response.headers.get('content-disposition') || '';
  const fileNameMatch = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(contentDisposition);
  const fallback = `sicherheitsprotokoll-${new Date().toISOString().slice(0, 10)}.csv`;
  const fileName = decodeURIComponent(fileNameMatch?.[1] || fallback);
  return { blob: await response.blob(), fileName };
}

export async function fetchRegistrationSetting(): Promise<{ enabled: boolean }> {
  const response = await apiFetch('/api/wms/admin/settings/registration');
  return parseResponse<{ enabled: boolean }>(response);
}

export function updateRegistrationSetting(enabled: boolean): Promise<{ enabled: boolean }> {
  return putJson<{ enabled: boolean }>('/api/wms/admin/settings/registration', { enabled });
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

// --- Login-Hintergrundbilder -------------------------------------------------

export type LoginBackground = {
  id: string;
  url: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  uploadedByName?: string | null;
  isActive: boolean;
  createdAt: string;
};

export function fetchLoginBackgrounds(): Promise<LoginBackground[]> {
  return apiFetch('/api/wms/admin/login-backgrounds').then((response) =>
    parseResponse<LoginBackground[]>(response),
  );
}

export async function uploadLoginBackground(file: File): Promise<LoginBackground> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await apiFetch('/api/wms/admin/login-backgrounds', {
    method: 'POST',
    body: formData,
  });
  return parseResponse<LoginBackground>(response);
}

export async function activateLoginBackground(id: string): Promise<LoginBackground> {
  const response = await apiFetch(`/api/wms/admin/login-backgrounds/${id}/activate`, {
    method: 'PATCH',
  });
  return parseResponse<LoginBackground>(response);
}

export async function deleteLoginBackground(id: string): Promise<{ deleted: boolean }> {
  const response = await apiFetch(`/api/wms/admin/login-backgrounds/${id}`, { method: 'DELETE' });
  return parseResponse<{ deleted: boolean }>(response);
}

export function deactivateLoginBackground(): Promise<{ deactivated: boolean }> {
  return postJson<{ deactivated: boolean }>('/api/wms/admin/login-backgrounds/deactivate', {});
}

/**
 * Öffentliche Login-Branding-Abfrage — läuft VOR der Anmeldung. Bewusst ein
 * schlichter fetch (nicht apiFetch/parseResponse), damit ein Fehler oder ein
 * unerwarteter Status niemals den globalen 401-Handler auslöst; jeder Fehler
 * führt einfach zum statischen Standard-Hintergrund.
 */
export async function fetchLoginBranding(): Promise<{ backgroundUrl: string | null }> {
  try {
    for (const url of apiUrls('/api/wms/login-branding')) {
      try {
        const response = await fetch(url, { credentials: 'same-origin' });
        if (!response.ok) continue;
        const payload = (await response.json()) as { backgroundUrl?: string | null };
        return { backgroundUrl: payload.backgroundUrl ?? null };
      } catch {
        // nächste URL-Variante versuchen
      }
    }
  } catch {
    // ignorieren — Fallback auf statischen Hintergrund
  }
  return { backgroundUrl: null };
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
  // Nur Planungen, denen der eingeloggte Benutzer zugewiesen ist
  // (Projektverantwortlicher ODER On-Site-Verantwortlicher). Serverseitig
  // gefiltert — Grundlage der persönlichen Dashboard-Sicht.
  assignedToMe?: boolean;
}): Promise<PlanningListItem[]> {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.fromDate) params.set("fromDate", filters.fromDate);
  if (filters?.toDate) params.set("toDate", filters.toDate);
  if (filters?.assignedToMe) params.set("assignedToMe", "true");
  const query = params.toString();
  const response = await apiFetch(`/api/wms/planning${query ? `?${query}` : ""}`);
  return parseResponse<PlanningListItem[]>(response);
}

// In-Flight-Dedup: wenn fuer dieselbe Planning-ID bereits ein Request
// laeuft, wird der bestehende Promise wiederverwendet. Schuetzt gegen
// Race Conditions, wenn mehrere Effects (z. B. Open + Save + Refresh)
// quasi-zeitgleich denselben Detail-Endpoint anfragen. Sobald der Request
// abgeschlossen ist (erfolgreich ODER mit Fehler), wird der Eintrag aus
// der Map entfernt — kein Caching, nur Dedup.
const inFlightGetPlanning = new Map<string, Promise<PlanningResponse>>();

export function getPlanning(planningId: string): Promise<PlanningResponse> {
  const existing = inFlightGetPlanning.get(planningId);
  if (existing) return existing;

  const pending = (async () => {
    const response = await apiFetch(`/api/wms/planning/${planningId}`);
    return parseResponse<PlanningResponse>(response);
  })().finally(() => {
    inFlightGetPlanning.delete(planningId);
  });

  inFlightGetPlanning.set(planningId, pending);
  return pending;
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

export async function getPlanningAssignedAssets(planningId: string): Promise<PlanningAssignedAssetsResponse> {
  const response = await apiFetch(`/api/wms/planning/${planningId}/assigned-assets`);
  return parseResponse<PlanningAssignedAssetsResponse>(response);
}

// --- Planungs-Historie (Audit-Log je Planung, Detailseite) ---

export type PlanningEventType =
  | "planning_created"
  | "status_changed"
  | "timeframe_changed"
  | "position_added"
  | "position_removed"
  | "quantity_changed"
  | "note_added"
  | "issue_recorded"
  | "return_recorded";

export type PlanningEventItem = {
  id: number;
  eventType: PlanningEventType | string;
  actorId?: string | null;
  actorName?: string | null;
  // ISO-8601 UTC (mit "Z") — im Client in Lokalzeit formatieren.
  createdAt: string;
  payload?: Record<string, unknown> | null;
};

export async function listPlanningEvents(planningId: string): Promise<PlanningEventItem[]> {
  const response = await apiFetch(`/api/wms/planning/${planningId}/events`);
  const body = await parseResponse<{ events: PlanningEventItem[] }>(response);
  return body.events ?? [];
}

export function addPlanningNote(planningId: string, text: string): Promise<PlanningEventItem> {
  return postJson<PlanningEventItem>(`/api/wms/planning/${planningId}/events/note`, { text });
}

// --- Automatische Projektübergabe (Asset-Handover A→B) ---
export type HandoverCategoryState =
  | "not_applicable"
  | "planned"
  | "due"
  | "partially_executed"
  | "executed";

export type HandoverCategoryStatus = {
  categoryKey: string;
  targetPlanningId?: string | null;
  targetPlanningLabel?: string | null;
  issuedQty: number;
  configuredQty: number;
  targetDemand: number;
  plannedTotal: number;
  alreadyTransferredQty: number;
  transferableQty: number;
  state: HandoverCategoryState;
  transferAssetIds: string[];
};

export type HandoverStatusResponse = {
  planningId: string;
  sourceReturnDay: string;
  dueNow: boolean;
  autoEligible: boolean;
  totalTransferable: number;
  totalAlreadyTransferred: number;
  categories: HandoverCategoryStatus[];
};

export type HandoverRunResponse = {
  planningId: string;
  batchId?: string | null;
  transferredCount: number;
  transferred: { assetId: string; name: string; category: string; targetPlanningId: string }[];
  skippedCount: number;
};

export type HandoverUndoResponse = {
  planningId: string;
  revertedCount: number;
  skippedCount: number;
};

export async function getHandoverStatus(planningId: string): Promise<HandoverStatusResponse> {
  const response = await apiFetch(`/api/wms/planning/${planningId}/handover/status`);
  return parseResponse<HandoverStatusResponse>(response);
}

export async function runHandover(planningId: string, force = false): Promise<HandoverRunResponse> {
  const response = await apiFetch(`/api/wms/planning/${planningId}/handover/run?force=${force ? "true" : "false"}`, {
    method: "POST",
  });
  return parseResponse<HandoverRunResponse>(response);
}

export async function undoHandover(planningId: string): Promise<HandoverUndoResponse> {
  const response = await apiFetch(`/api/wms/planning/${planningId}/handover/undo`, { method: "POST" });
  return parseResponse<HandoverUndoResponse>(response);
}

// --- Schritt E: admin-pflegbare Update-Notes ---
export type UpdateNote = {
  id: string;
  version: string;
  date?: string | null;
  title?: string | null;
  items: string[];
  isPublished: boolean;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UpdateNoteCreatePayload = {
  version: string;
  date?: string | null;
  title?: string | null;
  items: string[];
};

export type UpdateNoteUpdatePayload = Partial<UpdateNoteCreatePayload>;

export async function getLatestUpdateNote(): Promise<UpdateNote | null> {
  const response = await apiFetch('/api/wms/update-notes/latest');
  return parseResponse<UpdateNote | null>(response);
}

export async function listUpdateNotes(): Promise<UpdateNote[]> {
  const response = await apiFetch('/api/wms/admin/update-notes');
  return parseResponse<UpdateNote[]>(response);
}

export function createUpdateNote(payload: UpdateNoteCreatePayload): Promise<UpdateNote> {
  return postJson<UpdateNote>('/api/wms/admin/update-notes', payload);
}

export async function updateUpdateNote(id: string, payload: UpdateNoteUpdatePayload): Promise<UpdateNote> {
  const response = await apiFetch(`/api/wms/admin/update-notes/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(normalizeOutbound(payload)),
  });
  return parseResponse<UpdateNote>(response);
}

export function publishUpdateNote(id: string): Promise<UpdateNote> {
  return postJson<UpdateNote>(`/api/wms/admin/update-notes/${id}/publish`, {});
}

export async function deleteUpdateNote(id: string): Promise<{ deleted: boolean }> {
  const response = await apiFetch(`/api/wms/admin/update-notes/${id}`, { method: 'DELETE' });
  return parseResponse<{ deleted: boolean }>(response);
}

// --- Label-Prüfung (serverseitige Audit-Prüfrunden, alle Endpunkte Admin-only) ---
export async function listLabelAuditSessions(): Promise<LabelAuditSessionListItem[]> {
  const response = await apiFetch('/api/wms/label-audit/sessions');
  return parseResponse<LabelAuditSessionListItem[]>(response);
}

export async function getActiveLabelAuditSession(): Promise<LabelAuditSession> {
  const response = await apiFetch('/api/wms/label-audit/sessions/active');
  return parseResponse<LabelAuditSession>(response);
}

export async function getLabelAuditSession(sessionId: string): Promise<LabelAuditSession> {
  const response = await apiFetch(`/api/wms/label-audit/sessions/${encodeURIComponent(sessionId)}`);
  return parseResponse<LabelAuditSession>(response);
}

export function createLabelAuditSession(payload: { name: string; note?: string | null }): Promise<LabelAuditSession> {
  return postJson<LabelAuditSession>('/api/wms/label-audit/sessions', payload);
}

export function scanLabelAuditSession(sessionId: string, scanValue: string): Promise<LabelAuditScanResult> {
  return postJson<LabelAuditScanResult>(
    `/api/wms/label-audit/sessions/${encodeURIComponent(sessionId)}/scan`,
    { scanValue },
  );
}

export function archiveLabelAuditSession(sessionId: string): Promise<LabelAuditSession> {
  return postJson<LabelAuditSession>(
    `/api/wms/label-audit/sessions/${encodeURIComponent(sessionId)}/archive`,
    {},
  );
}

// Admin-Bearbeitung einer Prüfrunde (Name/Notiz/Status). Nur gesetzte Felder werden geändert.
export async function updateLabelAuditSession(
  sessionId: string,
  payload: { name?: string; note?: string | null; status?: LabelAuditSessionStatus },
): Promise<LabelAuditSession> {
  const response = await apiFetch(`/api/wms/label-audit/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(normalizeOutbound(payload)),
  });
  return parseResponse<LabelAuditSession>(response);
}

// Admin-Korrektur eines einzelnen Scans (Notiz/Ignorieren/Asset-Zuordnung).
export async function updateLabelAuditScan(
  sessionId: string,
  scanId: string,
  payload: {
    note?: string | null;
    ignored?: boolean;
    ignoreReason?: string | null;
    assetId?: string;
    correctionNote?: string | null;
  },
): Promise<LabelAuditScanResult> {
  const response = await apiFetch(
    `/api/wms/label-audit/sessions/${encodeURIComponent(sessionId)}/scans/${encodeURIComponent(scanId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalizeOutbound(payload)),
    },
  );
  return parseResponse<LabelAuditScanResult>(response);
}

// --- Rollen & Rechte (admin-editierbare Rollenrechte, alle Endpunkte roles.manage) ---
export type PermissionDef = { key: string; label: string; group: string };
export type PermissionGroup = { group: string; label: string; permissions: PermissionDef[] };
export type RolePermissions = { roleKey: string; label: string; permissions: string[] };

export async function fetchPermissionCatalog(): Promise<{ groups: PermissionGroup[] }> {
  const response = await apiFetch('/api/wms/admin/permissions');
  return parseResponse<{ groups: PermissionGroup[] }>(response);
}

export async function fetchRoles(): Promise<{ roles: RolePermissions[] }> {
  const response = await apiFetch('/api/wms/admin/roles');
  return parseResponse<{ roles: RolePermissions[] }>(response);
}

export async function updateRolePermissions(
  roleKey: string,
  permissions: string[],
): Promise<RolePermissions> {
  const response = await apiFetch(
    `/api/wms/admin/roles/${encodeURIComponent(roleKey)}/permissions`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalizeOutbound({ permissions })),
    },
  );
  return parseResponse<RolePermissions>(response);
}

// --- Systemupdate (Redeploy über den Portainer-Stack-Webhook, nur Admin) ---
// Die Webhook-URL ist AUSSCHLIESSLICH serverseitig bekannt; das Frontend
// erfährt nur, ob überhaupt eine hinterlegt ist (webhookConfigured).
export type UpdateCheckState =
  | 'up_to_date'
  | 'update_available'
  | 'check_failed'
  | 'installed_version_unknown'
  | 'disabled';

export type UpdateRunStatus =
  | 'idle'
  | 'checking'
  | 'backing_up'
  | 'redeploy_requested'
  | 'restarting'
  | 'success'
  | 'failed'
  | 'timeout';

export type SystemCommitInfo = {
  sha: string;
  shortSha: string;
  message: string;
  author?: string | null;
  date?: string | null;
  url?: string | null;
};

export type SystemVersion = {
  appVersion: string;
  installedCommit?: string | null;
  installedShortCommit?: string | null;
  installedBranch?: string | null;
  buildTime?: string | null;
  repository: string;
  branch: string;
  repositoryUrl: string;
  updateEnabled: boolean;
  webhookConfigured: boolean;
};

export type SystemUpdateCheck = {
  state: UpdateCheckState;
  updateAvailable: boolean;
  installedCommit?: string | null;
  installedShortCommit?: string | null;
  latest?: SystemCommitInfo | null;
  compareUrl?: string | null;
  checkedAt?: string | null;
  message: string;
  updateEnabled: boolean;
  webhookConfigured: boolean;
};

export type SystemUpdateRun = {
  id: string;
  status: UpdateRunStatus;
  startedAt?: string | null;
  finishedAt?: string | null;
  startedByUserId?: string | null;
  startedByName?: string | null;
  sourceCommit?: string | null;
  sourceShortCommit?: string | null;
  targetCommit?: string | null;
  targetShortCommit?: string | null;
  detectedCommitAfterRestart?: string | null;
  backupReference?: string | null;
  message?: string | null;
  errorDetails?: string | null;
};

export type SystemUpdateStatus = {
  status: UpdateRunStatus;
  inProgress: boolean;
  run?: SystemUpdateRun | null;
  installedCommit?: string | null;
  installedShortCommit?: string | null;
  updateEnabled: boolean;
  webhookConfigured: boolean;
  timeoutSeconds: number;
};

export type SystemUpdateStartResult = {
  accepted: boolean;
  status: UpdateRunStatus;
  targetCommit?: string | null;
  message: string;
  run?: SystemUpdateRun | null;
};

export async function fetchSystemVersion(): Promise<SystemVersion> {
  const response = await apiFetch('/api/admin/system/version');
  return parseResponse<SystemVersion>(response);
}

export async function checkSystemUpdate(): Promise<SystemUpdateCheck> {
  const response = await apiFetch('/api/admin/system/update/check');
  return parseResponse<SystemUpdateCheck>(response);
}

export async function startSystemUpdate(): Promise<SystemUpdateStartResult> {
  // Bewusst OHNE Body: Branch/Commit/URL kommen ausschließlich aus der
  // Serverkonfiguration.
  const response = await apiFetch('/api/admin/system/update', { method: 'POST' });
  return parseResponse<SystemUpdateStartResult>(response);
}

export async function fetchSystemUpdateStatus(): Promise<SystemUpdateStatus> {
  const response = await apiFetch('/api/admin/system/update/status');
  return parseResponse<SystemUpdateStatus>(response);
}

export async function fetchSystemUpdateHistory(
  limit = 20,
): Promise<{ items: SystemUpdateRun[]; total: number }> {
  const response = await apiFetch(`/api/admin/system/update/history?limit=${limit}`);
  return parseResponse<{ items: SystemUpdateRun[]; total: number }>(response);
}

// --- Companion App -----------------------------------------------------------

export type CompanionDevice = {
  id: string;
  name: string;
  platform?: string | null;
  connectedAt?: string | null;
  lastSeenAt?: string | null;
  passkeyRegistered: boolean;
  current: boolean;
};

export type CompanionSettings = {
  enabled: boolean;
  devices: CompanionDevice[];
  maxDevices: number;
  currentDeviceId?: string | null;
};

export type CompanionPairingStatus =
  | 'pending'
  | 'claimed'
  | 'approved'
  | 'rejected'
  | 'consumed'
  | 'cancelled'
  | 'expired';

export type CompanionPairingStart = {
  pairingId: string;
  pairingCode: string;
  expiresAt: string;
  expiresInSeconds: number;
};

export type CompanionPairingState = {
  pairingId: string;
  status: CompanionPairingStatus;
  expiresAt: string;
  expiresInSeconds: number;
  deviceName?: string | null;
  devicePlatform?: string | null;
  matchCode?: string | null;
};

export type CompanionClaim = {
  accountName: string;
  accountEmail: string;
  matchCode: string;
  expiresInSeconds: number;
};

export type CompanionSession = {
  user: AuthUser;
  deviceId: string;
  deviceName: string;
  passkeyRegistered: boolean;
  locked: boolean;
};

export async function fetchCompanionSettings(): Promise<CompanionSettings> {
  return parseResponse<CompanionSettings>(await apiFetch('/api/companion/settings'));
}

export function setCompanionEnabled(enabled: boolean): Promise<CompanionSettings> {
  return putJson<CompanionSettings>('/api/companion/settings', { enabled });
}

export async function revokeCompanionDevice(deviceId: string): Promise<{ revoked: number }> {
  const response = await apiFetch(`/api/companion/devices/${encodeURIComponent(deviceId)}`, {
    method: 'DELETE',
  });
  return parseResponse<{ revoked: number }>(response);
}

export function revokeAllCompanionDevices(): Promise<{ revoked: number }> {
  return postJson<{ revoked: number }>('/api/companion/devices/revoke-all', {});
}

export function startCompanionPairing(): Promise<CompanionPairingStart> {
  return postJson<CompanionPairingStart>('/api/companion/pairing', {});
}

export async function fetchCompanionPairing(pairingId: string): Promise<CompanionPairingState> {
  return parseResponse<CompanionPairingState>(
    await apiFetch(`/api/companion/pairing/${encodeURIComponent(pairingId)}`),
  );
}

export function decideCompanionPairing(
  pairingId: string,
  action: 'approve' | 'reject' | 'cancel',
): Promise<CompanionPairingState> {
  return postJson<CompanionPairingState>(
    `/api/companion/pairing/${encodeURIComponent(pairingId)}/${action}`,
    {},
  );
}

// Handy-Seite der Kopplung (ohne Anmeldung). Bewusst rawApiFetch: ein 401
// bedeutet hier nichts für eine bestehende Sitzung.
async function companionPublic<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await rawApiFetch(path, init);
  if (!response.ok) {
    let detail = '';
    try {
      const payload = (await response.json()) as { detail?: string };
      detail = typeof payload.detail === 'string' ? payload.detail : '';
    } catch {
      detail = '';
    }
    throw new WmsApiError(response.status, detail, detail || `Anfrage fehlgeschlagen (${response.status}).`);
  }
  return normalizeDeep((await response.json()) as T);
}

export function claimCompanionPairing(code: string): Promise<CompanionClaim> {
  return companionPublic<CompanionClaim>('/api/companion/pairing-claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
}

export function fetchCompanionClaimStatus(): Promise<{ status: CompanionPairingStatus; expiresInSeconds: number }> {
  return companionPublic('/api/companion/pairing-claim/status');
}

export async function completeCompanionPairing(): Promise<CompanionSession> {
  const session = await companionPublic<CompanionSession>('/api/companion/pairing-claim/complete', {
    method: 'POST',
  });
  resetDeviceRefreshState();
  setCurrentUser(session.user);
  return session;
}

export async function cancelCompanionClaim(): Promise<void> {
  try {
    await rawApiFetch('/api/companion/pairing-claim/cancel', { method: 'POST' });
  } catch {
    // Abbruch ist best effort — der Code verfällt ohnehin.
  }
}

// Passkeys (WebAuthn) — die Browser-Zeremonie selbst übernimmt
// @simplewebauthn/browser (siehe components/companion/passkeys.ts).

export type PasskeyOptions = { options: Record<string, unknown> };

export async function fetchCompanionSession(): Promise<CompanionSession> {
  return parseResponse<CompanionSession>(await apiFetch('/api/companion/session'));
}

export function fetchPasskeyRegistrationOptions(): Promise<PasskeyOptions> {
  return postJson<PasskeyOptions>('/api/companion/passkey/register/options', {});
}

export function verifyPasskeyRegistration(credential: unknown): Promise<CompanionSession> {
  return postJson<CompanionSession>('/api/companion/passkey/register/verify', { credential });
}

// Entsperren läuft über das Geräte-Cookie (gesperrt = kein gültiges
// Access-Token) — daher ohne den automatischen Erneuerungsversuch.
export function fetchUnlockOptions(): Promise<PasskeyOptions> {
  return companionPublic<PasskeyOptions>('/api/companion/unlock/options', { method: 'POST' });
}

export async function verifyUnlock(credential: unknown): Promise<CompanionSession> {
  const session = await companionPublic<CompanionSession>('/api/companion/unlock/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential }),
  });
  resetDeviceRefreshState();
  setCurrentUser(session.user);
  return session;
}

/** Abmeldung nur dieses Geräts, auch im gesperrten Zustand. */
export async function logoutCompanionDevice(): Promise<void> {
  try {
    await rawApiFetch('/api/companion/session/logout', { method: 'POST' });
  } catch {
    // best effort
  } finally {
    clearCurrentUser();
  }
}

/**
 * Sperrt die Gerätesitzung (App-Start, Rückkehr aus dem Hintergrund).
 * Liefert null, wenn dieses Gerät gar nicht gekoppelt ist (Browser-Sitzung).
 * Entsperren ist nur per Passkey möglich — der Client kann nur sperren.
 */
export async function lockCompanionSession(): Promise<{ locked: boolean; passkeyRegistered: boolean } | null> {
  try {
    const response = await rawApiFetch('/api/companion/session/lock', { method: 'POST' });
    if (!response.ok) return null;
    return (await response.json()) as { locked: boolean; passkeyRegistered: boolean };
  } catch {
    return null;
  }
}
