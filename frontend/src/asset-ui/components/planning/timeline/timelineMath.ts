import type { PlanningListItem } from '../../../../services/wmsApi';
import {
  addDaysIso,
  getReturnDayIso,
  getStockFreeAgainIso,
  isDateBooked,
  toIsoDate,
} from '../../../pages/planningPeriod';

// Reine Ableitungen der Kalender-Zeitleiste (Woche/Monat): Lane-Packing,
// Segment-Clipping auf einen Sichtbereich, Auslastung pro Tag und
// Datums-Mathematik. Bewusst ohne React, damit alles unit-testbar bleibt.

export type TimelineStatus = 'green' | 'sky' | 'amber' | 'red' | 'gray';

export type TimelineVisual = { status: TimelineStatus; label: string };

// Aktive Status wie im Backend (ACTIVE_PLANNING_STATUSES): binden Bestand.
const ACTIVE_STATUSES = new Set(['Entwurf', 'Geplant', 'Bestätigt', 'Bestaetigt']);

export function isActivePlanningStatus(status: string): boolean {
  return ACTIVE_STATUSES.has(status);
}

// Statusfarbe rein aus den Listendaten — dieselbe Rangfolge wie die frühere
// Kalenderansicht (rot vor gelb vor blau vor grün), nur ohne die lazy
// nachgeladene Availability: openConflictCount/handoverNeedsReview kommen
// vorberechnet vom Listen-Endpoint.
export function deriveTimelineStatus(planning: PlanningListItem): TimelineVisual {
  if (planning.status === 'Abgeschlossen' || planning.status === 'Storniert') {
    return { status: 'gray', label: planning.status };
  }
  if ((planning.openConflictCount ?? 0) > 0) {
    return { status: 'red', label: 'Handlungsbedarf' };
  }
  if (planning.handoverNeedsReview) {
    return { status: 'amber', label: 'Prüfung nötig' };
  }
  if (planning.handoverSummary) {
    return { status: 'sky', label: 'Übergabe/Verbund' };
  }
  return {
    status: 'green',
    label: planning.status === 'Entwurf' ? 'Entwurf · verfügbar' : 'Verfügbar',
  };
}

// --- Datums-Mathematik -------------------------------------------------------

export function getWeekStartIso(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  const day = date.getDay();
  const shift = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + shift);
  return toIsoDate(date);
}

export function getIsoWeekNumber(iso: string): number {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 0;
  // ISO 8601: die Woche des Donnerstags entscheidet über die KW.
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  return (
    1 +
    Math.round(
      ((date.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7,
    )
  );
}

export function listRangeDays(startIso: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => addDaysIso(startIso, index));
}

/** Montags-Wochenstarts aller Wochenzeilen, die den Monat von `monthIso` schneiden. */
export function buildMonthWeekStarts(monthIso: string): string[] {
  const [year, month] = monthIso.split('-');
  if (!year || !month) return [];
  const firstOfMonth = `${year}-${month}-01`;
  const firstOfNextMonth = toIsoDate(new Date(Number(year), Number(month), 1));
  const weeks: string[] = [];
  let cursor = getWeekStartIso(firstOfMonth);
  while (cursor < firstOfNextMonth) {
    weeks.push(cursor);
    cursor = addDaysIso(cursor, 7);
  }
  return weeks;
}

export function addMonthsIso(iso: string, months: number): string {
  const [year, month] = iso.split('-');
  if (!year || !month) return iso;
  return toIsoDate(new Date(Number(year), Number(month) - 1 + months, 1));
}

// --- Rückgabe-Fenster ---------------------------------------------------------

/**
 * Gestricheltes Rückgabe-Segment: beginnt am Rückgabetag und umfasst bei
 * Rückgabe-Puffer > 0 zusätzlich die Puffertage (Bestand bleibt gebunden).
 * Ohne Puffer genau ein Tag — der Rückgabetag selbst.
 */
export function getReturnWindow(
  planning: Pick<PlanningListItem, 'startDate' | 'endDate' | 'returnBufferDays'>,
): { startIso: string; endExclusiveIso: string } {
  const returnDay = getReturnDayIso(planning.startDate, planning.endDate);
  const freeAgain = getStockFreeAgainIso(planning.startDate, planning.endDate, planning.returnBufferDays);
  const endExclusive = freeAgain > returnDay ? freeAgain : addDaysIso(returnDay, 1);
  return { startIso: returnDay, endExclusiveIso: endExclusive };
}

// --- Lane-Packing + Segment-Clipping -----------------------------------------

export type TimelineSegment = {
  planning: PlanningListItem;
  kind: 'einsatz' | 'rueckgabe';
  /** 1-basierte Grid-Spalten (inklusive) innerhalb des Sichtbereichs. */
  startCol: number;
  endCol: number;
  /** Läuft das Segment über den linken/rechten Rand des Sichtbereichs hinaus? */
  clippedStart: boolean;
  clippedEnd: boolean;
};

export type TimelineLane = TimelineSegment[];

function dayDiff(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00`).getTime();
  const to = new Date(`${toIso}T00:00:00`).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86400000);
}

/**
 * Legt Planungen kollisionsfrei in Lanes (gierig: erste freie Lane von oben)
 * und clippt Einsatz- + Rückgabe-Segmente auf den Sichtbereich
 * [rangeStartIso, rangeStartIso + dayCount). Fürs Packing zählt das gesamte
 * Blockier-Intervall inkl. Rückgabefenster, damit Balken und gestricheltes
 * Segment derselben Lane nie mit Nachbarn kollidieren.
 */
export function packTimelineLanes(
  plannings: PlanningListItem[],
  rangeStartIso: string,
  dayCount: number,
): TimelineLane[] {
  const rangeEndExclusive = addDaysIso(rangeStartIso, dayCount);
  const entries = plannings
    .map((planning) => {
      const returnWindow = getReturnWindow(planning);
      return { planning, returnWindow, blockEndExclusive: returnWindow.endExclusiveIso };
    })
    .filter(
      (entry) =>
        entry.planning.startDate < rangeEndExclusive && rangeStartIso < entry.blockEndExclusive,
    )
    .sort((a, b) =>
      a.planning.startDate === b.planning.startDate
        ? a.planning.id.localeCompare(b.planning.id)
        : a.planning.startDate.localeCompare(b.planning.startDate),
    );

  const lanes: TimelineLane[] = [];
  const laneEndExclusive: string[] = [];

  const clip = (
    planning: PlanningListItem,
    kind: TimelineSegment['kind'],
    segmentStart: string,
    segmentEndExclusive: string,
  ): TimelineSegment | null => {
    if (segmentStart >= rangeEndExclusive || segmentEndExclusive <= rangeStartIso) return null;
    const visibleStart = segmentStart > rangeStartIso ? segmentStart : rangeStartIso;
    const visibleEndExclusive =
      segmentEndExclusive < rangeEndExclusive ? segmentEndExclusive : rangeEndExclusive;
    return {
      planning,
      kind,
      startCol: dayDiff(rangeStartIso, visibleStart) + 1,
      endCol: dayDiff(rangeStartIso, visibleEndExclusive),
      clippedStart: segmentStart < rangeStartIso,
      clippedEnd: segmentEndExclusive > rangeEndExclusive,
    };
  };

  for (const entry of entries) {
    let laneIndex = laneEndExclusive.findIndex((end) => end <= entry.planning.startDate);
    if (laneIndex === -1) {
      laneIndex = lanes.length;
      lanes.push([]);
      laneEndExclusive.push(entry.blockEndExclusive);
    } else {
      laneEndExclusive[laneIndex] = entry.blockEndExclusive;
    }

    const einsatz = clip(
      entry.planning,
      'einsatz',
      entry.planning.startDate,
      entry.returnWindow.startIso,
    );
    if (einsatz) lanes[laneIndex].push(einsatz);
    const rueckgabe = clip(
      entry.planning,
      'rueckgabe',
      entry.returnWindow.startIso,
      entry.returnWindow.endExclusiveIso,
    );
    if (rueckgabe) lanes[laneIndex].push(rueckgabe);
  }

  return lanes;
}

// --- Auslastung ---------------------------------------------------------------

export type DayUtilization = { inUse: number; returning: number };

/**
 * "Geräte im Einsatz" pro Tag: Summe der Gerätezahlen aller aktiven Planungen
 * (Entwurf/Geplant/Bestätigt — wie die Backend-Konfliktrechnung), deren
 * Einsatzzeitraum den Tag enthält. `returning` = Gerätesumme der Planungen mit
 * Rückgabetag an diesem Tag.
 */
export function buildUtilization(
  plannings: PlanningListItem[],
  days: string[],
): DayUtilization[] {
  return days.map((day) => {
    let inUse = 0;
    let returning = 0;
    for (const planning of plannings) {
      if (!isActivePlanningStatus(planning.status)) continue;
      const qty = Math.max(0, Number(planning.totalQty ?? 0));
      if (!qty) continue;
      if (isDateBooked(day, planning.startDate, planning.endDate)) inUse += qty;
      if (getReturnDayIso(planning.startDate, planning.endDate) === day) returning += qty;
    }
    return { inUse, returning };
  });
}
