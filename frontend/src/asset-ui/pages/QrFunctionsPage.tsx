import { Camera, ScanLine } from 'lucide-react';
import { useMemo, useState } from 'react';
import { QrScannerDialog } from '../components/QrScannerDialog';
import { StatusBadge } from '../components/StatusBadge';
import { resolveAssetByScan } from '../qr';
import { useAppDialog } from '../../components/dialogs/AppDialogProvider';
import type { Asset } from '../types';

type QrFunctionsPageProps = {
  assets: Asset[];
  onOpenAssetDetail: (assetId: string) => void;
  onCheckoutAsset: (assetId: string) => void;
  onCheckinAsset: (assetId: string) => void;
  onReportIssue: (assetName: string) => void;
};

export function QrFunctionsPage({
  assets,
  onOpenAssetDetail,
  onCheckoutAsset,
  onCheckinAsset,
  onReportIssue,
}: QrFunctionsPageProps) {
  const { alert } = useAppDialog();
  const [scanInput, setScanInput] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [lastScan, setLastScan] = useState('');

  const resolved = useMemo(() => resolveAssetByScan(lastScan || scanInput, assets), [assets, lastScan, scanInput]);

  const detectScan = async () => {
    const match = resolveAssetByScan(scanInput, assets);
    if (!match) {
      await alert({
        title: 'Keine Übereinstimmung',
        message: 'Kein passendes Asset zum Scan gefunden.',
      });
      return;
    }
    setLastScan(scanInput);
  };

  return (
    <section className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-700">QR-Code-Funktionen</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">Scan & Schnellaktionen</h2>
        <p className="mt-1 text-sm text-slate-500">
          QR-Code scannen und direkt ausleihen, zurückgeben oder Defekt melden.
        </p>
      </div>

      <article className="surface-card animate-fade-up">
        <label className="field">
          QR-Scanwert oder Inventarnummer
          <div className="flex gap-2">
            <input
              className="field-input"
              value={scanInput}
              onChange={(event) => setScanInput(event.target.value)}
              placeholder="z. B. WMS|asset-...|IMP-... oder Seriennummer"
            />
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700 hover:bg-slate-100"
              onClick={() => {
                void detectScan();
              }}
            >
              <ScanLine className="h-3.5 w-3.5" />
              Erkennen
            </button>
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700 hover:bg-slate-100"
              onClick={() => setScannerOpen(true)}
            >
              <Camera className="h-3.5 w-3.5" />
              Kamera
            </button>
          </div>
        </label>
      </article>

      <article className="surface-card animate-fade-up">
        <h3 className="text-base font-semibold text-slate-900">Gefundenes Gerät</h3>
        {resolved ? (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-lg font-semibold text-slate-900">{resolved.name}</p>
                <p className="text-sm text-slate-600">
                  {resolved.category} · {resolved.location}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Inventarnummer {resolved.tagNumber} · Seriennummer {resolved.serialNumber}
                </p>
              </div>
              <StatusBadge value={resolved.status} />
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-4">
              <button
                type="button"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                onClick={() => onOpenAssetDetail(resolved.id)}
              >
                Gerät öffnen
              </button>
              <button
                type="button"
                className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
                onClick={() => onCheckoutAsset(resolved.id)}
              >
                Ausleihen
              </button>
              <button
                type="button"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                onClick={() => onCheckinAsset(resolved.id)}
              >
                Zurückgeben
              </button>
              <button
                type="button"
                className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100"
                onClick={() => onReportIssue(resolved.name)}
              >
                Defekt melden
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-8 text-center text-sm text-slate-500">
            Noch kein passendes Gerät erkannt.
          </div>
        )}
      </article>
      {scannerOpen ? (
        <QrScannerDialog
          title="QR-Code scannen"
          onDetected={(value) => {
            setScanInput(value);
            setLastScan(value);
            setScannerOpen(false);
          }}
          onClose={() => setScannerOpen(false)}
        />
      ) : null}
    </section>
  );
}
