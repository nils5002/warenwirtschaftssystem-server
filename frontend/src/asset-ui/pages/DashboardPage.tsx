import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Boxes,
  CalendarPlus,
  CalendarRange,
  CheckCircle2,
  ChevronRight,
  Handshake,
  Laptop,
  MonitorSmartphone,
  PackagePlus,
  Printer,
  RefreshCw,
  ScanLine,
  Sparkles,
  TriangleAlert,
  Users,
  Wrench,
} from 'lucide-react';
import { ActionCard, EmptyState } from '../../ui';
import { normalizeCategory } from '../categories';
import { canAccessPage } from '../../config/pageAccess';
import { planningDetailPath } from '../../routing/appRoutes';
import { navigate } from '../../routing/router';
import type { ActivityItem, AppPage, AppRole, Asset, MaintenanceItem, ReservationItem } from '../types';
import type { Theme } from '../../hooks/useTheme';
import { getCurrentUser, listPlannings } from '../../services/wmsApi';
import type { PlanningListItem, WmsOverview } from '../../services/wmsApi';
import { formatGermanDate, isDateBooked, toIsoDate } from './planningPeriod';

type DashboardPageProps = {
  assets: Asset[];
  activities: ActivityItem[];
  reservations: ReservationItem[];
  maintenanceItems: MaintenanceItem[];
  planningSummary: WmsOverview['planningSummary'];
  theme: Theme;
  // Anzeigename für die Begrüßung im Hero.
  userName?: string;
  // Effektive Rechte-Keys + Rolle des aktuellen Users — entscheiden, welche
  // KPI-Kacheln/Schnellaktionen als Schnellzugriff klickbar sind (gleiche
  // Logik wie die Navigationsfilterung in App.tsx).
  permissions?: string[];
  activeRole: AppRole;
  onNavigate: (page: AppPage) => void;
  // Inventar gefiltert auf einen Status öffnen (Status-Kacheln).
  onOpenInventoryWithStatus: (status: Asset['status'] | null) => void;
  // True solange der erste Overview-Call noch läuft. KPI-Kacheln zeigen
  // dann "—" statt "0", damit der Bestand nicht fälschlich leer wirkt.
  isInitialLoading?: boolean;
};

const ASSET_ACCENTS_LIGHT = [
  { border: 'rgba(14, 116, 144, 0.90)', bg: 'rgba(14, 116, 144, 0.14)', text: 'rgb(12, 74, 110)' },
  { border: 'rgba(15, 118, 110, 0.90)', bg: 'rgba(15, 118, 110, 0.14)', text: 'rgb(17, 94, 89)' },
  { border: 'rgba(79, 70, 229, 0.90)', bg: 'rgba(79, 70, 229, 0.13)', text: 'rgb(55, 48, 163)' },
  { border: 'rgba(126, 34, 206, 0.86)', bg: 'rgba(126, 34, 206, 0.12)', text: 'rgb(88, 28, 135)' },
  { border: 'rgba(180, 83, 9, 0.86)', bg: 'rgba(180, 83, 9, 0.12)', text: 'rgb(146, 64, 14)' },
  { border: 'rgba(5, 150, 105, 0.86)', bg: 'rgba(5, 150, 105, 0.12)', text: 'rgb(6, 95, 70)' },
  { border: 'rgba(190, 24, 93, 0.82)', bg: 'rgba(190, 24, 93, 0.11)', text: 'rgb(157, 23, 77)' },
  { border: 'rgba(37, 99, 235, 0.88)', bg: 'rgba(37, 99, 235, 0.13)', text: 'rgb(30, 64, 175)' },
] as const;

const ASSET_ACCENTS_DARK = [
  { border: 'rgba(56, 189, 248, 0.72)', bg: 'rgba(56, 189, 248, 0.12)', text: 'rgb(186, 230, 253)' },
  { border: 'rgba(45, 212, 191, 0.70)', bg: 'rgba(45, 212, 191, 0.12)', text: 'rgb(153, 246, 228)' },
  { border: 'rgba(129, 140, 248, 0.72)', bg: 'rgba(129, 140, 248, 0.12)', text: 'rgb(199, 210, 254)' },
  { border: 'rgba(168, 85, 247, 0.68)', bg: 'rgba(168, 85, 247, 0.11)', text: 'rgb(221, 214, 254)' },
  { border: 'rgba(251, 191, 36, 0.64)', bg: 'rgba(251, 191, 36, 0.10)', text: 'rgb(254, 240, 138)' },
  { border: 'rgba(52, 211, 153, 0.66)', bg: 'rgba(52, 211, 153, 0.10)', text: 'rgb(167, 243, 208)' },
  { border: 'rgba(244, 114, 182, 0.60)', bg: 'rgba(244, 114, 182, 0.09)', text: 'rgb(251, 207, 232)' },
  { border: 'rgba(96, 165, 250, 0.70)', bg: 'rgba(96, 165, 250, 0.11)', text: 'rgb(191, 219, 254)' },
] as const;

// Typ-Badge der Aktivitätstabelle — token-aware (weiche Ton-Flächen in Dark).
const TYPE_BADGE: Record<string, string> = {
  Ausgabe: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
  Rücknahme: 'bg-sky-500/12 text-sky-700 dark:text-sky-300',
};
const TYPE_BADGE_DEFAULT = 'bg-slate-500/12 text-slate-700 dark:text-slate-300';

function hashText(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function getAssetAccentStyle(key: string, theme: Theme) {
  const palette = theme === 'dark' ? ASSET_ACCENTS_DARK : ASSET_ACCENTS_LIGHT;
  return palette[hashText(key) % palette.length];
}

function trimActivityAssetPrefix(detail: string, assetName?: string): string {
  if (!assetName) return detail;
  const escaped = assetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return detail.replace(new RegExp(`^${escaped}\\s+`, 'i'), '');
}

function isTechnicalKey(value: string | undefined): boolean {
  if (!value) return true;
  const normalized = value.trim();
  if (!normalized) return true;
  return /^IMP-/i.test(normalized) || /^asset-/i.test(normalized) || /^usr-/i.test(normalized) || /^WMS\|/i.test(normalized);
}

function getReadableAssetLabel(asset?: Asset): string {
  if (!asset) return 'Unbekanntes Gerät';
  if (asset.name?.trim() && !isTechnicalKey(asset.name)) return asset.name.trim();
  if (asset.tagNumber?.trim() && !isTechnicalKey(asset.tagNumber)) return asset.tagNumber.trim();
  if (asset.serialNumber?.trim() && !isTechnicalKey(asset.serialNumber)) return asset.serialNumber.trim();
  if (asset.category?.trim() && !isTechnicalKey(asset.category)) return asset.category.trim();
  return 'Unbekanntes Gerät';
}

function normalizeActivityText(detail: string, asset?: Asset): string {
  let text = trimActivityAssetPrefix(detail, asset?.name).trim();
  text = text.replace(/\s+/g, ' ');
  if (text.endsWith('.')) text = text.slice(0, -1);
  return text;
}

function summarizeActivityLine(
  title: string,
  detail: string,
): { main: string; actor?: string; actionLabel: string } {
  const isCheckout = title.toLowerCase() === 'checkout gebucht';
  const isCheckin = title.toLowerCase() === 'checkin gebucht';
  const actionLabel = isCheckout ? 'Ausgabe' : isCheckin ? 'Rücknahme' : title;

  const byMatch = detail.match(/Ausgeführt durch:\s*([^.]*)/i);
  const actor = byMatch?.[1]?.trim();
  const withoutActor = detail.replace(/\.\s*Ausgeführt durch:\s*[^.]*\.?/i, '').trim();

  if (isCheckout) {
    if (/für allgemeinen einsatz ausgegeben/i.test(withoutActor)) {
      return { main: 'Für allgemeinen Einsatz ausgegeben', actor, actionLabel };
    }
    const project = withoutActor.match(/für Projekt\s+([^.]*)\s+ausgegeben/i)?.[1]?.trim();
    return { main: project ? `Für Projekt ${project} ausgegeben` : 'Gerät ausgegeben', actor, actionLabel };
  }

  if (isCheckin) {
    const from = withoutActor.match(/von\s+([^.]*)\s+zurückgenommen/i)?.[1]?.trim();
    return { main: from ? `Von ${from} zurückgenommen` : 'Gerät zurückgenommen', actor, actionLabel };
  }

  return { main: detail, actor, actionLabel };
}

// Zeitabhängige Begrüßung (rein clientseitig, keine Serverdaten nötig).
function greetingFor(name?: string): string {
  const hour = new Date().getHours();
  const part = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Guten Tag' : 'Guten Abend';
  const first = name?.trim().split(/\s+/)[0];
  return first ? `${part}, ${first}!` : `${part}!`;
}

const WEEKDAYS = ['MO', 'DI', 'MI', 'DO', 'FR', 'SA', 'SO'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

function getMetricTone(
  tone: 'positive' | 'neutral' | 'warning' | 'critical' | 'info',
  theme: Theme,
): {
  background: string;
  borderColor: string;
  iconClass: string;
  labelClass: string;
} {
  const isDark = theme === 'dark';
  switch (tone) {
    case 'positive':
      return {
        background: isDark
          ? 'linear-gradient(135deg, rgba(18, 66, 55, 0.96) 0%, rgba(14, 29, 43, 0.98) 100%)'
          : 'linear-gradient(135deg, rgba(220, 252, 231, 0.96) 0%, rgba(240, 253, 244, 0.98) 100%)',
        borderColor: isDark ? 'rgba(52, 211, 153, 0.18)' : 'rgba(22, 163, 74, 0.18)',
        iconClass: 'bg-emerald-400/14 text-emerald-200 dark:bg-emerald-400/16 dark:text-emerald-200',
        labelClass: 'text-emerald-700 dark:text-emerald-200/85',
      };
    case 'warning':
      return {
        background: isDark
          ? 'linear-gradient(135deg, rgba(86, 64, 16, 0.95) 0%, rgba(37, 28, 14, 0.98) 100%)'
          : 'linear-gradient(135deg, rgba(254, 243, 199, 0.96) 0%, rgba(255, 251, 235, 0.98) 100%)',
        borderColor: isDark ? 'rgba(251, 191, 36, 0.18)' : 'rgba(217, 119, 6, 0.18)',
        iconClass: 'bg-amber-400/14 text-amber-200 dark:bg-amber-400/16 dark:text-amber-200',
        labelClass: 'text-amber-700 dark:text-amber-200/85',
      };
    case 'critical':
      return {
        background: isDark
          ? 'linear-gradient(135deg, rgba(84, 27, 49, 0.95) 0%, rgba(37, 16, 26, 0.98) 100%)'
          : 'linear-gradient(135deg, rgba(255, 228, 230, 0.97) 0%, rgba(255, 241, 242, 0.98) 100%)',
        borderColor: isDark ? 'rgba(251, 113, 133, 0.18)' : 'rgba(225, 29, 72, 0.16)',
        iconClass: 'bg-rose-400/14 text-rose-200 dark:bg-rose-400/16 dark:text-rose-200',
        labelClass: 'text-rose-700 dark:text-rose-200/85',
      };
    case 'info':
      return {
        background: isDark
          ? 'linear-gradient(135deg, rgba(19, 74, 92, 0.95) 0%, rgba(14, 32, 43, 0.98) 100%)'
          : 'linear-gradient(135deg, rgba(207, 250, 254, 0.97) 0%, rgba(240, 253, 250, 0.98) 100%)',
        borderColor: isDark ? 'rgba(103, 232, 249, 0.18)' : 'rgba(8, 145, 178, 0.16)',
        iconClass: 'bg-cyan-400/14 text-cyan-200 dark:bg-cyan-400/16 dark:text-cyan-200',
        labelClass: 'text-cyan-700 dark:text-cyan-100/85',
      };
    case 'neutral':
    default:
      return {
        background: isDark
          ? 'linear-gradient(135deg, rgba(20, 53, 83, 0.96) 0%, rgba(12, 24, 42, 0.98) 100%)'
          : 'linear-gradient(135deg, rgba(219, 234, 254, 0.97) 0%, rgba(239, 246, 255, 0.98) 100%)',
        borderColor: isDark ? 'rgba(96, 165, 250, 0.18)' : 'rgba(37, 99, 235, 0.16)',
        iconClass: 'bg-sky-400/14 text-sky-200 dark:bg-sky-400/16 dark:text-sky-200',
        labelClass: 'text-sky-700 dark:text-sky-100/85',
      };
  }
}

// Kurzformat "TT.MM." für kompakte Zeiträume in der persönlichen Einsatzliste.
function formatShortDate(isoDate: string): string {
  const [, month, day] = isoDate.split('-');
  if (!month || !day) return isoDate;
  return `${day}.${month}.`;
}

function dayDiffFromIso(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00`).getTime();
  const to = new Date(`${toIso}T00:00:00`).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86400000);
}

// Zeitliche Einordnung eines persönlichen Einsatzes relativ zu heute.
function getPlanningTiming(
  planning: PlanningListItem,
  todayIso: string,
): { label: string; tone: 'now' | 'soon' | 'later' } {
  if (isDateBooked(todayIso, planning.startDate, planning.endDate)) {
    return { label: 'Heute im Einsatz', tone: 'now' };
  }
  if (planning.startDate > todayIso) {
    const days = dayDiffFromIso(todayIso, planning.startDate);
    if (days === 1) return { label: 'Startet morgen', tone: 'soon' };
    return { label: `Start in ${days} Tagen`, tone: days <= 7 ? 'soon' : 'later' };
  }
  return { label: `Rückgabe ${formatShortDate(planning.endDate)}`, tone: 'later' };
}

// Rolle des eingeloggten Benutzers in einer Planung — Zuordnung über die
// stabile User-ID (userId aus /api/auth/me), nie über Anzeigenamen.
function getMyPlanningRole(planning: PlanningListItem, userId: string): string | null {
  if (!userId) return null;
  const isResponsible =
    planning.projectManagerUserId === userId || planning.responsibleUser?.id === userId;
  const isOnSite = planning.onSiteResponsibleUser?.id === userId;
  if (isResponsible && isOnSite) return 'Verantwortlich · vor Ort';
  if (isOnSite) return 'Vor Ort verantwortlich';
  if (isResponsible) return 'Verantwortlich';
  return null;
}

// Kompakter Monats-Mini-Kalender für den aktuellen Monat, heutiger Tag
// hervorgehoben. `markedDays` markiert Tage mit persönlichen Einsätzen.
function MiniCalendar({ markedDays }: { markedDays?: ReadonlySet<number> }) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();
  const firstDay = new Date(year, month, 1);
  // Wochenstart Montag: JS getDay() liefert 0=So..6=Sa → auf Mo=0 mappen.
  const leading = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < leading; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div>
      <p className="mb-3 text-sm font-semibold text-ink">
        {MONTHS[month]} {year}
      </p>
      <div className="grid grid-cols-7 gap-y-1 text-center text-[10px] font-semibold tracking-[0.14em] text-ink-faint">
        {WEEKDAYS.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1.5">
        {cells.map((day, index) => (
          <div key={index} className="flex items-center justify-center">
            {day === null ? (
              <span className="h-8 w-8" />
            ) : (
              <span
                className={`relative flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium ${
                  day === today
                    ? 'bg-primary text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_10px_30px_rgba(47,125,246,0.35)]'
                    : markedDays?.has(day)
                      ? 'bg-primary/10 font-semibold text-ink'
                      : 'text-ink-muted'
                }`}
              >
                {day}
                {markedDays?.has(day) ? (
                  <span
                    aria-hidden
                    className={`absolute bottom-0.5 h-1 w-1 rounded-full ${day === today ? 'bg-white' : 'bg-primary'}`}
                  />
                ) : null}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function DashboardPage({
  assets,
  activities,
  reservations,
  maintenanceItems,
  planningSummary,
  theme,
  userName,
  permissions,
  activeRole,
  onNavigate,
  onOpenInventoryWithStatus,
  isInitialLoading = false,
}: DashboardPageProps) {
  // Schnellzugriff-Berechtigungen: identisch zur Seiten-/Navigationsprüfung.
  const canInventory = canAccessPage('inventory', permissions, activeRole);
  const canPlanning = canAccessPage('planning', permissions, activeRole);
  const canCheckinout = canAccessPage('checkinCheckout', permissions, activeRole);
  const canTickets = canAccessPage('tickets', permissions, activeRole);
  const canUsers = canAccessPage('users', permissions, activeRole);

  // Solange der erste Overview-Call läuft, zeigen wir einen Em-Dash statt "0".
  const showPlaceholders = isInitialLoading && assets.length === 0;
  const formatCount = (value: number): string => (showPlaceholders ? '—' : String(value));

  const available = assets.filter((asset) => asset.status === 'Verfügbar').length;
  const loaned = assets.filter((asset) => asset.status === 'Verliehen').length;
  const defective = assets.filter((asset) => asset.status === 'Defekt').length;
  const inMaintenance = assets.filter((asset) => asset.status === 'In Wartung').length;
  const defectiveOrMaintenance = defective + inMaintenance;
  const maintenanceOpen = maintenanceItems.filter((item) => item.status !== 'Erledigt').length;
  const activeReservations = reservations.filter((item) => item.status === 'Aktiv').length;

  const categorySummary = Object.entries(
    assets.reduce<Record<string, { total: number; available: number }>>((acc, asset) => {
      const category = normalizeCategory(asset.category);
      const current = acc[category] || { total: 0, available: 0 };
      current.total += 1;
      if (asset.status === 'Verfügbar') current.available += 1;
      acc[category] = current;
      return acc;
    }, {}),
  );

  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));

  // --- Persönlicher Planungsüberblick -----------------------------------------
  // Eigene Datenquelle für den gesamten Abschnitt: die dem eingeloggten
  // Benutzer zugewiesenen Planungen (serverseitig gefiltert über assignedToMe).
  // Kalender, Einsatzliste und Kennzahlen leiten sich alle daraus ab — keine
  // gemischten Quellen mehr (vorher: Reservierungen vs. globale Summary).
  const todayIso = toIsoDate(new Date());
  const currentUserId = getCurrentUser()?.userId ?? '';
  const [myPlannings, setMyPlannings] = useState<PlanningListItem[]>([]);
  const [myPlanningsState, setMyPlanningsState] = useState<'loading' | 'ready' | 'error'>('loading');

  const loadMyPlannings = useCallback(async () => {
    setMyPlanningsState('loading');
    try {
      // fromDate = heute: laufende + kommende Einsätze (endDate >= heute).
      const items = await listPlannings({ assignedToMe: true, fromDate: toIsoDate(new Date()) });
      setMyPlannings(items);
      setMyPlanningsState('ready');
    } catch {
      setMyPlanningsState('error');
    }
  }, []);

  useEffect(() => {
    void loadMyPlannings();
  }, [loadMyPlannings]);

  // Persönliche Einsatzliste: stornierte/abgeschlossene raus, laufende zuerst,
  // danach nach Startdatum.
  const personalPlannings = useMemo(() => {
    const relevant = myPlannings.filter(
      (item) => item.status !== 'Storniert' && item.status !== 'Abgeschlossen',
    );
    const rank = (item: PlanningListItem): number =>
      isDateBooked(todayIso, item.startDate, item.endDate) ? 0 : item.startDate > todayIso ? 1 : 2;
    return [...relevant].sort((a, b) => {
      const byRank = rank(a) - rank(b);
      if (byRank !== 0) return byRank;
      if (a.startDate !== b.startDate) return a.startDate.localeCompare(b.startDate);
      return a.projectName.localeCompare(b.projectName);
    });
  }, [myPlannings, todayIso]);

  const myActiveToday = personalPlannings.filter((item) =>
    isDateBooked(todayIso, item.startDate, item.endDate),
  );
  const myOpenConflictCount = personalPlannings.reduce(
    (sum, item) => sum + (item.openConflictCount ?? 0),
    0,
  );
  const nextPersonalPlanning = personalPlannings.find((item) => item.startDate > todayIso);
  const visiblePersonalPlannings = personalPlannings.slice(0, 5);
  const hiddenPersonalCount = personalPlannings.length - visiblePersonalPlannings.length;

  // Tage des aktuellen Monats, an denen mindestens ein persönlicher Einsatz läuft.
  const markedCalendarDays = useMemo(() => {
    const days = new Set<number>();
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day += 1) {
      const iso = toIsoDate(new Date(now.getFullYear(), now.getMonth(), day));
      if (personalPlannings.some((item) => isDateBooked(iso, item.startDate, item.endDate))) {
        days.add(day);
      }
    }
    return days;
  }, [personalPlannings]);

  const formatPersonalCount = (value: number): string =>
    myPlanningsState === 'ready' ? String(value) : '—';

  // Engpässe & Risiken: bevorzugt echte Planungs-Fehlmengen, sonst
  // Bestandskategorien mit <= 1 verfügbarem Gerät.
  const shortageItems = (planningSummary?.categorySummaries ?? [])
    .filter((item) => item.shortageQty > 0)
    .sort((a, b) => b.shortageQty - a.shortageQty);
  const localBottlenecks = categorySummary
    .filter(([, entry]) => entry.total > 0 && entry.available <= 1)
    .sort((a, b) => a[1].available - b[1].available)
    .map(([name, entry]) => ({ label: name, sub: `Nur ${entry.available} verfügbar`, badge: entry.total }));
  const risks = shortageItems.length
    ? shortageItems.slice(0, 5).map((item) => ({
        label: item.categoryKey,
        sub: `${item.remainingAfterPlanning} nach Planung frei`,
        badge: item.shortageQty,
      }))
    : localBottlenecks.slice(0, 5);
  const bottleneckCount = shortageItems.length || localBottlenecks.length;

  const todayPlannedQty = planningSummary?.todayPlannedQty ?? 0;

  const recentActivities = activities.slice(0, 6);
  const hasActivities = recentActivities.length > 0;

  const cardShellStyle = {
    background:
      theme === 'dark'
        ? 'linear-gradient(180deg, rgba(12, 20, 34, 0.98) 0%, rgba(7, 13, 24, 0.98) 100%)'
        : 'linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(243, 246, 251, 0.98) 100%)',
  };
  const insetShellStyle = {
    background:
      theme === 'dark'
        ? 'linear-gradient(180deg, rgba(15, 27, 46, 0.94) 0%, rgba(10, 20, 35, 0.98) 100%)'
        : 'linear-gradient(180deg, rgba(248, 250, 252, 0.98) 0%, rgba(241, 245, 249, 0.98) 100%)',
  };
  const heroStyle = {
    background:
      theme === 'dark'
        ? 'radial-gradient(circle at 22% 0%, rgba(47, 125, 246, 0.18) 0%, transparent 34%), linear-gradient(135deg, rgba(13, 21, 37, 0.98) 0%, rgba(9, 18, 33, 0.98) 60%, rgba(9, 20, 36, 0.98) 100%)'
        : 'radial-gradient(circle at 22% 0%, rgba(37, 99, 235, 0.16) 0%, transparent 34%), linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(240, 246, 255, 0.98) 100%)',
  };

  const metricCards: Array<{
    title: string;
    value: string;
    trend: string;
    tone: 'positive' | 'neutral' | 'warning' | 'critical' | 'info';
    icon: typeof CheckCircle2;
    onClick?: () => void;
    disabled?: boolean;
  }> = [
    {
      title: 'Verfügbar',
      value: formatCount(available),
      trend: 'Geräte sofort verfügbar',
      tone: 'positive',
      icon: CheckCircle2,
      onClick: () => onOpenInventoryWithStatus('Verfügbar'),
      disabled: !canInventory,
    },
    {
      title: 'Verliehen',
      value: formatCount(loaned),
      trend: 'Aktuell im Einsatz',
      tone: 'neutral',
      icon: Handshake,
      onClick: () => onOpenInventoryWithStatus('Verliehen'),
      disabled: !canInventory,
    },
    {
      title: 'Defekt / Wartung',
      value: formatCount(defectiveOrMaintenance),
      trend: 'Nicht einsatzbereit',
      tone: 'warning',
      icon: Wrench,
      onClick: () => onOpenInventoryWithStatus('Defekt'),
      disabled: !canInventory,
    },
    {
      title: 'Offene Tickets',
      value: showPlaceholders ? '—' : String(maintenanceOpen),
      trend: 'Benötigen Bearbeitung',
      tone: 'critical',
      icon: TriangleAlert,
      onClick: () => onNavigate('tickets'),
      disabled: !canTickets,
    },
    {
      title: 'Aktive Planungen',
      value: showPlaceholders ? '—' : String(activeReservations),
      trend: 'Laufende Einsätze',
      tone: 'info',
      icon: CalendarRange,
      onClick: () => onNavigate('planning'),
      disabled: !canPlanning,
    },
  ];

  return (
    <section className="space-y-5 pb-2">
      <article
        className="animate-fade-up relative overflow-hidden rounded-[30px] border border-line shadow-soft"
        style={heroStyle}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-95"
          style={{
            background:
              theme === 'dark'
                ? 'linear-gradient(115deg, transparent 0%, transparent 60%, rgba(79, 172, 255, 0.08) 60%, transparent 100%)'
                : 'linear-gradient(115deg, transparent 0%, transparent 60%, rgba(37, 99, 235, 0.07) 60%, transparent 100%)',
          }}
        />
        <svg
          aria-hidden
          viewBox="0 0 1200 260"
          className="pointer-events-none absolute inset-0 hidden h-full w-full lg:block"
          preserveAspectRatio="none"
        >
          <path d="M760 210L990 72" stroke="rgba(125, 211, 252, 0.38)" strokeWidth="1.4" />
          <path d="M860 214L1090 48" stroke="rgba(191, 219, 254, 0.28)" strokeWidth="1.2" />
          <path d="M930 216L1155 92" stroke="rgba(103, 232, 249, 0.20)" strokeWidth="1.1" />
        </svg>
        <span className="pointer-events-none absolute left-[62%] top-7 h-1.5 w-1.5 rounded-full bg-sky-200 shadow-[0_0_18px_rgba(186,230,253,0.85)]" />
        <span className="pointer-events-none absolute left-[70%] top-16 h-1 w-1 rounded-full bg-sky-100 shadow-[0_0_14px_rgba(191,219,254,0.8)]" />
        <span className="pointer-events-none absolute left-[76%] top-9 h-1 w-1 rounded-full bg-cyan-100 shadow-[0_0_14px_rgba(165,243,252,0.75)]" />
        <span className="pointer-events-none absolute left-[84%] top-16 h-1.5 w-1.5 rounded-full bg-slate-100 shadow-[0_0_18px_rgba(226,232,240,0.75)]" />
        <span className="pointer-events-none absolute left-[90%] top-11 h-1 w-1 rounded-full bg-sky-200 shadow-[0_0_14px_rgba(186,230,253,0.75)]" />
        <div className="relative flex flex-col justify-between gap-6 px-5 py-6 md:px-7 md:py-7 lg:flex-row lg:items-start">
          <div className="max-w-2xl">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-primary/80 dark:text-sky-200/75">Dashboard</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-ink lg:text-[2.15rem]">{greetingFor(userName)}</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-ink-muted">
              Hier ist die aktuelle Übersicht über Hardware, Einsätze, Tickets und die laufende Betriebslage.
            </p>
          </div>
          <div className="hidden items-center gap-4 text-white/80 lg:flex">
            <Printer className="h-14 w-14 text-slate-100/80" strokeWidth={1.5} />
            <MonitorSmartphone className="h-16 w-16 text-sky-100/80" strokeWidth={1.35} />
            <Laptop className="h-14 w-14 text-slate-100/80" strokeWidth={1.35} />
          </div>
        </div>
      </article>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {metricCards.map((metric) => {
          const tone = getMetricTone(metric.tone, theme);
          const cardInner = (
            <div className="relative h-full overflow-hidden rounded-[24px] px-5 py-4 md:px-5 md:py-5">
              <div
                aria-hidden
                className="absolute inset-0 opacity-90"
                style={{ background: tone.background, borderColor: tone.borderColor }}
              />
              <div className="relative flex items-start gap-3.5">
                <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${tone.iconClass}`}>
                  <metric.icon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className={`text-[11px] font-bold uppercase tracking-[0.14em] ${tone.labelClass}`}>{metric.title}</p>
                  <p className="mt-1 text-4xl font-semibold leading-none tracking-tight text-ink">{metric.value}</p>
                  <p className="mt-2 text-xs font-medium text-ink-muted">{metric.trend}</p>
                </div>
              </div>
            </div>
          );

          if (metric.onClick) {
            if (metric.disabled) {
              return (
                <div
                  key={metric.title}
                  aria-disabled="true"
                  title="Keine Berechtigung"
                  className="overflow-hidden rounded-[24px] border border-line opacity-60 shadow-soft"
                >
                  {cardInner}
                </div>
              );
            }
            return (
              <button
                key={metric.title}
                type="button"
                onClick={metric.onClick}
                className="group overflow-hidden rounded-[24px] border border-line text-left shadow-soft transition duration-200 hover:-translate-y-0.5 hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {cardInner}
              </button>
            );
          }

          return (
            <div key={metric.title} className="overflow-hidden rounded-[24px] border border-line shadow-soft">
              {cardInner}
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(320px,0.82fr)]">
        <article
          className="animate-fade-up relative overflow-hidden rounded-[28px] border border-line shadow-soft"
          style={cardShellStyle}
        >
          <div className="relative p-4 md:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-[1.35rem] font-semibold tracking-tight text-ink">Planungsüberblick</h3>
                <p className="mt-1 text-sm text-ink-muted">Deine zugewiesenen Einsätze, Termine und erkannte Engpässe auf einen Blick.</p>
              </div>
              {canPlanning ? (
                <button
                  type="button"
                  onClick={() => onNavigate('planning')}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink-muted transition hover:border-line-strong hover:text-ink"
                >
                  Planung öffnen <ChevronRight className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.75fr)_240px]">
              <div
                className="relative overflow-hidden rounded-[24px] border border-line px-4 py-4"
                style={insetShellStyle}
              >
                {myPlanningsState === 'loading' ? (
                  <div aria-hidden className="min-h-[280px] space-y-3 py-1">
                    <div className="h-4 w-40 animate-pulse rounded-full bg-surface-2" />
                    {[0, 1, 2, 3].map((row) => (
                      <div key={row} className="h-14 animate-pulse rounded-2xl bg-surface-2" />
                    ))}
                  </div>
                ) : myPlanningsState === 'error' ? (
                  <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 text-center">
                    <TriangleAlert className="h-8 w-8 text-amber-500" />
                    <div>
                      <p className="text-sm font-semibold text-ink">Persönliche Einsätze konnten nicht geladen werden.</p>
                      <p className="mt-1 text-xs text-ink-muted">Bitte Verbindung prüfen und erneut versuchen.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void loadMyPlannings()}
                      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink-muted transition hover:border-line-strong hover:text-ink"
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> Erneut laden
                    </button>
                  </div>
                ) : personalPlannings.length ? (
                  <div className="relative">
                    <div className="mb-3 flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-ink-faint">
                      <span>Meine Einsätze</span>
                      <span>
                        {personalPlannings.length} {personalPlannings.length === 1 ? 'Eintrag' : 'Einträge'}
                      </span>
                    </div>
                    <ul className="space-y-2.5">
                      {visiblePersonalPlannings.map((planning) => {
                        const timing = getPlanningTiming(planning, todayIso);
                        const myRole = getMyPlanningRole(planning, currentUserId);
                        const fallbackAccent = getAssetAccentStyle(planning.id, theme);
                        const barColor = planning.responsibleUser?.signatureColor || fallbackAccent.border;
                        const conflictCount = planning.openConflictCount ?? 0;
                        const rowInner = (
                          <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface/70 px-3 py-2.5 transition group-hover:border-line-strong">
                            <span aria-hidden className="h-9 w-1 shrink-0 rounded-full" style={{ backgroundColor: barColor }} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <p className="truncate text-sm font-semibold text-ink">{planning.projectName}</p>
                                {myRole ? (
                                  <span className="inline-flex shrink-0 items-center rounded-full bg-sky-500/12 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:text-sky-300">
                                    {myRole}
                                  </span>
                                ) : null}
                                {conflictCount > 0 ? (
                                  <span className="inline-flex shrink-0 items-center rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-bold text-rose-600 dark:text-rose-300">
                                    {conflictCount} {conflictCount === 1 ? 'Konflikt' : 'Konflikte'}
                                  </span>
                                ) : null}
                              </div>
                              <p className="mt-0.5 truncate text-[11px] text-ink-muted">
                                {planning.customerName}
                                {planning.eventName ? ` · ${planning.eventName}` : ''}
                                {` · ${planning.totalQty ?? 0} Geräte`}
                              </p>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="text-xs font-semibold text-ink">
                                {formatShortDate(planning.startDate)} – {formatShortDate(planning.endDate)}
                              </p>
                              <p
                                className={`mt-0.5 text-[11px] font-medium ${
                                  timing.tone === 'now'
                                    ? 'text-emerald-600 dark:text-emerald-300'
                                    : timing.tone === 'soon'
                                      ? 'text-sky-600 dark:text-sky-300'
                                      : 'text-ink-muted'
                                }`}
                              >
                                {timing.label}
                              </p>
                            </div>
                          </div>
                        );
                        return (
                          <li key={planning.id}>
                            {canPlanning ? (
                              <button
                                type="button"
                                onClick={() => navigate(planningDetailPath(planning.id))}
                                className="group block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                              >
                                {rowInner}
                              </button>
                            ) : (
                              rowInner
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    {hiddenPersonalCount > 0 && canPlanning ? (
                      <button
                        type="button"
                        onClick={() => onNavigate('planning')}
                        className="mt-3 text-xs font-semibold text-primary hover:underline"
                      >
                        +{hiddenPersonalCount} weitere in der Einsatzplanung
                      </button>
                    ) : null}
                    <div className="mt-4 grid gap-2 border-t border-line/70 pt-3 text-xs text-ink-muted sm:grid-cols-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">Heute im Einsatz</p>
                        <p className="mt-1 font-semibold text-ink">
                          {myActiveToday.length} {myActiveToday.length === 1 ? 'Einsatz' : 'Einsätze'}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">Offene Konflikte</p>
                        <p className={`mt-1 font-semibold ${myOpenConflictCount > 0 ? 'text-rose-500 dark:text-rose-300' : 'text-ink'}`}>
                          {myOpenConflictCount}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">Nächster Einsatz</p>
                        <p className="mt-1 font-semibold text-ink">
                          {nextPersonalPlanning ? formatGermanDate(nextPersonalPlanning.startDate) : '—'}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <EmptyState
                    icon={CalendarRange}
                    title="Keine persönlichen Einsätze geplant"
                    message="Sobald du einer Planung als Verantwortlicher, On-Site-Verantwortlicher oder Mitarbeiter zugewiesen wirst, erscheint sie hier."
                    className="min-h-[280px]"
                  />
                )}
              </div>

              <div
                className="rounded-[24px] border border-line px-4 py-4"
                style={insetShellStyle}
              >
                <MiniCalendar markedDays={markedCalendarDays} />
                <div className="mt-4 space-y-2 border-t border-line pt-4 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-ink-muted">Meine Einsätze</span>
                    <span className="font-semibold text-ink">{formatPersonalCount(personalPlannings.length)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-ink-muted">Heute im Einsatz</span>
                    <span className="font-semibold text-ink">{formatPersonalCount(myActiveToday.length)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-ink-muted">Offene Konflikte</span>
                    <span className={`font-semibold ${myOpenConflictCount > 0 ? 'text-rose-500 dark:text-rose-300' : 'text-ink'}`}>
                      {formatPersonalCount(myOpenConflictCount)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-ink-muted">Tickets offen</span>
                    <span className="font-semibold text-ink">{maintenanceOpen}</span>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-line/70 bg-surface/70 px-3 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink-faint">Engpässe &amp; Risiken</p>
                  {risks.length ? (
                    <ul className="mt-3 space-y-2.5">
                      {risks.slice(0, 3).map((risk) => (
                        <li key={risk.label} className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-ink">{risk.label}</p>
                            <p className="truncate text-[11px] text-ink-muted">{risk.sub}</p>
                          </div>
                          <span className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-full bg-rose-500/15 px-1.5 text-[11px] font-bold text-rose-600 dark:text-rose-300">
                            {risk.badge}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-xs text-ink-muted">Keine Engpässe erkannt.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </article>

        <article
          className="animate-fade-up relative overflow-hidden rounded-[28px] border border-line shadow-soft"
          style={cardShellStyle}
        >
          <div className="relative p-4 md:p-5">
            <h3 className="text-[1.35rem] font-semibold tracking-tight text-ink">Schnellaktionen</h3>
            <p className="mt-1 text-sm text-ink-muted">Direkter Zugriff auf die wichtigsten Lager- und Serviceprozesse.</p>
            <div className="mt-4 space-y-3">
              <ActionCard
                icon={PackagePlus}
                title="Neues Gerät"
                subtitle="Gerät erfassen und inventarisieren"
                tone="primary"
                onClick={() => onNavigate('inventory')}
                disabled={!canInventory}
              />
              <ActionCard
                icon={CalendarPlus}
                title="Planung erstellen"
                subtitle="Neuen Einsatz planen"
                onClick={() => onNavigate('planning')}
                disabled={!canPlanning}
              />
              <ActionCard
                icon={ScanLine}
                title="Scannen"
                subtitle="Ein-/Auslagerung starten"
                tone="success"
                onClick={() => onNavigate('checkinCheckout')}
                disabled={!canCheckinout}
              />
              <ActionCard
                icon={TriangleAlert}
                title="Defekt melden"
                subtitle="Problem oder Defekt erfassen"
                tone="warning"
                onClick={() => onNavigate('tickets')}
                disabled={!canTickets}
              />
            </div>
          </div>
        </article>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(320px,0.82fr)]">
        <article
          className="animate-fade-up relative overflow-hidden rounded-[28px] border border-line shadow-soft"
          style={cardShellStyle}
        >
          <div className="relative p-4 md:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-[1.35rem] font-semibold tracking-tight text-ink">Aktuelle Aktivitäten</h3>
                <p className="mt-1 text-sm text-ink-muted">Letzte Buchungen, Änderungen und Systemvorgänge im Bestand.</p>
              </div>
              {canInventory ? (
                <button
                  type="button"
                  onClick={() => onNavigate('inventory')}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                >
                  Zum Inventar <ChevronRight className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            {hasActivities ? (
              <div className="overflow-x-auto rounded-[22px] border border-line" style={insetShellStyle}>
                <table className="w-full min-w-[620px] text-sm">
                  <thead>
                    <tr className="border-b border-line/80 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
                      <th className="px-4 py-3 font-semibold">Zeit</th>
                      <th className="px-4 py-3 font-semibold">Typ</th>
                      <th className="px-4 py-3 font-semibold">Details</th>
                      <th className="px-4 py-3 font-semibold">Gerät</th>
                      <th className="px-4 py-3 font-semibold">Standort</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentActivities.map((activity) => {
                      const relatedAsset = activity.assetId ? assetsById.get(activity.assetId) : undefined;
                      const assetKey = relatedAsset?.id ?? activity.assetId ?? '';
                      const accent = assetKey ? getAssetAccentStyle(assetKey, theme) : null;
                      const assetBadge = getReadableAssetLabel(relatedAsset);
                      const detailText = normalizeActivityText(activity.detail, relatedAsset);
                      const summary = summarizeActivityLine(activity.title, detailText);
                      const typeClass = TYPE_BADGE[summary.actionLabel] ?? TYPE_BADGE_DEFAULT;
                      return (
                        <tr key={activity.id} className="border-b border-line/60 last:border-0">
                          <td className="px-4 py-3 align-top text-xs text-ink-muted">{activity.timestamp}</td>
                          <td className="px-4 py-3 align-top">
                            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${typeClass}`}>
                              {summary.actionLabel}
                            </span>
                          </td>
                          <td className="px-4 py-3 align-top text-xs text-ink">
                            {summary.main}
                            {summary.actor ? <span className="mt-1 block text-[11px] text-ink-faint">durch {summary.actor}</span> : null}
                          </td>
                          <td className="px-4 py-3 align-top">
                            <span
                              className="inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold"
                              style={accent ? { borderColor: accent.border, backgroundColor: accent.bg, color: accent.text } : undefined}
                            >
                              {assetBadge}
                            </span>
                          </td>
                          <td className="px-4 py-3 align-top text-xs text-ink-muted">{relatedAsset?.location || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                icon={CalendarRange}
                title="Noch keine Aktivitäten vorhanden"
                message="Sobald Buchungen oder Änderungen erfolgen, erscheint hier die Timeline."
              />
            )}
          </div>
        </article>

        <article
          className="animate-fade-up relative overflow-hidden rounded-[28px] border border-line shadow-soft"
          style={cardShellStyle}
        >
          <div className="relative p-4 md:p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-[1.35rem] font-semibold tracking-tight text-ink">Betriebslage</h3>
                <p className="mt-1 text-sm text-ink-muted">Kompakte Kennzahlen zum aktuellen Tagesbetrieb.</p>
              </div>
              <Sparkles className="h-9 w-9 text-ink-faint/70" />
            </div>
            <div className="space-y-2.5 text-sm">
              <div className="flex items-center justify-between rounded-2xl border border-line px-3.5 py-3" style={insetShellStyle}>
                <span className="inline-flex items-center gap-2 text-ink-muted">
                  <CalendarRange className="h-4 w-4 text-primary" />
                  Aktive Reservierungen
                </span>
                <span className="font-semibold text-ink">{activeReservations}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-line px-3.5 py-3" style={insetShellStyle}>
                <span className="inline-flex items-center gap-2 text-ink-muted">
                  <CalendarPlus className="h-4 w-4 text-sky-500" />
                  Geräte geplant
                </span>
                <span className="font-semibold text-ink">{planningSummary?.upcomingPlannedQty ?? todayPlannedQty}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-line px-3.5 py-3" style={insetShellStyle}>
                <span className="inline-flex items-center gap-2 text-ink-muted">
                  <TriangleAlert className="h-4 w-4 text-amber-500" />
                  Offene Tickets
                </span>
                <span className="font-semibold text-ink">{maintenanceOpen}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-line px-3.5 py-3" style={insetShellStyle}>
                <span className="inline-flex items-center gap-2 text-ink-muted">
                  <Wrench className="h-4 w-4 text-amber-500" />
                  Geräte in Wartung
                </span>
                <span className="font-semibold text-ink">{inMaintenance}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-line px-3.5 py-3" style={insetShellStyle}>
                <span className="inline-flex items-center gap-2 text-ink-muted">
                  <TriangleAlert className="h-4 w-4 text-rose-500" />
                  Engpass-Kategorien
                </span>
                <span className="font-semibold text-ink">{bottleneckCount}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-line px-3.5 py-3" style={insetShellStyle}>
                <span className="inline-flex items-center gap-2 text-ink-muted">
                  <Boxes className="h-4 w-4 text-ink-faint" />
                  Gesamtbestand
                </span>
                <span className="font-semibold text-ink">{formatCount(assets.length)}</span>
              </div>
              {canUsers ? (
                <button
                  type="button"
                  onClick={() => onNavigate('users')}
                  className="flex w-full items-center justify-between rounded-2xl border border-line px-3.5 py-3 text-left transition hover:border-line-strong"
                  style={insetShellStyle}
                >
                  <span className="inline-flex items-center gap-2 text-ink-muted">
                    <Users className="h-4 w-4 text-ink-faint" />
                    Team &amp; Rollen
                  </span>
                  <ChevronRight className="h-4 w-4 text-ink-faint" />
                </button>
              ) : null}
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
