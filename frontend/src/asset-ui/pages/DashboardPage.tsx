import { Boxes, CalendarRange, CheckCircle2, Handshake, TriangleAlert, Users, Wrench } from 'lucide-react';
import { KpiCard } from '../components/KpiCard';
import { normalizeCategory } from '../categories';
import type { ActivityItem, AppPage, Asset, MaintenanceItem, ReservationItem } from '../types';

type DashboardPageProps = {
  assets: Asset[];
  activities: ActivityItem[];
  reservations: ReservationItem[];
  maintenanceItems: MaintenanceItem[];
  onNavigate: (page: AppPage) => void;
};

const ASSET_ACCENT_STYLES = [
  {
    border: 'border-l-cyan-500',
    badge: 'bg-cyan-50 text-cyan-800 border-cyan-200',
  },
  {
    border: 'border-l-emerald-500',
    badge: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  },
  {
    border: 'border-l-amber-500',
    badge: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  {
    border: 'border-l-violet-500',
    badge: 'bg-violet-50 text-violet-800 border-violet-200',
  },
  {
    border: 'border-l-rose-500',
    badge: 'bg-rose-50 text-rose-800 border-rose-200',
  },
  {
    border: 'border-l-sky-500',
    badge: 'bg-sky-50 text-sky-800 border-sky-200',
  },
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

function getAssetAccentStyle(key: string) {
  return ASSET_ACCENT_STYLES[hashText(key) % ASSET_ACCENT_STYLES.length];
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
  onNavigate,
}: DashboardPageProps) {
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

  return (
    <section className="space-y-6">
      <div className="surface-card animate-fade-up overflow-hidden p-0">
        <div className="grid gap-4 bg-gradient-to-br from-slate-900 via-slate-800 to-brand-800 px-5 py-5 text-slate-100 md:grid-cols-[1.3fr_1fr] md:px-6 md:py-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-200">Dashboard</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Kernübersicht</h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-200">
              Zentrale Steuerung für Lager, Projektplanung und Störungsbearbeitung in einer Oberfläche.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs sm:text-sm">
            <button type="button" onClick={() => onNavigate('planning')} className="rounded-xl bg-white/12 px-3 py-3 text-left transition hover:bg-white/20">
              <p className="font-semibold text-white">Einsatzplanung</p>
              <p className="mt-1 text-brand-100">Projektbedarf prüfen</p>
            </button>
            <button type="button" onClick={() => onNavigate('checkinCheckout')} className="rounded-xl bg-white/12 px-3 py-3 text-left transition hover:bg-white/20">
              <p className="font-semibold text-white">Ein-/Auslagerung</p>
              <p className="mt-1 text-brand-100">3-Klick Ausgabe</p>
            </button>
            <button type="button" onClick={() => onNavigate('inventory')} className="rounded-xl bg-white/12 px-3 py-3 text-left transition hover:bg-white/20">
              <p className="font-semibold text-white">Inventar</p>
              <p className="mt-1 text-brand-100">Bestand & Status</p>
            </button>
            <button type="button" onClick={() => onNavigate('tickets')} className="rounded-xl bg-white/12 px-3 py-3 text-left transition hover:bg-white/20">
              <p className="font-semibold text-white">Tickets</p>
              <p className="mt-1 text-brand-100">Defekte nachverfolgen</p>
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <KpiCard
          title="Gesamtanzahl Assets"
          value={String(totalAssets)}
          trend="Aktiver Bestand"
          tone="neutral"
          icon={Boxes}
        />
        <KpiCard
          title="Verfügbar"
          value={String(available)}
          trend="Direkt ausleihbar"
          tone="positive"
          icon={CheckCircle2}
        />
        <KpiCard
          title="Verliehen"
          value={String(loaned)}
          trend="Aktuell ausgegeben"
          tone="warning"
          icon={Handshake}
        />
        <KpiCard
          title="Defekte Geräte"
          value={String(defective)}
          trend="Benötigen Bearbeitung"
          tone="critical"
          icon={TriangleAlert}
        />
        <KpiCard
          title="In Wartung"
          value={String(inMaintenance)}
          trend="Technikprüfung"
          tone="warning"
          icon={Wrench}
        />
        <KpiCard
          title="Engpass-Kategorien"
          value={String(bottleneckCount)}
          trend="<= 1 verfügbar"
          tone={bottleneckCount > 0 ? 'critical' : 'neutral'}
          icon={TriangleAlert}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <article className="surface-card animate-fade-up xl:col-span-8">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-900">Letzte Aktivitäten</h3>
            <button type="button" onClick={() => onNavigate('inventory')} className="btn-secondary px-2.5 py-1.5 text-xs">
              Details im Inventar
            </button>
          </div>
          <ul className="space-y-2">
            {activities.slice(0, 8).map((activity) => (
              <li key={activity.id}>
                {(() => {
                  const relatedAsset = activity.assetId ? assetsById.get(activity.assetId) : undefined;
                  const assetKey = relatedAsset?.id ?? activity.assetId ?? '';
                  const accent = assetKey ? getAssetAccentStyle(assetKey) : null;
                  const assetBadge = getReadableAssetLabel(relatedAsset);
                  const detailText = normalizeActivityText(activity.detail, relatedAsset);
                  const summary = summarizeActivityLine(activity.title, detailText);
                  return (
                    <div
                      className={`surface-muted border-l-4 px-3 py-2.5 transition hover:border-brand-200 hover:bg-brand-50/40 ${
                        accent ? accent.border : 'border-l-slate-200'
                      }`}
                    >
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className={`inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${summary.actionClass}`}>
                            {summary.actionLabel}
                          </span>
                          {assetBadge ? (
                            <span
                              className={`inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                                accent ? accent.badge : 'border-slate-200 bg-slate-50 text-slate-700'
                              }`}
                            >
                              {assetBadge}
                            </span>
                          ) : null}
                        </div>
                        <span className="text-xs text-slate-500">{activity.timestamp}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-700">{summary.main}</p>
                      {summary.meta ? <p className="mt-0.5 text-[11px] text-slate-500">{summary.meta}</p> : null}
                    </div>
                  );
                })()}
              </li>
            ))}
          </ul>
        </article>

        <article className="surface-card animate-fade-up xl:col-span-4">
          <h3 className="text-base font-semibold text-slate-900">Betriebslage</h3>
          <div className="mt-3 space-y-2 text-sm">
            <div className="surface-muted flex items-center justify-between px-3 py-2.5">
              <span className="inline-flex items-center gap-2 text-slate-600">
                <CalendarRange className="h-4 w-4 text-brand-600" />
                Aktive Reservierungen
              </span>
              <span className="font-semibold text-slate-900">{activeReservations}</span>
            </div>
            <div className="surface-muted flex items-center justify-between px-3 py-2.5">
              <span className="inline-flex items-center gap-2 text-slate-600">
                <TriangleAlert className="h-4 w-4 text-amber-600" />
                Offene Tickets
              </span>
              <span className="font-semibold text-slate-900">{maintenanceOpen}</span>
            </div>
            <div className="surface-muted flex items-center justify-between px-3 py-2.5">
              <span className="inline-flex items-center gap-2 text-slate-600">
                <Wrench className="h-4 w-4 text-amber-600" />
                Geräte in Wartung
              </span>
              <span className="font-semibold text-slate-900">{inMaintenance}</span>
            </div>
            <div className="surface-muted flex items-center justify-between px-3 py-2.5">
              <span className="inline-flex items-center gap-2 text-slate-600">
                <TriangleAlert className="h-4 w-4 text-rose-600" />
                Engpassindikatoren
              </span>
              <span className="font-semibold text-slate-900">{bottleneckCount}</span>
            </div>
            <div className="surface-muted flex items-center justify-between px-3 py-2.5">
              <span className="inline-flex items-center gap-2 text-slate-600">
                <Users className="h-4 w-4 text-slate-600" />
                Team & Rollen
              </span>
              <button type="button" onClick={() => onNavigate('users')} className="btn-ghost px-2 py-1 text-xs">
                Öffnen
              </button>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
