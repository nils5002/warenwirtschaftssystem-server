import {
  AlertTriangle,
  CalendarPlus,
  Clock3,
  Copy,
  Link2,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAppDialog } from '../../components/dialogs/AppDialogProvider';
import { InlineLoadingState, LoadingButton } from '../../components/loading';
import { PageHeader } from '../../ui';
import { PlanningCalendarAddOn } from './PlanningCalendarAddOn';
import {
  createPlanning,
  deletePlanning,
  duplicatePlanning,
  getPlanning,
  getPlanningAvailability,
  getPlanningAssignedAssets,
  getHandoverStatus,
  runHandover,
  undoHandover,
  listPlannings,
  updatePlanning,
  updatePlanningStatus,
  type ConflictBadge,
  type HandoverStatusResponse,
  type PlanningAssignedAssetsResponse,
  type PlanningAvailabilityResponse,
  type PlanningConflictSeverity,
  type PlanningListItem,
  type RecommendationPriority,
  type PlanningStatus,
  type PlanningResponse,
  type PlanningUpsertPayload,
  type WmsOverview,
} from '../../services/wmsApi';
import { useScrollRestoration } from '../../hooks/useScrollRestoration';
import { useUrlFlag, useUrlQueryState } from '../../hooks/useUrlQueryState';
import { canonicalPathForPage, planningDetailPath, resolveRoute } from '../../routing/appRoutes';
import { navigate } from '../../routing/router';
import { SegmentedControl } from '../../ui';
import { PlanningCheckModal } from '../components/planning/PlanningCheckModal';
import { PlanningDetailPanel } from '../components/planning/PlanningDetailPanel';
import { PlanningKpiBar } from '../components/planning/PlanningKpiBar';
import { PlanningListCompact } from '../components/planning/PlanningListCompact';
import { categoryOptionsFromRecords, normalizeKnownCategory } from '../categories';
import {
  aggregateCategoryNeeds,
  buildConflictSentences,
  derivePlanningPhases,
  summarizeNeeds,
} from './planningCockpit';
import { conflictSeverityRank, conflictSeverityVisual } from './conflictSeverityVisuals';
import {
  PlanningPeriod,
  formatEinsatz,
  formatRueckgabe,
  getBookedDayCount,
  getReturnDayIso,
  getStockFreeAgainIso,
  isDateBooked,
} from './planningPeriod';
import type { Asset, CategoryItem, UserItem } from '../types';

type PlanningPageProps = {
  assets: Asset[];
  categories: CategoryItem[];
  users: UserItem[];
  planningSummary: WmsOverview['planningSummary'];
  onRefreshOverview?: () => Promise<void>;
  onOpenInventoryWithQuery: (query: string) => void;
  canEdit?: boolean;
  isMobile?: boolean;
  // Planungs-ID aus der Detail-Route /einsatzplanung/:planningId — steuert
  // das Detail-Modal (Deep-Link, Refresh, Browser-Zurück/Vor).
  routePlanningId?: string | null;
};

type EditablePlanning = {
  id: string;
  customerName: string;
  projectName: string;
  eventName: string;
  projectManagerUserId: string;
  calendarWeek: number | null;
  startDate: string;
  endDate: string;
  notes: string;
  status: PlanningStatus;
  returnBufferDays: number;
  days: Array<{
    planningDate: string;
    weekday: string;
    items: Array<{
      categoryKey: string;
      qty: number;
      notes: string;
      handoverEnabled: boolean;
      linkedPlanningId: string;
      handoverNote: string;
    }>;
  }>;
};

type PlanningSummary = PlanningListItem | PlanningResponse;
type PlanningListHandoverSummary = NonNullable<PlanningListItem['handoverSummary']>;
type BusyState = 'list' | 'open' | 'save' | 'create' | 'duplicate' | 'delete' | 'status' | null;

type HandoverVisualStatus = 'ok' | 'handover' | 'review' | 'open';

// Differenziert den visuellen 'review'-Status nach Ursache, damit der UI-Text
// die tatsächliche Handlungsempfehlung trifft statt pauschal
// "Projektverknüpfung prüfen" zu zeigen:
// - 'incomplete_link': Übergabe aktiv, aber noch kein Partnerprojekt verknüpft.
// - 'missing_link'   : verlinktes Partnerprojekt existiert nicht mehr.
// - 'low_reserve'    : Bestand knapp (availabilityState 'yellow'), kein Link-Problem.
type ReviewReason = 'incomplete_link' | 'missing_link' | 'low_reserve';

type IncomingHandoverInfo = {
  partnerPlanningId: string;
  partnerLabel: string;
  note: string;
};

// Aggregierter Verbund-Eintrag fuer den additiven Detail-Block: eine Zeile
// pro Partnerprojekt + Richtung. Datumsbereich und Kategorienliste werden
// ueber alle Tage des Verbunds aufgesammelt.
type VerbundEntry = {
  partnerPlanningId: string;
  partnerLabel: string;
  direction: 'incoming' | 'outgoing';
  categoryKeys: string[];
  dateFrom: string;
  dateTo: string;
  totalQty: number;
  notes: string[];
};

type AvailabilityVisual = {
  key: string;
  planningDate: string;
  weekday: string;
  categoryKey: string;
  status: HandoverVisualStatus;
  // Ursache für status === 'review'; null sonst. Treibt die differenzierten
  // Review-Texte (Link-Problem vs. knapper Bestand).
  reviewReason: ReviewReason | null;
  source: 'outgoing' | 'incoming' | 'none';
  partnerPlanningId: string;
  partnerLabel: string;
  note: string;
  totalStock: number;
  usableStock: number;
  currentPlanningQty: number;
  otherPlannedQty: number;
  totalPlannedQtyForDateCategory: number;
  remainingAfterAllPlanning: number;
  shortageQty: number;
  hasGlobalShortage: boolean;
  affectedPlanningIds: string[];
  linkedPlanningId: string;
  linkedPlanningLabel: string;
  handoverCoveredQty: number;
  // Backend-Klassifikation der Übergabe-Beziehung. Treibt das Differenz-
  // Badge "Geplante Übergabe" vs "Organisatorische Übergabe" in der UI,
  // damit Nutzer auf einen Blick sehen, ob die Verknüpfung tatsächlich
  // einen Konflikt entschärfen kann (planned) oder rein dokumentarisch
  // ist (organizational, z. B. Südwestfalen → PSD HT ohne Datums-Überlapp).
  handoverStatus: 'none' | 'planned' | 'missing_link' | 'organizational';
  // Anzahl Geräte, die für diese Bedarfszeile vom Bestand ausgeschlossen
  // wurden (z. B. Kartendrucker-inkompatible Laptops in Projekten mit
  // Kartendrucker-Bedarf). 0 für alle übrigen Kategorien.
  excludedQty: number;
  // Anzahl Geräte, die GLOBAL aus der Einsatzplanung ausgeschlossen sind
  // (availableForPlanning=false). 0 sonst.
  excludedFromPlanningQty: number;
  // Mindestbedarf-Kopplung Kartendrucker → Laptop (nur auf Laptop-Zeilen).
  // cardPrinterRequiredQty: Anzahl Kartendrucker an diesem Tag (informativ).
  // cardPrinterUpliftQty: angehobener Anteil — > 0 triggert UI-Hinweis.
  cardPrinterRequiredQty: number;
  cardPrinterUpliftQty: number;
  // Backend-Schweregrad-Einordnung (Konfliktanzeige-Paket). null bei reinen
  // grünen Zellen; treibt die Severity-Badges in der Detailansicht.
  conflictSeverity: PlanningConflictSeverity | null;
  conflictLabel: string | null;
  conflictSecondary: ConflictBadge[];
};

const STATUS_OPTIONS: PlanningStatus[] = ['Entwurf', 'Geplant', 'Bestätigt', 'Abgeschlossen', 'Storniert'];

function toIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getGermanWeekday(isoDate: string): string {
  const weekdays = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const date = new Date(`${isoDate}T00:00:00`);
  return weekdays[date.getDay()] ?? 'Tag';
}

function formatGermanDate(isoDate: string): string {
  if (!isoDate) return '';
  const [year, month, day] = isoDate.split('-');
  if (!year || !month || !day) return isoDate;
  return `${day}.${month}.${year}`;
}

function buildPlanningLabel(planning: Pick<PlanningSummary, 'projectName' | 'eventName' | 'startDate'>): string {
  const datePart = planning.startDate ? ` – ${formatGermanDate(planning.startDate)}` : '';
  if (planning.eventName?.trim()) return `${planning.projectName} (${planning.eventName})${datePart}`;
  return `${planning.projectName}${datePart}`;
}

// Zentralisiert die Texte für status === 'review', damit Badge-Card,
// Detail-Card und Übergaben-Übersicht nicht auseinanderlaufen.
function reviewBadgeLabel(reason: ReviewReason | null): string {
  return reason === 'low_reserve' ? 'Bestand knapp' : 'Prüfung nötig';
}

function reviewShortText(reason: ReviewReason | null): string {
  return reason === 'low_reserve' ? 'Bestand knapp' : 'Projektverknüpfung prüfen';
}

function reviewDetailText(reason: ReviewReason | null): string {
  if (reason === 'low_reserve') {
    return 'Der Bestand ist für diesen Tag knapp — es ist noch genug verfügbar, aber wenig Reserve. Keine Verknüpfung nötig, nur im Blick behalten.';
  }
  if (reason === 'missing_link') {
    return 'Verknüpfte Planung nicht gefunden — das verlinkte Partnerprojekt existiert nicht mehr. Bitte Verknüpfung lösen oder neu auswählen.';
  }
  return 'Eine Übergabe ist vorgemerkt, aber das Partnerprojekt fehlt noch. Bitte kurz prüfen.';
}

function getPeriodEndExclusiveIso(startDate: string, endDate: string): string {
  if (endDate > startDate) return endDate;
  const start = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(start.getTime())) return endDate;
  start.setDate(start.getDate() + 1);
  return toIsoDate(start);
}

function mergeRangeItemsFromDays(
  sourceDays: EditablePlanning['days'],
): EditablePlanning['days'][number]['items'] {
  const grouped = new Map<string, EditablePlanning['days'][number]['items'][number]>();
  for (const day of sourceDays) {
    for (const item of day.items) {
      // Kategorie unveraendert als Gruppierungsschluessel nutzen — Werte
      // stammen ausschliesslich aus dem Kategorie-Dropdown (aktive Kategorien).
      const categoryKey = (item.categoryKey ?? '').trim();
      if (!categoryKey) continue;
      const current = grouped.get(categoryKey);
      if (!current) {
        grouped.set(categoryKey, { ...item, categoryKey });
        continue;
      }
      grouped.set(categoryKey, {
        ...current,
        qty: Math.max(current.qty, item.qty),
        notes: current.notes || item.notes,
        handoverEnabled: current.handoverEnabled || item.handoverEnabled,
        linkedPlanningId: current.linkedPlanningId || item.linkedPlanningId,
        handoverNote: current.handoverNote || item.handoverNote,
      });
    }
  }
  return Array.from(grouped.values()).sort((a, b) => a.categoryKey.localeCompare(b.categoryKey, 'de'));
}

function buildRangePlanningDays(
  startDate: string,
  sourceDays: EditablePlanning['days'] = [],
): EditablePlanning['days'] {
  if (!startDate) return [];
  return [
    {
      planningDate: startDate,
      weekday: getGermanWeekday(startDate),
      items: mergeRangeItemsFromDays(sourceDays),
    },
  ];
}

function toEditablePlanning(item: PlanningResponse): EditablePlanning {
  const normalizedDays = [...item.days]
    .sort((a, b) => a.planningDate.localeCompare(b.planningDate))
    .map((day) => ({
      planningDate: day.planningDate,
      weekday: day.weekday || getGermanWeekday(day.planningDate),
      items: day.items.map((entry) => ({
        // Kategorie unveraendert aus dem Backend uebernehmen — dynamisch
        // angelegte Kategorien duerfen NICHT auf eine kanonische gezwungen
        // werden (sonst verschwindet z. B. "Eigener Laptop" aus dem Editor).
        categoryKey: entry.categoryKey,
        qty: entry.qty,
        notes: entry.notes ?? '',
        handoverEnabled: Boolean(entry.handoverEnabled),
        linkedPlanningId: entry.linkedPlanningId ?? '',
        handoverNote: entry.handoverNote ?? '',
      })),
    }));

  return {
    id: item.id,
    customerName: item.customerName,
    projectName: item.projectName,
    eventName: item.eventName ?? '',
    projectManagerUserId: item.projectManagerUserId ?? '',
    calendarWeek: item.calendarWeek ?? null,
    startDate: item.startDate,
    endDate: item.endDate,
    notes: item.notes,
    status: item.status === 'Bestaetigt' ? 'Bestätigt' : item.status,
    returnBufferDays: Math.min(3, Math.max(0, Number(item.returnBufferDays ?? 0))),
    days: buildRangePlanningDays(item.startDate, normalizedDays),
  };
}

function cloneEditablePlanning(item: EditablePlanning): EditablePlanning {
  return {
    ...item,
    days: item.days.map((day) => ({
      ...day,
      items: day.items.map((entry) => ({ ...entry })),
    })),
  };
}

function toUpsertPayload(item: EditablePlanning): PlanningUpsertPayload {
  return {
    id: item.id,
    customerName: item.customerName.trim(),
    projectName: item.projectName.trim(),
    eventName: item.eventName.trim() || null,
    projectManagerUserId: item.projectManagerUserId || null,
    calendarWeek: item.calendarWeek ?? null,
    startDate: item.startDate,
    endDate: item.endDate,
    notes: item.notes,
    status: item.status,
    returnBufferDays: Math.min(3, Math.max(0, Number(item.returnBufferDays ?? 0))),
    days: item.days.map((day) => ({
      planningDate: day.planningDate,
      weekday: day.weekday || getGermanWeekday(day.planningDate),
      items: day.items
        .filter((entry) => entry.categoryKey.trim().length > 0)
        .map((entry) => ({
          // Ausgewaehlte Kategorie unveraendert senden; die autoritative
          // Normalisierung uebernimmt das Backend (normalize_category_for_db).
          categoryKey: entry.categoryKey.trim(),
          qty: Number.isFinite(entry.qty) ? Math.max(0, entry.qty) : 0,
          notes: entry.notes.trim() || null,
          handoverEnabled: Boolean(entry.handoverEnabled),
          linkedPlanningId: entry.linkedPlanningId.trim() || null,
          handoverNote: entry.handoverNote.trim() || null,
        })),
    })),
  };
}

function handoverKey(dayIndex: number, itemIndex: number): string {
  return `${dayIndex}:${itemIndex}`;
}

function isDateWithinRange(isoDate: string, startDate: string, endDate: string): boolean {
  return isoDate >= startDate && isoDate < getPeriodEndExclusiveIso(startDate, endDate);
}

function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const aEndExclusive = getPeriodEndExclusiveIso(aStart, aEnd);
  const bEndExclusive = getPeriodEndExclusiveIso(bStart, bEnd);
  return aStart < bEndExclusive && bStart < aEndExclusive;
}

function buildPlanningFallbackLabel(
  planningId: string,
  plannings: Awaited<ReturnType<typeof listPlannings>>,
): string {
  const match = plannings.find((item) => item.id === planningId);
  if (!match) return `Projektverknüpfung (${planningId.slice(-6)})`;
  return buildPlanningLabel(match);
}

// Deutsche Plural-Formen der bekannten Hardware-Kategorien. Für unbekannte
// (z. B. selbst angelegte) Kategorien greift ein Fallback (siehe categoryCountLabel).
const CATEGORY_PLURALS: Record<string, string> = {
  Laptop: 'Laptops',
  iPad: 'iPads',
  Handheld: 'Handhelds',
  Smartphone: 'Smartphones',
  'QR-Code-Scanner': 'QR-Code-Scanner',
  Drucker: 'Drucker',
  Kartendrucker: 'Kartendrucker',
  Switch: 'Switches',
  Router: 'Router',
  'LTE-Router': 'LTE-Router',
  Zubehör: 'Zubehör',
  Zubehoer: 'Zubehoer',
  Sonstiges: 'Sonstiges',
};

// "1 Laptop", "8 Laptops", "7 QR-Code-Scanner". Für unbekannte Kategorien im
// Plural der gut lesbare "8× Kategorie"-Fallback.
function categoryCountLabel(category: string, count: number): string {
  if (count === 1) return `1 ${category}`;
  const plural = CATEGORY_PLURALS[category];
  if (plural) return `${count} ${plural}`;
  return `${count}× ${category}`;
}

// Verb-Form passend zur Menge: "1 ... fehlt", "8 ... fehlen".
function shortageVerb(count: number): string {
  return count === 1 ? 'fehlt' : 'fehlen';
}

// Farbpunkt je Empfehlungs-Priorität.
function recoPriorityDot(priority: RecommendationPriority): string {
  if (priority === 'high') return 'bg-rose-500';
  if (priority === 'medium') return 'bg-amber-500';
  return 'bg-slate-400';
}

// Kompaktes farbiges Schweregrad-Badge. `label` überschreibt das Fallback-Label
// (das Backend liefert conflictLabel mit).
function ConflictSeverityChip({
  severity,
  label,
  size = 'md',
}: {
  severity: PlanningConflictSeverity | null | undefined;
  label?: string | null;
  size?: 'sm' | 'md';
}) {
  const visual = conflictSeverityVisual(severity);
  const sizing = size === 'sm' ? 'px-1.5 py-[1px] text-[10px]' : 'px-2 py-0.5 text-[11px]';
  return (
    <span
      className={`inline-flex items-center rounded-full border font-semibold ${sizing} ${visual.chipClass}`}
    >
      {label?.trim() || visual.label}
    </span>
  );
}

function updatePlanningItemInEditor(
  planning: EditablePlanning,
  dayIndex: number,
  itemIndex: number,
  updater: (item: EditablePlanning['days'][number]['items'][number]) => EditablePlanning['days'][number]['items'][number],
): EditablePlanning {
  const nextDays = [...planning.days];
  const nextItems = [...nextDays[dayIndex].items];
  nextItems[itemIndex] = updater(nextItems[itemIndex]);
  nextDays[dayIndex] = { ...nextDays[dayIndex], items: nextItems };
  return { ...planning, days: nextDays };
}

export function PlanningPage({
  assets: _assets,
  categories,
  users,
  planningSummary,
  onRefreshOverview,
  onOpenInventoryWithQuery,
  canEdit = true,
  isMobile = false,
  routePlanningId = null,
}: PlanningPageProps) {
  const { alert, confirm } = useAppDialog();
  const [plannings, setPlannings] = useState<Awaited<ReturnType<typeof listPlannings>>>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [editor, setEditor] = useState<EditablePlanning | null>(null);
  const [availability, setAvailability] = useState<PlanningAvailabilityResponse | null>(null);
  // Schritt C: geplant vs. ausgegeben + zugeordnete Geräte (reine Anzeige).
  const [assignedAssets, setAssignedAssets] = useState<PlanningAssignedAssetsResponse | null>(null);
  const [handoverStatus, setHandoverStatus] = useState<HandoverStatusResponse | null>(null);
  const [handoverBusy, setHandoverBusy] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyState, setBusyState] = useState<BusyState>(null);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Listen-Filter leben in der URL (?q, ?status, ?konflikte) — Browser-Zurück
  // aus dem Detail und Refresh stellen die gefilterte Liste wieder her.
  const [listSearch, setListSearch] = useUrlQueryState('q', '', { debounceMs: 350 });
  // Cockpit-Ansicht (Liste | Woche | Konflikte) — in der URL, damit Zurück/
  // Refresh die gewählte Ansicht erhalten. 'liste' ist Default (ohne Param).
  const [viewParam, setView] = useUrlQueryState('view', 'liste');
  const view: 'liste' | 'woche' | 'konflikte' =
    viewParam === 'woche' || viewParam === 'konflikte' ? viewParam : 'liste';
  const [listStatusParam, setListStatus] = useUrlQueryState('status', 'Alle');
  const listStatus: 'Alle' | PlanningStatus = (STATUS_OPTIONS as string[]).includes(listStatusParam)
    ? (listStatusParam as PlanningStatus)
    : 'Alle';
  const [conflictFilterActive, setConflictFilterActive] = useUrlFlag('konflikte');
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  // Scrollposition der Planungsliste erhalten (z. B. nach Modal-Besuchen
  // oder Browser-Zurück); Restaurierung erst, wenn die Liste geladen ist.
  useScrollRestoration(listScrollRef, { ready: plannings.length > 0 });
  const [createOpen, setCreateOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  // "Projekt prüfen"-Modal: offen + frischer Availability-Load läuft.
  const [checkOpen, setCheckOpen] = useState(false);
  const [checkBusy, setCheckBusy] = useState(false);
  // Ziel für "Konflikte lösen" (Scroll zum Konfliktblock im Panel).
  const conflictBlockRef = useRef<HTMLDivElement | null>(null);
  const [editorInitial, setEditorInitial] = useState<EditablePlanning | null>(null);
  const [handoverEditorKey, setHandoverEditorKey] = useState<string | null>(null);
  const [handoverSnapshot, setHandoverSnapshot] = useState<Record<string, EditablePlanning['days'][number]['items'][number]>>({});
  const [relatedPlannings, setRelatedPlannings] = useState<Record<string, PlanningResponse>>({});
  const [planningListDetails, setPlanningListDetails] = useState<Record<string, PlanningResponse>>({});
  const [calendarAvailabilitiesByPlanningId, setCalendarAvailabilitiesByPlanningId] = useState<
    Record<string, PlanningAvailabilityResponse>
  >({});
  const openPlanningRequestSeq = useRef(0);
  const [createForm, setCreateForm] = useState({
    customerName: '',
    projectName: '',
    eventName: '',
    projectManagerUserId: '',
    startDate: toIsoDate(new Date()),
    endDate: toIsoDate(new Date()),
    notes: '',
    status: 'Entwurf' as PlanningStatus,
    returnBufferDays: 0,
  });

  const categoryOptions = useMemo(() => categoryOptionsFromRecords(categories), [categories]);

  // Menge der aktuell aktiven Kategorienamen — Basis fuer eine Normalisierung,
  // die selbst angelegte Kategorien (z. B. "Eigener Laptop", "DYMO") erhaelt,
  // statt sie auf eine kanonische Kategorie zu kollabieren.
  const knownCategorySet = useMemo(
    () =>
      new Set(
        categories
          .filter((category) => category.isActive !== false)
          .map((category) => category.name.trim())
          .filter(Boolean),
      ),
    [categories],
  );
  const normalizeItemCategory = useCallback(
    (value: string | null | undefined): string => normalizeKnownCategory(value, knownCategorySet),
    [knownCategorySet],
  );

  const selectableProjectManagers = useMemo(
    () =>
      users.filter(
        (user) =>
          user.status === 'Aktiv' && (user.role === 'Projektmanager' || user.role === 'Admin'),
      ),
    [users],
  );

  const managerLabelById = useMemo(
    () =>
      new Map(users.map((user) => [user.id, user.department ? `${user.name} (${user.department})` : user.name])),
    [users],
  );

  const planningListItemById = useMemo(() => new Map(plannings.map((item) => [item.id, item])), [plannings]);

  const availabilityByCategoryForRange = useMemo(() => {
    const map = new Map<string, PlanningAvailabilityResponse['items'][number]>();
    const rank = (item: PlanningAvailabilityResponse['items'][number]) => {
      if (item.hasGlobalShortage || item.shortageQty > 0 || item.remainingAfterAllPlanning < 0) return 3;
      if (item.handoverStatus === 'missing_link') return 2;
      if (Number(item.handoverCoveredQty ?? 0) > 0 || item.handoverStatus === 'planned') return 1;
      return 0;
    };
    for (const item of availability?.items ?? []) {
      const key = normalizeItemCategory(item.categoryKey);
      const current = map.get(key);
      if (!current) {
        map.set(key, item);
        continue;
      }
      const currentRank = rank(current);
      const nextRank = rank(item);
      if (nextRank > currentRank || (nextRank === currentRank && item.shortageQty > current.shortageQty)) {
        map.set(key, item);
      }
    }
    return map;
  }, [availability, normalizeItemCategory]);

  const localHandoverByDayCategory = useMemo(() => {
    const map = new Map<
      string,
      {
        handoverEnabled: boolean;
        linkedPlanningId: string;
        linkedPlanningLabel?: string;
        handoverNote: string;
      }
    >();
    if (!editor) return map;
    for (const day of editor.days) {
      for (const item of day.items) {
        const category = normalizeItemCategory(item.categoryKey);
        const key = `${day.planningDate}|${category}`;
        map.set(key, {
          handoverEnabled: item.handoverEnabled,
          linkedPlanningId: item.linkedPlanningId,
          linkedPlanningLabel: item.linkedPlanningId
            ? buildPlanningFallbackLabel(item.linkedPlanningId, plannings)
            : undefined,
          handoverNote: item.handoverNote,
        });
        map.set(`*|${category}`, {
          handoverEnabled: item.handoverEnabled,
          linkedPlanningId: item.linkedPlanningId,
          linkedPlanningLabel: item.linkedPlanningId
            ? buildPlanningFallbackLabel(item.linkedPlanningId, plannings)
            : undefined,
          handoverNote: item.handoverNote,
        });
      }
    }
    return map;
  }, [editor, plannings, normalizeItemCategory]);

  useEffect(() => {
    if (!editor || !availability) {
      setRelatedPlannings({});
      return;
    }
    const relatedIds = new Set<string>();
    for (const item of availability.items) {
      for (const affectedId of item.affectedPlanningIds ?? []) {
        if (affectedId && affectedId !== editor.id) relatedIds.add(affectedId);
      }
      if (item.linkedPlanningId && item.linkedPlanningId !== editor.id) {
        relatedIds.add(item.linkedPlanningId);
      }
    }
    for (const localEntry of localHandoverByDayCategory.values()) {
      if (localEntry.linkedPlanningId && localEntry.linkedPlanningId !== editor.id) {
        relatedIds.add(localEntry.linkedPlanningId);
      }
    }
    const candidateIds = Array.from(relatedIds);
    if (!candidateIds.length) {
      setRelatedPlannings({});
      return;
    }

    let cancelled = false;
    void Promise.all(
      candidateIds.map(async (planningId) => {
        try {
          return await getPlanning(planningId);
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      const next: Record<string, PlanningResponse> = {};
      for (const planning of results) {
        if (planning) next[planning.id] = planning;
      }
      setRelatedPlannings(next);
    });

    return () => {
      cancelled = true;
    };
  }, [availability, editor?.id, localHandoverByDayCategory]);

  const incomingHandoverByDayCategory = useMemo(() => {
    const map = new Map<string, IncomingHandoverInfo>();
    if (!editor) return map;

    // Server-Quelle (additiv, ab Backend mit incomingHandovers): deckt die
    // Empfänger-Seite einer Übergabe zuverlässig ab — auch wenn die geöffnete
    // Planung selbst keine outgoing-Items trägt.
    const serverIncoming =
      availability?.incomingHandovers ?? [];
    for (const entry of serverIncoming) {
      const partnerLabel = entry.partnerPlanningLabel || entry.partnerPlanningId;
      const note = entry.note ?? '';
      const key = `${entry.planningDate}|${normalizeItemCategory(entry.categoryKey)}`;
      if (!map.has(key)) {
        map.set(key, {
          partnerPlanningId: entry.partnerPlanningId,
          partnerLabel,
          note,
        });
      }
      const anyDayKey = `*|${normalizeItemCategory(entry.categoryKey)}`;
      if (!map.has(anyDayKey)) {
        map.set(anyDayKey, {
          partnerPlanningId: entry.partnerPlanningId,
          partnerLabel,
          note,
        });
      }
    }

    // Fallback: bisheriger Pfad über bereits geladene relatedPlannings.
    // Bleibt für ältere Server-Stände und für lokale, noch nicht gespeicherte
    // Änderungen im Editor relevant.
    for (const planning of Object.values(relatedPlannings)) {
      const planningLabel = buildPlanningLabel(planning);
      for (const day of planning.days) {
        for (const item of day.items) {
          if (!item.handoverEnabled || item.linkedPlanningId !== editor.id) continue;
          const key = `${day.planningDate}|${normalizeItemCategory(item.categoryKey)}`;
          if (!map.has(key)) {
            map.set(key, {
              partnerPlanningId: planning.id,
              partnerLabel: planningLabel,
              note: item.handoverNote ?? '',
            });
          }
          const anyDayKey = `*|${normalizeItemCategory(item.categoryKey)}`;
          if (!map.has(anyDayKey)) {
            map.set(anyDayKey, {
              partnerPlanningId: planning.id,
              partnerLabel: planningLabel,
              note: item.handoverNote ?? '',
            });
          }
        }
      }
    }

    return map;
  }, [editor, availability, relatedPlannings, normalizeItemCategory]);

  const availabilityVisualMap = useMemo(() => {
    const map = new Map<string, AvailabilityVisual>();

    for (const item of availability?.items ?? []) {
      const normalizedCategory = normalizeItemCategory(item.categoryKey);
      const key = `${item.planningDate}|${normalizedCategory}`;
      const localHandover = localHandoverByDayCategory.get(key) ?? localHandoverByDayCategory.get(`*|${normalizedCategory}`);
      const incomingHandover = incomingHandoverByDayCategory.get(key) ?? incomingHandoverByDayCategory.get(`*|${normalizedCategory}`);
      const effectiveHandoverEnabled = localHandover?.handoverEnabled ?? Boolean(item.handoverEnabled);
      const effectiveLinkedPlanningId = localHandover?.linkedPlanningId ?? (item.linkedPlanningId || '');
      const linkedPlanning =
        (effectiveLinkedPlanningId ? relatedPlannings[effectiveLinkedPlanningId] : undefined) ??
        (effectiveLinkedPlanningId ? planningListItemById.get(effectiveLinkedPlanningId) : undefined);
      const effectiveLinkedPlanningLabel =
        localHandover?.linkedPlanningLabel ||
        item.linkedPlanningLabel ||
        (linkedPlanning ? buildPlanningLabel(linkedPlanning) : '') ||
        (effectiveLinkedPlanningId ? buildPlanningFallbackLabel(effectiveLinkedPlanningId, plannings) : '');
      const effectiveHandoverNote = localHandover?.handoverNote ?? (item.handoverNote || '');
      const hasGlobalShortage =
        Boolean(item.hasGlobalShortage) ||
        item.shortageQty > 0 ||
        item.remainingAfterAllPlanning < 0;
      const handoverCoveredQty = Math.max(0, Number(item.handoverCoveredQty ?? 0));
      const hadShortageBeforeHandover = handoverCoveredQty > 0;
      const resolvedByHandover =
        (hadShortageBeforeHandover || hasGlobalShortage) &&
        handoverCoveredQty > 0 &&
        item.shortageQty <= 0 &&
        ((effectiveHandoverEnabled && Boolean(effectiveLinkedPlanningId)) || Boolean(incomingHandover));
      const hasOpenShortage = hasGlobalShortage && !resolvedByHandover;
      const hasResolvedShortage = hasGlobalShortage && resolvedByHandover;

      let status: HandoverVisualStatus = 'ok';
      let reviewReason: ReviewReason | null = null;
      let source: AvailabilityVisual['source'] = 'none';
      let partnerPlanningId = '';
      let partnerLabel = '';
      let note = '';

      const hasMissingLink = (item.handoverStatus ?? 'none') === 'missing_link';

      // Präzedenz: handover > incomplete_link > open (echter Engpass) >
      // missing_link > low_reserve. Ein missing_link-Item mit echtem Engpass
      // bleibt 'open' (Engpass-Anzeige unverändert), wird nicht herabgestuft.
      // Der missing_link-Zweig ist unabhängig von availabilityState, damit ein
      // kaputter Link auch bei grünem Bestand sichtbar wird (vorher 'ok').
      if (hasResolvedShortage) {
        status = 'handover';
      } else if (hasGlobalShortage && effectiveHandoverEnabled && !effectiveLinkedPlanningId) {
        status = 'review';
        reviewReason = 'incomplete_link';
      } else if (hasOpenShortage) {
        status = 'open';
      } else if (hasMissingLink) {
        status = 'review';
        reviewReason = 'missing_link';
      } else if (item.availabilityState === 'yellow') {
        status = 'review';
        reviewReason = 'low_reserve';
      }

      if (effectiveHandoverEnabled && effectiveLinkedPlanningId) {
        source = 'outgoing';
        partnerPlanningId = effectiveLinkedPlanningId;
        partnerLabel = effectiveLinkedPlanningLabel;
        note = effectiveHandoverNote;
      } else if (incomingHandover) {
        source = 'incoming';
        partnerPlanningId = incomingHandover.partnerPlanningId;
        partnerLabel = incomingHandover.partnerLabel;
        note = incomingHandover.note;
      } else if (effectiveHandoverEnabled && !effectiveLinkedPlanningId) {
        note = effectiveHandoverNote;
      }

      map.set(key, {
        key,
        planningDate: item.planningDate,
        weekday: item.weekday,
        categoryKey: item.categoryKey,
        status,
        reviewReason,
        source,
        partnerPlanningId,
        partnerLabel,
        note,
        totalStock: item.totalStock,
        usableStock: item.usableStock,
        currentPlanningQty: item.currentPlanningQty,
        otherPlannedQty: item.otherPlannedQty,
        totalPlannedQtyForDateCategory: item.totalPlannedQtyForDateCategory,
        remainingAfterAllPlanning: item.remainingAfterAllPlanning,
        shortageQty: item.shortageQty,
        hasGlobalShortage,
        affectedPlanningIds: item.affectedPlanningIds,
        linkedPlanningId: effectiveLinkedPlanningId,
        linkedPlanningLabel: effectiveLinkedPlanningLabel,
        handoverCoveredQty,
        handoverStatus: item.handoverStatus ?? 'none',
        excludedQty: Number(item.excludedQty ?? 0),
        excludedFromPlanningQty: Number(item.excludedFromPlanningQty ?? 0),
        cardPrinterRequiredQty: Number(item.cardPrinterRequiredQty ?? 0),
        cardPrinterUpliftQty: Number(item.cardPrinterUpliftQty ?? 0),
        conflictSeverity: item.conflictSeverity ?? null,
        conflictLabel: item.conflictLabel ?? null,
        conflictSecondary: item.secondary ?? [],
      });
    }

    return map;
  }, [
    availability,
    incomingHandoverByDayCategory,
    localHandoverByDayCategory,
    planningListItemById,
    plannings,
    relatedPlannings,
    normalizeItemCategory,
  ]);

  const availabilityVisuals = useMemo(
    () =>
      Array.from(availabilityVisualMap.values()).sort((a, b) => {
        if (a.planningDate !== b.planningDate) return a.planningDate.localeCompare(b.planningDate);
        return a.categoryKey.localeCompare(b.categoryKey, 'de');
      }),
    [availabilityVisualMap],
  );

  const availabilityVisualByCategoryForRange = useMemo(() => {
    const map = new Map<string, AvailabilityVisual>();
    const rank = (item: AvailabilityVisual) => {
      if (item.status === 'open') return 3;
      if (item.status === 'review') return 2;
      if (item.status === 'handover') return 1;
      return 0;
    };
    for (const item of availabilityVisuals) {
      const key = normalizeItemCategory(item.categoryKey);
      const current = map.get(key);
      if (!current) {
        map.set(key, item);
        continue;
      }
      const currentRank = rank(current);
      const nextRank = rank(item);
      if (nextRank > currentRank || (nextRank === currentRank && item.shortageQty > current.shortageQty)) {
        map.set(key, item);
      }
    }
    return map;
  }, [availabilityVisuals, normalizeItemCategory]);

  const planningStats = useMemo(() => {
    const openStatuses: PlanningStatus[] = ['Entwurf', 'Geplant', 'Bestätigt'];
    const openCount = plannings.filter((item) => openStatuses.includes(item.status)).length;
    const doneCount = plannings.filter((item) => item.status === 'Abgeschlossen').length;
    const redCount = planningSummary?.openConflictCount ?? 0;
    return {
      total: plannings.length,
      openCount,
      doneCount,
      redCount,
    };
  }, [planningSummary, plannings]);

  // Konfliktursachen-Gruppierung — vom Backend berechnet, hier nur dargestellt.
  const conflictGroups = planningSummary?.conflictGroups ?? [];
  const conflictCauseCount = planningSummary?.conflictCauseCount ?? conflictGroups.length;

  const networkVisuals = useMemo(
    () => availabilityVisuals.filter((item) => item.status === 'handover'),
    [availabilityVisuals],
  );

  const incompleteVisuals = useMemo(
    () => availabilityVisuals.filter((item) => item.status === 'review'),
    [availabilityVisuals],
  );

  const shortageVisuals = useMemo(
    () => availabilityVisuals.filter((item) => item.status === 'open'),
    [availabilityVisuals],
  );

  // Aggregierte Verbund-/Übergabe-Einträge für den additiven Detail-Block.
  // Zeigt jede dokumentierte Übergabe-Verknüpfung der geöffneten Planung —
  // unabhängig davon, ob ein Engpass besteht. Eingehende Übergaben kommen
  // direkt aus availability.incomingHandovers (Backend liefert sie pro
  // Tag×Kategorie), ausgehende werden aus availabilityVisuals ergänzt, die
  // der bestehende networkVisuals-Filter (status === 'handover') wegen
  // fehlender Engpass-Coverage nicht erfasst.
  const verbundEntries = useMemo<VerbundEntry[]>(() => {
    const map = new Map<string, VerbundEntry>();

    for (const entry of availability?.incomingHandovers ?? []) {
      if (!entry.partnerPlanningId) continue;
      const key = `incoming|${entry.partnerPlanningId}`;
      const existing = map.get(key);
      if (existing) {
        if (!existing.categoryKeys.includes(entry.categoryKey)) {
          existing.categoryKeys.push(entry.categoryKey);
        }
        if (entry.planningDate < existing.dateFrom) existing.dateFrom = entry.planningDate;
        if (entry.planningDate > existing.dateTo) existing.dateTo = entry.planningDate;
        existing.totalQty += entry.qty ?? 0;
        if (entry.note && !existing.notes.includes(entry.note)) existing.notes.push(entry.note);
      } else {
        map.set(key, {
          partnerPlanningId: entry.partnerPlanningId,
          partnerLabel: entry.partnerPlanningLabel || entry.partnerPlanningId,
          direction: 'incoming',
          categoryKeys: [entry.categoryKey],
          dateFrom: entry.planningDate,
          dateTo: entry.planningDate,
          totalQty: entry.qty ?? 0,
          notes: entry.note ? [entry.note] : [],
        });
      }
    }

    for (const visual of availabilityVisuals) {
      if (visual.source !== 'outgoing') continue;
      if (!visual.partnerPlanningId) continue;
      // Was bereits im bestehenden "Geplante Übergaben"-Block erscheint
      // (handover / review / open), nicht doppeln. Nur die stillen
      // 'ok'-Verknüpfungen einsammeln.
      if (visual.status === 'handover' || visual.status === 'review' || visual.status === 'open') continue;
      const key = `outgoing|${visual.partnerPlanningId}`;
      const existing = map.get(key);
      if (existing) {
        if (!existing.categoryKeys.includes(visual.categoryKey)) {
          existing.categoryKeys.push(visual.categoryKey);
        }
        if (visual.planningDate < existing.dateFrom) existing.dateFrom = visual.planningDate;
        if (visual.planningDate > existing.dateTo) existing.dateTo = visual.planningDate;
        existing.totalQty += visual.currentPlanningQty;
        if (visual.note && !existing.notes.includes(visual.note)) existing.notes.push(visual.note);
      } else {
        map.set(key, {
          partnerPlanningId: visual.partnerPlanningId,
          partnerLabel: visual.partnerLabel || visual.linkedPlanningLabel || visual.partnerPlanningId,
          direction: 'outgoing',
          categoryKeys: [visual.categoryKey],
          dateFrom: visual.planningDate,
          dateTo: visual.planningDate,
          totalQty: visual.currentPlanningQty,
          notes: visual.note ? [visual.note] : [],
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      if (a.direction !== b.direction) return a.direction === 'incoming' ? -1 : 1;
      return a.partnerLabel.localeCompare(b.partnerLabel);
    });
  }, [availability, availabilityVisuals]);

  // Schweregrad-Zusammenfassung über alle klassifizierten Zellen — treibt die
  // kompakte "3 Echte Engpässe · 2 Übergabe prüfen · …"-Kopfzeile.
  const conflictSeveritySummary = useMemo(() => {
    const counts = new Map<PlanningConflictSeverity, number>();
    for (const visual of availabilityVisuals) {
      if (!visual.conflictSeverity) continue;
      counts.set(visual.conflictSeverity, (counts.get(visual.conflictSeverity) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([severity, count]) => ({ severity, count }))
      .sort((a, b) => conflictSeverityRank(a.severity) - conflictSeverityRank(b.severity));
  }, [availabilityVisuals]);

  // Uplift-Hinweise, die NICHT bereits im Engpass-Card erscheinen — z. B.
  // wenn der Bedarf ausreichend gedeckt ist, der Nutzer aber trotzdem sehen
  // soll, dass der Laptop-Bedarf wegen Kartendruckern angehoben wurde.
  const cardPrinterUpliftVisuals = useMemo(
    () => availabilityVisuals.filter(
      (item) => item.cardPrinterUpliftQty > 0 && item.status !== 'open',
    ),
    [availabilityVisuals],
  );

  const healthyCategoryCount = useMemo(() => {
    const blockedCategories = new Set(
      availabilityVisuals
        .filter((item) => item.status !== 'ok')
        .map((item) => normalizeItemCategory(item.categoryKey)),
    );
    return (availability?.categorySummary ?? []).filter(
      (item) => !blockedCategories.has(normalizeItemCategory(item.categoryKey)),
    ).length;
  }, [availability, availabilityVisuals, normalizeItemCategory]);

  const currentPlanningLabel = useMemo(() => {
    if (!editor) return '';
    return buildPlanningLabel({
      projectName: editor.projectName,
      eventName: editor.eventName,
      startDate: editor.startDate,
    });
  }, [editor]);

  const visiblePlannings = useMemo(() => {
    const filtered = plannings.filter((item) => {
      const matchesStatus = listStatus === 'Alle' || item.status === listStatus;
      const needle = listSearch.trim().toLowerCase();
      const haystack = `${item.customerName} ${item.projectName} ${item.eventName ?? ''}`.toLowerCase();
      const matchesSearch = !needle || haystack.includes(needle);
      const matchesConflict = !conflictFilterActive || (item.openConflictCount ?? 0) > 0;
      return matchesStatus && matchesSearch && matchesConflict;
    });
    if (!conflictFilterActive) return filtered;
    return [...filtered].sort((a, b) => {
      if (a.startDate !== b.startDate) return a.startDate.localeCompare(b.startDate);
      const customer = a.customerName.localeCompare(b.customerName, 'de', { sensitivity: 'base' });
      if (customer !== 0) return customer;
      return a.projectName.localeCompare(b.projectName, 'de', { sensitivity: 'base' });
    });
  }, [conflictFilterActive, listSearch, listStatus, plannings]);

  // Handover-Summary kommt ausschliesslich aus der Listen-API
  // (GET /api/wms/planning). Frueher haben wir hier fuer jede Karte ohne
  // ``handoverSummary`` zusaetzlich GET /api/wms/planning/{id} per Promise.all
  // ausgeloest, um einen Fallback-Summary in der FE zu berechnen. Das war
  // teuer (eine Detail-Welle beim Oeffnen der Seite) und inhaltlich folgenlos:
  // wenn das Backend ``handoverSummary === null`` liefert, gibt es keine
  // Handover-Verknuepfung — der Fallback fand auch keine.
  // Falls ``item.handoverSummary`` ``null`` ist, wird kein Handover-Badge
  // angezeigt. Details werden erst beim Oeffnen einer Planung geladen
  // (openPlanning).
  const planningListHandoverSummaryById = useMemo(() => {
    const map = new Map<string, PlanningListHandoverSummary>();
    for (const item of visiblePlannings) {
      if (item.handoverSummary) map.set(item.id, item.handoverSummary);
    }
    return map;
  }, [visiblePlannings]);

  // Planungen mit Übergabe-Verbund → blauer Marker in der kompakten Liste.
  const handoverIdSet = useMemo(
    () => new Set(planningListHandoverSummaryById.keys()),
    [planningListHandoverSummaryById],
  );

  // --- Cockpit-Ableitungen für das Detail-Panel (reine Präsentation) --------
  // Panel zeigt nur konsistente Daten: editor gehört zur aktuellen Auswahl,
  // sonst Skeleton (openPlanning setzt selectedId sofort, Daten kommen async).
  const panelPlanning = editor && editor.id === selectedId ? editor : null;
  const todayIso = toIsoDate(new Date());

  const cockpitTimeline = useMemo(
    () =>
      panelPlanning
        ? derivePlanningPhases({
            status: panelPlanning.status,
            startDate: panelPlanning.startDate,
            endDate: panelPlanning.endDate,
            returnBufferDays: panelPlanning.returnBufferDays,
            today: todayIso,
            issuedQty: assignedAssets?.assignedTotal,
            plannedQty: assignedAssets?.plannedTotal,
          })
        : null,
    [panelPlanning, assignedAssets, todayIso],
  );

  // Bedarf-Tabelle: konsumiert die bestehende Worst-Status-Aggregation pro
  // Kategorie (availabilityVisualByCategoryForRange) — keine eigene Logik.
  const needsRows = useMemo(
    () =>
      aggregateCategoryNeeds(
        availability?.categorySummary ?? [],
        availabilityVisualByCategoryForRange,
        normalizeItemCategory,
      ),
    [availability, availabilityVisualByCategoryForRange, normalizeItemCategory],
  );
  const needsSummary = useMemo(() => summarizeNeeds(needsRows), [needsRows]);

  const conflictSentences = useMemo(
    () =>
      panelPlanning
        ? buildConflictSentences({
            dayVisuals: availabilityVisuals,
            relatedPlannings,
            conflictGroups,
            ownPlanningId: panelPlanning.id,
            ownEndDate: panelPlanning.endDate,
            normalizeCategory: normalizeItemCategory,
          })
        : { sentences: [], recommendation: null },
    [panelPlanning, availabilityVisuals, relatedPlannings, conflictGroups, normalizeItemCategory],
  );

  const handoverProjectOptions = useMemo(() => {
    const activeStatuses: PlanningStatus[] = ['Entwurf', 'Geplant', 'Bestätigt', 'Bestaetigt'];
    return plannings.filter((planning) => activeStatuses.includes(planning.status));
  }, [plannings]);

  const handoverOptionsByDay = useMemo(() => {
    if (!editor) return new Map<string, Array<{ id: string; label: string }>>();
    const map = new Map<string, Array<{ id: string; label: string }>>();

    for (const day of editor.days) {
      const enriched = handoverProjectOptions
        .filter((planning) => planning.id !== editor.id)
        .map((planning) => {
          const sameDay = isDateWithinRange(day.planningDate, planning.startDate, planning.endDate);
          const overlapsEditorRange = rangesOverlap(
            editor.startDate,
            editor.endDate,
            planning.startDate,
            planning.endDate,
          );
          const priority = sameDay ? 0 : overlapsEditorRange ? 1 : 2;
          const suffix = sameDay
            ? 'gleicher Tag'
            : overlapsEditorRange
              ? 'Zeitraum überschneidet sich'
              : 'andere aktive Planung';
          return {
            id: planning.id,
            priority,
            startDate: planning.startDate,
            label: `${planning.projectName} (${planning.customerName}) - ${suffix}`,
          };
        });

      // Fallback: aktuell verknüpfte Planungen, die nicht in der aktiven
      // Auswahlliste auftauchen (z. B. Status "Abgeschlossen" oder
      // "Storniert", oder Partner zwischenzeitlich gelöscht). Ohne diesen
      // Block würde das <select> keine passende Option mehr finden und der
      // Browser zeigt die leere Default-Option — der Nutzer denkt, die
      // Übergabe sei verschwunden, obwohl linkedPlanningId noch gesetzt ist
      // (Live-Fall BPI 1 / BPI 2 Kartendrucker).
      const existingIds = new Set(enriched.map((option) => option.id));
      const selectedIds = new Set<string>();
      for (const item of day.items) {
        const linked = item.linkedPlanningId?.trim();
        if (linked && linked !== editor.id) {
          selectedIds.add(linked);
        }
      }
      for (const linkedId of selectedIds) {
        if (existingIds.has(linkedId)) continue;
        const partner = plannings.find((entry) => entry.id === linkedId);
        if (partner) {
          enriched.push({
            id: linkedId,
            priority: 3,
            startDate: partner.startDate,
            label: `${partner.projectName} (${partner.customerName}) - verknüpft, anderer Status`,
          });
        } else {
          enriched.push({
            id: linkedId,
            priority: 4,
            startDate: '',
            label: `${buildPlanningFallbackLabel(linkedId, plannings)} - Verknüpfte Planung nicht gefunden`,
          });
        }
      }

      const options = enriched
        .sort((a, b) => {
          if (a.priority !== b.priority) return a.priority - b.priority;
          if (a.startDate !== b.startDate) return a.startDate.localeCompare(b.startDate);
          return a.label.localeCompare(b.label, 'de');
        })
        .map((item) => ({ id: item.id, label: item.label }));
      map.set(day.planningDate, options);
    }
    return map;
  }, [editor, handoverProjectOptions, plannings]);

  const editorStats = useMemo(() => {
    if (!editor) {
      return {
        requestedQty: 0,
        dayCount: 0,
        categoryCount: 0,
      };
    }
    const allItems = editor.days.flatMap((day) => day.items);
    const requestedQty = allItems.reduce((total, item) => total + Math.max(0, Number(item.qty || 0)), 0);
    const categoryCount = new Set(allItems.map((item) => normalizeItemCategory(item.categoryKey)).filter(Boolean)).size;
    return {
      requestedQty,
      dayCount: editor.days.length,
      categoryCount,
    };
  }, [editor, normalizeItemCategory]);

  const loadPlannings = async (selectId?: string, options?: { silentBusy?: boolean }) => {
    setListLoading(true);
    if (!options?.silentBusy) setBusyState('list');
    setError(null);
    try {
      const data = await listPlannings();
      setPlannings(data);
      const visiblePlanningIds = new Set(data.map((item) => item.id));
      setPlanningListDetails((current) => {
        const next: Record<string, PlanningResponse> = {};
        for (const [planningId, details] of Object.entries(current)) {
          if (visiblePlanningIds.has(planningId)) next[planningId] = details;
        }
        return next;
      });
      setCalendarAvailabilitiesByPlanningId((current) => {
        const next: Record<string, PlanningAvailabilityResponse> = {};
        for (const [planningId, planningAvailability] of Object.entries(current)) {
          if (visiblePlanningIds.has(planningId)) next[planningId] = planningAvailability;
        }
        return next;
      });
      if (selectId) {
        setSelectedId(selectId);
      } else if (selectedId && !data.some((item) => item.id === selectedId)) {
        setSelectedId('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Planungen konnten nicht geladen werden.');
    } finally {
      setListLoading(false);
      if (!options?.silentBusy) setBusyState(null);
    }
  };

  // Lädt eine Planung in Panel-/Editor-States. Navigiert NICHT selbst — die
  // URL steuert die Auswahl (navigateToPlanning bzw. Route-Effekt unten);
  // showModal=true öffnet zusätzlich das Editor-Modal (z. B. Mobile,
  // Refresh-Flows während der Editor offen ist).
  const openPlanning = async (planningId: string, options?: { showModal?: boolean; silentBusy?: boolean }) => {
    // Ursache des Bugs: Mehrere schnelle Klicks konnten asynchron in falscher Reihenfolge zurückkommen
    // und damit Editor/Availability mit Daten eines anderen Projekts überschreiben.
    const requestSeq = openPlanningRequestSeq.current + 1;
    openPlanningRequestSeq.current = requestSeq;
    setSelectedId(planningId);
    if (options?.showModal ?? true) {
      setEditorOpen(true);
    }
    setDetailLoading(true);
    if (!options?.silentBusy) setBusyState('open');
    setError(null);
    try {
      const [planning, planningAvailability, planningAssigned, planningHandover] = await Promise.all([
        getPlanning(planningId),
        getPlanningAvailability(planningId),
        // Schritt C: darf den Detail-Load nicht blockieren → Fehler tolerieren.
        getPlanningAssignedAssets(planningId).catch(() => null),
        getHandoverStatus(planningId).catch(() => null),
      ]);
      const editable = toEditablePlanning(planning);
      if (openPlanningRequestSeq.current !== requestSeq) return;
      setEditor(editable);
      setEditorInitial(cloneEditablePlanning(editable));
      setAvailability(planningAvailability);
      setAssignedAssets(planningAssigned);
      setHandoverStatus(planningHandover);
      setPlanningListDetails((current) => ({ ...current, [planning.id]: planning }));
      setCalendarAvailabilitiesByPlanningId((current) => ({
        ...current,
        [planningAvailability.planningId || planning.id]: planningAvailability,
      }));
    } catch (err) {
      if (openPlanningRequestSeq.current !== requestSeq) return;
      setError(err instanceof Error ? err.message : 'Planungsdetail konnte nicht geladen werden.');
    } finally {
      if (openPlanningRequestSeq.current !== requestSeq) return;
      setDetailLoading(false);
      if (!options?.silentBusy) setBusyState(null);
    }
  };

  const refreshOverview = async () => {
    try {
      await onRefreshOverview?.();
    } catch {
      // Keep planning flows stable even if global overview refresh fails.
    }
  };

  // Fallback/Notfall: stößt die (sonst automatische) Übergabe manuell an bzw.
  // macht sie rückgängig. Standardweg ist der automatische Scheduler.
  const runHandoverNow = async () => {
    if (!editor || handoverBusy) return;
    setHandoverBusy(true);
    setError(null);
    try {
      const result = await runHandover(editor.id, true);
      setHandoverStatus(await getHandoverStatus(editor.id).catch(() => null));
      await openPlanning(editor.id, { silentBusy: true });
      await refreshOverview();
      if (result.transferredCount === 0) {
        setError('Keine übergabefähigen Geräte gefunden (Konfiguration, Mengen oder Zeitpunkt prüfen).');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Übergabe konnte nicht ausgeführt werden.');
    } finally {
      setHandoverBusy(false);
    }
  };

  const undoHandoverNow = async () => {
    if (!editor || handoverBusy) return;
    setHandoverBusy(true);
    setError(null);
    try {
      await undoHandover(editor.id);
      setHandoverStatus(await getHandoverStatus(editor.id).catch(() => null));
      await openPlanning(editor.id, { silentBusy: true });
      await refreshOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Übergabe konnte nicht rückgängig gemacht werden.');
    } finally {
      setHandoverBusy(false);
    }
  };

  // Detail-Auswahl über die URL (push mit plPanel-Marker): Der Route-Effekt
  // unten lädt daraufhin die Daten; Browser-Zurück deselektiert das Panel.
  const navigateToPlanning = (planningId: string) => {
    if (resolveRoute(window.location.pathname).params.planningId === planningId) return;
    navigate(planningDetailPath(planningId), { state: { plPanel: true } });
  };

  const handlePlanningCardClick = (planningId: string) => {
    if (editorOpen) return;
    if (selectedId === planningId) {
      closePanel();
      return;
    }
    navigateToPlanning(planningId);
  };

  const activateConflictFilter = () => {
    if ((planningSummary?.openConflictCount ?? 0) <= 0) return;
    setListSearch('');
    setListStatus('Alle');
    setConflictFilterActive(true);
    const firstWithConflict = [...plannings]
      .filter((item) => (item.openConflictCount ?? 0) > 0)
      .sort((a, b) => {
        if (a.startDate !== b.startDate) return a.startDate.localeCompare(b.startDate);
        const customer = a.customerName.localeCompare(b.customerName, 'de', { sensitivity: 'base' });
        if (customer !== 0) return customer;
        return a.projectName.localeCompare(b.projectName, 'de', { sensitivity: 'base' });
      })[0];
    if (firstWithConflict) {
      // Auswahl läuft über die URL — so zeigt das Panel die Planung inkl.
      // Konfliktdetails und Browser-Zurück funktioniert.
      navigateToPlanning(firstWithConflict.id);
    }
  };

  const clearConflictFilter = () => {
    setConflictFilterActive(false);
  };

  // Kalender laedt beim initialen Rendern KEINE Planungsdetails mehr —
  // frueher loeste das eine Detail-Welle pro Wochenansicht aus. Detail-Daten
  // (Tage/Items) werden nur dann benoetigt, wenn der User eine Planung
  // tatsaechlich oeffnet → das laeuft ueber ``openPlanning`` und befuellt
  // ``planningListDetails`` punktuell. Was der Kalender pro sichtbarer
  // Woche braucht, ist Availability (gruen/gelb/rot pro Tag/Kategorie) — die
  // wird hier weiter pro fehlender Planung nachgeladen.
  // ``useCallback`` stabilisiert die Funktion, damit der Child-Effect in
  // PlanningCalendarAddOn nicht bei jedem Parent-Render erneut feuert.
  const requestCalendarPlanningData = useCallback(
    (planningIds: string[]) => {
      const missingAvailabilityIds = planningIds.filter(
        (planningId) => !calendarAvailabilitiesByPlanningId[planningId],
      );
      if (!missingAvailabilityIds.length) return;

      void Promise.all(
        missingAvailabilityIds.map(async (planningId) => {
          try {
            const planningAvailability = await getPlanningAvailability(planningId);
            return { planningId, planningAvailability };
          } catch {
            return null;
          }
        }),
      ).then((results) => {
        setCalendarAvailabilitiesByPlanningId((current) => {
          const next = { ...current };
          for (const result of results) {
            if (!result) continue;
            const responsePlanningId = result.planningAvailability.planningId || result.planningId;
            next[responsePlanningId] = result.planningAvailability;
          }
          return next;
        });
      });
    },
    [calendarAvailabilitiesByPlanningId],
  );

  const persistPlanning = async (planning: EditablePlanning) => {
    if (!planning.customerName.trim() || !planning.projectName.trim()) {
      await alert({
        title: 'Pflichtfelder fehlen',
        message: 'Bitte Kunde und Projekt ausfüllen.',
      });
      return null;
    }
    if (planning.endDate < planning.startDate) {
      await alert({
        title: 'Zeitraum ungültig',
        message: 'Das Enddatum darf nicht vor dem Startdatum liegen.',
      });
      return null;
    }
    setSaving(true);
    setBusyState('save');
    setError(null);
    try {
      const saved = await updatePlanning(planning.id, toUpsertPayload(planning));
      const [freshPlanning, planningAvailability, planningAssigned, planningHandover] = await Promise.all([
        getPlanning(saved.id),
        getPlanningAvailability(saved.id),
        getPlanningAssignedAssets(saved.id).catch(() => null),
        getHandoverStatus(saved.id).catch(() => null),
        loadPlannings(saved.id, { silentBusy: true }),
      ]);
      setHandoverStatus(planningHandover);
      await refreshOverview();
      const savedEditor = toEditablePlanning(freshPlanning);
      setEditor(savedEditor);
      setEditorInitial(cloneEditablePlanning(savedEditor));
      setAvailability(planningAvailability);
      setAssignedAssets(planningAssigned);
      setPlanningListDetails((current) => ({ ...current, [freshPlanning.id]: freshPlanning }));
      setCalendarAvailabilitiesByPlanningId((current) => ({
        ...current,
        [planningAvailability.planningId || freshPlanning.id]: planningAvailability,
      }));
      return savedEditor;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Planung konnte nicht gespeichert werden.');
      return null;
    } finally {
      setSaving(false);
      setBusyState(null);
    }
  };

  const saveCurrent = async () => {
    if (!editor) return;
    await persistPlanning(editor);
  };

  const isEditorDirty = useMemo(() => {
    if (!editor || !editorInitial) return false;
    return JSON.stringify(editor) !== JSON.stringify(editorInitial);
  }, [editor, editorInitial]);

  // Detail-State hart zurücksetzen — ohne Rückfrage und ohne Navigation.
  // Wird vom Browser-Zurück (popstate) und als gemeinsamer Kern der
  // UI-Schließwege genutzt.
  const resetDetailState = () => {
    setEditorOpen(false);
    setHandoverEditorKey(null);
    setHandoverSnapshot({});
    setEditor(null);
    setEditorInitial(null);
    setAvailability(null);
    setAssignedAssets(null);
    setHandoverStatus(null);
    setSelectedId('');
  };

  // Panel deselektieren: State abräumen und die URL zurück zur Liste bringen —
  // echter Back-Schritt, wenn das Detail aus der App geöffnet wurde
  // (plPanel-Marker), sonst replace (Deep-Link/Refresh ohne Vorgeschichte).
  const closePanel = () => {
    resetDetailState();
    const historyState =
      typeof window !== 'undefined' ? (window.history.state as { plPanel?: boolean } | null) : null;
    if (historyState?.plPanel) {
      window.history.back();
    } else if (resolveRoute(window.location.pathname).params.planningId) {
      navigate(canonicalPathForPage('planning'), { replace: true });
    }
  };

  // Editor-Modal schließen: Dirty-Rückfrage, dann verworfene Änderungen auf
  // den gespeicherten Stand zurückrollen (Clone — kein Referenz-Aliasing),
  // damit das Panel darunter keine ungespeicherten Werte zeigt. Auswahl und
  // URL bleiben erhalten; nur Mobile (kein Panel) räumt beides mit ab.
  const closeEditorModal = async () => {
    if (!editorOpen) return;
    if (canEdit && isEditorDirty) {
      const accepted = await confirm({
        title: 'Änderungen verwerfen?',
        message: 'Nicht gespeicherte Änderungen gehen verloren. Modal wirklich schließen?',
        confirmLabel: 'Verwerfen',
        cancelLabel: 'Weiter bearbeiten',
        tone: 'default',
      });
      if (!accepted) return;
    }
    if (editorInitial) {
      setEditor(cloneEditablePlanning(editorInitial));
    }
    setHandoverEditorKey(null);
    setEditorOpen(false);
    if (isMobile) {
      closePanel();
    }
  };

  // Escape-Kaskade: erst den Editor schließen, dann das Panel deselektieren.
  useEffect(() => {
    if (!editorOpen && !selectedId) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || saving) return;
      if (editorOpen) {
        void closeEditorModal();
      } else {
        closePanel();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [editorOpen, selectedId, saving, closeEditorModal]);

  // URL ⇄ Panel synchron halten: Eine Detail-URL (Deep-Link, Refresh,
  // Browser-Vor/Zurück) selektiert das Panel für genau diese Planung (auf
  // Mobile öffnet sie den Editor); fällt die URL auf die Liste zurück
  // (Browser-Zurück), wird hart deselektiert — bewusst ohne Rückfrage, die
  // gilt nur für UI-Schließwege.
  useEffect(() => {
    if (routePlanningId) {
      // Auch laden, wenn selectedId zwar schon stimmt (z. B. von loadPlannings
      // nach dem Anlegen gesetzt), die Detail-Daten aber noch fehlen.
      if (selectedId !== routePlanningId || editor?.id !== routePlanningId) {
        void openPlanning(routePlanningId, { showModal: isMobile });
      }
      return;
    }
    if (selectedId) {
      resetDetailState();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routePlanningId]);

  const createNewPlanning = async () => {
    if (!createForm.customerName.trim() || !createForm.projectName.trim()) {
      await alert({
        title: 'Pflichtfelder fehlen',
        message: 'Bitte Kunde und Projekt ausfüllen.',
      });
      return;
    }
    if (createForm.endDate < createForm.startDate) {
      await alert({
        title: 'Zeitraum ungültig',
        message: 'Das Enddatum darf nicht vor dem Startdatum liegen.',
      });
      return;
    }
    setSaving(true);
    setBusyState('create');
    setError(null);
    try {
      const created = await createPlanning({
        customerName: createForm.customerName.trim(),
        projectName: createForm.projectName.trim(),
        eventName: createForm.eventName.trim() || null,
        projectManagerUserId: createForm.projectManagerUserId || null,
        startDate: createForm.startDate,
        endDate: createForm.endDate,
        notes: createForm.notes,
        status: createForm.status,
        returnBufferDays: createForm.returnBufferDays,
        days: buildRangePlanningDays(createForm.startDate),
      });
      setCreateOpen(false);
      setCreateForm((current) => ({
        ...current,
        customerName: '',
        projectName: '',
        eventName: '',
        projectManagerUserId: '',
        notes: '',
      }));
      await loadPlannings(created.id, { silentBusy: true });
      await refreshOverview();
      // Neue Planung im Panel selektieren (URL) und direkt den Editor öffnen,
      // damit Positionen erfasst werden können — wie bisher.
      navigateToPlanning(created.id);
      if (canEdit) setEditorOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Planung konnte nicht angelegt werden.');
    } finally {
      setSaving(false);
      setBusyState(null);
    }
  };

  const duplicate = async (planningId: string) => {
    setSaving(true);
    setBusyState('duplicate');
    setError(null);
    try {
      const duplicated = await duplicatePlanning(planningId);
      await loadPlannings(duplicated.id, { silentBusy: true });
      await refreshOverview();
      navigateToPlanning(duplicated.id);
      if (canEdit) setEditorOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Planung konnte nicht dupliziert werden.');
    } finally {
      setSaving(false);
      setBusyState(null);
    }
  };

  const deleteCurrent = async (planningId: string) => {
    const accepted = await confirm({
      title: 'Planung löschen',
      message: 'Diese Planung wird dauerhaft gelöscht. Fortfahren?',
      confirmLabel: 'Löschen',
      cancelLabel: 'Abbrechen',
      tone: 'danger',
    });
    if (!accepted) return;
    setSaving(true);
    setBusyState('delete');
    setError(null);
    try {
      await deletePlanning(planningId);
      if (selectedId === planningId) {
        // Auswahl abräumen; die Detail-URL der gelöschten Planung nicht als
        // History-Eintrag stehen lassen (replace zur Liste).
        resetDetailState();
        if (resolveRoute(window.location.pathname).params.planningId === planningId) {
          navigate(canonicalPathForPage('planning'), { replace: true });
        }
      }
      setPlanningListDetails((current) => {
        if (!current[planningId]) return current;
        const next = { ...current };
        delete next[planningId];
        return next;
      });
      setCalendarAvailabilitiesByPlanningId((current) => {
        if (!current[planningId]) return current;
        const next = { ...current };
        delete next[planningId];
        return next;
      });
      await loadPlannings(undefined, { silentBusy: true });
      await refreshOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Planung konnte nicht gelöscht werden.');
    } finally {
      setSaving(false);
      setBusyState(null);
    }
  };

  const changeStatus = async (planningId: string, status: PlanningStatus) => {
    setSaving(true);
    setBusyState('status');
    setStatusUpdatingId(planningId);
    setError(null);
    try {
      await updatePlanningStatus(planningId, status);
      if (selectedId === planningId) {
        await loadPlannings(planningId, { silentBusy: true });
        await openPlanning(planningId, { showModal: false, silentBusy: true });
      } else {
        await loadPlannings(undefined, { silentBusy: true });
      }
      await refreshOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Status konnte nicht gesetzt werden.');
    } finally {
      setSaving(false);
      setStatusUpdatingId(null);
      setBusyState(null);
    }
  };

  // --- "Projekt prüfen": frische Verfügbarkeitsprüfung + geführte Aktionen ---
  const openCheck = async () => {
    if (!panelPlanning) return;
    setCheckOpen(true);
    setCheckBusy(true);
    try {
      // Frisch laden — die Panel-Anzeige zieht automatisch mit (setAvailability).
      const fresh = await getPlanningAvailability(panelPlanning.id);
      setAvailability(fresh);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verfügbarkeit konnte nicht geprüft werden.');
      setCheckOpen(false);
    } finally {
      setCheckBusy(false);
    }
  };

  const resolveConflictsFromCheck = () => {
    setCheckOpen(false);
    conflictBlockRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const adjustFromCheck = () => {
    setCheckOpen(false);
    setEditorOpen(true);
  };

  const saveStatusFromCheck = (status: PlanningStatus) => {
    if (!panelPlanning) return;
    setCheckOpen(false);
    void changeStatus(panelPlanning.id, status);
  };

  const patchEditor = (updater: (value: EditablePlanning) => EditablePlanning) => {
    setEditor((current) => (current ? updater(current) : current));
  };

  const patchPlanningItem = (
    dayIndex: number,
    itemIndex: number,
    updater: (item: EditablePlanning['days'][number]['items'][number]) => EditablePlanning['days'][number]['items'][number],
  ) => {
    patchEditor((current) => updatePlanningItemInEditor(current, dayIndex, itemIndex, updater));
  };

  const findPlanningItemPosition = (planningDate: string, categoryKey: string) => {
    if (!editor) return null;
    const normalizedTarget = normalizeItemCategory(categoryKey);
    for (let dayIndex = 0; dayIndex < editor.days.length; dayIndex += 1) {
      if (editor.days[dayIndex].planningDate !== planningDate && editor.days[dayIndex].planningDate !== editor.startDate) continue;
      const itemIndex = editor.days[dayIndex].items.findIndex(
        (item) => normalizeItemCategory(item.categoryKey) === normalizedTarget,
      );
      if (itemIndex >= 0) return { dayIndex, itemIndex };
    }
    const fallbackIndex = editor.days[0]?.items.findIndex(
      (item) => normalizeItemCategory(item.categoryKey) === normalizedTarget,
    );
    if (typeof fallbackIndex === 'number' && fallbackIndex >= 0) return { dayIndex: 0, itemIndex: fallbackIndex };
    return null;
  };

  const openHandoverEditor = (
    dayIndex: number,
    itemIndex: number,
    preset?: Partial<EditablePlanning['days'][number]['items'][number]>,
  ) => {
    if (!editor) return;
    const key = handoverKey(dayIndex, itemIndex);
    setHandoverSnapshot((current) => ({ ...current, [key]: { ...editor.days[dayIndex].items[itemIndex] } }));
    if (preset) {
      patchPlanningItem(dayIndex, itemIndex, (item) => ({
        ...item,
        ...preset,
      }));
    }
    setHandoverEditorKey(key);
  };

  const cancelHandoverEditor = (dayIndex: number, itemIndex: number) => {
    const key = handoverKey(dayIndex, itemIndex);
    const snapshot = handoverSnapshot[key];
    if (snapshot) {
      patchPlanningItem(dayIndex, itemIndex, () => snapshot);
    }
    setHandoverEditorKey((current) => (current === key ? null : current));
  };

  const clearHandoverSnapshot = (key: string) => {
    setHandoverSnapshot((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const saveHandoverEditor = async (dayIndex: number, itemIndex: number) => {
    if (!editor) return;
    const key = handoverKey(dayIndex, itemIndex);
    const saved = await persistPlanning(editor);
    if (!saved) return;
    clearHandoverSnapshot(key);
    setHandoverEditorKey((current) => (current === key ? null : current));
  };

  const removeHandover = async (dayIndex: number, itemIndex: number) => {
    if (!editor) return;
    const key = handoverKey(dayIndex, itemIndex);
    const nextEditor = updatePlanningItemInEditor(editor, dayIndex, itemIndex, (item) => ({
      ...item,
      handoverEnabled: false,
      linkedPlanningId: '',
      handoverNote: '',
    }));
    setEditor(nextEditor);
    const saved = await persistPlanning(nextEditor);
    if (!saved) return;
    clearHandoverSnapshot(key);
    setHandoverEditorKey((current) => (current === key ? null : current));
  };

  const openHandoverEditorByKey = (
    planningDate: string,
    categoryKey: string,
    preset?: Partial<EditablePlanning['days'][number]['items'][number]>,
  ) => {
    const position = findPlanningItemPosition(planningDate, categoryKey);
    if (!position) return;
    openHandoverEditor(position.dayIndex, position.itemIndex, preset);
  };

  const removeHandoverByKey = async (planningDate: string, categoryKey: string) => {
    const position = findPlanningItemPosition(planningDate, categoryKey);
    if (!position) return;
    await removeHandover(position.dayIndex, position.itemIndex);
  };

  useEffect(() => {
    void loadPlannings();
  }, []);

  // todayIso ist weiter oben (Cockpit-Ableitungen) deklariert.
  const tomorrowIso = toIsoDate(new Date(Date.now() + 86400000));
  const weekEndIso = toIsoDate(new Date(Date.now() + 6 * 86400000));
  // Enddatum ist exklusiv (= Rückgabetag, kein Einsatztag). Eine Planung gilt
  // an einem Tag nur dann als aktiv, wenn dieser Tag belegt ist
  // (start <= Tag < Rückgabetag) — sonst erschiene sie noch an ihrem
  // Rückgabetag fälschlich unter "Heute".
  const mobileToday = visiblePlannings.filter((item) => isDateBooked(todayIso, item.startDate, item.endDate));
  const mobileTomorrow = visiblePlannings.filter((item) => isDateBooked(tomorrowIso, item.startDate, item.endDate));
  const mobileWeek = visiblePlannings.filter(
    (item) => item.startDate <= weekEndIso && getReturnDayIso(item.startDate, item.endDate) > todayIso,
  );
  const busyMessage =
    busyState === 'list'
      ? 'Planungsliste wird geladen ...'
      : busyState === 'open'
        ? 'Planung und Verfügbarkeit werden geladen ...'
        : busyState === 'save'
          ? 'Planung wird gespeichert ...'
          : busyState === 'create'
            ? 'Planung wird angelegt ...'
            : busyState === 'duplicate'
              ? 'Planung wird dupliziert ...'
              : busyState === 'delete'
                ? 'Planung wird gelöscht ...'
                : busyState === 'status'
                  ? 'Status wird aktualisiert ...'
                  : null;

  return (
    <section className="space-y-5">
      <div className="surface-card animate-fade-up">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PageHeader dense kicker="Einsatzplanung" title="Projektbezogene Hardwareplanung" />
          <div className="flex flex-wrap items-center gap-2">
            {!isMobile ? (
              <>
                <input
                  className="field-input h-9 w-52 text-sm"
                  placeholder="Kunde oder Projekt suchen"
                  value={listSearch}
                  onChange={(event) => setListSearch(event.target.value)}
                />
                <select
                  className="field-input h-9 w-40 text-sm"
                  value={listStatus}
                  onChange={(event) => setListStatus(event.target.value as 'Alle' | PlanningStatus)}
                >
                  <option value="Alle">Alle Status</option>
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
                <SegmentedControl
                  options={[
                    { value: 'liste', label: 'Liste' },
                    { value: 'woche', label: 'Woche' },
                    { value: 'konflikte', label: 'Konflikte' },
                  ]}
                  value={view}
                  onChange={setView}
                />
              </>
            ) : null}
            {canEdit ? (
              <button type="button" data-testid="planning-create" className="btn-primary" onClick={() => setCreateOpen(true)}>
                <CalendarPlus className="h-4 w-4" />
                Neue Planung
              </button>
            ) : (
              <span className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Leseansicht
              </span>
            )}
          </div>
        </div>

        <PlanningKpiBar
          className="mt-3"
          stats={planningStats}
          conflictCauseCount={conflictCauseCount}
          conflictsViewActive={view === 'konflikte'}
          onConflictsClick={() => setView(view === 'konflikte' ? 'liste' : 'konflikte')}
        />
      </div>

      {!isMobile && view === 'konflikte' ? (
        conflictGroups.length > 0 ? (
          <article
            className="surface-card rounded-xl border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-700/50 dark:bg-amber-950/25"
            data-testid="conflict-causes-panel"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-100">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                Konfliktursachen: {conflictCauseCount}
              </h3>
              <button
                type="button"
                className="btn-secondary px-2.5 py-1.5 text-xs"
                onClick={() => {
                  activateConflictFilter();
                  setView('liste');
                }}
              >
                Betroffene Planungen in der Liste zeigen
              </button>
            </div>
            <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">
              {planningStats.redCount} technische Konflikte hängen mit diesen Engpässen zusammen.
            </p>
            <div className="mt-3 grid gap-2">
              {conflictGroups.map((group) => {
                const rangeLabel =
                  group.dateFrom === group.dateTo
                    ? formatGermanDate(group.dateFrom)
                    : `${formatGermanDate(group.dateFrom)} – ${formatGermanDate(group.dateTo)}`;
                return (
                  <div
                    key={group.id}
                    data-testid={`conflict-cause-${group.id}`}
                    className="rounded-lg border border-amber-200 bg-white p-3 text-xs shadow-sm dark:border-amber-700/50 dark:bg-slate-950"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {group.categoryKey} · {rangeLabel}
                      </span>
                      <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:border-amber-600 dark:bg-amber-900/50 dark:text-amber-100">
                        Gemeinsamer Pool-Engpass
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Es {shortageVerb(group.maxMissingQty)} maximal{' '}
                      {categoryCountLabel(group.categoryKey, group.maxMissingQty)}
                    </p>
                    <p className="mt-0.5 text-slate-600 dark:text-slate-300">
                      {group.affectedPlanningCount}{' '}
                      {group.affectedPlanningCount === 1 ? 'Planung' : 'Planungen'} betroffen
                    </p>
                    {group.affectedPlanningLabels.length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {group.affectedPlanningLabels.map((label, index) => (
                          <span
                            key={`${group.id}-pl-${index}`}
                            className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                        Tagesdetails
                      </summary>
                      <ul className="mt-1.5 space-y-1">
                        {group.days.map((day) => (
                          <li
                            key={`${group.id}-${day.date}`}
                            className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                          >
                            {formatGermanDate(day.date)}:{' '}
                            {categoryCountLabel(group.categoryKey, day.requiredQty)} benötigt ·{' '}
                            {day.usableStock} nutzbar ·{' '}
                            {categoryCountLabel(group.categoryKey, day.missingQty)}{' '}
                            {shortageVerb(day.missingQty)}
                          </li>
                        ))}
                      </ul>
                    </details>
                    {(group.recommendations ?? []).length > 0 ? (
                      <details
                        className="mt-2"
                        data-testid={`conflict-cause-recommendations-${group.id}`}
                      >
                        <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                          Lösungsvorschläge ({(group.recommendations ?? []).length})
                        </summary>
                        <ul className="mt-1.5 space-y-1.5">
                          {(group.recommendations ?? []).map((reco, index) => (
                            <li
                              key={`${group.id}-reco-${index}`}
                              className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900"
                            >
                              <div className="flex items-start gap-1.5">
                                <span
                                  className={`mt-1 h-2 w-2 shrink-0 rounded-full ${recoPriorityDot(reco.priority)}`}
                                  aria-hidden="true"
                                />
                                <div>
                                  <p className="text-[11px] font-semibold text-slate-800 dark:text-slate-100">
                                    {reco.title}
                                  </p>
                                  <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                                    {reco.description}
                                  </p>
                                </div>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </article>
        ) : (
          <article className="surface-card" data-testid="conflict-causes-panel">
            <h3 className="text-sm font-semibold text-ink">Konfliktursachen</h3>
            <p className="mt-2 rounded-xl border border-dashed border-line bg-surface-2 px-3 py-6 text-center text-sm text-ink-muted">
              Aktuell gibt es keine offenen Engpässe — alle Planungen sind gedeckt.
            </p>
          </article>
        )
      ) : null}

      {!isMobile && view === 'woche' ? (
        <article className="surface-card">
          <PlanningCalendarAddOn
            plannings={visiblePlannings}
            selectedId={selectedId}
            handoverSummaryById={planningListHandoverSummaryById}
            planningDetailsById={planningListDetails}
            availabilityByPlanningId={calendarAvailabilitiesByPlanningId}
            onSelectPlanning={(planningId) => {
              navigateToPlanning(planningId);
            }}
            requestPlanningData={requestCalendarPlanningData}
          />
        </article>
      ) : null}

      {error ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      {busyMessage ? <InlineLoadingState message={busyMessage} /> : null}

      {isMobile ? (
        <article className="surface-card">
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Mobile Planung</h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Heute, Morgen und diese Woche im Überblick.</p>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <div className="surface-muted px-2 py-2">
              <p className="font-semibold text-slate-600 dark:text-slate-300">Heute</p>
              <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">{mobileToday.length}</p>
            </div>
            <div className="surface-muted px-2 py-2">
              <p className="font-semibold text-slate-600 dark:text-slate-300">Morgen</p>
              <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">{mobileTomorrow.length}</p>
            </div>
            <div className="surface-muted px-2 py-2">
              <p className="font-semibold text-slate-600 dark:text-slate-300">Woche</p>
              <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">{mobileWeek.length}</p>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {mobileWeek.slice(0, 12).map((item) => {
              const handoverSummary = planningListHandoverSummaryById.get(item.id);
              const hasShortage = (item.openConflictCount ?? 0) > 0;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="surface-muted block min-h-[52px] w-full px-3 py-2 text-left"
                  onClick={() => {
                    void openPlanning(item.id);
                  }}
                >
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{item.projectName}</p>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    Einsatz: {formatEinsatz(item.startDate, item.endDate)} · {item.status}
                  </p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    Rückgabe: {formatRueckgabe(item.startDate, item.endDate)}
                    {Number(item.returnBufferDays ?? 0) > 0
                      ? ` · Puffer +${Math.min(3, Number(item.returnBufferDays))} · frei ab ${formatGermanDate(getStockFreeAgainIso(item.startDate, item.endDate, item.returnBufferDays))}`
                      : ''}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {handoverSummary ? 'Übergabe/Verbund aktiv' : 'Kein Verbund'}
                    {hasShortage ? ' · Engpass offen' : ''}
                  </p>
                </button>
              );
            })}
            {!mobileWeek.length ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-400">
                Keine Planungen in dieser Woche.
              </div>
            ) : null}
          </div>
        </article>
      ) : null}

      {!isMobile && view === 'liste' ? <div className="grid gap-4 xl:grid-cols-12">
        <article className="surface-card self-start xl:col-span-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-slate-900">Planungsliste</h3>
            <LoadingButton
              type="button"
              className="btn-secondary px-2.5 py-1.5 text-xs"
              onClick={() => {
                void loadPlannings();
              }}
              isLoading={listLoading && busyState === 'list'}
              loadingText="Wird geladen ..."
              disabled={saving}
            >
              Aktualisieren
            </LoadingButton>
          </div>

          {conflictFilterActive ? (
            <div
              className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"
              data-testid="planning-conflict-filter-banner"
            >
              <span>Es werden nur Planungen mit offenen Konflikten angezeigt.</span>
              <button
                type="button"
                data-testid="planning-conflict-filter-reset"
                className="rounded-full border border-rose-300 bg-white px-2.5 py-0.5 text-[11px] font-medium text-rose-700 hover:bg-rose-100"
                onClick={clearConflictFilter}
              >
                Filter zurücksetzen
              </button>
            </div>
          ) : null}

          <PlanningListCompact
            items={visiblePlannings}
            selectedId={selectedId}
            canEdit={canEdit}
            busy={saving}
            onSelect={handlePlanningCardClick}
            onDuplicate={(id) => {
              void duplicate(id);
            }}
            onDelete={(id) => {
              void deleteCurrent(id);
            }}
            handoverIds={handoverIdSet}
            scrollRef={listScrollRef}
            maxHeightClass="mt-3 max-h-[calc(100vh-330px)]"
            emptyHint={listLoading ? 'Planungen werden geladen ...' : 'Noch keine passende Planung gefunden.'}
          />
        </article>
        <div className="xl:col-span-7">
          <PlanningDetailPanel
            planning={panelPlanning}
            loading={detailLoading || (Boolean(selectedId) && !panelPlanning)}
            timeline={cockpitTimeline}
            needsRows={needsRows}
            needsSummary={needsSummary}
            sentences={conflictSentences.sentences}
            recommendation={conflictSentences.recommendation}
            issuedQty={assignedAssets?.assignedTotal ?? null}
            managerLabel={
              panelPlanning?.projectManagerUserId
                ? managerLabelById.get(panelPlanning.projectManagerUserId) ?? null
                : null
            }
            statusOptions={STATUS_OPTIONS}
            canEdit={canEdit}
            saving={saving}
            onCheck={() => {
              void openCheck();
            }}
            onEdit={() => setEditorOpen(true)}
            onClose={closePanel}
            onStatusChange={(status) => {
              if (panelPlanning) void changeStatus(panelPlanning.id, status);
            }}
            conflictRef={conflictBlockRef}
            maxHeightClass="max-h-[calc(100vh-260px)]"
          />
        </div>
      </div> : null}

      <PlanningCheckModal
        open={checkOpen}
        checking={checkBusy || detailLoading}
        saving={saving}
        status={panelPlanning?.status ?? 'Entwurf'}
        needsSummary={needsSummary}
        needsCount={needsRows.length}
        sentences={conflictSentences.sentences}
        recommendation={conflictSentences.recommendation}
        canEdit={canEdit}
        onResolve={resolveConflictsFromCheck}
        onSaveStatus={saveStatusFromCheck}
        onAdjust={adjustFromCheck}
        onClose={() => setCheckOpen(false)}
      />

      {editorOpen ? (
          <div
            className="fixed inset-0 z-[80] bg-slate-900/60 p-0 sm:p-4"
            onClick={() => {
              if (saving) return;
              void closeEditorModal();
            }}
          >
            <div className="flex h-full items-end justify-center sm:items-center">
              <article
                className="surface-card w-full max-h-full overflow-hidden rounded-t-2xl border-0 sm:max-h-[92vh] sm:max-w-6xl sm:rounded-2xl sm:border"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="soft-scrollbar h-[92vh] overflow-y-auto p-4 sm:h-auto sm:max-h-[92vh] sm:p-5">
                  {editor ? (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="text-base font-semibold text-slate-900">
                            Planung {editor.customerName} · {editor.projectName}
                          </h3>
                          <p className="text-xs text-slate-500">ID {editor.id}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => {
                              void closeEditorModal();
                            }}
                            disabled={saving}
                          >
                            Abbrechen
                          </button>
                          {canEdit ? (
                            <LoadingButton
                              type="button"
                              data-testid="planning-save"
                              className="btn-primary"
                              onClick={() => {
                                void saveCurrent();
                              }}
                              isLoading={saving && busyState === 'save'}
                              loadingText="Planung wird gespeichert ..."
                              disabled={saving && busyState !== 'save'}
                            >
                              <Save className="h-4 w-4" />
                              Speichern
                            </LoadingButton>
                          ) : (
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() => {
                                void closeEditorModal();
                              }}
                            >
                              Schließen
                            </button>
                          )}
                        </div>
                      </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <h4 className="text-sm font-semibold text-slate-900">Projektdaten</h4>
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  <label className="field">
                    Kunde
                    <input
                      className="field-input"
                      value={editor.customerName}
                      onChange={(event) =>
                        patchEditor((current) => ({ ...current, customerName: event.target.value }))
                      }
                      disabled={!canEdit}
                    />
                  </label>
                  <label className="field">
                    Projekt
                    <input
                      className="field-input"
                      value={editor.projectName}
                      onChange={(event) =>
                        patchEditor((current) => ({ ...current, projectName: event.target.value }))
                      }
                      disabled={!canEdit}
                    />
                  </label>
                  <label className="field md:col-span-2">
                    Veranstaltung
                    <input
                      className="field-input"
                      value={editor.eventName}
                      onChange={(event) =>
                        patchEditor((current) => ({ ...current, eventName: event.target.value }))
                      }
                      disabled={!canEdit}
                    />
                  </label>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <h4 className="text-sm font-semibold text-slate-900">Zeitraum und Status</h4>
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  <label className="field">
                    Startdatum
                    <input
                      type="date"
                      className="field-input"
                      value={editor.startDate}
                      disabled={!canEdit}
                      onChange={(event) =>
                        patchEditor((current) => {
                          const nextStartDate = event.target.value;
                          return {
                            ...current,
                            startDate: nextStartDate,
                            days: buildRangePlanningDays(nextStartDate, current.days),
                          };
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    Enddatum
                    <input
                      type="date"
                      className="field-input"
                      value={editor.endDate}
                      disabled={!canEdit}
                      onChange={(event) =>
                        patchEditor((current) => {
                          const nextEndDate = event.target.value;
                          return {
                            ...current,
                            endDate: nextEndDate,
                            days: buildRangePlanningDays(current.startDate, current.days),
                          };
                        })
                      }
                    />
                    <span className="mt-1 block text-xs font-normal text-slate-400 dark:text-slate-500">
                      = Rückgabetag (kein Einsatztag)
                    </span>
                  </label>
                  <label className="field">
                    Rückgabe-Puffer
                    <select
                      className="field-input"
                      value={editor.returnBufferDays}
                      disabled={!canEdit}
                      onChange={(event) =>
                        patchEditor((current) => ({
                          ...current,
                          returnBufferDays: Math.min(3, Math.max(0, Number(event.target.value) || 0)),
                        }))
                      }
                    >
                      <option value={0}>0 Tage</option>
                      <option value={1}>1 Tag</option>
                      <option value={2}>2 Tage</option>
                      <option value={3}>3 Tage</option>
                    </select>
                    <span className="mt-1 block text-xs font-normal text-slate-400 dark:text-slate-500">
                      Blockiert den Bestand zusätzlich für Rücktransport, Abbau oder verspätete Rückgabe.
                    </span>
                    <span className="mt-1 block text-xs font-normal text-amber-600 dark:text-amber-300">
                      Bestand wieder verfügbar: {formatGermanDate(getStockFreeAgainIso(editor.startDate, editor.endDate, editor.returnBufferDays))}
                    </span>
                  </label>
                  <label className="field">
                    Status
                    <select
                      className="field-input"
                      value={editor.status}
                      disabled={!canEdit}
                      onChange={(event) =>
                        patchEditor((current) => ({ ...current, status: event.target.value as PlanningStatus }))
                      }
                    >
                      {STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="field mt-3">
                  Notizen
                  <textarea
                    className="field-input min-h-[80px]"
                    value={editor.notes}
                    disabled={!canEdit}
                    onChange={(event) => patchEditor((current) => ({ ...current, notes: event.target.value }))}
                  />
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="surface-muted px-3 py-2.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Belegte Tage</p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">{getBookedDayCount(editor.startDate, editor.endDate)}</p>
                </div>
                <div className="surface-muted px-3 py-2.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Gesamtbedarf</p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">{editorStats.requestedQty}</p>
                </div>
                <div className="surface-muted px-3 py-2.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Kategorien</p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">{editorStats.categoryCount}</p>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-semibold text-slate-900">Hardwareplanung im Zeitraum</h4>
                  <p className="text-xs text-slate-500">Automatisch aus Start- und Enddatum</p>
                </div>

                <div className="soft-scrollbar max-h-[560px] space-y-3 overflow-y-auto pr-1">
                  {editor.days.map((day, dayIndex) => {
                    const dayTotal = day.items.reduce((sum, item) => sum + Math.max(0, Number(item.qty || 0)), 0);
                    return (
                      <div
                        key={`${day.planningDate}-${dayIndex}`}
                        data-testid={`planning-day-${dayIndex}`}
                        className="rounded-xl border border-slate-200 bg-white p-3"
                      >
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <div className="inline-flex items-center gap-2">
                            <PlanningPeriod start={editor.startDate} end={editor.endDate} buffer={editor.returnBufferDays} variant="detail" />
                          </div>
                          <div className="inline-flex items-center gap-2">
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
                              Zeitraum-Bedarf {dayTotal}
                            </span>
                          </div>
                        </div>

                        <div className="space-y-2">
                          {day.items.map((item, itemIndex) => {
                            const normalizedCategory = normalizeItemCategory(item.categoryKey);
                            const availabilityItem = availabilityByCategoryForRange.get(normalizedCategory);
                            const visual = availabilityVisualByCategoryForRange.get(normalizedCategory);
                            const editorKey = handoverKey(dayIndex, itemIndex);
                            const handoverEditorOpen = handoverEditorKey === editorKey;
                            return (
                              <div key={`${item.categoryKey}-${itemIndex}`} className="space-y-2">
                                <div className="grid gap-2 lg:grid-cols-12">
                                <select
                                  data-testid={`planning-item-category-${dayIndex}-${itemIndex}`}
                                  className="field-input lg:col-span-4"
                                  value={item.categoryKey}
                                  disabled={!canEdit}
                                  onChange={(event) =>
                                    patchEditor((current) => {
                                      const nextDays = [...current.days];
                                      const nextItems = [...nextDays[dayIndex].items];
                                      nextItems[itemIndex] = { ...nextItems[itemIndex], categoryKey: event.target.value };
                                      nextDays[dayIndex] = { ...nextDays[dayIndex], items: nextItems };
                                      return { ...current, days: nextDays };
                                    })
                                  }
                                >
                                  <option value="">Kategorie wählen</option>
                                  {categoryOptions.map((category) => (
                                    <option key={category} value={category}>
                                      {category}
                                    </option>
                                  ))}
                                </select>

                                <input
                                  data-testid={`planning-item-qty-${dayIndex}-${itemIndex}`}
                                  type="number"
                                  min={0}
                                  className="field-input lg:col-span-2"
                                  value={item.qty}
                                  disabled={!canEdit}
                                  onChange={(event) =>
                                    patchEditor((current) => {
                                      const nextDays = [...current.days];
                                      const nextItems = [...nextDays[dayIndex].items];
                                      nextItems[itemIndex] = {
                                        ...nextItems[itemIndex],
                                        qty: Math.max(0, Number(event.target.value || '0')),
                                      };
                                      nextDays[dayIndex] = { ...nextDays[dayIndex], items: nextItems };
                                      return { ...current, days: nextDays };
                                    })
                                  }
                                />

                                <input
                                  className="field-input lg:col-span-3"
                                  value={item.notes}
                                  placeholder="Notiz optional"
                                  disabled={!canEdit}
                                  onChange={(event) =>
                                    patchEditor((current) => {
                                      const nextDays = [...current.days];
                                      const nextItems = [...nextDays[dayIndex].items];
                                      nextItems[itemIndex] = { ...nextItems[itemIndex], notes: event.target.value };
                                      nextDays[dayIndex] = { ...nextDays[dayIndex], items: nextItems };
                                      return { ...current, days: nextDays };
                                    })
                                  }
                                />

                                <div className="lg:col-span-2">
                                  {availabilityItem && visual ? (
                                    <div
                                      className={`rounded-2xl border px-2.5 py-2 text-[11px] ${
                                        visual.status === 'handover'
                                          ? 'border-sky-200 bg-gradient-to-br from-sky-50 via-white to-cyan-50 text-slate-700 dark:border-sky-700 dark:from-sky-950/30 dark:via-slate-950 dark:to-cyan-950/20 dark:text-slate-100'
                                          : visual.status === 'review'
                                            ? 'border-orange-200 bg-orange-50/85 text-orange-900 dark:border-orange-700 dark:bg-orange-950/30 dark:text-orange-100'
                                            : visual.status === 'open'
                                              ? 'border-rose-200 bg-rose-50/90 text-rose-900 dark:border-rose-700 dark:bg-rose-950/35 dark:text-rose-100'
                                              : 'border-emerald-200 bg-emerald-50/90 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/25 dark:text-emerald-100'
                                      }`}
                                    >
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        <span
                                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                            visual.status === 'handover'
                                              ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-100'
                                              : visual.status === 'review'
                                                ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-100'
                                                : visual.status === 'open'
                                                  ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-100'
                                                  : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-100'
                                          }`}
                                        >
                                          {visual.status === 'handover'
                                            ? 'Übergabe-Verbund'
                                            : visual.status === 'review'
                                              ? reviewBadgeLabel(visual.reviewReason)
                                              : visual.status === 'open'
                                                ? 'Offen'
                                                : 'Verfügbar'}
                                        </span>
                                        <span className="text-[10px] font-medium text-slate-500 dark:text-slate-300">
                                          {visual.categoryKey}
                                        </span>
                                      </div>
                                      <p className="mt-1 leading-relaxed">
                                        {visual.status === 'handover'
                                          ? `${visual.categoryKey} · ${visual.shortageQty} Stück abgestimmt`
                                          : visual.status === 'review'
                                            ? `${visual.categoryKey} · ${reviewShortText(visual.reviewReason)}`
                                            : visual.status === 'open'
                                              ? `${visual.categoryKey} · ${visual.shortageQty} Stück offen`
                                              : 'Kein offener Handlungsbedarf'}
                                      </p>
                                    </div>
                                  ) : (
                                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-500">
                                      Nach Speichern sichtbar
                                    </div>
                                  )}
                                </div>

                                {canEdit ? (
                                  <button
                                    type="button"
                                    className="btn-danger px-2 py-1 text-xs lg:col-span-1"
                                    onClick={() =>
                                      patchEditor((current) => {
                                        const nextDays = [...current.days];
                                        nextDays[dayIndex] = {
                                          ...nextDays[dayIndex],
                                          items: nextDays[dayIndex].items.filter((_, index) => index !== itemIndex),
                                        };
                                        return { ...current, days: nextDays };
                                      })
                                    }
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                ) : null}
                                </div>

                                {visual?.status === 'open' ? (
                                  <div className="rounded-2xl border border-rose-200 bg-gradient-to-br from-rose-50 via-white to-orange-50 px-3 py-3 text-xs text-rose-900 shadow-sm dark:border-rose-700 dark:from-rose-950/40 dark:via-slate-950 dark:to-orange-950/20 dark:text-rose-100">
                                    <div className="flex items-start gap-3">
                                      <span className="rounded-2xl bg-rose-100 p-2 text-rose-700 dark:bg-rose-900/50 dark:text-rose-100">
                                        <AlertTriangle className="h-4 w-4" />
                                      </span>
                                      <div className="flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                          {visual.conflictSeverity ? (
                                            <ConflictSeverityChip
                                              severity={visual.conflictSeverity}
                                              label={visual.conflictLabel}
                                            />
                                          ) : (
                                            <p className="text-sm font-semibold">Offener Engpass</p>
                                          )}
                                          <span className="rounded-full border border-rose-200 bg-white/75 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700 dark:border-rose-700 dark:bg-slate-950/40 dark:text-rose-100">
                                            {visual.categoryKey}
                                          </span>
                                          {visual.conflictSecondary.map((badge) => (
                                            <ConflictSeverityChip
                                              key={badge.severity}
                                              severity={badge.severity}
                                              label={badge.label}
                                              size="sm"
                                            />
                                          ))}
                                        </div>
                                        <p className="mt-1 text-[13px] leading-relaxed text-rose-800 dark:text-rose-100">
                                          {visual.categoryKey} · {visual.shortageQty} Stück fehlen im Projektzeitraum.
                                        </p>
                                        <p className="mt-2 leading-relaxed text-rose-800 dark:text-rose-100">
                                          Für diese Position gibt es aktuell keinen erklärten Übergabe-Verbund. Hier besteht Handlungsbedarf.
                                        </p>
                                        <details className="mt-3">
                                          <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-200">
                                            Details anzeigen
                                          </summary>
                                          <div className="mt-2 space-y-0.5 text-[10px]">
                                            <p>Nutzbar: {visual.usableStock}</p>
                                            <p>Diese Planung: {visual.currentPlanningQty}</p>
                                            <p>Andere Planungen: {visual.otherPlannedQty}</p>
                                            <p>Gesamt geplant: {visual.totalPlannedQtyForDateCategory}</p>
                                            <p>Rest nach Gesamtplanung: {visual.remainingAfterAllPlanning}</p>
                                          </div>
                                        </details>
                                        <div className="mt-3 flex flex-wrap gap-2">
                                          <button
                                            type="button"
                                            className="btn-danger px-2.5 py-1.5 text-xs"
                                            onClick={() => openHandoverEditor(dayIndex, itemIndex)}
                                          >
                                            Übergabe planen
                                          </button>
                                          <button
                                            type="button"
                                            className="btn-secondary px-2.5 py-1.5 text-xs"
                                            onClick={() => onOpenInventoryWithQuery(visual.categoryKey)}
                                          >
                                            Bestand öffnen
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                ) : null}

                                {visual?.status === 'handover' ? (
                                  <div className="rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-cyan-50 px-3 py-3 text-xs text-slate-800 shadow-sm dark:border-sky-700 dark:from-sky-950/35 dark:via-slate-950 dark:to-cyan-950/25 dark:text-slate-100">
                                    <div className="flex items-start gap-3">
                                      <span className="rounded-2xl bg-sky-100 p-2 text-sky-700 dark:bg-sky-900/50 dark:text-sky-100">
                                        <Link2 className="h-4 w-4" />
                                      </span>
                                      <div className="flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <p className="text-sm font-semibold">Geplante Übergabe</p>
                                          <span className="rounded-full border border-sky-200 bg-white/75 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:border-sky-700 dark:bg-slate-950/40 dark:text-sky-100">
                                            Engpass-Ausgleich aktiv
                                          </span>
                                        </div>
                                        <p className="mt-1 text-[13px] font-medium text-slate-800 dark:text-slate-100">
                                          {visual.categoryKey} · {visual.shortageQty} Stück abgestimmt
                                        </p>
                                        <p className="mt-2 leading-relaxed text-slate-600 dark:text-slate-300">
                                          {visual.source === 'incoming'
                                            ? `Dieses Projekt ist bereits über ${visual.partnerLabel || 'ein Partnerprojekt'} Teil desselben Übergabe-Verbunds. Du musst hier nichts doppelt verknüpfen.`
                                            : `Diese Planung ist mit ${visual.partnerLabel || 'einem Partnerprojekt'} abgestimmt. Die Übergabe wird bereits berücksichtigt.`}
                                        </p>
                                        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                                          <span className="rounded-full border border-slate-200 bg-white/80 px-2.5 py-1 text-slate-700 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100">
                                            {currentPlanningLabel || 'Aktuelles Projekt'}
                                          </span>
                                          <span className="text-slate-400 dark:text-slate-500">↔</span>
                                          <span className="rounded-full border border-sky-200 bg-sky-100/70 px-2.5 py-1 text-sky-800 dark:border-sky-700 dark:bg-sky-900/40 dark:text-sky-100">
                                            {visual.partnerLabel || 'Partnerprojekt'}
                                          </span>
                                        </div>
                                        {visual.note ? (
                                          <p className="mt-2 rounded-xl border border-white/70 bg-white/65 px-2.5 py-2 text-[11px] text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-200">
                                            Hinweis: {visual.note}
                                          </p>
                                        ) : null}
                                        <details className="mt-3">
                                          <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
                                            Details anzeigen
                                          </summary>
                                          <div className="mt-2 space-y-0.5 text-[10px] text-slate-600 dark:text-slate-300">
                                            <p>Nutzbar: {visual.usableStock}</p>
                                            <p>Diese Planung: {visual.currentPlanningQty}</p>
                                            <p>Andere Planungen: {visual.otherPlannedQty}</p>
                                            <p>Gesamt geplant: {visual.totalPlannedQtyForDateCategory}</p>
                                            <p>Rest nach Gesamtplanung: {visual.remainingAfterAllPlanning}</p>
                                          </div>
                                        </details>
                                        <div className="mt-3 flex flex-wrap gap-2">
                                          {visual.partnerPlanningId ? (
                                            <button
                                              type="button"
                                              className="btn-secondary px-2.5 py-1.5 text-xs"
                                              onClick={() => {
                                                navigateToPlanning(visual.partnerPlanningId);
                                              }}
                                            >
                                              Partner öffnen
                                            </button>
                                          ) : null}
                                          {visual.source === 'incoming' ? (
                                            <>
                                              <span className="inline-flex items-center rounded-full border border-sky-200 bg-white/75 px-2.5 py-1 text-[11px] text-slate-600 dark:border-sky-700 dark:bg-slate-950/40 dark:text-slate-300">
                                                Partnerprojekt berücksichtigt
                                              </span>
                                            </>
                                          ) : (
                                            <>
                                              <button
                                                type="button"
                                                className="btn-secondary px-2.5 py-1.5 text-xs"
                                                onClick={() => openHandoverEditor(dayIndex, itemIndex)}
                                              >
                                                Übergabe bearbeiten
                                              </button>
                                              <button
                                                type="button"
                                                className="btn-secondary px-2.5 py-1.5 text-xs"
                                                onClick={() => {
                                                  void removeHandover(dayIndex, itemIndex);
                                                }}
                                              >
                                                Verknüpfung lösen
                                              </button>
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                ) : null}

                                {visual?.status !== 'handover'
                                  && visual?.handoverStatus === 'organizational' ? (
                                  <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-slate-50 px-3 py-3 text-xs text-slate-700 shadow-sm dark:border-slate-700 dark:from-slate-900/40 dark:via-slate-950 dark:to-slate-900/20 dark:text-slate-200">
                                    <div className="flex items-start gap-3">
                                      <span className="rounded-2xl bg-slate-100 p-2 text-slate-600 dark:bg-slate-800/60 dark:text-slate-200">
                                        <Link2 className="h-4 w-4" />
                                      </span>
                                      <div className="flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <p className="text-sm font-semibold">Organisatorische Übergabe</p>
                                          <span className="rounded-full border border-slate-300 bg-white/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:border-slate-600 dark:bg-slate-950/60 dark:text-slate-200">
                                            Dokumentarische Verknüpfung
                                          </span>
                                        </div>
                                        <p className="mt-1 text-[13px] font-medium text-slate-800 dark:text-slate-100">
                                          {visual.categoryKey} · Verbindung zu {visual.partnerLabel || visual.linkedPlanningLabel || 'Partnerprojekt'}
                                        </p>
                                        <p className="mt-2 leading-relaxed text-slate-600 dark:text-slate-300">
                                          Diese Übergabe ist rein dokumentarisch — sie verändert die Verfügbarkeit nicht, weil sich die Zeiträume der beiden Planungen nicht überschneiden (bzw. die Partnerplanung am Vortag keinen Bedarf in dieser Kategorie hat).
                                        </p>
                                        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                                          <span className="rounded-full border border-slate-200 bg-white/80 px-2.5 py-1 text-slate-700 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100">
                                            {currentPlanningLabel || 'Aktuelles Projekt'}
                                          </span>
                                          <span className="text-slate-400 dark:text-slate-500">↔</span>
                                          <span className="rounded-full border border-slate-300 bg-slate-100/70 px-2.5 py-1 text-slate-700 dark:border-slate-600 dark:bg-slate-800/40 dark:text-slate-100">
                                            {visual.partnerLabel || visual.linkedPlanningLabel || 'Partnerprojekt'}
                                          </span>
                                        </div>
                                        {visual.note ? (
                                          <p className="mt-2 rounded-xl border border-white/70 bg-white/65 px-2.5 py-2 text-[11px] text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-200">
                                            Hinweis: {visual.note}
                                          </p>
                                        ) : null}
                                        <div className="mt-3 flex flex-wrap gap-2">
                                          {visual.partnerPlanningId ? (
                                            <button
                                              type="button"
                                              className="btn-secondary px-2.5 py-1.5 text-xs"
                                              onClick={() => {
                                                navigateToPlanning(visual.partnerPlanningId);
                                              }}
                                            >
                                              Partner öffnen
                                            </button>
                                          ) : null}
                                          <button
                                            type="button"
                                            className="btn-secondary px-2.5 py-1.5 text-xs"
                                            onClick={() => openHandoverEditor(dayIndex, itemIndex)}
                                          >
                                            Übergabe bearbeiten
                                          </button>
                                          <button
                                            type="button"
                                            className="btn-secondary px-2.5 py-1.5 text-xs"
                                            onClick={() => {
                                              void removeHandover(dayIndex, itemIndex);
                                            }}
                                          >
                                            Verknüpfung lösen
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                ) : null}

                                {visual?.status === 'review' ? (
                                  <div className="rounded-2xl border border-orange-200 bg-gradient-to-br from-orange-50 via-white to-amber-50 px-3 py-3 text-xs text-orange-900 shadow-sm dark:border-orange-700 dark:from-orange-950/35 dark:via-slate-950 dark:to-amber-950/20 dark:text-orange-100">
                                    <div className="flex items-start gap-3">
                                      <span className="rounded-2xl bg-orange-100 p-2 text-orange-700 dark:bg-orange-900/50 dark:text-orange-100">
                                        <Clock3 className="h-4 w-4" />
                                      </span>
                                      <div className="flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <p className="text-sm font-semibold">{reviewBadgeLabel(visual.reviewReason)}</p>
                                          <span className="rounded-full border border-orange-200 bg-white/75 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-700 dark:border-orange-700 dark:bg-slate-950/40 dark:text-orange-100">
                                            {visual.reviewReason === 'low_reserve' ? 'Wenig Reserve' : 'Verknüpfung offen'}
                                          </span>
                                        </div>
                                        <p className="mt-1 text-[13px] leading-relaxed">
                                          {reviewDetailText(visual.reviewReason)}
                                        </p>
                                        {visual.note ? <p className="mt-2 text-[11px]">Hinweis: {visual.note}</p> : null}
                                        <details className="mt-3">
                                          <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-orange-700 dark:text-orange-200">
                                            Details anzeigen
                                          </summary>
                                          <div className="mt-2 space-y-0.5 text-[10px]">
                                            <p>Nutzbar: {visual.usableStock}</p>
                                            <p>Diese Planung: {visual.currentPlanningQty}</p>
                                            <p>Andere Planungen: {visual.otherPlannedQty}</p>
                                            <p>Gesamt geplant: {visual.totalPlannedQtyForDateCategory}</p>
                                            <p>Rest nach Gesamtplanung: {visual.remainingAfterAllPlanning}</p>
                                          </div>
                                        </details>
                                        {visual.reviewReason !== 'low_reserve' ? (
                                          <div className="mt-3 flex flex-wrap gap-2">
                                            <button
                                              type="button"
                                              className="btn-secondary px-2.5 py-1.5 text-xs"
                                              onClick={() => openHandoverEditor(dayIndex, itemIndex)}
                                            >
                                              Projekt auswählen
                                            </button>
                                          </div>
                                        ) : null}
                                      </div>
                                    </div>
                                  </div>
                                ) : null}

                                {handoverEditorOpen ? (
                                  <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-2 dark:border-amber-800 dark:bg-amber-950/25">
                                    <div className="grid gap-2 lg:grid-cols-12">
                                      <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200 lg:col-span-3">
                                        <input
                                          type="checkbox"
                                          checked={item.handoverEnabled}
                                          onChange={(event) =>
                                            patchPlanningItem(dayIndex, itemIndex, (current) => ({
                                              ...current,
                                              handoverEnabled: event.target.checked,
                                            }))
                                          }
                                        />
                                        Übergabe geplant
                                      </label>
                                      <select
                                        className="field-input lg:col-span-4"
                                        value={item.linkedPlanningId}
                                        disabled={!item.handoverEnabled}
                                        onChange={(event) =>
                                          patchPlanningItem(dayIndex, itemIndex, (current) => ({
                                            ...current,
                                            linkedPlanningId: event.target.value,
                                          }))
                                        }
                                      >
                                        <option value="">Übergabe-Projekt auswählen</option>
                                        {(handoverOptionsByDay.get(day.planningDate) ?? []).map((option) => (
                                          <option key={option.id} value={option.id}>
                                            {option.label}
                                          </option>
                                        ))}
                                      </select>
                                      <input
                                        className="field-input lg:col-span-5"
                                        value={item.handoverNote}
                                        disabled={!item.handoverEnabled}
                                        placeholder="z. B. Projekt 1 übergibt 2 LTE-Router an Projekt 2 nach Aufbau"
                                        onChange={(event) =>
                                          patchPlanningItem(dayIndex, itemIndex, (current) => ({
                                            ...current,
                                            handoverNote: event.target.value,
                                          }))
                                        }
                                      />
                                    </div>
                                    {item.handoverEnabled && !item.linkedPlanningId ? (
                                      <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                                        Hinweis: Verknüpftes Projekt auswählen, damit die Übergabeplanung nachvollziehbar ist.
                                      </p>
                                    ) : null}
                                    <div className="mt-2 flex gap-1.5">
                                      <button
                                        type="button"
                                        className="btn-primary px-2.5 py-1.5 text-xs"
                                        onClick={() => {
                                          void saveHandoverEditor(dayIndex, itemIndex);
                                        }}
                                        disabled={saving}
                                      >
                                        Übernehmen
                                      </button>
                                      <button
                                        type="button"
                                        className="btn-secondary px-2.5 py-1.5 text-xs"
                                        onClick={() => cancelHandoverEditor(dayIndex, itemIndex)}
                                      >
                                        Abbrechen
                                      </button>
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}

                          {canEdit ? (
                            <button
                              type="button"
                              data-testid={`planning-add-item-${dayIndex}`}
                              className="btn-secondary px-2.5 py-1.5 text-xs"
                              onClick={() =>
                                patchEditor((current) => {
                                  const nextDays = [...current.days];
                                  nextDays[dayIndex] = {
                                    ...nextDays[dayIndex],
                                    items: [
                                      ...nextDays[dayIndex].items,
                                      {
                                        categoryKey: categoryOptions[0] ?? '',
                                        qty: 0,
                                        notes: '',
                                        handoverEnabled: false,
                                        linkedPlanningId: '',
                                        handoverNote: '',
                                      },
                                    ],
                                  };
                                  return { ...current, days: nextDays };
                                })
                              }
                            >
                              <Plus className="h-3.5 w-3.5" />
                              + Position
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {handoverStatus && handoverStatus.categories.some((c) => c.state !== 'not_applicable') ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-800 dark:bg-emerald-950/30">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="font-semibold text-slate-900 dark:text-slate-100">Automatische Projektübergabe</h4>
                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                        Geräte gehen automatisch direkt ins Folgeprojekt — kein Rücklauf ins Lager. Die Übergabe
                        greift selbstständig zum Rückgabetag ({formatGermanDate(handoverStatus.sourceReturnDay)}).
                      </p>
                    </div>
                    {handoverStatus.totalAlreadyTransferred > 0 ? (
                      <span className="rounded-full border border-emerald-300 bg-white px-3 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">
                        🟢 {handoverStatus.totalAlreadyTransferred} automatisch übergeben
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {handoverStatus.categories
                      .filter((cat) => cat.state !== 'not_applicable')
                      .map((cat) => {
                        const meta =
                          cat.state === 'executed'
                            ? { label: 'Automatisch übergeben', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' }
                            : cat.state === 'partially_executed'
                              ? { label: 'Teilweise übergeben', cls: 'border-amber-200 bg-amber-50 text-amber-700' }
                              : cat.state === 'due'
                                ? { label: 'Übergabe fällig', cls: 'border-amber-200 bg-amber-50 text-amber-700' }
                                : { label: 'Übergabe geplant', cls: 'border-sky-200 bg-sky-50 text-sky-700' };
                        const done = cat.alreadyTransferredQty;
                        const total = cat.plannedTotal;
                        return (
                          <div
                            key={`ho-${cat.categoryKey}`}
                            className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{cat.categoryKey}</span>
                              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${meta.cls}`}>
                                {meta.label}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                              {done > 0 ? `${done} von ${total}` : `${total}`} {cat.categoryKey} → {cat.targetPlanningLabel ?? cat.targetPlanningId}
                            </p>
                          </div>
                        );
                      })}
                  </div>

                  {canEdit ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="btn-secondary px-2.5 py-1.5 text-xs"
                        disabled={handoverBusy}
                        onClick={() => void runHandoverNow()}
                      >
                        {handoverBusy ? 'Bitte warten …' : 'Jetzt ausführen (Fallback)'}
                      </button>
                      {handoverStatus.totalAlreadyTransferred > 0 ? (
                        <button
                          type="button"
                          className="btn-secondary px-2.5 py-1.5 text-xs"
                          disabled={handoverBusy}
                          onClick={() => void undoHandoverNow()}
                        >
                          Rückgängig
                        </button>
                      ) : null}
                      <span className="text-[11px] text-slate-400 dark:text-slate-500">
                        Notfallwerkzeug — normalerweise läuft die Übergabe automatisch.
                      </span>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {assignedAssets ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="font-semibold text-slate-900 dark:text-slate-100">Geplant vs. Ausgegeben</h4>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">
                        Welche Geräte wurden dieser Planung zugeordnet — und passt das zur geplanten Menge?
                      </p>
                    </div>
                    <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                      Ausgegeben {assignedAssets.assignedTotal} / Geplant {assignedAssets.plannedTotal}
                    </span>
                  </div>

                  {assignedAssets.categories.length > 0 ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {assignedAssets.categories.map((cat) => {
                        const diff = cat.differenceQty;
                        const badge =
                          diff === 0
                            ? { label: 'Passt', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' }
                            : diff > 0
                              ? { label: 'Mehr ausgegeben', cls: 'border-amber-200 bg-amber-50 text-amber-800' }
                              : { label: 'Noch offen', cls: 'border-sky-200 bg-sky-50 text-sky-800' };
                        return (
                          <div
                            key={cat.categoryKey}
                            className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm dark:border-slate-700 dark:bg-slate-950"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{cat.categoryKey}</p>
                              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${badge.cls}`}>
                                {badge.label}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                              Geplant {cat.plannedQty} · Ausgegeben {cat.assignedQty}
                              {diff !== 0 ? ` · ${diff > 0 ? '+' : ''}${diff}` : ''}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Keine geplanten Kategorien.</p>
                  )}

                  {assignedAssets.assets.length > 0 ? (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs font-semibold text-slate-700 dark:text-slate-200">
                        Ausgegebene Hardware ({assignedAssets.assets.length})
                      </summary>
                      <div className="mt-2 space-y-2">
                        {assignedAssets.assets.map((asset) => (
                          <div
                            key={asset.id}
                            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm dark:border-slate-700 dark:bg-slate-950"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{asset.name}</p>
                              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                                {asset.status}
                              </span>
                            </div>
                            <p className="mt-0.5 text-slate-600 dark:text-slate-300">
                              {asset.category}
                              {asset.qrCode ? ` · ${asset.qrCode}` : asset.tagNumber ? ` · ${asset.tagNumber}` : ''}
                            </p>
                            {asset.expectedReturnDate ? (
                              <p className="mt-0.5 text-slate-500 dark:text-slate-400">
                                Rückgabe erwartet: {formatGermanDate(asset.expectedReturnDate)}
                              </p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </details>
                  ) : (
                    <p className="mt-3 rounded-xl border border-dashed border-slate-300 bg-white px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400">
                      Noch keine Geräte dieser Planung zugeordnet.
                    </p>
                  )}
                </div>
              ) : null}

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="font-semibold text-slate-900">Availability Übersicht</h4>
                    <p className="mt-1 text-xs text-slate-500">
                      Trennt klar zwischen geplanten Übergabe-Verbuenden und wirklich ungeklärten Engpaessen.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-800 dark:border-sky-700 dark:bg-sky-950/30 dark:text-sky-200">
                      Übergabe-Verbuende: {networkVisuals.length}
                    </span>
                    <span className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-medium text-orange-800 dark:border-orange-700 dark:bg-orange-950/30 dark:text-orange-200">
                      Unvollständig: {incompleteVisuals.length}
                    </span>
                    <span className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-medium text-rose-800 dark:border-rose-700 dark:bg-rose-950/30 dark:text-rose-200">
                      Ungeklärte Engpässe: {shortageVisuals.length}
                    </span>
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200">
                      Konfliktfrei: {healthyCategoryCount}
                    </span>
                  </div>
                </div>

                {conflictSeveritySummary.length > 0 ? (
                  <div
                    className="mt-3 flex flex-wrap items-center gap-1.5"
                    data-testid="planning-detail-severity-summary"
                  >
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Schweregrade:
                    </span>
                    {conflictSeveritySummary.map(({ severity, count }) => {
                      const visual = conflictSeverityVisual(severity);
                      return (
                        <span
                          key={severity}
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${visual.chipClass}`}
                        >
                          {count}× {visual.label}
                        </span>
                      );
                    })}
                  </div>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="status-chip border-emerald-200 bg-emerald-50 text-emerald-700">
                    <Clock3 className="h-3.5 w-3.5" />
                    Grün = Alles verfügbar
                  </span>
                  <span className="status-chip border-sky-200 bg-sky-50 text-sky-700">
                    <Link2 className="h-3.5 w-3.5" />
                    Blau = Übergabe geplant
                  </span>
                  <span className="status-chip border-orange-200 bg-orange-50 text-orange-700">
                    <Clock3 className="h-3.5 w-3.5" />
                    Gelb = Prüfung nötig oder Bestand knapp
                  </span>
                  <span className="status-chip border-rose-200 bg-rose-50 text-rose-700">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Rot = Offener Handlungsbedarf
                  </span>
                </div>

                <div className="mt-4 grid gap-3 xl:grid-cols-2">
                  <div className="rounded-2xl border border-sky-200 bg-white p-3 shadow-sm dark:border-sky-800 dark:bg-slate-950">
                    <div className="flex items-start gap-3">
                      <span className="rounded-2xl bg-sky-100 p-2 text-sky-700 dark:bg-sky-900/40 dark:text-sky-100">
                        <Link2 className="h-4 w-4" />
                      </span>
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Geplante Übergaben</p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">
                          Diese Projekte sind bereits miteinander abgestimmt. Die abgestimmte Menge bleibt sichtbar, wirkt aber nicht wie ein offener Fehler.
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 space-y-2">
                      {[...networkVisuals, ...incompleteVisuals].map((visual) => (
                        <div
                          key={`network-${visual.key}`}
                          className={`rounded-2xl border px-3 py-3 text-xs shadow-sm ${
                            visual.status === 'review'
                              ? 'border-orange-200 bg-orange-50/80 text-orange-900 dark:border-orange-700 dark:bg-orange-950/25 dark:text-orange-100'
                              : 'border-sky-200 bg-gradient-to-br from-sky-50 via-white to-cyan-50 text-slate-800 dark:border-sky-700 dark:from-sky-950/30 dark:via-slate-950 dark:to-cyan-950/20 dark:text-slate-100'
                          }`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold">
                              {visual.status === 'review'
                                ? reviewBadgeLabel(visual.reviewReason)
                                : 'Übergabe-Verbund aktiv'}
                            </p>
                            <span className="rounded-full border border-white/80 bg-white/75 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100">
                              {visual.categoryKey}
                            </span>
                          </div>
                          <p className="mt-1 text-[13px] font-medium">
                            {visual.categoryKey} · {visual.shortageQty} Stück · {formatGermanDate(visual.planningDate)}
                          </p>
                          <p className="mt-2 leading-relaxed text-slate-600 dark:text-slate-300">
                            {visual.status === 'review'
                              ? reviewDetailText(visual.reviewReason)
                              : visual.source === 'incoming'
                                ? `Dieses Projekt ist über ${visual.partnerLabel || 'ein Partnerprojekt'} bereits eingebunden. Kein offener Handlungsbedarf.`
                                : `Diese Menge ist über eine geplante Übergabe mit ${visual.partnerLabel || 'einem Partnerprojekt'} berücksichtigt.`}
                          </p>
                          {visual.status !== 'review' ? (
                            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                              <span className="rounded-full border border-slate-200 bg-white/80 px-2.5 py-1 text-slate-700 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100">
                                {currentPlanningLabel || 'Aktuelles Projekt'}
                              </span>
                              <span className="text-slate-400 dark:text-slate-500">↔</span>
                              <span className="rounded-full border border-sky-200 bg-sky-100/70 px-2.5 py-1 text-sky-800 dark:border-sky-700 dark:bg-sky-900/40 dark:text-sky-100">
                                {visual.partnerLabel || 'Partnerprojekt'}
                              </span>
                            </div>
                          ) : null}
                          {visual.partnerLabel ? (
                            <p className="mt-2 text-[11px] text-slate-600 dark:text-slate-300">
                              Partnerprojekt: {visual.partnerLabel}
                            </p>
                          ) : null}
                          {visual.note ? (
                            <p className="mt-2 rounded-xl border border-white/80 bg-white/70 px-2.5 py-2 text-[11px] text-slate-700 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-200">
                              Hinweis: {visual.note}
                            </p>
                          ) : null}
                          <details className="mt-2">
                            <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
                              Details anzeigen
                            </summary>
                            <div className="mt-2 space-y-0.5 text-[10px] text-slate-600 dark:text-slate-300">
                              <p>Nutzbar: {visual.usableStock}</p>
                              <p>Diese Planung: {visual.currentPlanningQty}</p>
                              <p>Andere Planungen: {visual.otherPlannedQty}</p>
                              <p>Gesamt geplant: {visual.totalPlannedQtyForDateCategory}</p>
                              <p>Rest nach Gesamtplanung: {visual.remainingAfterAllPlanning}</p>
                              <p>affectedPlanningIds: {visual.affectedPlanningIds.join(', ') || '-'}</p>
                              <p>linkedPlanningId: {visual.linkedPlanningId || '-'}</p>
                            </div>
                          </details>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {visual.status === 'review' ? (
                              visual.reviewReason === 'low_reserve' ? null : (
                                <button
                                  type="button"
                                  className="btn-secondary px-2.5 py-1.5 text-xs"
                                  onClick={() => openHandoverEditorByKey(visual.planningDate, visual.categoryKey)}
                                >
                                  Projekt auswählen
                                </button>
                              )
                            ) : visual.source === 'incoming' ? (
                              <>
                              <button
                                type="button"
                                className="btn-secondary px-2.5 py-1.5 text-xs"
                                onClick={() => {
                                  navigateToPlanning(visual.partnerPlanningId);
                                }}
                              >
                                Partner öffnen
                              </button>
                              <span className="inline-flex items-center rounded-full border border-sky-200 bg-white/75 px-2.5 py-1 text-[11px] text-slate-600 dark:border-sky-700 dark:bg-slate-950/40 dark:text-slate-300">
                                Partnerprojekt berücksichtigt
                              </span>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                  className="btn-secondary px-2.5 py-1.5 text-xs"
                                  onClick={() => openHandoverEditorByKey(visual.planningDate, visual.categoryKey)}
                              >
                                Übergabe bearbeiten
                              </button>
                                <button
                                  type="button"
                                  className="btn-secondary px-2.5 py-1.5 text-xs"
                                  onClick={() => {
                                    void removeHandoverByKey(visual.planningDate, visual.categoryKey);
                                  }}
                                >
                                  Verknüpfung lösen
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                      {!networkVisuals.length && !incompleteVisuals.length ? (
                        <p className="rounded-xl border border-dashed border-amber-200 px-3 py-4 text-center text-xs text-slate-500 dark:border-amber-800 dark:text-slate-400">
                          Noch keine geplante Übergabe hinterlegt.
                        </p>
                      ) : null}
                    </div>
                  </div>

                  {verbundEntries.length > 0 ? (
                    <div className="rounded-2xl border border-sky-200 bg-white p-3 shadow-sm dark:border-sky-800 dark:bg-slate-950">
                      <div className="flex items-start gap-3">
                        <span className="rounded-2xl bg-sky-100 p-2 text-sky-700 dark:bg-sky-900/40 dark:text-sky-100">
                          <Link2 className="h-4 w-4" />
                        </span>
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Übergabe-Verbund aktiv</p>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">
                            Diese Planung ist Teil eines Verbunds mit anderen Projekten — auch wenn aktuell kein Engpass besteht.
                          </p>
                        </div>
                      </div>
                      <ul className="mt-3 space-y-2">
                        {verbundEntries.map((entry) => (
                          <li
                            key={`verbund-${entry.direction}-${entry.partnerPlanningId}`}
                            className="rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-cyan-50 px-3 py-3 text-xs dark:border-sky-700 dark:from-sky-950/30 dark:via-slate-950 dark:to-cyan-950/20"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-sky-200 bg-sky-100/80 px-2 py-0.5 text-[11px] font-semibold text-sky-800 dark:border-sky-700 dark:bg-sky-900/60 dark:text-sky-50">
                                {entry.direction === 'incoming' ? 'Empfängt von' : 'Übergibt an'}
                              </span>
                              <span className="rounded-full border border-slate-200 bg-white/80 px-2.5 py-1 text-slate-700 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100">
                                {currentPlanningLabel || 'Aktuelles Projekt'}
                              </span>
                              <span className="text-slate-400 dark:text-slate-500">↔</span>
                              <span className="rounded-full border border-sky-200 bg-sky-100/70 px-2.5 py-1 text-sky-800 dark:border-sky-700 dark:bg-sky-900/40 dark:text-sky-100">
                                {entry.partnerLabel}
                              </span>
                            </div>
                            <p className="mt-2 text-[13px] font-medium text-slate-800 dark:text-slate-100">
                              {entry.categoryKeys.join(', ')}
                              {entry.totalQty > 0 ? ` · ${entry.totalQty} Stück` : ''}
                              {entry.dateFrom === entry.dateTo
                                ? ` · ${formatGermanDate(entry.dateFrom)}`
                                : ` · ${formatGermanDate(entry.dateFrom)} – ${formatGermanDate(entry.dateTo)}`}
                            </p>
                            {entry.notes.length > 0 ? (
                              <p className="mt-2 rounded-xl border border-white/80 bg-white/70 px-2.5 py-2 text-[11px] text-slate-700 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-200">
                                Hinweis: {entry.notes.join(' · ')}
                              </p>
                            ) : null}
                            <div className="mt-2">
                              <button
                                type="button"
                                className="btn-secondary px-2.5 py-1.5 text-xs"
                                onClick={() => {
                                  navigateToPlanning(entry.partnerPlanningId);
                                }}
                              >
                                Partner öffnen
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {cardPrinterUpliftVisuals.length ? (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-3 shadow-sm dark:border-amber-700/60 dark:bg-amber-950/20">
                      <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">Kartendrucker-Mindestbedarf</p>
                      <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">
                        Pro Kartendrucker wird mindestens 1 kompatibler Laptop benötigt. Der Laptop-Bedarf wurde automatisch angehoben — der Bestand reicht aktuell aus.
                      </p>
                      <ul className="mt-2 space-y-1 text-[12px] text-amber-900 dark:text-amber-100">
                        {cardPrinterUpliftVisuals.map((visual) => (
                          <li key={`uplift-${visual.key}`} className="rounded-lg border border-amber-200/80 bg-white/70 px-2.5 py-1.5 dark:border-amber-700/60 dark:bg-amber-950/40">
                            {formatGermanDate(visual.planningDate)} · Für {visual.cardPrinterRequiredQty} Kartendrucker werden mindestens {visual.cardPrinterRequiredQty} kompatible Laptops benötigt (+{visual.cardPrinterUpliftQty}).
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="rounded-2xl border border-rose-200 bg-white p-3 shadow-sm dark:border-rose-800 dark:bg-slate-950">
                    <div className="flex items-start gap-3">
                      <span className="rounded-2xl bg-rose-100 p-2 text-rose-700 dark:bg-rose-900/40 dark:text-rose-100">
                        <AlertTriangle className="h-4 w-4" />
                      </span>
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Ungeklärte Engpässe</p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">
                          Nur diese Konflikte brauchen noch eine aktive Entscheidung. Wenn hier nichts steht, ist kein roter Fehler mehr offen.
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 space-y-2">
                      {shortageVisuals.map((visual) => (
                        <div
                          key={`shortage-${visual.key}`}
                          className="rounded-2xl border border-rose-200 bg-rose-50/85 px-3 py-3 text-xs text-rose-900 shadow-sm dark:border-rose-700 dark:bg-rose-950/30 dark:text-rose-100"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            {visual.conflictSeverity ? (
                              <ConflictSeverityChip
                                severity={visual.conflictSeverity}
                                label={visual.conflictLabel}
                              />
                            ) : (
                              <p className="text-sm font-semibold">Offener Engpass</p>
                            )}
                            <span className="rounded-full border border-white/80 bg-white/75 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700 dark:border-rose-700 dark:bg-slate-950/40 dark:text-rose-100">
                              {visual.categoryKey}
                            </span>
                            {visual.conflictSecondary.map((badge) => (
                              <ConflictSeverityChip
                                key={badge.severity}
                                severity={badge.severity}
                                label={badge.label}
                                size="sm"
                              />
                            ))}
                          </div>
                          <p className="mt-1 text-[13px]">
                            {visual.categoryKey} · {visual.shortageQty} Stück fehlen · {formatGermanDate(visual.planningDate)}
                          </p>
                          <p className="mt-2 leading-relaxed text-rose-800 dark:text-rose-100">
                            Für diese Kategorie reicht der Bestand trotz aktueller Planung nicht aus. Hier besteht offener Handlungsbedarf.
                          </p>
                          {visual.excludedQty > 0 ? (
                            <p className="mt-2 rounded-lg border border-rose-300/60 bg-white/60 px-2.5 py-1.5 text-[12px] leading-relaxed text-rose-800 dark:border-rose-700/70 dark:bg-rose-950/40 dark:text-rose-100">
                              <span className="font-semibold">Hinweis:</span> {visual.excludedQty} {visual.categoryKey === 'Laptop' ? 'Laptop(s)' : 'Gerät(e)'} wurden ausgeschlossen, weil im Projekt mindestens 1 Kartendrucker geplant ist (z. B. MacBook Neo).
                            </p>
                          ) : null}
                          {visual.excludedFromPlanningQty > 0 ? (
                            <p className="mt-2 rounded-lg border border-slate-300/70 bg-white/70 px-2.5 py-1.5 text-[12px] leading-relaxed text-slate-700 dark:border-slate-600/70 dark:bg-slate-900/50 dark:text-slate-200">
                              <span className="font-semibold">Hinweis:</span> {visual.excludedFromPlanningQty} {visual.categoryKey === 'Laptop' ? 'Laptop(s)' : 'Gerät(e)'} sind global aus der Einsatzplanung ausgeschlossen (z. B. interne Server-Laptops). Sie bleiben im Inventar nutzbar.
                            </p>
                          ) : null}
                          {visual.cardPrinterUpliftQty > 0 ? (
                            <p className="mt-2 rounded-lg border border-amber-300/60 bg-white/70 px-2.5 py-1.5 text-[12px] leading-relaxed text-amber-800 dark:border-amber-600/60 dark:bg-amber-950/40 dark:text-amber-100">
                              <span className="font-semibold">Hinweis:</span> Für {visual.cardPrinterRequiredQty} Kartendrucker werden mindestens {visual.cardPrinterRequiredQty} kompatible Laptops benötigt. Der Laptop-Bedarf wurde automatisch um {visual.cardPrinterUpliftQty} angehoben.
                            </p>
                          ) : null}
                          <details className="mt-2">
                            <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-200">
                              Details anzeigen
                            </summary>
                            <div className="mt-2 space-y-0.5 text-[10px]">
                              <p>Nutzbar: {visual.usableStock}</p>
                              <p>Diese Planung: {visual.currentPlanningQty}</p>
                              <p>Andere Planungen: {visual.otherPlannedQty}</p>
                              <p>Gesamt geplant: {visual.totalPlannedQtyForDateCategory}</p>
                              <p>Rest nach Gesamtplanung: {visual.remainingAfterAllPlanning}</p>
                              <p>affectedPlanningIds: {visual.affectedPlanningIds.join(', ') || '-'}</p>
                            </div>
                          </details>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="btn-danger px-2.5 py-1.5 text-xs"
                              onClick={() => openHandoverEditorByKey(visual.planningDate, visual.categoryKey)}
                            >
                              Übergabe planen
                            </button>
                            <button
                              type="button"
                              className="btn-secondary px-2.5 py-1.5 text-xs"
                              onClick={() => onOpenInventoryWithQuery(visual.categoryKey)}
                            >
                              Bestand öffnen
                            </button>
                          </div>
                        </div>
                      ))}
                      {!shortageVisuals.length ? (
                        <p className="rounded-xl border border-dashed border-rose-200 px-3 py-4 text-center text-xs text-slate-500 dark:border-rose-800 dark:text-slate-400">
                          Keine ungeklärten Engpässe.
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>
                  ) : (
                    <div className="flex h-full min-h-[420px] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
                      {detailLoading ? 'Planung wird geladen...' : 'Wähle links eine Planung aus oder lege eine neue an.'}
                    </div>
                  )}
                </div>
              </article>
            </div>
          </div>
      ) : null}

      {createOpen && canEdit ? (
        <div
          className="fixed inset-0 z-[70] bg-slate-900/55 p-0 sm:flex sm:items-center sm:justify-center sm:p-4"
          onClick={() => {
            if (saving) return;
            setCreateOpen(false);
          }}
        >
          <div
            className="soft-scrollbar mt-12 h-[calc(100vh-3rem)] w-full overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-5 shadow-panel sm:mt-0 sm:h-auto sm:max-h-[92vh] sm:max-w-2xl sm:rounded-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-lg font-semibold text-slate-900">Neue Einsatzplanung</h3>
              <button type="button" className="btn-secondary px-2.5 py-1.5 text-xs" onClick={() => setCreateOpen(false)} disabled={saving}>
                Schließen
              </button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="field">
                Kunde
                <input
                  className="field-input"
                  value={createForm.customerName}
                  onChange={(event) => setCreateForm((current) => ({ ...current, customerName: event.target.value }))}
                />
              </label>
              <label className="field">
                Projekt
                <input
                  className="field-input"
                  value={createForm.projectName}
                  onChange={(event) => setCreateForm((current) => ({ ...current, projectName: event.target.value }))}
                />
              </label>
              <label className="field">
                Veranstaltung
                <input
                  className="field-input"
                  value={createForm.eventName}
                  onChange={(event) => setCreateForm((current) => ({ ...current, eventName: event.target.value }))}
                />
              </label>
              <label className="field">
                Projektmanager
                <select
                  className="field-input"
                  value={createForm.projectManagerUserId}
                  onChange={(event) => setCreateForm((current) => ({ ...current, projectManagerUserId: event.target.value }))}
                >
                  <option value="">Nicht gesetzt</option>
                  {selectableProjectManagers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Startdatum
                <input
                  type="date"
                  className="field-input"
                  value={createForm.startDate}
                  onChange={(event) => setCreateForm((current) => ({ ...current, startDate: event.target.value }))}
                />
              </label>
              <label className="field">
                Enddatum
                <input
                  type="date"
                  className="field-input"
                  value={createForm.endDate}
                  onChange={(event) => setCreateForm((current) => ({ ...current, endDate: event.target.value }))}
                />
                <span className="mt-1 block text-xs font-normal text-slate-400 dark:text-slate-500">
                  = Rückgabetag (kein Einsatztag)
                </span>
              </label>
              <label className="field">
                Rückgabe-Puffer
                <select
                  className="field-input"
                  value={createForm.returnBufferDays}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      returnBufferDays: Math.min(3, Math.max(0, Number(event.target.value) || 0)),
                    }))
                  }
                >
                  <option value={0}>0 Tage</option>
                  <option value={1}>1 Tag</option>
                  <option value={2}>2 Tage</option>
                  <option value={3}>3 Tage</option>
                </select>
                <span className="mt-1 block text-xs font-normal text-slate-400 dark:text-slate-500">
                  Blockiert den Bestand zusätzlich für Rücktransport, Abbau oder verspätete Rückgabe.
                </span>
                <span className="mt-1 block text-xs font-normal text-amber-600 dark:text-amber-300">
                  Bestand wieder verfügbar: {formatGermanDate(getStockFreeAgainIso(createForm.startDate, createForm.endDate, createForm.returnBufferDays))}
                </span>
              </label>
              <label className="field">
                Status
                <select
                  className="field-input"
                  value={createForm.status}
                  onChange={(event) => setCreateForm((current) => ({ ...current, status: event.target.value as PlanningStatus }))}
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field mt-3">
              Notizen
              <textarea
                className="field-input min-h-[90px]"
                value={createForm.notes}
                onChange={(event) => setCreateForm((current) => ({ ...current, notes: event.target.value }))}
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setCreateOpen(false)} disabled={saving}>
                Abbrechen
              </button>
              <LoadingButton
                type="button"
                className="btn-primary"
                onClick={() => {
                  void createNewPlanning();
                }}
                isLoading={saving && busyState === 'create'}
                loadingText="Planung wird angelegt ..."
                disabled={saving && busyState !== 'create'}
              >
                Planung anlegen
              </LoadingButton>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

