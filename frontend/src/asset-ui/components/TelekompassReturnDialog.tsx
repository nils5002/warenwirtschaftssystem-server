import { Signal, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { LoadingButton } from '../../components/loading';

export type TelekompassEntry = { assetId: string; name: string };

type TelekompassReturnDialogProps = {
  entries: TelekompassEntry[];
  unitPrice: number;
  busy?: boolean;
  onCancel: () => void;
  // Liefert je LTE-Router die erfasste Anzahl (>= 0). Wird sowohl von
  // "Speichern und einlagern" als auch (mit 0en) von "Ohne Telekompass" genutzt.
  onConfirm: (counts: Record<string, number>) => void;
};

function formatPrice(value: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);
}

// Leeres Feld = 0; sonst auf nicht-negative Ganzzahl normalisieren.
function parseCount(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  const value = Math.floor(Number(trimmed.replace(',', '.')));
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}

export function TelekompassReturnDialog({
  entries,
  unitPrice,
  busy = false,
  onCancel,
  onConfirm,
}: TelekompassReturnDialogProps) {
  const [counts, setCounts] = useState<Record<string, string>>({});
  const single = entries.length === 1;

  const totalBookings = useMemo(
    () => entries.reduce((sum, entry) => sum + parseCount(counts[entry.assetId] ?? ''), 0),
    [entries, counts],
  );
  const totalCost = totalBookings * (unitPrice || 0);

  const buildCounts = (zero: boolean): Record<string, number> => {
    const result: Record<string, number> = {};
    for (const entry of entries) {
      result[entry.assetId] = zero ? 0 : parseCount(counts[entry.assetId] ?? '');
    }
    return result;
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-900/55 p-3 sm:items-center">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-panel dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">
              <Signal className="h-3.5 w-3.5" />
              Telekompass erfassen
            </p>
            <h3 className="mt-0.5 text-base font-semibold text-slate-900 dark:text-slate-50">
              Wie oft wurde der Telekompass gebucht?
            </h3>
          </div>
          <button
            type="button"
            aria-label="Abbrechen"
            className="btn-ghost h-9 w-9 shrink-0 p-0"
            onClick={onCancel}
            disabled={busy}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-sm text-slate-600 dark:text-slate-300">
          {single
            ? 'Bitte die Anzahl der Telekompass-Buchungen für diesen LTE-Router erfassen.'
            : 'Bitte die Anzahl der Telekompass-Buchungen je LTE-Router erfassen.'}
        </p>

        <div className="mt-3 space-y-2">
          {entries.map((entry) => (
            <label key={entry.assetId} className="block">
              {!single ? (
                <span className="mb-1 block truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                  {entry.name}
                </span>
              ) : null}
              <div className="flex items-center gap-2">
                <span className="sr-only">Anzahl Telekompass-Buchungen</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  className="field-input h-12 flex-1 text-base"
                  placeholder="Anzahl (z. B. 3)"
                  value={counts[entry.assetId] ?? ''}
                  disabled={busy}
                  onChange={(event) =>
                    setCounts((prev) => ({ ...prev, [entry.assetId]: event.target.value }))
                  }
                />
              </div>
            </label>
          ))}
        </div>

        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950/40">
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-500 dark:text-slate-400">Preis pro Buchung</span>
            <span className="font-medium text-slate-800 dark:text-slate-100">{formatPrice(unitPrice || 0)}</span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="text-slate-500 dark:text-slate-400">Kosten für diese Rückgabe</span>
            <span className="font-semibold text-slate-900 dark:text-slate-50">{formatPrice(totalCost)}</span>
          </div>
        </div>

        <div className="mt-4 grid gap-2">
          <LoadingButton
            className="btn-primary h-11 w-full justify-center"
            onClick={() => onConfirm(buildCounts(false))}
            isLoading={busy}
            loadingText="Wird gespeichert ..."
          >
            Speichern und einlagern
          </LoadingButton>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className="btn-secondary h-11"
              onClick={() => onConfirm(buildCounts(true))}
              disabled={busy}
            >
              Ohne Telekompass
            </button>
            <button type="button" className="btn-secondary h-11" onClick={onCancel} disabled={busy}>
              Abbrechen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
