import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

type AssetQrCodePreviewProps = {
  qrValue: string;
  assetName: string;
  size?: number;
};

// Modul-Cache: identische QR-Payloads werden nur einmal gerendert. Beim erneuten
// Hover desselben Assets liegt das Data-URL sofort vor (kein erneutes Generieren).
const qrCache = new Map<string, string>();

/**
 * Schlanke, wiederverwendbare QR-Bildkomponente (nur das <img>, ohne
 * Download/Print). Erzeugt das QR-Data-URL clientseitig aus dem bereits
 * vorhandenen Payload — kein neuer Datensatz, kein Backend-Request.
 */
export function AssetQrCodePreview({ qrValue, assetName, size = 132 }: AssetQrCodePreviewProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string>(() => qrCache.get(qrValue) ?? '');

  useEffect(() => {
    const cached = qrCache.get(qrValue);
    if (cached) {
      setQrDataUrl(cached);
      return;
    }

    let cancelled = false;
    const createQr = async () => {
      try {
        const dataUrl = await QRCode.toDataURL(qrValue, {
          width: size,
          margin: 1,
          color: {
            dark: '#0f172a',
            light: '#ffffff',
          },
        });
        qrCache.set(qrValue, dataUrl);
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
  }, [qrValue, size]);

  // QR immer auf weißer Kachel rendern (Scanbarkeit), unabhängig vom Theme.
  return qrDataUrl ? (
    <img
      src={qrDataUrl}
      alt={`QR-Code für ${assetName}`}
      width={size}
      height={size}
      className="rounded-md border border-slate-200 bg-white p-1"
    />
  ) : (
    <div
      className="flex items-center justify-center rounded-md border border-dashed border-slate-300 bg-white text-xs text-slate-500"
      style={{ width: size, height: size }}
    >
      …
    </div>
  );
}
