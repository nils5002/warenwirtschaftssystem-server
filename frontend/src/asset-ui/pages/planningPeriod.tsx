// Einsatzplanung-Zeitraum: gemeinsame, reine Helfer + Anzeige-Komponente.
//
// Fachlicher Hintergrund (siehe Audit P1-A): Das Backend bucht den Einsatz als
// halboffenes Intervall [startDate, endDate). Das **Enddatum ist exklusiv** und
// entspricht dem **Rückgabetag** (Abreise), NICHT einem belegten Einsatztag.
// Damit Liste, Kalender und Detail dieselbe Wahrheit zeigen, leiten alle drei
// hier zentral ab:
//   - belegte Tage   = [startDate, returnDay)
//   - Rückgabetag    = returnDay = periodEndExclusive(start, end)
// Single-Day-Planungen speichern end == start; ihr Rückgabetag ist der Folgetag.
//
// Die Datums-Mathematik spiegelt 1:1 die Backend-Logik
// (planning_repository._period_end_exclusive / _iter_bound_dates).

export function toIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatGermanDate(isoDate: string): string {
  if (!isoDate) return '';
  const [year, month, day] = isoDate.split('-');
  if (!year || !month || !day) return isoDate;
  return `${day}.${month}.${year}`;
}

export function addDaysIso(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

/** Rückgabetag = exklusives Periodenende. Für end > start ist das end selbst,
 *  für eine 1-Tages-Planung (end == start) der Folgetag von start. */
export function getReturnDayIso(startIso: string, endIso: string): string {
  if (!startIso) return endIso || startIso;
  if (endIso && endIso > startIso) return endIso;
  return addDaysIso(startIso, 1);
}

/** Letzter belegter Einsatztag = Rückgabetag − 1 Tag. */
export function getLastBookedDayIso(startIso: string, endIso: string): string {
  return addDaysIso(getReturnDayIso(startIso, endIso), -1);
}

/** Anzahl belegter Tage = Tage in [start, returnDay). Immer >= 1 (defensiv). */
export function getBookedDayCount(startIso: string, endIso: string): number {
  if (!startIso) return 0;
  const start = new Date(`${startIso}T00:00:00`);
  const ret = new Date(`${getReturnDayIso(startIso, endIso)}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(ret.getTime())) return 1;
  const diff = Math.round((ret.getTime() - start.getTime()) / 86400000);
  return Math.max(1, diff);
}

/** Ist `iso` ein belegter Tag (start <= iso < returnDay)? Exklusive Semantik. */
export function isDateBooked(iso: string, startIso: string, endIso: string): boolean {
  if (!iso || !startIso) return false;
  return iso >= startIso && iso < getReturnDayIso(startIso, endIso);
}

function formatBookedRange(startIso: string, lastBookedIso: string): string {
  if (startIso === lastBookedIso) return formatGermanDate(startIso);
  const [sy, sm] = startIso.split('-');
  const [ly, lm] = lastBookedIso.split('-');
  // Kompaktform bei gleichem Monat & Jahr: "17.–18.06.2026".
  if (sy === ly && sm === lm) {
    const sd = startIso.split('-')[2];
    return `${sd}.–${formatGermanDate(lastBookedIso)}`;
  }
  return `${formatGermanDate(startIso)}–${formatGermanDate(lastBookedIso)}`;
}

/** Einsatz-Label ohne Präfix, z. B. "17.–18.06.2026 · 2 Tage" / "08.06.2026 · 1 Tag". */
export function formatEinsatz(startIso: string, endIso: string): string {
  if (!startIso) return '-';
  const count = getBookedDayCount(startIso, endIso);
  const range = formatBookedRange(startIso, getLastBookedDayIso(startIso, endIso));
  return `${range} · ${count} ${count === 1 ? 'Tag' : 'Tage'}`;
}

/** Rückgabe-Label ohne Präfix, z. B. "19.06.2026". */
export function formatRueckgabe(startIso: string, endIso: string): string {
  if (!startIso) return '-';
  return formatGermanDate(getReturnDayIso(startIso, endIso));
}

type PlanningPeriodProps = {
  start: string;
  end: string;
  /** 'card' = zwei Zeilen (Liste/Kalender), 'detail' = inline-Pills im Badge. */
  variant?: 'card' | 'detail';
  className?: string;
};

/**
 * Zeigt den Einsatzzeitraum getrennt nach belegten Tagen und Rückgabetag:
 *   Einsatz: 17.–18.06.2026 · 2 Tage
 *   Rückgabe: 19.06.2026
 */
export function PlanningPeriod({ start, end, variant = 'card', className }: PlanningPeriodProps) {
  const einsatz = formatEinsatz(start, end);
  const rueckgabe = formatRueckgabe(start, end);
  if (variant === 'detail') {
    return (
      <span className={`inline-flex flex-wrap items-center gap-1.5 ${className ?? ''}`}>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
          Einsatz: {einsatz}
        </span>
        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
          Rückgabe: {rueckgabe}
        </span>
      </span>
    );
  }
  return (
    <span className={`block ${className ?? ''}`}>
      <span className="block">Einsatz: {einsatz}</span>
      <span className="block text-slate-400 dark:text-slate-500">Rückgabe: {rueckgabe}</span>
    </span>
  );
}
