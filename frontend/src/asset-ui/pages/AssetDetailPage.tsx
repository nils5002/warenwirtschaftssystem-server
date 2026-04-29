import { AlertTriangle, CalendarClock, ClipboardList, PenSquare, RotateCcw, ShieldCheck, Wrench } from 'lucide-react';
import { AssetQrCard } from '../components/AssetQrCard';
import { StatusBadge } from '../components/StatusBadge';
import { getAssetQrCode } from '../qr';
import type { ActivityItem, AppRole, Asset, MaintenanceItem } from '../types';

type AssetDetailPageProps = {
  activeRole: AppRole;
  asset: Asset | null;
  activities: ActivityItem[];
  maintenanceItems: MaintenanceItem[];
  onReserveAsset: (assetId: string) => void;
  onCheckoutAsset: (assetId: string) => void;
  onCheckinAsset: (assetId: string) => void;
  onSetMaintenance: (assetId: string) => void;
  onEditAsset: (assetId: string) => void;
  onCreateMaintenance: (payload: { assetName: string; issue: string; comment: string }) => void;
  onUpdateMaintenanceStatus: (id: string, status: MaintenanceItem['status']) => void;
  onOpenInventoryWithQuery: (query: string) => void;
};

export function AssetDetailPage({
  activeRole,
  asset,
  activities,
  maintenanceItems,
  onReserveAsset,
  onCheckoutAsset,
  onCheckinAsset,
  onSetMaintenance,
  onEditAsset,
  onCreateMaintenance,
  onUpdateMaintenanceStatus,
  onOpenInventoryWithQuery,
}: AssetDetailPageProps) {
  if (!asset) {
    return (
      <section className="surface-card animate-fade-up">
        <h2 className="text-xl font-semibold text-slate-900">Asset-Detail</h2>
        <p className="mt-2 text-sm text-slate-500">
          Bitte ein Asset in der Inventaransicht auswählen, um Details zu sehen.
        </p>
      </section>
    );
  }

  const timeline = activities.filter((item) => item.assetId === asset.id);
  const movementLog = asset.notes
    .split('\n')
    .map((line) => line.trim())
    .filter((line) =>
      ['Projekt:', 'Ausgabe durch:', 'Rücknahme:', 'Rücknahme durch:', 'Projektkontext:'].some((prefix) =>
        line.startsWith(prefix),
      ),
    );
  const relatedMaintenance = maintenanceItems
    .filter((item) => item.assetName === asset.name || item.assetName.includes(asset.tagNumber))
    .slice(0, 5);
  const latestMaintenance = relatedMaintenance[0] ?? null;
  const openMaintenanceCount = relatedMaintenance.filter((item) => item.status !== 'Erledigt').length;
  const qrValue = getAssetQrCode(asset);
  const isAdmin = activeRole === 'Admin';

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-700">Asset-Detailseite</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{asset.name}</h2>
          <p className="mt-1 text-sm text-slate-500">
            Inventarnummer {asset.tagNumber} • Seriennummer {asset.serialNumber}
          </p>
        </div>
        <div className="grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap">
          <button
            className="w-full rounded-xl bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 sm:w-auto"
            onClick={() => onReserveAsset(asset.id)}
          >
            Verleihen
          </button>
          <button
            className="w-full rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 sm:w-auto"
            onClick={() => onCheckoutAsset(asset.id)}
          >
            Ausgeben
          </button>
          <button
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 sm:w-auto"
            onClick={() => onCheckinAsset(asset.id)}
          >
            Zurücknehmen
          </button>
          <button
            className="w-full rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-medium text-orange-700 hover:bg-orange-100 sm:w-auto"
            onClick={() => onSetMaintenance(asset.id)}
          >
            In Wartung setzen
          </button>
          <button
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 sm:w-auto"
            onClick={() => onEditAsset(asset.id)}
          >
            Bearbeiten
          </button>
          <button
            className="w-full rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100 sm:w-auto"
            onClick={() =>
              onCreateMaintenance({
                assetName: asset.name,
                issue: 'Gerät defekt',
                comment: '',
              })
            }
          >
            Defekt melden
          </button>
        </div>
      </div>

      <article className="surface-card animate-fade-up">
        <div className="grid gap-4 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <div className="flex h-full flex-col rounded-2xl border border-slate-200 bg-gradient-to-br from-brand-700 to-brand-500 p-5 text-white">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20 text-xl font-bold">
                {asset.name.charAt(0)}
              </div>
              <h3 className="mt-4 text-xl font-semibold">{asset.name}</h3>
              <p className="mt-1 text-sm text-brand-100">{asset.category}</p>
              <div className="mt-4">
                <StatusBadge value={asset.status} />
              </div>
              <dl className="mt-5 space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-brand-100">Standort</dt>
                  <dd className="font-medium">{asset.location}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-brand-100">Zugewiesen an</dt>
                  <dd className="font-medium">{asset.assignedTo}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-brand-100">Nächste Rückgabe</dt>
                  <dd className="font-medium">{asset.nextReturn}</dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="space-y-4 lg:col-span-8">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Kategorie</p>
                <p className="mt-1 text-sm font-medium text-slate-900">{asset.category}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Inventarnummer</p>
                <p className="mt-1 text-sm font-medium text-slate-900">{asset.tagNumber}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Seriennummer</p>
                <p className="mt-1 text-sm font-medium text-slate-900">{asset.serialNumber}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Wartungsstatus</p>
                <p className="mt-1 text-sm font-medium text-slate-900">{asset.maintenanceState}</p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  <ClipboardList className="h-3.5 w-3.5" />
                  Letzte Ausgabe
                </p>
                <p className="mt-2 text-sm font-medium text-slate-900">{asset.lastCheckout}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  <CalendarClock className="h-3.5 w-3.5" />
                  Nächste Reservierung
                </p>
                <p className="mt-2 text-sm font-medium text-slate-900">{asset.nextReservation}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Wartung
                </p>
                <p className="mt-2 text-sm font-medium text-slate-900">{asset.maintenanceState}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  <Wrench className="h-3.5 w-3.5" />
                  Offene Tickets
                </p>
                <p className="mt-2 text-sm font-medium text-slate-900">{openMaintenanceCount}</p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                <PenSquare className="h-3.5 w-3.5" />
                Notizen
              </p>
              <p className="mt-2 text-sm text-slate-700">{asset.notes}</p>
            </div>

            <AssetQrCard qrValue={qrValue} assetName={asset.name} tagNumber={asset.tagNumber} />
          </div>
        </div>
      </article>

      <article className="surface-card animate-fade-up">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="inline-flex items-center gap-2 text-base font-semibold text-slate-900">
              <AlertTriangle className="h-4 w-4" />
              Defekt-/Wartungsstatus am Gerät
            </h3>
            <p className="mt-1 text-xs text-slate-500">Melden, bearbeiten, erledigen direkt im Asset-Kontext.</p>
          </div>
          {latestMaintenance ? <StatusBadge value={latestMaintenance.status} /> : null}
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {['Displaybruch', 'Display beschädigt', 'Gerät startet nicht'].map((preset) => (
            <button
              key={preset}
              type="button"
              className="btn-secondary justify-start"
              onClick={() => onCreateMaintenance({ assetName: asset.name, issue: preset, comment: '' })}
            >
              {preset}
            </button>
          ))}
        </div>

        {latestMaintenance ? (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm font-semibold text-slate-900">{latestMaintenance.issue}</p>
            <p className="mt-1 text-xs text-slate-600">{latestMaintenance.comment || 'Keine Zusatznotiz'}</p>
            <p className="mt-1 text-xs text-slate-500">Gemeldet: {latestMaintenance.reportedAt}</p>
            {isAdmin ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {latestMaintenance.status !== 'In Bearbeitung' ? (
                  <button
                    type="button"
                    className="btn-secondary px-2 py-1 text-xs"
                    onClick={() => onUpdateMaintenanceStatus(latestMaintenance.id, 'In Bearbeitung')}
                  >
                    In Bearbeitung
                  </button>
                ) : null}
                {latestMaintenance.status !== 'Erledigt' ? (
                  <button
                    type="button"
                    className="btn-primary px-2 py-1 text-xs"
                    onClick={() => onUpdateMaintenanceStatus(latestMaintenance.id, 'Erledigt')}
                  >
                    Erledigt
                  </button>
                ) : null}
                {latestMaintenance.status !== 'Offen' ? (
                  <button
                    type="button"
                    className="btn-ghost px-2 py-1 text-xs"
                    onClick={() => onUpdateMaintenanceStatus(latestMaintenance.id, 'Offen')}
                  >
                    Offen
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
            Für dieses Gerät liegt aktuell keine Defektmeldung vor.
          </div>
        )}
      </article>

      <article className="surface-card animate-fade-up">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="inline-flex items-center gap-2 text-base font-semibold text-slate-900">
            <Wrench className="h-4 w-4" />
            Zugehörige Defektmeldungen
          </h3>
          <button
            type="button"
            className="btn-secondary px-2.5 py-1.5 text-xs"
            onClick={() => onOpenInventoryWithQuery(asset.name)}
          >
            Im Inventar suchen
          </button>
        </div>
        {relatedMaintenance.length ? (
          <div className="space-y-2">
            {relatedMaintenance.map((item) => (
              <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-slate-900">{item.issue}</p>
                  <StatusBadge value={item.status} />
                </div>
                <p className="mt-1 text-xs text-slate-600">{item.comment}</p>
                {isAdmin ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {item.status !== 'In Bearbeitung' ? (
                      <button
                        type="button"
                        className="btn-secondary px-2 py-1 text-xs"
                        onClick={() => onUpdateMaintenanceStatus(item.id, 'In Bearbeitung')}
                      >
                        In Bearbeitung
                      </button>
                    ) : null}
                    {item.status !== 'Erledigt' ? (
                      <button
                        type="button"
                        className="btn-primary px-2 py-1 text-xs"
                        onClick={() => onUpdateMaintenanceStatus(item.id, 'Erledigt')}
                      >
                        Erledigt
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
            Für dieses Asset wurden noch keine Tickets erfasst.
          </div>
        )}
      </article>

      <article className="surface-card animate-fade-up">
        <h3 className="inline-flex items-center gap-2 text-base font-semibold text-slate-900">
          <ClipboardList className="h-4 w-4" />
          Bewegungsprotokoll
        </h3>
        <div className="mt-3 space-y-2">
          {movementLog.length ? (
            movementLog.slice(-12).reverse().map((entry, index) => (
              <div key={`movement-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                {entry}
              </div>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
              Noch keine Bewegungsdaten im Asset-Notizprotokoll.
            </div>
          )}
        </div>
      </article>

      <article className="surface-card animate-fade-up">
        <h3 className="inline-flex items-center gap-2 text-base font-semibold text-slate-900">
          <RotateCcw className="h-4 w-4" />
          Historie
        </h3>
        <div className="mt-3 space-y-2">
          {timeline.length ? (
            timeline.map((item) => (
              <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-slate-900">{item.title}</p>
                  <span className="text-xs text-slate-500">{item.timestamp}</span>
                </div>
                <p className="mt-1 text-xs text-slate-600">{item.detail}</p>
              </div>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
              Noch keine Historie vorhanden.
            </div>
          )}
        </div>
        <div className="mt-4 inline-flex items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-medium text-orange-700">
          <Wrench className="h-4 w-4" />
          Wartungsfreigabe erforderlich vor nächster Ausgabe
        </div>
      </article>
    </section>
  );
}

