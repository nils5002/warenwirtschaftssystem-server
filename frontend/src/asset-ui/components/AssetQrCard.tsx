import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Download, Printer, QrCode } from 'lucide-react';
import { printSingleLabel } from '../printLabels';

type AssetQrCardProps = {
  qrValue: string;
  assetName: string;
  tagNumber: string;
  compact?: boolean;
};

export function AssetQrCard({ qrValue, assetName, tagNumber, compact = false }: AssetQrCardProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  useEffect(() => {
    let cancelled = false;

    const createQr = async () => {
      try {
        const dataUrl = await QRCode.toDataURL(qrValue, {
          width: compact ? 140 : 220,
          margin: 1,
          color: {
            dark: '#0f172a',
            light: '#ffffff',
          },
        });
        if (!cancelled) {
          setQrDataUrl(dataUrl);
        }
      } catch {
        if (!cancelled) {
          setQrDataUrl('');
        }
      }
    };

    void createQr();
    return () => {
      cancelled = true;
    };
  }, [compact, qrValue]);

  const downloadPng = () => {
    if (!qrDataUrl) return;
    const link = document.createElement('a');
    link.href = qrDataUrl;
    link.download = `${tagNumber}-qr.png`;
    link.click();
  };

  const printQr = () => {
    if (!qrDataUrl) return;
    void printSingleLabel({ qrDataUrl, assetName, tagNumber });
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
        <QrCode className="h-3.5 w-3.5" />
        QR-Code
      </p>
      <div className="mt-2 flex items-center gap-3">
        {qrDataUrl ? (
          <img src={qrDataUrl} alt={`QR-Code für ${assetName}`} className="h-28 w-28 rounded-md border border-slate-200 bg-white p-1" />
        ) : (
          <div className="flex h-28 w-28 items-center justify-center rounded-md border border-dashed border-slate-300 text-xs text-slate-500">
            Fehler
          </div>
        )}
        <div className="min-w-0">
          <p className="text-xs text-slate-500">Für Labeldruck / Scanner</p>
          <p className="mt-1 truncate text-xs font-medium text-slate-800">{tagNumber}</p>
          {!compact ? (
            <p className="mt-1 max-w-[220px] break-all text-[11px] text-slate-500">{qrValue}</p>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
          onClick={downloadPng}
        >
          <Download className="h-3.5 w-3.5" />
          QR herunterladen
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
          onClick={printQr}
        >
          <Printer className="h-3.5 w-3.5" />
          QR drucken
        </button>
      </div>
    </div>
  );
}
