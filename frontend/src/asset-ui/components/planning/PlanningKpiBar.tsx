import { AlertTriangle, CircleCheck } from 'lucide-react';

export type PlanningKpiStats = {
  total: number;
  openCount: number;
  doneCount: number;
  redCount: number;
};

type PlanningKpiBarProps = {
  stats: PlanningKpiStats;
  conflictCauseCount: number;
  // Klick auf den Konflikt-Chip wechselt in die Konflikte-Ansicht.
  onConflictsClick: () => void;
  conflictsViewActive: boolean;
  className?: string;
};

const CHIP_BASE =
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs';

// Einzeilige KPI-Chips des Planungs-Cockpits (Gesamt / Aktiv / Abgeschlossen /
// Offene Konflikte). Bewusst flache Chips statt Kacheln — der Kopfbereich soll
// möglichst wenig Höhe kosten, damit Wochenansicht/Liste den Platz bekommen.
export function PlanningKpiBar({
  stats,
  conflictCauseCount,
  onConflictsClick,
  conflictsViewActive,
  className = '',
}: PlanningKpiBarProps) {
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`.trim()}>
      <span className={`${CHIP_BASE} border-line bg-surface-2 text-ink-muted`}>
        <span className="font-semibold tabular-nums text-ink">{stats.total}</span>
        Planungen
      </span>
      <span className={`${CHIP_BASE} border-line bg-surface-2 text-ink-muted`}>
        <span className="font-semibold tabular-nums text-ink">{stats.openCount}</span>
        aktiv
      </span>
      <span className={`${CHIP_BASE} border-line bg-surface-2 text-ink-muted`}>
        <span className="font-semibold tabular-nums text-ink">{stats.doneCount}</span>
        abgeschlossen
      </span>
      {stats.redCount > 0 ? (
        <button
          type="button"
          data-testid="planning-conflicts-card"
          className={`${CHIP_BASE} border-rose-200 bg-rose-50 font-medium text-rose-700 transition hover:border-rose-300 hover:bg-rose-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/20 ${
            conflictsViewActive ? 'ring-1 ring-rose-400' : ''
          }`}
          onClick={onConflictsClick}
          aria-pressed={conflictsViewActive}
          aria-label={`${stats.redCount} offene Konflikte anzeigen`}
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="font-semibold tabular-nums">{stats.redCount}</span>
          {stats.redCount === 1 ? 'offener Konflikt' : 'offene Konflikte'}
          {conflictCauseCount > 0 ? (
            <span data-testid="planning-conflict-cause-count" className="hidden font-normal 2xl:inline">
              · {conflictCauseCount} {conflictCauseCount === 1 ? 'Ursache' : 'Ursachen'}
            </span>
          ) : null}
        </button>
      ) : (
        <span
          className={`${CHIP_BASE} border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300`}
        >
          <CircleCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Keine offenen Konflikte
        </span>
      )}
    </div>
  );
}
