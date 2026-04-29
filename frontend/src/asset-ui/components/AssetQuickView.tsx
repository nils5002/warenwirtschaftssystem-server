import { CalendarClock, ClipboardCheck, Wrench, X } from 'lucide-react';
import { getAssetQrCode } from '../qr';
import { AssetQrCard } from './AssetQrCard';
import { StatusBadge } from './StatusBadge';
import type { Asset } from '../types';

type AssetQuickViewProps = {
  asset: Asset | null;
  onClose: () => void;
  onOpenDetail: (assetId: string) => void;
  onReserve: (assetId: string) => void;
  onCheckout: (assetId: string) => void;
};

export function AssetQuickView({ asset, onClose, onOpenDetail, onReserve, onCheckout }: AssetQuickViewProps) {
  if (!asset) return null;
  const qrValue = getAssetQrCode(asset);

  return (
    <div className="fixed inset-0 z-40">
      <button type="button" className="h-full w-full bg-slate-900/35" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full max-w-md overflow-y-auto border-l border-slate-200 bg-white p-5 shadow-panel">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-700">Asset Quick View</p>
            <h3 className="mt-1 text-lg font-semibold text-slate-900">{asset.name}</h3>
          </div>
          <button
            type="button"
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4">
          <StatusBadge value={asset.status} />
        </div>

        <dl className="mt-4 space-y-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Inventarnummer</dt>
            <dd className="font-medium text-slate-900">{asset.tagNumber}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Kategorie</dt>
            <dd className="font-medium text-slate-900">{asset.category}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Standort</dt>
            <dd className="font-medium text-slate-900">{asset.location}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Seriennummer</dt>
            <dd className="font-medium text-slate-900">{asset.serialNumber}</dd>
          </div>
        </dl>

        <div className="mt-6 grid gap-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              <ClipboardCheck className="h-3.5 w-3.5" />
              Letzte Ausgabe
            </p>
            <p className="mt-2 text-sm font-medium text-slate-900">{asset.lastCheckout}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              <CalendarClock className="h-3.5 w-3.5" />
              Nächste Reservierung
            </p>
            <p className="mt-2 text-sm font-medium text-slate-900">{asset.nextReservation}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              <Wrench className="h-3.5 w-3.5" />
              Wartungsstatus
            </p>
            <p className="mt-2 text-sm font-medium text-slate-900">{asset.maintenanceState}</p>
          </div>

          <AssetQrCard
            qrValue={qrValue}
            assetName={asset.name}
            tagNumber={asset.tagNumber}
            compact
          />
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
            onClick={() => onReserve(asset.id)}
          >
            Reservieren
          </button>
          <button
            type="button"
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
            onClick={() => onCheckout(asset.id)}
          >
            Ausgeben
          </button>
          <button
            type="button"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            onClick={() => onOpenDetail(asset.id)}
          >
            Vollansicht
          </button>
        </div>
      </aside>
    </div>
  );
}

