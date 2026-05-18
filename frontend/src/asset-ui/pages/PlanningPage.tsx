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
import { PlanningCalendarAddOn } from './PlanningCalendarAddOn';
import {
  createPlanning,
  deletePlanning,
  duplicatePlanning,
  getPlanning,
  getPlanningAvailability,
  listPlannings,
  updatePlanning,
  updatePlanningStatus,
  type ConflictBadge,
  type PlanningAvailabilityResponse,
  type PlanningConflictSeverity,
  type PlanningListItem,
  type PlanningStatus,
  type PlanningResponse,
  type PlanningUpsertPayload,
  type WmsOverview,
} from '../../services/wmsApi';
import { categoryOptionsFromRecords, normalizeCategory } from '../categories';
import { conflictSeverityRank, conflictSeverityVisual } from './conflictSeverityVisuals';
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
type PlanningListMissingItem = NonNullable<PlanningListItem['missingItems']>[number];
type BusyState = 'list' | 'open' | 'save' | 'create' | 'duplicate' | 'delete' | 'status' | null;

type HandoverNetworkAccent = {
  card: string;
  cardActive: string;
  panel: string;
  badge: string;
  hint: string;
};

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

const HANDOVER_NETWORK_ACCENTS: HandoverNetworkAccent[] = [
  {
    card: 'border-sky-200 bg-sky-50/55 dark:border-sky-400/40 dark:bg-sky-950/25',
    cardActive: 'border-sky-300 bg-sky-50/80 ring-1 ring-sky-200 dark:border-sky-400/60 dark:bg-sky-950/40 dark:ring-sky-500/40',
    panel: 'border-sky-200 bg-white/75 text-sky-900 dark:border-sky-400/50 dark:bg-sky-950/35 dark:text-sky-50',
    badge: 'border-sky-200 bg-sky-100/80 text-sky-700 dark:border-sky-400/60 dark:bg-sky-900/60 dark:text-sky-50',
    hint: 'text-sky-800 dark:text-sky-100',
  },
  {
    card: 'border-teal-200 bg-teal-50/55 dark:border-teal-400/40 dark:bg-teal-950/25',
    cardActive: 'border-teal-300 bg-teal-50/80 ring-1 ring-teal-200 dark:border-teal-400/60 dark:bg-teal-950/40 dark:ring-teal-500/40',
    panel: 'border-teal-200 bg-white/75 text-teal-900 dark:border-teal-400/50 dark:bg-teal-950/35 dark:text-teal-50',
    badge: 'border-teal-200 bg-teal-100/80 text-teal-700 dark:border-teal-400/60 dark:bg-teal-900/60 dark:text-teal-50',
    hint: 'text-teal-800 dark:text-teal-100',
  },
  {
    card: 'border-violet-200 bg-violet-50/55 dark:border-violet-400/40 dark:bg-violet-950/25',
    cardActive: 'border-violet-300 bg-violet-50/80 ring-1 ring-violet-200 dark:border-violet-400/60 dark:bg-violet-950/40 dark:ring-violet-500/40',
    panel: 'border-violet-200 bg-white/75 text-violet-900 dark:border-violet-400/50 dark:bg-violet-950/35 dark:text-violet-50',
    badge: 'border-violet-200 bg-violet-100/80 text-violet-700 dark:border-violet-400/60 dark:bg-violet-900/60 dark:text-violet-50',
    hint: 'text-violet-800 dark:text-violet-100',
  },
  {
    card: 'border-amber-200 bg-amber-50/55 dark:border-amber-400/40 dark:bg-amber-950/25',
    cardActive: 'border-amber-300 bg-amber-50/80 ring-1 ring-amber-200 dark:border-amber-400/60 dark:bg-amber-950/40 dark:ring-amber-500/40',
    panel: 'border-amber-200 bg-white/75 text-amber-900 dark:border-amber-400/50 dark:bg-amber-950/35 dark:text-amber-50',
    badge: 'border-amber-200 bg-amber-100/80 text-amber-700 dark:border-amber-400/60 dark:bg-amber-900/60 dark:text-amber-50',
    hint: 'text-amber-800 dark:text-amber-100',
  },
  {
    card: 'border-emerald-200 bg-emerald-50/55 dark:border-emerald-400/40 dark:bg-emerald-950/25',
    cardActive: 'border-emerald-300 bg-emerald-50/80 ring-1 ring-emerald-200 dark:border-emerald-400/60 dark:bg-emerald-950/40 dark:ring-emerald-500/40',
    panel: 'border-emerald-200 bg-white/75 text-emerald-900 dark:border-emerald-400/50 dark:bg-emerald-950/35 dark:text-emerald-50',
    badge: 'border-emerald-200 bg-emerald-100/80 text-emerald-700 dark:border-emerald-400/60 dark:bg-emerald-900/60 dark:text-emerald-50',
    hint: 'text-emerald-800 dark:text-emerald-100',
  },
  {
    card: 'border-rose-200 bg-rose-50/55 dark:border-rose-400/40 dark:bg-rose-950/25',
    cardActive: 'border-rose-300 bg-rose-50/80 ring-1 ring-rose-200 dark:border-rose-400/60 dark:bg-rose-950/40 dark:ring-rose-500/40',
    panel: 'border-rose-200 bg-white/75 text-rose-900 dark:border-rose-400/50 dark:bg-rose-950/35 dark:text-rose-50',
    badge: 'border-rose-200 bg-rose-100/80 text-rose-700 dark:border-rose-400/60 dark:bg-rose-900/60 dark:text-rose-50',
    hint: 'text-rose-800 dark:text-rose-100',
  },
  {
    card: 'border-indigo-200 bg-indigo-50/55 dark:border-indigo-400/40 dark:bg-indigo-950/25',
    cardActive: 'border-indigo-300 bg-indigo-50/80 ring-1 ring-indigo-200 dark:border-indigo-400/60 dark:bg-indigo-950/40 dark:ring-indigo-500/40',
    panel: 'border-indigo-200 bg-white/75 text-indigo-900 dark:border-indigo-400/50 dark:bg-indigo-950/35 dark:text-indigo-50',
    badge: 'border-indigo-200 bg-indigo-100/80 text-indigo-700 dark:border-indigo-400/60 dark:bg-indigo-900/60 dark:text-indigo-50',
    hint: 'text-indigo-800 dark:text-indigo-100',
  },
];

const DEFAULT_HANDOVER_NETWORK_ACCENT = HANDOVER_NETWORK_ACCENTS[0];

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

function formatPeriod(start: string, end: string): string {
  if (!start && !end) return '-';
  return `${start || '-'} bis ${end || '-'}`;
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
      const categoryKey = normalizeCategory(item.categoryKey);
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
        categoryKey: normalizeCategory(entry.categoryKey),
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
    days: item.days.map((day) => ({
      planningDate: day.planningDate,
      weekday: day.weekday || getGermanWeekday(day.planningDate),
      items: day.items
        .filter((entry) => entry.categoryKey.trim().length > 0)
        .map((entry) => ({
          categoryKey: normalizeCategory(entry.categoryKey),
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

function buildPlanningListHandoverHint(summary: PlanningListHandoverSummary): string {
  const partnerLabel =
    summary.partnerPlanningLabel?.trim() ||
    (summary.partnerPlanningId ? `Projektverknüpfung (${summary.partnerPlanningId.slice(-6)})` : 'Partnerprojekt');
  const categoryLabel = summary.categoryKeys[0] ?? '';
  const partnerSuffix = summary.partnerPlanningCount > 1 ? ` +${summary.partnerPlanningCount - 1}` : '';
  const categorySuffix = summary.categoryKeys.length > 1 ? ` +${summary.categoryKeys.length - 1}` : '';
  const detailParts = [partnerLabel + partnerSuffix, categoryLabel ? `${categoryLabel}${categorySuffix}` : ''].filter(Boolean);

  if (summary.direction === 'incoming') {
    return `Teil des Verbunds mit ${detailParts.join(' · ')}`;
  }
  if (summary.direction === 'mixed') {
    return `Mit ${detailParts.join(' · ')} abgestimmt`;
  }
  return `Mit ${detailParts.join(' · ')} abgestimmt`;
}

const MISSING_SUMMARY_VISIBLE_LIMIT = 3;
const CONFLICT_LINES_VISIBLE_LIMIT = 3;

function getMissingHardwareSummary(
  missingItems: PlanningListMissingItem[] | null | undefined,
): string | null {
  if (!missingItems || missingItems.length === 0) return null;
  const positiveItems = missingItems.filter((item) => Number(item.missingQty) > 0);
  if (positiveItems.length === 0) return null;
  const visible = positiveItems.slice(0, MISSING_SUMMARY_VISIBLE_LIMIT);
  const overflow = positiveItems.length - visible.length;
  const parts = visible.map((item) => `${item.missingQty}× ${item.categoryKey}`);
  const overflowSuffix = overflow > 0 ? ` + ${overflow} weitere` : '';
  return `Fehlt: ${parts.join(', ')}${overflowSuffix}`;
}

// "2026-06-08" -> "08.06" für die kompakte Konfliktzeile auf der Karte.
function formatConflictDay(iso: string): string {
  const parts = String(iso).split('-');
  return parts.length === 3 ? `${parts[2]}.${parts[1]}` : String(iso);
}

function conflictShortageText(qty: number): string {
  return qty === 1 ? '1 fehlt' : `${qty} fehlen`;
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
}: PlanningPageProps) {
  const { alert, confirm } = useAppDialog();
  const [plannings, setPlannings] = useState<Awaited<ReturnType<typeof listPlannings>>>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [editor, setEditor] = useState<EditablePlanning | null>(null);
  const [availability, setAvailability] = useState<PlanningAvailabilityResponse | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyState, setBusyState] = useState<BusyState>(null);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listSearch, setListSearch] = useState('');
  const [listStatus, setListStatus] = useState<'Alle' | PlanningStatus>('Alle');
  const [conflictFilterActive, setConflictFilterActive] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
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
  });

  const categoryOptions = useMemo(() => categoryOptionsFromRecords(categories), [categories]);

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
      const key = normalizeCategory(item.categoryKey);
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
  }, [availability]);

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
        const category = normalizeCategory(item.categoryKey);
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
  }, [editor, plannings]);

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

    for (const planning of Object.values(relatedPlannings)) {
      const planningLabel = buildPlanningLabel(planning);
      for (const day of planning.days) {
        for (const item of day.items) {
          if (!item.handoverEnabled || item.linkedPlanningId !== editor.id) continue;
          const key = `${day.planningDate}|${normalizeCategory(item.categoryKey)}`;
          if (!map.has(key)) {
            map.set(key, {
              partnerPlanningId: planning.id,
              partnerLabel: planningLabel,
              note: item.handoverNote ?? '',
            });
          }
          const anyDayKey = `*|${normalizeCategory(item.categoryKey)}`;
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
  }, [editor, relatedPlannings]);

  const availabilityVisualMap = useMemo(() => {
    const map = new Map<string, AvailabilityVisual>();

    for (const item of availability?.items ?? []) {
      const normalizedCategory = normalizeCategory(item.categoryKey);
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
      const key = normalizeCategory(item.categoryKey);
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
  }, [availabilityVisuals]);

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
        .map((item) => normalizeCategory(item.categoryKey)),
    );
    return (availability?.categorySummary ?? []).filter(
      (item) => !blockedCategories.has(normalizeCategory(item.categoryKey)),
    ).length;
  }, [availability, availabilityVisuals]);

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

  const planningListNetworkAccentById = useMemo(() => {
    const accentByPlanningId = new Map<string, HandoverNetworkAccent>();
    if (!planningListHandoverSummaryById.size) return accentByPlanningId;

    const visiblePlanningById = new Map(visiblePlannings.map((planning) => [planning.id, planning]));
    const adjacency = new Map<string, Set<string>>();
    const addNode = (planningId: string) => {
      if (!planningId) return;
      if (!adjacency.has(planningId)) adjacency.set(planningId, new Set<string>());
    };
    const addEdge = (from: string, to: string) => {
      if (!from || !to) return;
      addNode(from);
      addNode(to);
      adjacency.get(from)?.add(to);
      adjacency.get(to)?.add(from);
    };

    for (const [planningId, summary] of planningListHandoverSummaryById.entries()) {
      addNode(planningId);
      if (summary.partnerPlanningId) addEdge(planningId, summary.partnerPlanningId);
    }

    type NetworkComponent = {
      members: string[];
      earliestStartDate: string;
      smallestPlanningId: string;
    };
    const components: NetworkComponent[] = [];
    const visited = new Set<string>();
    for (const planningId of planningListHandoverSummaryById.keys()) {
      if (visited.has(planningId)) continue;
      const queue = [planningId];
      const component = new Set<string>();
      visited.add(planningId);

      while (queue.length) {
        const current = queue.shift();
        if (!current) continue;
        component.add(current);
        for (const neighbour of adjacency.get(current) ?? []) {
          if (visited.has(neighbour)) continue;
          visited.add(neighbour);
          queue.push(neighbour);
        }
      }

      const members = Array.from(component)
        .filter((member) => planningListHandoverSummaryById.has(member))
        .sort((a, b) => a.localeCompare(b, 'de'));
      if (!members.length) continue;

      const earliestStartDate = members.reduce((earliest, member) => {
        const startDate = visiblePlanningById.get(member)?.startDate ?? '9999-12-31';
        return startDate < earliest ? startDate : earliest;
      }, '9999-12-31');

      components.push({
        members,
        earliestStartDate,
        smallestPlanningId: members[0] ?? '',
      });
    }

    components
      .sort((a, b) => {
        if (a.earliestStartDate !== b.earliestStartDate) {
          return a.earliestStartDate.localeCompare(b.earliestStartDate);
        }
        return a.smallestPlanningId.localeCompare(b.smallestPlanningId, 'de');
      })
      .forEach((component, index) => {
        const accent = HANDOVER_NETWORK_ACCENTS[index % HANDOVER_NETWORK_ACCENTS.length];
        for (const member of component.members) {
          accentByPlanningId.set(member, accent);
        }
      });

    return accentByPlanningId;
  }, [planningListHandoverSummaryById, visiblePlannings]);

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
    const categoryCount = new Set(allItems.map((item) => normalizeCategory(item.categoryKey)).filter(Boolean)).size;
    return {
      requestedQty,
      dayCount: editor.days.length,
      categoryCount,
    };
  }, [editor]);

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

  const openPlanning = async (planningId: string, options?: { showModal?: boolean; silentBusy?: boolean }) => {
    // Ursache des Bugs: Mehrere schnelle Klicks konnten asynchron in falscher Reihenfolge zurückkommen
    // und damit Editor/Availability mit Daten eines anderen Projekts überschreiben.
    const requestSeq = openPlanningRequestSeq.current + 1;
    openPlanningRequestSeq.current = requestSeq;
    setSelectedId(planningId);
    if (options?.showModal ?? true) {
      setDetailModalOpen(true);
    }
    setDetailLoading(true);
    if (!options?.silentBusy) setBusyState('open');
    setError(null);
    try {
      const [planning, planningAvailability] = await Promise.all([
        getPlanning(planningId),
        getPlanningAvailability(planningId),
      ]);
      const editable = toEditablePlanning(planning);
      if (openPlanningRequestSeq.current !== requestSeq) return;
      setEditor(editable);
      setEditorInitial(cloneEditablePlanning(editable));
      setAvailability(planningAvailability);
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

  const handlePlanningCardClick = (planningId: string) => {
    if (detailModalOpen) return;
    if (selectedId === planningId) {
      setSelectedId('');
      return;
    }
    void openPlanning(planningId);
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
      setSelectedId(firstWithConflict.id);
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
      const [freshPlanning, planningAvailability] = await Promise.all([
        getPlanning(saved.id),
        getPlanningAvailability(saved.id),
        loadPlannings(saved.id, { silentBusy: true }),
      ]);
      await refreshOverview();
      const savedEditor = toEditablePlanning(freshPlanning);
      setEditor(savedEditor);
      setEditorInitial(cloneEditablePlanning(savedEditor));
      setAvailability(planningAvailability);
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

  const closeDetailModal = async () => {
    if (!detailModalOpen) return;
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
    setDetailModalOpen(false);
    setHandoverEditorKey(null);
    setHandoverSnapshot({});
    setEditor(null);
    setEditorInitial(null);
    setAvailability(null);
    setSelectedId('');
  };

  useEffect(() => {
    if (!detailModalOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || saving) return;
      void closeDetailModal();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [detailModalOpen, saving, closeDetailModal]);

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
      await openPlanning(created.id, { silentBusy: true });
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
      await openPlanning(duplicated.id, { silentBusy: true });
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
        setEditor(null);
        setAvailability(null);
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
      if (detailModalOpen && selectedId === planningId) {
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
    const normalizedTarget = normalizeCategory(categoryKey);
    for (let dayIndex = 0; dayIndex < editor.days.length; dayIndex += 1) {
      if (editor.days[dayIndex].planningDate !== planningDate && editor.days[dayIndex].planningDate !== editor.startDate) continue;
      const itemIndex = editor.days[dayIndex].items.findIndex(
        (item) => normalizeCategory(item.categoryKey) === normalizedTarget,
      );
      if (itemIndex >= 0) return { dayIndex, itemIndex };
    }
    const fallbackIndex = editor.days[0]?.items.findIndex(
      (item) => normalizeCategory(item.categoryKey) === normalizedTarget,
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

  const todayIso = toIsoDate(new Date());
  const tomorrowIso = toIsoDate(new Date(Date.now() + 86400000));
  const weekEndIso = toIsoDate(new Date(Date.now() + 6 * 86400000));
  const mobileToday = visiblePlannings.filter((item) => item.startDate <= todayIso && item.endDate >= todayIso);
  const mobileTomorrow = visiblePlannings.filter((item) => item.startDate <= tomorrowIso && item.endDate >= tomorrowIso);
  const mobileWeek = visiblePlannings.filter((item) => item.startDate <= weekEndIso && item.endDate >= todayIso);
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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="page-kicker">Einsatzplanung</p>
            <h2 className="page-title">Projektbezogene Hardwareplanung</h2>
            <p className="page-subtitle">Bedarf für den gesamten Projektzeitraum planen, Summen prüfen und Engpässe direkt sehen.</p>
          </div>
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

        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <div className="surface-muted px-3 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Gesamt Planungen</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{planningStats.total}</p>
          </div>
          <div className="surface-muted px-3 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Aktiv</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{planningStats.openCount}</p>
          </div>
          <div className="surface-muted px-3 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Abgeschlossen</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{planningStats.doneCount}</p>
          </div>
          {planningStats.redCount > 0 ? (
            <button
              type="button"
              data-testid="planning-conflicts-card"
              className={`surface-muted px-3 py-2.5 text-left transition hover:border-rose-300 hover:bg-rose-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 ${
                conflictFilterActive ? 'border-rose-400 bg-rose-50 ring-1 ring-rose-300' : ''
              }`}
              onClick={activateConflictFilter}
              aria-pressed={conflictFilterActive}
              aria-label={`${planningStats.redCount} offene Konflikte anzeigen`}
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Offene Konflikte</p>
              <p className="mt-1 text-xl font-semibold text-slate-900">{planningStats.redCount}</p>
              {conflictCauseCount > 0 ? (
                <p
                  className="mt-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300"
                  data-testid="planning-conflict-cause-count"
                >
                  Konfliktursachen: {conflictCauseCount}
                </p>
              ) : null}
              <p className="mt-0.5 text-[11px] text-rose-700">
                {conflictFilterActive ? 'Filter aktiv' : 'Klicken, um zu filtern'}
              </p>
            </button>
          ) : (
            <div className="surface-muted px-3 py-2.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Offene Konflikte</p>
              <p className="mt-1 text-xl font-semibold text-slate-900">{planningStats.redCount}</p>
            </div>
          )}
        </div>

        {conflictGroups.length > 0 ? (
          <details
            open
            className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-700/50 dark:bg-amber-950/25"
            data-testid="conflict-causes-panel"
          >
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-100">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              Konfliktursachen: {conflictCauseCount}
              <span className="font-normal text-amber-700 dark:text-amber-300">
                ({planningStats.redCount} technische Konflikte)
              </span>
            </summary>
            <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">
              Mehrere offene Konflikte können dieselbe Ursache haben.
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
                    <p className="mt-1 text-slate-700 dark:text-slate-200">
                      Maximale Fehlmenge:{' '}
                      <span className="font-semibold">{group.maxMissingQty}</span>
                      {' · '}
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
                            {formatGermanDate(day.date)}: {day.requiredQty} benötigt ·{' '}
                            {day.usableStock} nutzbar · {conflictShortageText(day.missingQty)}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </div>
                );
              })}
            </div>
          </details>
        ) : null}

        <div className="mt-4">
          <PlanningCalendarAddOn
            plannings={visiblePlannings}
            selectedId={selectedId}
            handoverSummaryById={planningListHandoverSummaryById}
            planningDetailsById={planningListDetails}
            availabilityByPlanningId={calendarAvailabilitiesByPlanningId}
            onSelectPlanning={(planningId) => {
              void openPlanning(planningId);
            }}
            requestPlanningData={requestCalendarPlanningData}
          />
        </div>
      </div>

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
                    {formatPeriod(item.startDate, item.endDate)} · {item.status}
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

      {!isMobile ? <div className="grid gap-4 xl:grid-cols-12">
        <article className="surface-card xl:col-span-12">
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

          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className="field-input"
              placeholder="Kunde oder Projekt suchen"
              value={listSearch}
              onChange={(event) => setListSearch(event.target.value)}
            />
            <select
              className="field-input"
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

          <div
            className="soft-scrollbar mt-3 max-h-[720px] space-y-2 overflow-y-auto pr-1"
            onClick={(event) => {
              if (event.target === event.currentTarget && !detailModalOpen) {
                setSelectedId('');
              }
            }}
          >
            {!visiblePlannings.length && !listLoading ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-8 text-center text-sm text-slate-500">
                Noch keine passende Planung gefunden.
              </div>
            ) : null}

            {visiblePlannings.map((item) => {
              const isActive = selectedId === item.id;
              const handoverSummary = planningListHandoverSummaryById.get(item.id);
              const rowStatusLoading = statusUpdatingId === item.id && busyState === 'status';
              const hasHandoverNetwork = Boolean(handoverSummary);
              const handoverAccent = planningListNetworkAccentById.get(item.id) ?? DEFAULT_HANDOVER_NETWORK_ACCENT;
              const itemConflictCount = item.openConflictCount ?? 0;
              const hasOpenConflict = itemConflictCount > 0;
              // Klassifizierte Konfliktzeilen (Backend-sortiert nach Tag/Kategorie).
              // Fallback auf die alte "Fehlt: ..."-Zeile, wenn das Backend noch
              // kein conflicts-Feld liefert.
              const conflictLines = item.conflicts ?? [];
              const missingSummary = getMissingHardwareSummary(item.missingItems);
              return (
                <div
                  key={item.id}
                  data-testid={`planning-row-${item.id}`}
                  role="button"
                  tabIndex={0}
                  className={`cursor-pointer rounded-xl border p-3 ${
                    hasOpenConflict
                      ? isActive
                        ? 'border-rose-400 bg-rose-50 ring-1 ring-rose-300 dark:border-rose-400/60 dark:bg-rose-950/40 dark:ring-rose-500/40'
                        : 'border-rose-200 bg-rose-50/60 dark:border-rose-400/40 dark:bg-rose-950/30'
                      : isActive
                      ? hasHandoverNetwork
                        ? handoverAccent.cardActive
                        : 'border-brand-300 bg-brand-50/50 ring-1 ring-brand-200/80 dark:border-brand-700 dark:bg-brand-900/20 dark:ring-brand-700/60'
                      : hasHandoverNetwork
                        ? handoverAccent.card
                        : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60'
                  }`}
                  onClick={() => {
                    handlePlanningCardClick(item.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    handlePlanningCardClick(item.id);
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">{item.customerName}</p>
                      <p className="text-xs text-slate-600 dark:text-slate-300">{item.projectName}</p>
                      {item.eventName ? <p className="text-xs text-slate-500 dark:text-slate-400">{item.eventName}</p> : null}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {hasOpenConflict ? (
                        <span
                          data-testid={`planning-conflict-badge-${item.id}`}
                          className="rounded-full border border-rose-300 bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:border-rose-400/50 dark:bg-rose-950/70 dark:text-rose-100"
                        >
                          Konflikt{itemConflictCount > 1 ? ` · ${itemConflictCount}` : ''}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {hasOpenConflict ? (
                    <p className="mt-1 text-[11px] font-medium text-rose-700 dark:text-rose-200">Offener Konflikt</p>
                  ) : null}
                  {conflictLines.length > 0 ? (
                    <div
                      className="mt-1 flex flex-col gap-1"
                      data-testid={`planning-conflict-list-${item.id}`}
                    >
                      {conflictLines.slice(0, CONFLICT_LINES_VISIBLE_LIMIT).map((conflict, index) => (
                        <div
                          key={`${conflict.conflictDay}-${conflict.categoryKey}-${index}`}
                          data-testid={`planning-conflict-line-${item.id}-${index}`}
                          className="flex flex-wrap items-center gap-1"
                        >
                          <span className="text-[11px] font-medium text-slate-700 dark:text-slate-200">
                            {conflict.categoryKey} · {formatConflictDay(conflict.conflictDay)} ·{' '}
                            {conflictShortageText(Number(conflict.unresolvedShortageQty) || 0)}
                          </span>
                          <ConflictSeverityChip
                            severity={conflict.conflictSeverity}
                            label={conflict.conflictLabel}
                          />
                          {(conflict.secondary ?? []).map((badge) => (
                            <ConflictSeverityChip
                              key={badge.severity}
                              severity={badge.severity}
                              label={badge.label}
                              size="sm"
                            />
                          ))}
                        </div>
                      ))}
                      {conflictLines.length > CONFLICT_LINES_VISIBLE_LIMIT ? (
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">
                          + {conflictLines.length - CONFLICT_LINES_VISIBLE_LIMIT} weitere
                        </span>
                      ) : null}
                    </div>
                  ) : missingSummary ? (
                    <p
                      data-testid={`planning-missing-summary-${item.id}`}
                      className="mt-1 inline-flex max-w-full items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:border-rose-400/40 dark:bg-rose-950/55 dark:text-rose-100"
                    >
                      <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span className="break-words">{missingSummary}</span>
                    </p>
                  ) : null}

                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-300">{formatPeriod(item.startDate, item.endDate)}</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">
                    PM:{' '}
                    {item.projectManagerUserId
                      ? managerLabelById.get(item.projectManagerUserId) ?? '-'
                      : '-'}
                  </p>
                  {handoverSummary ? (
                    <div className={`mt-2 rounded-xl border px-2.5 py-2 text-xs shadow-sm ${handoverAccent.panel}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${handoverAccent.badge}`}>
                          <Link2 className="h-3.5 w-3.5" />
                          Übergabe-Verbund
                        </span>
                      </div>
                      <p className={`mt-1.5 text-[11px] leading-relaxed ${handoverAccent.hint}`}>
                        {buildPlanningListHandoverHint(handoverSummary)}
                      </p>
                    </div>
                  ) : null}

                  <div className="mt-2 grid gap-2">
                    <select
                      value={item.status}
                      className="field-input h-9 text-xs"
                      disabled={!canEdit || saving}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => {
                        void changeStatus(item.id, event.target.value as PlanningStatus);
                      }}
                    >
                      {STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center justify-end gap-1.5">
                      {canEdit ? (
                        <LoadingButton
                        type="button"
                        className="btn-secondary px-2 py-1 text-xs"
                        onClick={(event) => {
                          event.stopPropagation();
                          void duplicate(item.id);
                        }}
                        isLoading={rowStatusLoading}
                        loadingText="..."
                        disabled={saving && !rowStatusLoading}
                      >
                        <Copy className="h-3.5 w-3.5" />
                        </LoadingButton>
                      ) : null}
                      {canEdit ? (
                        <LoadingButton
                        type="button"
                        className="btn-danger px-2 py-1 text-xs"
                        onClick={(event) => {
                          event.stopPropagation();
                          void deleteCurrent(item.id);
                        }}
                        isLoading={rowStatusLoading}
                        loadingText="..."
                        disabled={saving && !rowStatusLoading}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        </LoadingButton>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </article>
      </div> : null}

      {detailModalOpen ? (
          <div
            className="fixed inset-0 z-[80] bg-slate-900/60 p-0 sm:p-4"
            onClick={() => {
              if (saving) return;
              void closeDetailModal();
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
                              void closeDetailModal();
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
                                void closeDetailModal();
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
                  </label>
                  <label className="field">
                    Status
                    <select
                      className="field-input"
                      value={editor.status}
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
                    onChange={(event) => patchEditor((current) => ({ ...current, notes: event.target.value }))}
                  />
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="surface-muted px-3 py-2.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Zeitraumtage</p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">{editorStats.dayCount}</p>
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
                    const periodLabel = `${formatGermanDate(editor.startDate)} – ${formatGermanDate(editor.endDate)}`;
                    return (
                      <div
                        key={`${day.planningDate}-${dayIndex}`}
                        data-testid={`planning-day-${dayIndex}`}
                        className="rounded-xl border border-slate-200 bg-white p-3"
                      >
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <div className="inline-flex items-center gap-2">
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700">
                              {periodLabel}
                            </span>
                          </div>
                          <div className="inline-flex items-center gap-2">
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
                              Zeitraum-Bedarf {dayTotal}
                            </span>
                          </div>
                        </div>

                        <div className="space-y-2">
                          {day.items.map((item, itemIndex) => {
                            const normalizedCategory = normalizeCategory(item.categoryKey);
                            const availabilityItem = availabilityByCategoryForRange.get(normalizedCategory);
                            const visual = availabilityVisualByCategoryForRange.get(normalizedCategory);
                            const editorKey = handoverKey(dayIndex, itemIndex);
                            const editorOpen = handoverEditorKey === editorKey;
                            return (
                              <div key={`${item.categoryKey}-${itemIndex}`} className="space-y-2">
                                <div className="grid gap-2 lg:grid-cols-12">
                                <select
                                  data-testid={`planning-item-category-${dayIndex}-${itemIndex}`}
                                  className="field-input lg:col-span-4"
                                  value={item.categoryKey}
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
                                                void openPlanning(visual.partnerPlanningId);
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
                                                void openPlanning(visual.partnerPlanningId);
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

                                {editorOpen ? (
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
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

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
                                  void openPlanning(visual.partnerPlanningId);
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

