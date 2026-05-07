import { Boxes, CalendarRange, CheckCircle2, Handshake, TriangleAlert, Users, Wrench } from 'lucide-react';
import { KpiCard } from '../components/KpiCard';
import { normalizeCategory } from '../categories';
import type { ActivityItem, AppPage, Asset, MaintenanceItem, ReservationItem } from '../types';
import type { Theme } from '../../hooks/useTheme';
import type { WmsOverview } from '../../services/wmsApi';

type DashboardPageProps = {
  assets: Asset[];
  activities: ActivityItem[];
  reservations: ReservationItem[];
  maintenanceItems: MaintenanceItem[];
  planningSummary: WmsOverview['planningSummary'];
  theme: Theme;
  onNavigate: (page: AppPage) => void;
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
  { border: 'rgba(56, 189, 248, 0.72)', bg: 'rgba(56, 189, 248, 0.10)', text: 'rgb(186, 230, 253)' },
  { border: 'rgba(45, 212, 191, 0.70)', bg: 'rgba(45, 212, 191, 0.10)', text: 'rgb(153, 246, 228)' },
  { border: 'rgba(129, 140, 248, 0.72)', bg: 'rgba(129, 140, 248, 0.10)', text: 'rgb(199, 210, 254)' },
  { border: 'rgba(168, 85, 247, 0.68)', bg: 'rgba(168, 85, 247, 0.09)', text: 'rgb(221, 214, 254)' },
  { border: 'rgba(251, 191, 36, 0.64)', bg: 'rgba(251, 191, 36, 0.08)', text: 'rgb(254, 240, 138)' },
  { border: 'rgba(52, 211, 153, 0.66)', bg: 'rgba(52, 211, 153, 0.08)', text: 'rgb(167, 243, 208)' },
  { border: 'rgba(244, 114, 182, 0.60)', bg: 'rgba(244, 114, 182, 0.07)', text: 'rgb(251, 207, 232)' },
  { border: 'rgba(96, 165, 250, 0.70)', bg: 'rgba(96, 165, 250, 0.09)', text: 'rgb(191, 219, 254)' },
] as const;

const CHECKOUT_ACTION_STYLES = 'border-emerald-200 bg-emerald-50 text-emerald-800';
const CHECKIN_ACTION_STYLES = 'border-sky-200 bg-sky-50 text-sky-800';
const DEFAULT_ACTION_STYLES = 'border-slate-200 bg-slate-100 text-slate-700';

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

function summarizeActivityLine(title: string, detail: string): { main: string; meta?: string; actionLabel: string; actionClass: string } {
  const isCheckout = title.toLowerCase() === 'checkout gebucht';
  const isCheckin = title.toLowerCase() === 'checkin gebucht';
  const actionLabel = isCheckout ? 'Ausgabe' : isCheckin ? 'Rücknahme' : title;
  const actionClass = isCheckout ? CHECKOUT_ACTION_STYLES : isCheckin ? CHECKIN_ACTION_STYLES : DEFAULT_ACTION_STYLES;

  const byMatch = detail.match(/Ausgeführt durch:\s*([^.]*)/i);
  const actor = byMatch?.[1]?.trim();
  const withoutActor = detail.replace(/\.\s*Ausgeführt durch:\s*[^.]*\.?/i, '').trim();

  if (isCheckout) {
    if (/für allgemeinen einsatz ausgegeben/i.test(withoutActor)) {
      return { main: `Für Allgemeinen Einsatz ausgegeben${actor ? ` · durch ${actor}` : ''}`, actionLabel, actionClass };
    }
    const project = withoutActor.match(/für Projekt\s+([^.]*)\s+ausgegeben/i)?.[1]?.trim();
    const recipient = withoutActor.match(/an\s+([^.]*)\s+(für Projekt|ausgegeben)/i)?.[1]?.trim();
    const parts = [];
    if (project) parts.push(`Für Projekt ${project} ausgegeben`);
    else parts.push('Ausgegeben');
    if (actor) parts.push(`durch ${actor}`);
    return { main: parts.join(' · '), meta: recipient ? `Empfänger: ${recipient}` : undefined, actionLabel, actionClass };
  }

  if (isCheckin) {
    const from = withoutActor.match(/von\s+([^.]*)\s+zurückgenommen/i)?.[1]?.trim();
    return {
      main: `${from ? `Von ${from} ` : ''}zurückgenommen${actor ? ` · durch ${actor}` : ''}`.replace(/^z/, 'Z'),
      actionLabel,
      actionClass,
    };
  }

  return { main: detail, actionLabel, actionClass };
}

export function DashboardPage({
  assets,
  activities,
  reservations,
  maintenanceItems,
  planningSummary,
  theme,
  onNavigate,
  isInitialLoading = false,
}: DashboardPageProps) {
  // Solange der erste Overview-Call läuft, zeigen wir einen Em-Dash
  // statt "0" — sonst wirkt das Inventar fälschlich leer. Sobald echte
  // Werte da sind, springen die Zahlen ein.
  const showPlaceholders = isInitialLoading && assets.length === 0;
  const formatCount = (value: number): string => (showPlaceholders ? '—' : String(value));
  const totalAssets = assets.length;
  const available = assets.filter((asset) => asset.status === 'Verfügbar').length;
  const loaned = assets.filter((asset) => asset.status === 'Verliehen').length;
  const defective = assets.filter((asset) => asset.status === 'Defekt').length;
  const inMaintenance = assets.filter((asset) => asset.status === 'In Wartung').length;
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
  const bottleneckCount = categorySummary.filter(([, entry]) => entry.total > 0 && entry.available <= 1).length;
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const todayPlannedQty = planningSummary?.todayPlannedQty ?? 0;
  const todayShortageCount = planningSummary?.todayShortageCount ?? 0;
  const upcomingPlannedQty = planningSummary?.upcomingPlannedQty ?? 0;
  const upcomingShortageCount = planningSummary?.upcomingShortageCount ?? 0;
  const hasPlanningCategorySummary = Boolean(planningSummary?.categorySummaries?.length);
  const hasActivities = activities.length > 0;

  return (
    <section className="mx-auto w-full max-w-[1520px] space-y-8">
      <div className="surface-card animate-fade-up overflow-hidden rounded-3xl border border-slate-200/80 p-0 shadow-lg dark:border-slate-800 dark:bg-slate-900/75">
        <div className="grid gap-6 bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 px-6 py-7 text-slate-100 md:grid-cols-[1.4fr_1fr] md:px-8 md:py-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-200">Dashboard</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Kernübersicht</h2>
            <p className="mt-3 max-w-2xl text-sm text-slate-200 sm:text-base">
              Bestand, Planung und Rückgaben auf einen Blick.
            </p>
            <div className="mt-5 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-slate-100">Verfügbar: {formatCount(available)}</span>
              <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-slate-100">Verliehen: {formatCount(loaned)}</span>
              <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-slate-100">Offene Tickets: {showPlaceholders ? '—' : maintenanceOpen}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2.5 text-xs sm:text-sm">
            <button type="button" onClick={() => onNavigate('planning')} className="rounded-xl border border-white/15 bg-white/12 px-3 py-3 text-left transition hover:-translate-y-0.5 hover:bg-white/20">
              <p className="font-semibold text-white">Einsatzplanung</p>
              <p className="mt-1 text-sky-100">Projektbedarf prüfen</p>
            </button>
            <button type="button" onClick={() => onNavigate('checkinCheckout')} className="rounded-xl border border-white/15 bg-white/12 px-3 py-3 text-left transition hover:-translate-y-0.5 hover:bg-white/20">
              <p className="font-semibold text-white">Ein-/Auslagerung</p>
              <p className="mt-1 text-sky-100">3-Klick Ausgabe</p>
            </button>
            <button type="button" onClick={() => onNavigate('inventory')} className="rounded-xl border border-white/15 bg-white/12 px-3 py-3 text-left transition hover:-translate-y-0.5 hover:bg-white/20">
              <p className="font-semibold text-white">Inventar</p>
              <p className="mt-1 text-sky-100">Bestand & Status</p>
            </button>
            <button type="button" onClick={() => onNavigate('tickets')} className="rounded-xl border border-white/15 bg-white/12 px-3 py-3 text-left transition hover:-translate-y-0.5 hover:bg-white/20">
              <p className="font-semibold text-white">Tickets</p>
              <p className="mt-1 text-sky-100">Defekte nachverfolgen</p>
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <KpiCard
          title="Gesamtanzahl Assets"
          value={formatCount(totalAssets)}
          trend={showPlaceholders ? 'Wird geladen …' : 'Aktiver Bestand'}
          tone="neutral"
          icon={Boxes}
        />
        <KpiCard
          title="Verfügbar"
          value={formatCount(available)}
          trend={showPlaceholders ? 'Wird geladen …' : 'Direkt ausleihbar'}
          tone="positive"
          icon={CheckCircle2}
        />
        <KpiCard
          title="Verliehen"
          value={formatCount(loaned)}
          trend={showPlaceholders ? 'Wird geladen …' : 'Aktuell ausgegeben'}
          tone="warning"
          icon={Handshake}
        />
        <KpiCard
          title="Defekte Geräte"
          value={formatCount(defective)}
          trend={showPlaceholders ? 'Wird geladen …' : 'Benötigen Bearbeitung'}
          tone="critical"
          icon={TriangleAlert}
        />
        <KpiCard
          title="In Wartung"
          value={formatCount(inMaintenance)}
          trend={showPlaceholders ? 'Wird geladen …' : 'Technikprüfung'}
          tone="warning"
          icon={Wrench}
        />
        <KpiCard
          title="Engpass-Kategorien"
          value={formatCount(bottleneckCount)}
          trend={showPlaceholders ? 'Wird geladen …' : '<= 1 verfügbar'}
          tone={!showPlaceholders && bottleneckCount > 0 ? 'critical' : 'neutral'}
          icon={TriangleAlert}
        />
      </div>

      <article className="surface-card animate-fade-up rounded-2xl border border-slate-200/80 p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/75 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Planung heute / kommende Einsätze</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Planungsdruck und mögliche Engpässe pro Zeitraum.</p>
          </div>
          <button type="button" onClick={() => onNavigate('planning')} className="btn-secondary px-3 py-1.5 text-xs">
            Einsatzplanung öffnen
          </button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="surface-muted rounded-xl px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Heute geplant</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">{todayPlannedQty}</p>
          </div>
          <div className="surface-muted rounded-xl px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-rose-700">Heute Engpässe</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">{todayShortageCount}</p>
          </div>
          <div className="surface-muted rounded-xl px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Kommende 7 Tage geplant</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">{upcomingPlannedQty}</p>
          </div>
          <div className="surface-muted rounded-xl px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-amber-700">Kommende Engpass-Kategorien</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">{upcomingShortageCount}</p>
          </div>
        </div>
        <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
          Physisch verfügbar basiert auf Inventarstatus. Nach Planung frei ist eine rechnerische Vorschau und ändert keinen echten Asset-Status.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(planningSummary?.categorySummaries ?? []).slice(0, 9).map((item) => (
            <div key={`planning-summary-${item.categoryKey}`} className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300">
              <p className="font-semibold text-slate-900 dark:text-slate-100">{item.categoryKey}</p>
              <p>Physisch verfügbar: {item.usableStock}</p>
              <p>Heute geplant: {item.plannedQtyToday}</p>
              <p>Nach Planung frei: {item.remainingAfterPlanning}</p>
              <p className={item.shortageQty > 0 ? 'font-semibold text-rose-700' : 'text-emerald-700'}>
                Fehlmenge: {item.shortageQty}
              </p>
            </div>
          ))}
          {!hasPlanningCategorySummary ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center dark:border-slate-700 dark:bg-slate-900/50">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Keine Planungsdaten für heute vorhanden</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Lege eine Einsatzplanung an, um Auslastung und Engpässe zu sehen.</p>
            </div>
          ) : null}
        </div>
      </article>

      <div className="grid gap-4 xl:grid-cols-12">
        <article className="surface-card animate-fade-up rounded-2xl border border-slate-200/80 p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/75 xl:col-span-8 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Letzte Aktivitäten</h3>
            <button type="button" onClick={() => onNavigate('inventory')} className="btn-secondary px-2.5 py-1.5 text-xs">
              Details im Inventar
            </button>
          </div>
          {hasActivities ? (
          <ul className="space-y-2.5">
            {activities.slice(0, 8).map((activity) => (
              <li key={activity.id}>
                {(() => {
                  const relatedAsset = activity.assetId ? assetsById.get(activity.assetId) : undefined;
                  const assetKey = relatedAsset?.id ?? activity.assetId ?? '';
                  const accent = assetKey ? getAssetAccentStyle(assetKey, theme) : null;
                  const assetBadge = getReadableAssetLabel(relatedAsset);
                  const detailText = normalizeActivityText(activity.detail, relatedAsset);
                  const summary = summarizeActivityLine(activity.title, detailText);
                  return (
                    <div
                      className={`surface-muted rounded-xl border-l-4 px-3 py-3 transition ${
                        theme === 'dark' ? 'hover:bg-white/5' : 'hover:border-brand-200 hover:bg-brand-50/40'
                      } ${
                        accent ? '' : 'border-l-slate-200'
                      }`}
                      style={accent ? { borderLeftColor: accent.border } : undefined}
                    >
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className={`inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${summary.actionClass}`}>
                            {summary.actionLabel}
                          </span>
                          {assetBadge ? (
                            <span
                              className={`inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                                accent ? '' : 'border-slate-200 bg-slate-50 text-slate-700'
                              }`}
                              style={accent ? { borderColor: accent.border, backgroundColor: accent.bg, color: accent.text } : undefined}
                            >
                              {assetBadge}
                            </span>
                          ) : null}
                        </div>
                        <span className="text-xs text-slate-500">{activity.timestamp}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-700 dark:text-slate-300">{summary.main}</p>
                      {summary.meta ? <p className="mt-0.5 text-[11px] text-slate-500">{summary.meta}</p> : null}
                    </div>
                  );
                })()}
              </li>
            ))}
          </ul>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-7 text-center dark:border-slate-700 dark:bg-slate-900/50">
              <CalendarRange className="mx-auto h-6 w-6 text-slate-400" />
              <p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-200">Noch keine Aktivitäten vorhanden</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Sobald Buchungen oder Änderungen erfolgen, erscheint hier die Timeline.</p>
            </div>
          )}
        </article>

        <article className="surface-card animate-fade-up rounded-2xl border border-slate-200/80 p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/75 xl:col-span-4 sm:p-6">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Betriebslage</h3>
          <div className="mt-4 space-y-2.5 text-sm">
            <div className="surface-muted flex items-center justify-between rounded-xl px-3 py-3">
              <span className="inline-flex items-center gap-2 text-slate-600">
                <CalendarRange className="h-4 w-4 text-brand-600" />
                Aktive Reservierungen
              </span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">{activeReservations}</span>
            </div>
            <div className="surface-muted flex items-center justify-between rounded-xl px-3 py-3">
              <span className="inline-flex items-center gap-2 text-slate-600">
                <TriangleAlert className="h-4 w-4 text-amber-600" />
                Offene Tickets
              </span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">{maintenanceOpen}</span>
            </div>
            <div className="surface-muted flex items-center justify-between rounded-xl px-3 py-3">
              <span className="inline-flex items-center gap-2 text-slate-600">
                <Wrench className="h-4 w-4 text-amber-600" />
                Geräte in Wartung
              </span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">{inMaintenance}</span>
            </div>
            <div className="surface-muted flex items-center justify-between rounded-xl px-3 py-3">
              <span className="inline-flex items-center gap-2 text-slate-600">
                <TriangleAlert className="h-4 w-4 text-rose-600" />
                Engpassindikatoren
              </span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">{bottleneckCount}</span>
            </div>
            <div className="surface-muted flex items-center justify-between rounded-xl px-3 py-3">
              <span className="inline-flex items-center gap-2 text-slate-600">
                <Users className="h-4 w-4 text-slate-600" />
                Team & Rollen
              </span>
              <button type="button" onClick={() => onNavigate('users')} className="btn-ghost px-3 py-1.5 text-xs">
                Öffnen
              </button>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
