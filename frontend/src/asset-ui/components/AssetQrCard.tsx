import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Download, Printer, QrCode } from 'lucide-react';

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
    const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=500,height=650');
    if (!printWindow) return;
    const title = `QR ${tagNumber}`;
    printWindow.document.write(`
      <html>
        <head>
          <title>${title}</title>
          <style>
            body { font-family: Arial, sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
            .label { text-align:center; border:1px solid #d1d5db; border-radius:12px; padding:16px; }
            img { width:240px; height:240px; display:block; margin:0 auto 12px; }
            .name { font-size:14px; margin-bottom:6px; color:#111827; }
            .tag { font-size:13px; color:#334155; }
          </style>
        </head>
        <body>
          <div class="label">
            <img src="${qrDataUrl}" alt="QR" />
            <div class="name">${assetName}</div>
            <div class="tag">${tagNumber}</div>
          </div>
          <script>window.onload = () => window.print();</script>
        </body>
      </html>
    `);
    printWindow.document.close();
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
