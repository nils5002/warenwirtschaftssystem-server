export type PlanningKpiStats = {
  total: number;
  openCount: number;
  doneCount: number;
  redCount: number;
};

type PlanningKpiBarProps = {
  stats: PlanningKpiStats;
  conflictCauseCount: number;
  // Klick auf die Konflikt-Kachel wechselt in die Konflikte-Ansicht.
  onConflictsClick: () => void;
  conflictsViewActive: boolean;
  className?: string;
};

// Kompakte KPI-Zeile des Planungs-Cockpits (Gesamt / Aktiv / Abgeschlossen /
// Offene Konflikte). Bewusst flache surface-muted-Kacheln statt der großen
// Dashboard-Karten — auf 14 Zoll zählt jede Zeile Höhe.
export function PlanningKpiBar({
  stats,
  conflictCauseCount,
  onConflictsClick,
  conflictsViewActive,
  className = '',
}: PlanningKpiBarProps) {
  return (
    <div className={`grid gap-3 sm:grid-cols-4 ${className}`}>
      <div className="surface-muted px-3 py-2.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Gesamt Planungen</p>
        <p className="mt-1 text-xl font-semibold text-slate-900">{stats.total}</p>
      </div>
      <div className="surface-muted px-3 py-2.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Aktiv</p>
        <p className="mt-1 text-xl font-semibold text-slate-900">{stats.openCount}</p>
      </div>
      <div className="surface-muted px-3 py-2.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Abgeschlossen</p>
        <p className="mt-1 text-xl font-semibold text-slate-900">{stats.doneCount}</p>
      </div>
      {stats.redCount > 0 ? (
        <button
          type="button"
          data-testid="planning-conflicts-card"
          className={`surface-muted px-3 py-2.5 text-left transition hover:border-rose-300 hover:bg-rose-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 ${
            conflictsViewActive ? 'border-rose-400 bg-rose-50 ring-1 ring-rose-300' : ''
          }`}
          onClick={onConflictsClick}
          aria-pressed={conflictsViewActive}
          aria-label={`${stats.redCount} offene Konflikte anzeigen`}
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Offene Konflikte</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{stats.redCount}</p>
          {conflictCauseCount > 0 ? (
            <p
              className="mt-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300"
              data-testid="planning-conflict-cause-count"
            >
              Konfliktursachen: {conflictCauseCount}
            </p>
          ) : null}
          <p className="mt-0.5 text-[11px] text-rose-700">
            {conflictsViewActive ? 'Konflikte-Ansicht aktiv' : 'Klicken für Details'}
          </p>
        </button>
      ) : (
        <div className="surface-muted px-3 py-2.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Offene Konflikte</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{stats.redCount}</p>
        </div>
      )}
    </div>
  );
}
