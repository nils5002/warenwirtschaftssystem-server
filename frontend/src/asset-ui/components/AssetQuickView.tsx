import { useEffect } from 'react';
import { CalendarClock, ClipboardCheck, MapPin, UserRound, Wrench, X } from 'lucide-react';
import { getAssetQrCode } from '../qr';
import { AssetQrCard } from './AssetQrCard';
import { StatusBadge } from './StatusBadge';
import { AssetImage } from './AssetImage';
import type { Asset } from '../types';

type AssetQuickViewProps = {
  asset: Asset | null;
  categoryImageUrl?: string | null;
  onClose?: () => void;
  onOpenDetail: (assetId: string) => void;
  onReserve: (assetId: string) => void;
  onCheckout: (assetId: string) => void;
};

/**
 * Detail-Drawer: schiebt sich von rechts über die Inventar-Tabelle, sobald
 * ein Asset ausgewählt ist. Schließt per X-Button, Escape oder Klick auf den
 * dezent abgedunkelten Hintergrund.
 */
export function AssetQuickView({
  asset,
  categoryImageUrl,
  onClose,
  onOpenDetail,
  onReserve,
  onCheckout,
}: AssetQuickViewProps) {
  // Escape schließt den Drawer. Das Kontextmenü fängt Escape in der
  // Capture-Phase mit stopPropagation ab — ist es offen, schließt Escape
  // zuerst das Menü und erst der nächste Druck den Drawer.
  useEffect(() => {
    if (!asset || !onClose) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [asset, onClose]);

  if (!asset) return null;
  const qrValue = getAssetQrCode(asset);

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        aria-label="Detailansicht schließen"
        className="animate-overlay-fade h-full w-full bg-slate-950/40 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Details zu ${asset.name}`}
        className="animate-drawer-in absolute right-0 top-0 h-full w-[92%] max-w-[480px] overflow-y-auto border-l border-line bg-canvas p-5 shadow-panel"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <AssetImage asset={asset} categoryImageUrl={categoryImageUrl} size="lg" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-xl font-semibold text-ink">{asset.tagNumber}</h3>
                  <StatusBadge value={asset.status} />
                </div>
                <p className="mt-2 text-sm text-ink-muted">{asset.name}</p>
                <p className="text-sm text-ink-faint">{asset.model || asset.category}</p>
              </div>
            </div>
          </div>
          {onClose ? (
            <button
              type="button"
              aria-label="Schließen"
              className="rounded-xl p-2 text-ink-faint transition hover:bg-surface-2 hover:text-ink"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <div className="mt-6 grid gap-3">
          <div className="rounded-2xl border border-line bg-surface-2 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">Stammdaten</p>
            <dl className="mt-3 space-y-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <dt className="text-ink-muted">Inventarnummer</dt>
                <dd className="text-right font-medium text-ink">{asset.tagNumber}</dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="text-ink-muted">Seriennummer</dt>
                <dd className="break-all text-right font-medium text-ink">{asset.serialNumber}</dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="text-ink-muted">Kategorie</dt>
                <dd className="text-right font-medium text-ink">{asset.category}</dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="text-ink-muted">Status</dt>
                <dd className="text-right font-medium text-ink">{asset.maintenanceState}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-2xl border border-line bg-surface-2 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">Standort</p>
            <div className="mt-3 flex items-start gap-3">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />
              <div>
                <p className="text-sm font-medium text-ink">{asset.location}</p>
                <p className="text-xs text-ink-muted">Letzter Scan: {asset.lastCheckout || '—'}</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-surface-2 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">Verfügbarkeit</p>
            <div className="mt-3 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-ink-muted">Aktuell</span>
                <StatusBadge value={asset.status} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-ink-muted">Nächste Reservierung</span>
                <span className="font-medium text-ink">{asset.nextReservation}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-ink-muted">Wartung</span>
                <span className="font-medium text-ink">{asset.maintenanceState}</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-surface-2 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">Zugewiesen / Projekt</p>
            <div className="mt-3 flex items-start gap-3">
              <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />
              <div>
                <p className="text-sm font-medium text-ink">{asset.assignedTo}</p>
                <p className="text-xs text-ink-muted">Rückgabe: {asset.nextReturn}</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-surface-2 p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                  <ClipboardCheck className="h-3.5 w-3.5" />
                  Letzte Ausgabe
                </p>
                <p className="mt-2 text-sm font-medium text-ink">{asset.lastCheckout}</p>
              </div>
              <div>
                <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                  <CalendarClock className="h-3.5 w-3.5" />
                  Reservierung
                </p>
                <p className="mt-2 text-sm font-medium text-ink">{asset.nextReservation}</p>
              </div>
              <div>
                <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                  <Wrench className="h-3.5 w-3.5" />
                  Wartung
                </p>
                <p className="mt-2 text-sm font-medium text-ink">{asset.maintenanceState}</p>
              </div>
            </div>
          </div>

          <AssetQrCard qrValue={qrValue} assetName={asset.name} tagNumber={asset.tagNumber} compact />
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <button type="button" className="btn-secondary flex-1" onClick={() => onOpenDetail(asset.id)}>
            Gerät bearbeiten
          </button>
          <button type="button" className="btn-primary" onClick={() => onCheckout(asset.id)}>
            Ausgeben
          </button>
          <button type="button" className="btn-secondary" onClick={() => onReserve(asset.id)}>
            Reservieren
          </button>
        </div>
      </aside>
    </div>
  );
}
