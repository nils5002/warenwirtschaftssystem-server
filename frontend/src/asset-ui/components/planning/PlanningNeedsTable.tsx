import type { CategoryNeedRow, NeedRowTone } from '../../pages/planningCockpit';

const TONE_DOT: Record<NeedRowTone, string> = {
  green: 'bg-emerald-500',
  yellow: 'bg-amber-500',
  red: 'bg-rose-500',
  blue: 'bg-sky-500',
};

const TONE_TEXT: Record<NeedRowTone, string> = {
  green: 'text-emerald-700 dark:text-emerald-300',
  yellow: 'text-amber-700 dark:text-amber-300',
  red: 'text-rose-700 dark:text-rose-300',
  blue: 'text-sky-700 dark:text-sky-300',
};

// Kompakte Hardwarebedarf-Tabelle des Detail-Panels:
// Kategorie | Benötigt (Peak/Tag) | Verfügbar | Fehlt | Status + Kurzaktion.
export function PlanningNeedsTable({ rows }: { rows: CategoryNeedRow[] }) {
  if (!rows.length) {
    return (
      <p className="rounded-xl border border-dashed border-line bg-surface-2 px-3 py-4 text-center text-xs text-ink-muted">
        Noch kein Hardwarebedarf erfasst — über „Bearbeiten“ Positionen anlegen.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[420px] border-collapse text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-ink-faint">
            <th className="border-b border-line bg-surface-2 px-3 py-2">Kategorie</th>
            <th className="w-20 border-b border-line bg-surface-2 px-2 py-2 text-right">Benötigt</th>
            <th className="w-20 border-b border-line bg-surface-2 px-2 py-2 text-right">Verfügbar</th>
            <th className="w-16 border-b border-line bg-surface-2 px-2 py-2 text-right">Fehlt</th>
            <th className="w-44 border-b border-line bg-surface-2 px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.categoryKey} className="border-b border-line/70 last:border-b-0">
              <td className="px-3 py-2 font-medium text-ink">{row.categoryKey}</td>
              <td
                className="px-2 py-2 text-right tabular-nums text-ink"
                title={`Gesamt über den Zeitraum: ${row.requiredTotal}`}
              >
                {row.requiredPeak}
              </td>
              <td className="px-2 py-2 text-right tabular-nums text-ink">{row.available}</td>
              <td
                className={`px-2 py-2 text-right font-semibold tabular-nums ${
                  row.missing > 0 ? 'text-rose-600 dark:text-rose-300' : 'text-ink-faint'
                }`}
              >
                {row.missing > 0 ? row.missing : '–'}
              </td>
              <td className="px-3 py-2">
                <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${TONE_TEXT[row.tone]}`}>
                  <span className={`h-2 w-2 shrink-0 rounded-full ${TONE_DOT[row.tone]}`} aria-hidden="true" />
                  {row.statusLabel}
                </span>
                {row.actionHint ? (
                  <span className="block truncate text-[11px] text-ink-muted" title={row.actionHint}>
                    {row.actionHint}
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
