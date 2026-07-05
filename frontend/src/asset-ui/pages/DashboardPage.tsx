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
  ScanLine,
  TriangleAlert,
  Users,
  Wrench,
} from 'lucide-react';
import { KpiCard } from '../components/KpiCard';
import { ActionCard, EmptyState } from '../../ui';
import { normalizeCategory } from '../categories';
import { canAccessPage } from '../../config/pageAccess';
import type { ActivityItem, AppPage, AppRole, Asset, MaintenanceItem, ReservationItem } from '../types';
import type { Theme } from '../../hooks/useTheme';
import type { WmsOverview } from '../../services/wmsApi';

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

// Kompakter Monats-Mini-Kalender für den aktuellen Monat, heutiger Tag
// hervorgehoben. Rein aus dem aktuellen Datum abgeleitet (keine Fake-Bars).
function MiniCalendar() {
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
      <p className="mb-2 text-sm font-semibold text-ink">
        {MONTHS[month]} {year}
      </p>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-ink-faint">
        {WEEKDAYS.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((day, index) => (
          <div key={index} className="flex items-center justify-center">
            {day === null ? (
              <span className="h-7 w-7" />
            ) : (
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${
                  day === today ? 'bg-primary font-bold text-white' : 'text-ink-muted'
                }`}
              >
                {day}
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

  // Nächste Einsätze: aktive/geplante Reservierungen (keine abgeschlossenen).
  const upcomingReservations = reservations
    .filter((item) => item.status !== 'Abgeschlossen' && item.status !== 'Storniert')
    .slice(0, 4);

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
  const openConflictCount = planningSummary?.openConflictCount ?? 0;

  const recentActivities = activities.slice(0, 6);
  const hasActivities = recentActivities.length > 0;

  return (
    <section className="space-y-6">
      {/* HERO: zeitabhängige Begrüßung + dezente Geräte-Silhouetten rechts. */}
      <div className="relative overflow-hidden rounded-2xl border border-line bg-surface p-6 md:p-7">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{ background: 'radial-gradient(circle at 88% -10%, var(--ui-primary-soft) 0%, transparent 55%)' }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute right-4 top-1/2 hidden -translate-y-1/2 items-center gap-3 text-ink-faint/40 lg:flex"
        >
          <Printer className="h-14 w-14" strokeWidth={1} />
          <MonitorSmartphone className="h-20 w-20" strokeWidth={1} />
          <Laptop className="h-16 w-16" strokeWidth={1} />
        </div>
        <div className="relative">
          <h2 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{greetingFor(userName)}</h2>
          <p className="mt-2 max-w-xl text-sm text-ink-muted">
            Hier ist der aktuelle Überblick über Hardware, Planungen und Vorgänge.
          </p>
        </div>
      </div>

      {/* KPI-ZEILE */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        <KpiCard
          title="Verfügbar"
          value={formatCount(available)}
          trend="Geräte sofort verfügbar"
          tone="positive"
          icon={CheckCircle2}
          onClick={() => onOpenInventoryWithStatus('Verfügbar')}
          disabled={!canInventory}
        />
        <KpiCard
          title="Verliehen"
          value={formatCount(loaned)}
          trend="Aktuell im Einsatz"
          tone="neutral"
          icon={Handshake}
          onClick={() => onOpenInventoryWithStatus('Verliehen')}
          disabled={!canInventory}
        />
        <KpiCard
          title="Defekt / Wartung"
          value={formatCount(defectiveOrMaintenance)}
          trend="Nicht einsatzbereit"
          tone="warning"
          icon={Wrench}
          onClick={() => onOpenInventoryWithStatus('Defekt')}
          disabled={!canInventory}
        />
        <KpiCard
          title="Offene Tickets"
          value={showPlaceholders ? '—' : String(maintenanceOpen)}
          trend="Benötigen Bearbeitung"
          tone="critical"
          icon={TriangleAlert}
          onClick={() => onNavigate('tickets')}
          disabled={!canTickets}
        />
        <KpiCard
          title="Aktive Planungen"
          value={showPlaceholders ? '—' : String(activeReservations)}
          trend="Laufende Einsätze"
          tone="neutral"
          icon={CalendarRange}
          onClick={() => onNavigate('planning')}
          disabled={!canPlanning}
        />
      </div>

      {/* PLANUNGSÜBERBLICK (3 Spalten) + SCHNELLAKTIONEN */}
      <div className="grid gap-4 xl:grid-cols-12">
        <article className="surface-card animate-fade-up xl:col-span-8">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-ink">Planungsüberblick</h3>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {/* Nächste Einsätze */}
            <div className="rounded-xl border border-line bg-surface-2 p-3.5">
              <p className="mb-3 text-sm font-semibold text-ink">Nächste Einsätze</p>
              {upcomingReservations.length ? (
                <ul className="space-y-2.5">
                  {upcomingReservations.map((reservation) => (
                    <li key={reservation.id} className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface text-ink-muted">
                        <CalendarRange className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-ink">{reservation.team || reservation.requestedBy}</p>
                        <p className="truncate text-[11px] text-ink-muted">
                          {reservation.assets.length} Geräte · {reservation.location || '—'}
                        </p>
                        <p className="truncate text-[11px] text-ink-faint">{reservation.period}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-6 text-center text-xs text-ink-muted">Keine geplanten Einsätze</p>
              )}
              {canPlanning ? (
                <button
                  type="button"
                  onClick={() => onNavigate('planning')}
                  className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                >
                  Alle Planungen anzeigen <ChevronRight className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>

            {/* Engpässe & Risiken */}
            <div className="rounded-xl border border-line bg-surface-2 p-3.5">
              <p className="mb-3 text-sm font-semibold text-ink">Engpässe &amp; Risiken</p>
              {risks.length ? (
                <ul className="space-y-2.5">
                  {risks.map((risk) => (
                    <li key={risk.label} className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-ink">{risk.label}</p>
                        <p className="truncate text-[11px] text-ink-muted">{risk.sub}</p>
                      </div>
                      <span className="flex h-6 min-w-[24px] shrink-0 items-center justify-center rounded-full bg-rose-500/15 px-1.5 text-[11px] font-bold text-rose-600 dark:text-rose-300">
                        {risk.badge}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-6 text-center text-xs text-ink-muted">Keine Engpässe erkannt</p>
              )}
              {canPlanning ? (
                <button
                  type="button"
                  onClick={() => onNavigate('planning')}
                  className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                >
                  Alle Engpässe anzeigen <ChevronRight className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>

            {/* Kalenderübersicht */}
            <div className="rounded-xl border border-line bg-surface-2 p-3.5">
              <MiniCalendar />
              <div className="mt-3 space-y-1.5 border-t border-line pt-3 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-ink-muted">Heute geplant</span>
                  <span className="font-semibold text-ink">{todayPlannedQty} Geräte</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-ink-muted">Offene Konflikte</span>
                  <span className={`font-semibold ${openConflictCount > 0 ? 'text-rose-600 dark:text-rose-300' : 'text-ink'}`}>
                    {openConflictCount}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </article>

        {/* Schnellaktionen */}
        <article className="surface-card animate-fade-up xl:col-span-4">
          <h3 className="mb-4 text-lg font-semibold text-ink">Schnellaktionen</h3>
          <div className="space-y-2.5">
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
        </article>
      </div>

      {/* AKTIVITÄTEN-TABELLE + BETRIEBSLAGE */}
      <div className="grid gap-4 xl:grid-cols-12">
        <article className="surface-card animate-fade-up overflow-hidden xl:col-span-8">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-ink">Aktuelle Aktivitäten</h3>
            {canInventory ? (
              <button
                type="button"
                onClick={() => onNavigate('inventory')}
                className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
              >
                Zum Inventar <ChevronRight className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          {hasActivities ? (
            <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                    <th className="pb-2 pr-3 font-semibold">Zeit</th>
                    <th className="pb-2 pr-3 font-semibold">Typ</th>
                    <th className="pb-2 pr-3 font-semibold">Details</th>
                    <th className="pb-2 pr-3 font-semibold">Gerät</th>
                    <th className="pb-2 font-semibold">Standort</th>
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
                        <td className="py-2.5 pr-3 align-top text-xs text-ink-muted">{activity.timestamp}</td>
                        <td className="py-2.5 pr-3 align-top">
                          <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${typeClass}`}>
                            {summary.actionLabel}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 align-top text-xs text-ink">
                          {summary.main}
                          {summary.actor ? <span className="block text-[11px] text-ink-faint">durch {summary.actor}</span> : null}
                        </td>
                        <td className="py-2.5 pr-3 align-top">
                          <span
                            className="inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold"
                            style={accent ? { borderColor: accent.border, backgroundColor: accent.bg, color: accent.text } : undefined}
                          >
                            {assetBadge}
                          </span>
                        </td>
                        <td className="py-2.5 align-top text-xs text-ink-muted">{relatedAsset?.location || '—'}</td>
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
        </article>

        {/* Betriebslage — echte Kennzahlen (kein erfundener Systemstatus). */}
        <article className="surface-card animate-fade-up xl:col-span-4">
          <h3 className="mb-4 text-lg font-semibold text-ink">Betriebslage</h3>
          <div className="space-y-2.5 text-sm">
            <div className="flex items-center justify-between rounded-xl border border-line bg-surface-2 px-3 py-2.5">
              <span className="inline-flex items-center gap-2 text-ink-muted">
                <CalendarRange className="h-4 w-4 text-primary" />
                Aktive Reservierungen
              </span>
              <span className="font-semibold text-ink">{activeReservations}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-line bg-surface-2 px-3 py-2.5">
              <span className="inline-flex items-center gap-2 text-ink-muted">
                <TriangleAlert className="h-4 w-4 text-amber-500" />
                Offene Tickets
              </span>
              <span className="font-semibold text-ink">{maintenanceOpen}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-line bg-surface-2 px-3 py-2.5">
              <span className="inline-flex items-center gap-2 text-ink-muted">
                <Wrench className="h-4 w-4 text-amber-500" />
                Geräte in Wartung
              </span>
              <span className="font-semibold text-ink">{inMaintenance}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-line bg-surface-2 px-3 py-2.5">
              <span className="inline-flex items-center gap-2 text-ink-muted">
                <TriangleAlert className="h-4 w-4 text-rose-500" />
                Engpass-Kategorien
              </span>
              <span className="font-semibold text-ink">{bottleneckCount}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-line bg-surface-2 px-3 py-2.5">
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
                className="flex w-full items-center justify-between rounded-xl border border-line bg-surface-2 px-3 py-2.5 transition hover:border-line-strong hover:bg-surface"
              >
                <span className="inline-flex items-center gap-2 text-ink-muted">
                  <Users className="h-4 w-4 text-ink-faint" />
                  Team &amp; Rollen
                </span>
                <ChevronRight className="h-4 w-4 text-ink-faint" />
              </button>
            ) : null}
          </div>
        </article>
      </div>
    </section>
  );
}
