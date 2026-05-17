// Visuelle Zuordnung für Konflikt-Schweregrade (Konfliktanzeige-Paket).
//
// Eine zentrale Stelle, die eine `PlanningConflictSeverity` auf Tailwind-Klassen
// (für ein `.status-chip`) und ein deutsches Fallback-Label abbildet. Die
// Farbpalette ist bewusst identisch zu `statusBadgeClasses` in
// `PlanningCalendarAddOn.tsx`, damit die Planung ein einheitliches Farbsystem
// behält. Das Backend liefert `conflictLabel` normalerweise mit — `label` hier
// ist nur der Fallback für ältere Backend-Stände.
import type { PlanningConflictSeverity } from '../../services/wmsApi';

export type SeverityVisual = {
  /** Tailwind-Klassen für ein `.status-chip` dieser Severity. */
  chipClass: string;
  /** Deutsches Fallback-Label. */
  label: string;
  /** Sortrang — kleiner = kritischer, in Zusammenfassungen zuerst zeigen. */
  rank: number;
};

const RED =
  'border-rose-300 bg-rose-100 text-rose-800 dark:border-rose-700 dark:bg-rose-950/60 dark:text-rose-100';
const AMBER =
  'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-100';
const SKY =
  'border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-700 dark:bg-sky-950/60 dark:text-sky-100';
const SLATE =
  'border-slate-300 bg-slate-200 text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-100';

const SEVERITY_VISUALS: Record<PlanningConflictSeverity, SeverityVisual> = {
  echter_engpass: { chipClass: RED, label: 'Echter Engpass', rank: 0 },
  kompatible_laptops_fehlen: {
    chipClass: RED,
    label: 'Kompatible Laptops fehlen',
    rank: 1,
  },
  handover_review: { chipClass: AMBER, label: 'Übergabe prüfen', rank: 2 },
  teilweise_geloest: { chipClass: AMBER, label: 'Teilweise gelöst', rank: 3 },
  nicht_planbare_ausgeschlossen: {
    chipClass: SLATE,
    label: 'Nicht planbare Geräte ausgeschlossen',
    rank: 4,
  },
  hinweis: { chipClass: SKY, label: 'Hinweis', rank: 5 },
};

const FALLBACK: SeverityVisual = { chipClass: SLATE, label: 'Konflikt', rank: 9 };

/** Liefert die visuelle Zuordnung einer Severity (robust gegen unbekannte Werte). */
export function conflictSeverityVisual(
  severity: PlanningConflictSeverity | null | undefined,
): SeverityVisual {
  if (!severity) return FALLBACK;
  return SEVERITY_VISUALS[severity] ?? FALLBACK;
}

/** Sortrang einer Severity (für deterministische Reihenfolgen). */
export function conflictSeverityRank(
  severity: PlanningConflictSeverity | null | undefined,
): number {
  return conflictSeverityVisual(severity).rank;
}
