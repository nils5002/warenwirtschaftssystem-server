import { AlertTriangle, ArrowRight, CalendarDays, CircleCheck } from 'lucide-react';

import type { CapacityRow } from '../../../pages/planningCockpit';
import { formatGermanDateShort } from '../../../pages/planningCockpit';

export type OverlapRow = {
  id: string;
  customerName: string;
  projectName: string;
  startDate: string;
  endDate: string;
  // "bindet 4× Laptop, 6× QR-Code-Scanner" — leer solange Details noch laden.
  boundLabel: string;
};

type ConflictsTabProps = {
  rows: CapacityRow[];
  conflictCount: number;
  overlaps: OverlapRow[];
  canEdit: boolean;
  onOpenHardware: () => void;
  onOpenExternalPool: () => void;
  onOpenPlanning: (planningId: string) => void;
};

const STATE_PILLS: Record<CapacityRow['state'], { className: string; label: string }> = {
  gedeckt: {
    className:
      'border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300',
    label: 'Gedeckt',
  },
  knapp: {
    className:
      'border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300',
    label: 'Knapp',
  },
  konflikt: {
    className:
      'border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300',
    label: 'Konflikt',
  },
  unbekannt: {
    className: 'border-line bg-surface-2 text-ink-muted',
    label: 'Ungeprüft',
  },
};

function rangeLabel(start: string, end: string): string {
  if (start === end) return formatGermanDateShort(start);
  const [, sm, sd] = start.split('-');
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  if (sameMonth && sd && sm) {
    return `${sd}.–${formatGermanDateShort(end)}`;
  }
  return `${formatGermanDateShort(start)} – ${formatGermanDateShort(end)}`;
}

// Tab „Konflikte": macht die Verfügbarkeitsrechnung transparent — Bedarf,
// freier Bestand, Puffer und Status je Kategorie plus die parallelen
// Planungen, die Bestand binden.
export function ConflictsTab({
  rows,
  conflictCount,
  overlaps,
  canEdit,
  onOpenHardware,
  onOpenExternalPool,
  onOpenPlanning,
}: ConflictsTabProps) {
  return (
    <div className="space-y-3">
      {conflictCount > 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {conflictCount === 1 ? '1 Konflikt' : `${conflictCount} Konflikte`} im Zeitraum
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
          <CircleCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
          Keine Konflikte – der Bedarf ist im gesamten Zeitraum gedeckt.
        </div>
      )}

      {/* Mobile (< md): Kartenliste — die breite Tabelle darf auf schmalen
          Viewports keine Box bilden, sonst weiten mobile Browser (v. a. iOS
          Safari) den Layout-Viewport auf und die Seite zoomt raus, auch
          innerhalb von overflow-x-auto (siehe HardwareTab). */}
      <div className="space-y-2 md:hidden">
        {rows.map((row) => {
          const pill = STATE_PILLS[row.state];
          return (
            <div
              key={row.categoryKey}
              className={`rounded-xl border border-line p-3 ${
                row.state === 'knapp' ? 'bg-amber-500/5' : row.state === 'konflikt' ? 'bg-rose-500/5' : 'bg-surface-2'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{row.categoryKey}</p>
                <span
                  className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${pill.className}`}
                >
                  {row.state === 'konflikt' && row.buffer !== null ? `Fehlen ${Math.abs(row.buffer)}` : pill.label}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-ink-muted">
                Bedarf <span className="font-semibold tabular-nums text-ink">{row.demand}</span>
                {' · '}Frei im Zeitraum <span className="tabular-nums text-ink">{row.free ?? '–'}</span>
                {' · '}Puffer{' '}
                <span
                  className={`font-semibold tabular-nums ${
                    row.buffer === null
                      ? 'text-ink-faint'
                      : row.buffer < 0
                        ? 'text-rose-600 dark:text-rose-300'
                        : row.buffer <= 1
                          ? 'text-amber-600 dark:text-amber-300'
                          : 'text-emerald-600 dark:text-emerald-300'
                  }`}
                >
                  {row.buffer === null ? '–' : row.buffer >= 0 ? `+${row.buffer}` : row.buffer}
                </span>
              </p>
              {row.state === 'konflikt' && canEdit ? (
                <div className="mt-1.5 flex flex-wrap gap-x-4">
                  <button
                    type="button"
                    className="py-1.5 text-xs font-medium text-[#00b9e1] underline-offset-2 hover:underline"
                    onClick={onOpenExternalPool}
                  >
                    Fremdbestand anfragen
                  </button>
                  <button
                    type="button"
                    className="py-1.5 text-xs font-medium text-[#00b9e1] underline-offset-2 hover:underline"
                    onClick={onOpenHardware}
                  >
                    Menge reduzieren
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
        {rows.length === 0 ? (
          <p className="rounded-xl border border-line px-3 py-6 text-center text-xs text-ink-muted">
            Noch kein Bedarf erfasst — die Kapazitätsrechnung erscheint, sobald Positionen existieren.
          </p>
        ) : null}
      </div>

      {/* Desktop (>= md): Tabelle mit internem Scroll. */}
      <div className="hidden overflow-x-auto rounded-xl border border-line md:block">
        <table className="w-full min-w-[620px] border-collapse text-sm" style={{ tableLayout: 'fixed' }}>
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-ink-faint">
              <th className="w-[26%] border-b border-line bg-surface-2 px-3 py-2">Kategorie</th>
              <th className="w-[12%] border-b border-line bg-surface-2 px-2 py-2 text-right">Bedarf</th>
              <th className="w-[18%] border-b border-line bg-surface-2 px-2 py-2 text-right">Frei im Zeitraum</th>
              <th className="w-[12%] border-b border-line bg-surface-2 px-2 py-2 text-right">Puffer</th>
              <th className="w-[32%] border-b border-line bg-surface-2 px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const pill = STATE_PILLS[row.state];
              return (
                <tr
                  key={row.categoryKey}
                  className={`border-b border-line/70 last:border-b-0 ${
                    row.state === 'knapp' ? 'bg-amber-500/5' : row.state === 'konflikt' ? 'bg-rose-500/5' : ''
                  }`}
                >
                  <td className="px-3 py-2 font-medium text-ink">{row.categoryKey}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">{row.demand}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">{row.free ?? '–'}</td>
                  <td
                    className={`px-2 py-2 text-right font-semibold tabular-nums ${
                      row.buffer === null
                        ? 'text-ink-faint'
                        : row.buffer < 0
                          ? 'text-rose-600 dark:text-rose-300'
                          : row.buffer <= 1
                            ? 'text-amber-600 dark:text-amber-300'
                            : 'text-emerald-600 dark:text-emerald-300'
                    }`}
                  >
                    {row.buffer === null ? '–' : row.buffer >= 0 ? `+${row.buffer}` : row.buffer}
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${pill.className}`}
                      >
                        {row.state === 'konflikt' && row.buffer !== null
                          ? `Fehlen ${Math.abs(row.buffer)}`
                          : pill.label}
                      </span>
                      {row.state === 'konflikt' && canEdit ? (
                        <>
                          <button
                            type="button"
                            className="text-[11px] font-medium text-[#00b9e1] underline-offset-2 hover:underline"
                            onClick={onOpenExternalPool}
                          >
                            Fremdbestand anfragen
                          </button>
                          <button
                            type="button"
                            className="text-[11px] font-medium text-[#00b9e1] underline-offset-2 hover:underline"
                            onClick={onOpenHardware}
                          >
                            Menge reduzieren
                          </button>
                        </>
                      ) : null}
                    </span>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-xs text-ink-muted">
                  Noch kein Bedarf erfasst — die Kapazitätsrechnung erscheint, sobald Positionen existieren.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-ink-faint">
        Berechnung berücksichtigt Rückgabe-Puffer, Defekte und parallele Planungen im Zeitraum.
      </p>

      <div className="rounded-xl border border-line bg-surface-2 p-3">
        <h4 className="text-sm font-semibold text-ink">Überschneidende Planungen ({overlaps.length})</h4>
        <ul className="mt-2 divide-y divide-line/70">
          {overlaps.map((overlap) => (
            <li key={overlap.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 py-2 text-left transition hover:bg-surface/60"
                onClick={() => onOpenPlanning(overlap.id)}
              >
                <CalendarDays className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">
                  <span className="font-medium">
                    {overlap.customerName} · {overlap.projectName}
                  </span>
                  <span className="text-ink-muted"> · {rangeLabel(overlap.startDate, overlap.endDate)}</span>
                </span>
                <span className="shrink-0 text-xs text-ink-muted">{overlap.boundLabel}</span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden="true" />
              </button>
            </li>
          ))}
          {overlaps.length === 0 ? (
            <li className="py-2 text-xs text-ink-muted">Keine überschneidenden Planungen im Zeitraum.</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
