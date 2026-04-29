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
              <li
                key={activity.id}
                className="surface-muted px-3 py-2.5 transition hover:border-brand-200 hover:bg-brand-50/40"
              >
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                  <p className="text-sm font-semibold text-slate-900">{activity.title}</p>
                  <span className="text-xs text-slate-500">{activity.timestamp}</span>
                </div>
                <p className="mt-1 text-xs text-slate-600">{activity.detail}</p>
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
