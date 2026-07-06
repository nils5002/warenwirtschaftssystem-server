import { AlertTriangle, CalendarClock, ClipboardList, PenSquare, RotateCcw, ShieldCheck, Signal, Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';
import { resolveCategoryDefaultImageUrl } from '../categories';
import { AssetEditModal } from '../components/AssetEditModal';
import { AssetImage } from '../components/AssetImage';
import { AssetQrCard } from '../components/AssetQrCard';
import { KpiCard } from '../components/KpiCard';
import { StatusBadge } from '../components/StatusBadge';
import { getAssetQrCode } from '../qr';
import { getTelecomPassSettings } from '../../services/wmsApi';
import { PageHeader } from '../../ui';
import type { ActivityItem, AppRole, Asset, CategoryItem, MaintenanceItem } from '../types';

function formatEuro(value: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);
}

function trimActivityAssetPrefix(detail: string, assetName: string): string {
  const escaped = assetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return detail.replace(new RegExp(`^${escaped}\\s+`, 'i'), '');
}

type AssetDetailPageProps = {
  activeRole: AppRole;
  // Rechte-gesteuerte Sichtbarkeit der Aktionsbuttons (Feature „Rollen & Rechte").
  // Default true → ältere Aufrufer/Backends verhalten sich wie bisher.
  canEditAsset?: boolean;
  canManageDefects?: boolean;
  canReportDefects?: boolean;
  asset: Asset | null;
  categories: CategoryItem[];
  activities: ActivityItem[];
  maintenanceItems: MaintenanceItem[];
  onReserveAsset: (assetId: string) => void;
  onCheckoutAsset: (assetId: string) => void;
  onCheckinAsset: (assetId: string) => void;
  onSetMaintenance: (assetId: string) => void;
  onSaveAsset: (assetId: string, patch: Partial<Asset>) => Promise<void>;
  onRefreshAssetImage?: (assetId: string) => Promise<Asset>;
  onCreateMaintenance: (payload: { assetName: string; issue: string; comment: string }) => void;
  onUpdateMaintenanceStatus: (id: string, status: MaintenanceItem['status']) => void;
  onOpenInventoryWithQuery: (query: string) => void;
};

export function AssetDetailPage({
  canEditAsset = true,
  canManageDefects = true,
  canReportDefects = true,
  asset,
  categories,
  activities,
  maintenanceItems,
  onReserveAsset,
  onCheckoutAsset,
  onCheckinAsset,
  onSetMaintenance,
  onSaveAsset,
  onRefreshAssetImage,
  onCreateMaintenance,
  onUpdateMaintenanceStatus,
  onOpenInventoryWithQuery,
}: AssetDetailPageProps) {
  const [editModalOpen, setEditModalOpen] = useState(false);
  const isLteRouter = (asset?.category ?? '').trim().toLowerCase() === 'lte-router';
  // Telekompass-Preis nur für LTE-Router laden (Kostenanzeige). null = nicht
  // verfügbar/geladen → dann nur die Buchungsanzahl zeigen.
  const [telecomUnitPrice, setTelecomUnitPrice] = useState<number | null>(null);
  useEffect(() => {
    if (!isLteRouter) return;
    let cancelled = false;
    void (async () => {
      try {
        const settings = await getTelecomPassSettings();
        if (!cancelled) setTelecomUnitPrice(settings.unitPrice || 0);
      } catch {
        if (!cancelled) setTelecomUnitPrice(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLteRouter]);

  if (!asset) {
    return (
      <section className="surface-card animate-fade-up">
        <PageHeader title="Asset-Detail" subtitle="Bitte ein Asset in der Inventaransicht auswählen, um Details zu sehen." />
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
  const categoryImageUrl = resolveCategoryDefaultImageUrl(asset.category, categories);

  return (
    <section className="space-y-5">
      <PageHeader
        kicker="Asset-Detailseite"
        title={asset.name}
        subtitle={`Inventarnummer ${asset.tagNumber} • Seriennummer ${asset.serialNumber}`}
        actions={
          <>
            <button className="btn-secondary w-full sm:w-auto" onClick={() => onReserveAsset(asset.id)}>
              Verleihen
            </button>
            <button className="btn-primary w-full sm:w-auto" onClick={() => onCheckoutAsset(asset.id)}>
              Ausgeben
            </button>
            <button className="btn-secondary w-full sm:w-auto" onClick={() => onCheckinAsset(asset.id)}>
              Zurücknehmen
            </button>
            {canManageDefects ? (
              <button className="btn-secondary w-full sm:w-auto" onClick={() => onSetMaintenance(asset.id)}>
                In Wartung setzen
              </button>
            ) : null}
            {canEditAsset ? (
              <button className="btn-secondary w-full sm:w-auto" onClick={() => setEditModalOpen(true)}>
                Bearbeiten
              </button>
            ) : null}
            {canReportDefects ? (
              <button
                className="btn-danger w-full sm:w-auto"
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
            ) : null}
          </>
        }
      />

      {(asset.availableForPlanning === false || (asset.category === 'Laptop' && asset.cardPrinterCompatible === false)) ? (
        <div className="flex flex-wrap items-center gap-2">
          {asset.availableForPlanning === false ? (
            <span className="inline-flex items-center rounded-full border border-white/10 bg-slate-500/10 px-2.5 py-1 text-xs font-semibold text-ink-muted">
              Nicht planbar
            </span>
          ) : null}
          {asset.category === 'Laptop' && asset.cardPrinterCompatible === false ? (
            <span className="inline-flex items-center rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-300">
              Nicht kartendrucker-kompatibel
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Status" value={asset.status} trend="Aktueller Gerätezustand" tone="positive" icon={ShieldCheck} />
        <KpiCard title="Standort" value={asset.location} trend="Aktueller Lager- oder Einsatzort" tone="neutral" icon={ClipboardList} />
        <KpiCard title="Reservierung" value={asset.nextReservation} trend="Nächste geplante Belegung" tone="neutral" icon={CalendarClock} />
        <KpiCard
          title="Offene Tickets"
          value={String(openMaintenanceCount)}
          trend="Defekt- oder Wartungsfälle"
          tone={openMaintenanceCount > 0 ? 'warning' : 'positive'}
          icon={Wrench}
        />
      </div>

      <article className="surface-card animate-fade-up">
        <div className="grid gap-4 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <div className="flex h-full flex-col rounded-2xl border border-line bg-surface-2 p-5">
              <AssetImage asset={asset} categoryImageUrl={categoryImageUrl} size="xl" className="mx-auto" />
              <h3 className="mt-5 text-center text-xl font-semibold text-ink">{asset.tagNumber}</h3>
              <p className="mt-1 text-center text-sm text-ink-muted">{asset.name}</p>
              <p className="text-center text-sm text-ink-faint">{asset.category}</p>
              <div className="mt-4 flex justify-center">
                <StatusBadge value={asset.status} />
              </div>
              <dl className="mt-6 space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-faint">Standort</dt>
                  <dd className="font-medium text-ink">{asset.location}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-faint">Zugewiesen an</dt>
                  <dd className="font-medium text-ink">{asset.assignedTo}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-faint">Nächste Rückgabe</dt>
                  <dd className="font-medium text-ink">{asset.nextReturn}</dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="space-y-4 lg:col-span-8">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-line bg-surface-2 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">Kategorie</p>
                <p className="mt-1 text-sm font-medium text-ink">{asset.category}</p>
              </div>
              <div className="rounded-2xl border border-line bg-surface-2 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">Inventarnummer</p>
                <p className="mt-1 text-sm font-medium text-ink">{asset.tagNumber}</p>
              </div>
              <div className="rounded-2xl border border-line bg-surface-2 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">Seriennummer</p>
                <p className="mt-1 text-sm font-medium text-ink">{asset.serialNumber}</p>
              </div>
              <div className="rounded-2xl border border-line bg-surface-2 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">Wartungsstatus</p>
                <p className="mt-1 text-sm font-medium text-ink">{asset.maintenanceState}</p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-line bg-surface p-4">
                <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
                  <ClipboardList className="h-3.5 w-3.5" />
                  Letzte Ausgabe
                </p>
                <p className="mt-2 text-sm font-medium text-ink">{asset.lastCheckout}</p>
              </div>
              <div className="rounded-2xl border border-line bg-surface p-4">
                <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
                  <CalendarClock className="h-3.5 w-3.5" />
                  Nächste Reservierung
                </p>
                <p className="mt-2 text-sm font-medium text-ink">{asset.nextReservation}</p>
              </div>
              <div className="rounded-2xl border border-line bg-surface p-4">
                <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Wartung
                </p>
                <p className="mt-2 text-sm font-medium text-ink">{asset.maintenanceState}</p>
              </div>
              <div className="rounded-2xl border border-line bg-surface p-4">
                <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
                  <Wrench className="h-3.5 w-3.5" />
                  Offene Tickets
                </p>
                <p className="mt-2 text-sm font-medium text-ink">{openMaintenanceCount}</p>
              </div>
            </div>

            <div className="rounded-2xl border border-line bg-surface p-4">
              <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
                <PenSquare className="h-3.5 w-3.5" />
                Notizen
              </p>
              <p className="mt-2 text-sm text-ink-muted">{asset.notes}</p>
            </div>

            <AssetQrCard qrValue={qrValue} assetName={asset.name} tagNumber={asset.tagNumber} />
          </div>
        </div>
      </article>

      {isLteRouter ? (
        <article className="surface-card animate-fade-up">
          <h3 className="inline-flex items-center gap-2 text-base font-semibold text-slate-900">
            <Signal className="h-4 w-4 text-brand-700" />
            Telekompass
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Telekompass gesamt
              </p>
              <p className="mt-1 text-sm font-medium text-slate-900">
                {asset.telecomPassBookingCountTotal ?? 0} Buchungen
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Aktueller Wert
              </p>
              <p className="mt-1 text-sm font-medium text-slate-900">
                {telecomUnitPrice !== null
                  ? formatEuro((asset.telecomPassBookingCountTotal ?? 0) * telecomUnitPrice)
                  : '—'}
              </p>
              {telecomUnitPrice !== null ? (
                <p className="mt-0.5 text-xs text-slate-500">
                  Basis: {formatEuro(telecomUnitPrice)} pro Buchung
                </p>
              ) : null}
            </div>
          </div>
        </article>
      ) : null}

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
            {canManageDefects ? (
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
                {canManageDefects ? (
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
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-sm font-medium text-slate-900">{item.title}</p>
                    <span className="inline-flex shrink-0 items-center rounded-md border border-brand-200 bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-800">
                      {asset.tagNumber}
                    </span>
                  </div>
                  <span className="text-xs text-slate-500">{item.timestamp}</span>
                </div>
                <p className="mt-1 text-xs text-slate-600">{trimActivityAssetPrefix(item.detail, asset.name)}</p>
              </div>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
              Noch keine Historie vorhanden.
            </div>
          )}
        </div>
        {/* Hinweis nur, wenn wirklich noch ein aktiver Defekt-/Wartungsfall
            offen ist — vorher stand er statisch unter jedem Asset. */}
        {openMaintenanceCount > 0 ? (
          <div className="mt-4 inline-flex items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-medium text-orange-700">
            <Wrench className="h-4 w-4" />
            Wartungsfreigabe erforderlich vor nächster Ausgabe ({openMaintenanceCount}{' '}
            {openMaintenanceCount === 1 ? 'offener Fall' : 'offene Fälle'})
          </div>
        ) : null}
      </article>

      {canEditAsset && editModalOpen ? (
        <AssetEditModal
          asset={asset}
          categories={categories}
          onClose={() => setEditModalOpen(false)}
          onSave={onSaveAsset}
          onRefreshImage={onRefreshAssetImage}
        />
      ) : null}
    </section>
  );
}

