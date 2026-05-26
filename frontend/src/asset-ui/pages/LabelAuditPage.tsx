import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  CircleAlert,
  CircleSlash,
  Copy,
  Download,
  ListChecks,
  RotateCcw,
  ScanLine,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { QrScannerDialog } from '../components/QrScannerDialog';
import { resolveAssetByScan } from '../qr';
import { useAppDialog } from '../../components/dialogs/AppDialogProvider';
import type { Asset } from '../types';

type LabelAuditPageProps = {
  assets: Asset[];
};

// Reines Lese-/Prüftool: keine API-Mutationen, keine Statusänderungen.
// Die komplette Prüfrunde lebt ausschließlich im localStorage des Browsers.
const LABEL_AUDIT_STORAGE_KEY = 'wms.labelAudit.session.v1';

// Obergrenze für das "Zuletzt gescannt"-Protokoll. Counts werden separat
// gehalten, damit Summen auch nach dem Abschneiden des Feeds stimmen.
const RECENT_LIMIT = 60;

type ScanKind = 'match' | 'duplicate' | 'unknown';

type ScanEvent = {
  id: string;
  raw: string;
  at: string;
  kind: ScanKind;
  assetId?: string;
};

type AuditSession = {
  // Asset-IDs in Reihenfolge der ERSTEN Erfassung (unique).
  checkedAssetIds: string[];
  // Wie oft wurde ein bereits geprüftes Asset erneut gescannt.
  duplicateScanCount: number;
  // Wie oft wurde ein QR-Code gescannt, der zu keinem Asset passt.
  unknownScanCount: number;
  // Neueste-zuerst-Protokoll der letzten Scans (gekappt auf RECENT_LIMIT).
  recent: ScanEvent[];
};

const EMPTY_SESSION: AuditSession = {
  checkedAssetIds: [],
  duplicateScanCount: 0,
  unknownScanCount: 0,
  recent: [],
};

function toScanKind(value: unknown): ScanKind {
  return value === 'match' || value === 'duplicate' ? value : 'unknown';
}

function sanitizeSession(value: unknown): AuditSession {
  const raw = typeof value === 'object' && value ? (value as Record<string, unknown>) : {};
  const checkedAssetIds = Array.isArray(raw.checkedAssetIds)
    ? Array.from(new Set(raw.checkedAssetIds.filter((entry): entry is string => typeof entry === 'string')))
    : [];
  const recent = Array.isArray(raw.recent)
    ? raw.recent
        .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
        .map((entry) => ({
          id: typeof entry.id === 'string' ? entry.id : `${Date.now()}-${Math.random()}`,
          raw: typeof entry.raw === 'string' ? entry.raw : '',
          at: typeof entry.at === 'string' ? entry.at : new Date().toISOString(),
          kind: toScanKind(entry.kind),
          assetId: typeof entry.assetId === 'string' ? entry.assetId : undefined,
        }))
        .slice(0, RECENT_LIMIT)
    : [];
  const toCount = (input: unknown): number =>
    typeof input === 'number' && Number.isFinite(input) && input >= 0 ? Math.floor(input) : 0;
  return {
    checkedAssetIds,
    duplicateScanCount: toCount(raw.duplicateScanCount),
    unknownScanCount: toCount(raw.unknownScanCount),
    recent,
  };
}

function loadStoredSession(): AuditSession {
  if (typeof window === 'undefined') return EMPTY_SESSION;
  try {
    const raw = window.localStorage.getItem(LABEL_AUDIT_STORAGE_KEY);
    if (!raw) return EMPTY_SESSION;
    return sanitizeSession(JSON.parse(raw));
  } catch {
    return EMPTY_SESSION;
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '';
  }
}

// CSV-sicher quoten (Excel/DE): doppelte Anführungszeichen escapen, Wert umschließen.
function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function LabelAuditPage({ assets }: LabelAuditPageProps) {
  const { confirm } = useAppDialog();
  const [session, setSession] = useState<AuditSession>(() => loadStoredSession());
  const [scanInput, setScanInput] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  // Ergebnis des letzten Scans für das große farbige Banner.
  const [lastResult, setLastResult] = useState<ScanEvent | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Persistenz: jede Änderung der Prüfrunde lokal speichern.
  useEffect(() => {
    try {
      window.localStorage.setItem(LABEL_AUDIT_STORAGE_KEY, JSON.stringify(session));
    } catch {
      // Ignorieren: Prüfung bleibt funktionsfähig, auch wenn localStorage blockiert ist.
    }
  }, [session]);

  // Auto-Fokus auf das Scanfeld beim Laden (Hardware-Scanner tippen direkt hinein).
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const assetById = useMemo(() => {
    const map = new Map<string, Asset>();
    for (const asset of assets) map.set(asset.id, asset);
    return map;
  }, [assets]);

  // Nur geprüfte IDs zählen, die es im aktuellen Bestand noch gibt.
  const checkedExistingIds = useMemo(
    () => session.checkedAssetIds.filter((id) => assetById.has(id)),
    [assetById, session.checkedAssetIds],
  );

  const checkedSet = useMemo(() => new Set(checkedExistingIds), [checkedExistingIds]);

  const openAssets = useMemo(
    () => assets.filter((asset) => !checkedSet.has(asset.id)),
    [assets, checkedSet],
  );

  const summary = useMemo(
    () => ({
      total: assets.length,
      checked: checkedExistingIds.length,
      open: Math.max(0, assets.length - checkedExistingIds.length),
      duplicates: session.duplicateScanCount,
      unknown: session.unknownScanCount,
    }),
    [assets.length, checkedExistingIds.length, session.duplicateScanCount, session.unknownScanCount],
  );

  const refocus = () => {
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const registerScan = (rawValue: string) => {
    const raw = rawValue.trim();
    if (!raw) return;

    const match = resolveAssetByScan(raw, assets);
    const event: ScanEvent = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      raw,
      at: new Date().toISOString(),
      kind: 'unknown',
    };

    setSession((current) => {
      const next: AuditSession = {
        checkedAssetIds: [...current.checkedAssetIds],
        duplicateScanCount: current.duplicateScanCount,
        unknownScanCount: current.unknownScanCount,
        recent: current.recent,
      };

      if (match) {
        event.assetId = match.id;
        if (next.checkedAssetIds.includes(match.id)) {
          event.kind = 'duplicate';
          next.duplicateScanCount += 1;
        } else {
          event.kind = 'match';
          next.checkedAssetIds = [...next.checkedAssetIds, match.id];
        }
      } else {
        event.kind = 'unknown';
        next.unknownScanCount += 1;
      }

      next.recent = [event, ...current.recent].slice(0, RECENT_LIMIT);
      return next;
    });

    setLastResult(event);
    setScanInput('');
    refocus();
  };

  const handleSubmit = (eventArg: FormEvent) => {
    eventArg.preventDefault();
    registerScan(scanInput);
  };

  const resetSession = async () => {
    const confirmed = await confirm({
      title: 'Prüfrunde zurücksetzen?',
      message:
        'Alle erfassten Scans dieser Prüfrunde werden gelöscht. Hardwaredaten bleiben unverändert. Fortfahren?',
      confirmLabel: 'Zurücksetzen',
      cancelLabel: 'Abbrechen',
      tone: 'danger',
    });
    if (!confirmed) return;
    setSession(EMPTY_SESSION);
    setLastResult(null);
    refocus();
  };

  const exportCsv = () => {
    const checkedAtById = new Map<string, string>();
    for (const entry of session.recent) {
      if (entry.kind === 'match' && entry.assetId && !checkedAtById.has(entry.assetId)) {
        checkedAtById.set(entry.assetId, entry.at);
      }
    }

    const header = ['Asset-ID', 'Name', 'Kategorie', 'Seriennummer', 'Inventarnummer', 'Geprüft', 'Geprüft am'];
    const rows = assets.map((asset) => [
      asset.id,
      asset.name,
      asset.category,
      asset.serialNumber,
      asset.tagNumber,
      checkedSet.has(asset.id) ? 'ja' : 'nein',
      checkedAtById.get(asset.id) ?? '',
    ]);

    const csv = [header, ...rows].map((line) => line.map(csvCell).join(';')).join('\r\n');
    // BOM voranstellen, damit Excel die Umlaute korrekt erkennt.
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `label-pruefung-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const lastResultAsset = lastResult?.assetId ? assetById.get(lastResult.assetId) ?? null : null;

  return (
    <section className="space-y-4 sm:space-y-5">
      <div>
        <p className="page-kicker">Admin</p>
        <h2 className="page-title">Label-Prüfung</h2>
        <p className="page-subtitle">
          QR-Labels nach dem Bekleben einscannen und prüfen — reines Lesetool, ändert keine Hardwaredaten. Die
          Prüfrunde wird nur lokal in diesem Browser gespeichert.
        </p>
      </div>

      {/* Zusammenfassung */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
        <SummaryCard label="Assets gesamt" value={summary.total} icon={<ListChecks className="h-4 w-4" />} />
        <SummaryCard
          label="Geprüft"
          value={summary.checked}
          icon={<CheckCircle2 className="h-4 w-4" />}
          tone="emerald"
        />
        <SummaryCard label="Offen" value={summary.open} icon={<CircleSlash className="h-4 w-4" />} tone="slate" />
        <SummaryCard
          label="Doppelte Scans"
          value={summary.duplicates}
          icon={<Copy className="h-4 w-4" />}
          tone="amber"
        />
        <SummaryCard
          label="Unbekannte Scans"
          value={summary.unknown}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone="rose"
        />
      </div>

      {/* Scan-Eingabe */}
      <article className="surface-card animate-fade-up space-y-3">
        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="field">
            QR-Code scannen oder Inventarnummer eingeben
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                ref={inputRef}
                className="field-input h-12 flex-1 text-lg"
                value={scanInput}
                onChange={(event) => setScanInput(event.target.value)}
                placeholder="QR-Code scannen … (z. B. WMS|asset-…|IMP-… oder Seriennummer)"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="done"
              />
              <div className="flex gap-2">
                <button type="submit" className="btn-primary h-12 flex-1 sm:flex-none">
                  <ScanLine className="h-4 w-4" />
                  Prüfen
                </button>
                <button
                  type="button"
                  className="btn-secondary h-12 flex-1 sm:flex-none"
                  onClick={() => setScannerOpen(true)}
                >
                  <Camera className="h-4 w-4" />
                  Kamera
                </button>
              </div>
            </div>
          </label>
        </form>

        {/* Letztes Ergebnis als großes farbiges Banner */}
        {lastResult ? <ScanResultBanner result={lastResult} asset={lastResultAsset} /> : null}

        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <button
            type="button"
            className="btn-secondary min-h-11 justify-center text-xs"
            onClick={() => void resetSession()}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Prüfrunde zurücksetzen
          </button>
          <button
            type="button"
            className="btn-secondary min-h-11 justify-center text-xs"
            onClick={exportCsv}
            disabled={!assets.length}
          >
            <Download className="h-3.5 w-3.5" />
            Als CSV exportieren
          </button>
        </div>
      </article>

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
        {/* Zuletzt gescannt */}
        <article className="surface-card animate-fade-up">
          <h3 className="text-base font-semibold text-slate-900">Zuletzt gescannt</h3>
          <p className="mt-1 text-xs text-slate-500">Neueste Scans dieser Prüfrunde (max. {RECENT_LIMIT}).</p>
          <div className="soft-scrollbar mt-3 max-h-[42vh] space-y-2 overflow-y-auto pr-1 sm:max-h-[50vh]">
            {session.recent.length ? (
              session.recent.map((entry) => (
                <RecentRow key={entry.id} entry={entry} asset={entry.assetId ? assetById.get(entry.assetId) ?? null : null} />
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-8 text-center text-sm text-slate-500">
                Noch keine Scans erfasst.
              </div>
            )}
          </div>
        </article>

        {/* Noch nicht geprüft */}
        <article className="surface-card animate-fade-up">
          <h3 className="text-base font-semibold text-slate-900">Noch nicht geprüft ({openAssets.length})</h3>
          <p className="mt-1 text-xs text-slate-500">Assets, deren Label in dieser Runde noch nicht gescannt wurde.</p>
          <div className="soft-scrollbar mt-3 max-h-[42vh] space-y-2 overflow-y-auto pr-1 sm:max-h-[50vh]">
            {openAssets.length ? (
              openAssets.map((asset) => (
                <div key={asset.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                  <p className="truncate text-sm font-semibold text-slate-900">{asset.name}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {asset.category} · SN: {asset.serialNumber || '—'} · Inv: {asset.tagNumber || '—'}
                  </p>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-emerald-300 bg-emerald-50 px-3 py-8 text-center text-sm text-emerald-700">
                {assets.length ? 'Alle Assets wurden geprüft. 🎉' : 'Keine Assets vorhanden.'}
              </div>
            )}
          </div>
        </article>
      </div>

      {scannerOpen ? (
        <QrScannerDialog
          title="QR-Label scannen"
          onDetected={(value) => {
            setScannerOpen(false);
            registerScan(value);
          }}
          onClose={() => {
            setScannerOpen(false);
            refocus();
          }}
        />
      ) : null}
    </section>
  );
}

type SummaryTone = 'brand' | 'emerald' | 'amber' | 'rose' | 'slate';

const SUMMARY_TONES: Record<SummaryTone, string> = {
  brand: 'border-brand-200 bg-brand-50 text-brand-700',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  amber: 'border-amber-200 bg-amber-50 text-amber-700',
  rose: 'border-rose-200 bg-rose-50 text-rose-700',
  slate: 'border-slate-200 bg-slate-50 text-slate-700',
};

function SummaryCard({
  label,
  value,
  icon,
  tone = 'brand',
}: {
  label: string;
  value: number;
  icon: ReactNode;
  tone?: SummaryTone;
}) {
  return (
    <div className={`rounded-xl border px-2.5 py-2 sm:px-3 sm:py-3 ${SUMMARY_TONES[tone]}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-medium opacity-80 sm:text-xs">
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <p className="mt-0.5 text-xl font-bold tabular-nums sm:mt-1 sm:text-2xl">{value}</p>
    </div>
  );
}

function ScanResultBanner({ result, asset }: { result: ScanEvent; asset: Asset | null }) {
  if (result.kind === 'unknown') {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-rose-800">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="min-w-0">
          <p className="font-semibold">Unbekannter QR-Code</p>
          <p className="mt-0.5 break-all text-sm text-rose-700">
            Kein Asset gefunden für: <span className="font-mono">{result.raw}</span>
          </p>
        </div>
      </div>
    );
  }

  const isDuplicate = result.kind === 'duplicate';
  const tone = isDuplicate
    ? 'border-amber-200 bg-amber-50 text-amber-800'
    : 'border-emerald-200 bg-emerald-50 text-emerald-800';

  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${tone}`}>
      {isDuplicate ? (
        <Copy className="mt-0.5 h-5 w-5 shrink-0" />
      ) : (
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
      )}
      <div className="min-w-0">
        <p className="font-semibold">{isDuplicate ? 'Bereits geprüft (doppelter Scan)' : 'Geprüft ✓'}</p>
        {asset ? (
          <>
            <p className="mt-0.5 truncate text-base font-semibold">{asset.name}</p>
            <p className="mt-0.5 text-sm opacity-90">
              {asset.category} · SN: {asset.serialNumber || '—'} · Inv: {asset.tagNumber || '—'} · ID: {asset.id}
            </p>
          </>
        ) : (
          <p className="mt-0.5 text-sm opacity-90">Asset nicht mehr im aktuellen Bestand vorhanden.</p>
        )}
      </div>
    </div>
  );
}

function RecentRow({ entry, asset }: { entry: ScanEvent; asset: Asset | null }) {
  const config: Record<ScanKind, { wrap: string; icon: ReactNode; label: string }> = {
    match: {
      wrap: 'border-emerald-200 bg-emerald-50',
      icon: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
      label: 'Geprüft',
    },
    duplicate: {
      wrap: 'border-amber-200 bg-amber-50',
      icon: <Copy className="h-4 w-4 text-amber-600" />,
      label: 'Doppelt',
    },
    unknown: {
      wrap: 'border-rose-200 bg-rose-50',
      icon: <CircleAlert className="h-4 w-4 text-rose-600" />,
      label: 'Unbekannt',
    },
  };
  const item = config[entry.kind];

  return (
    <div className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 ${item.wrap}`}>
      <span className="mt-0.5 shrink-0">{item.icon}</span>
      <div className="min-w-0 flex-1">
        {asset ? (
          <p className="truncate text-sm font-semibold text-slate-900">{asset.name}</p>
        ) : (
          <p className="truncate break-all font-mono text-sm text-slate-700">{entry.raw}</p>
        )}
        <p className="mt-0.5 truncate text-xs text-slate-500">
          {asset ? `${asset.category} · SN: ${asset.serialNumber || '—'} · Inv: ${asset.tagNumber || '—'}` : 'Kein passendes Asset'}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <span className="block text-xs font-semibold text-slate-600">{item.label}</span>
        <span className="block text-[11px] text-slate-400">{formatTime(entry.at)}</span>
      </div>
    </div>
  );
}
