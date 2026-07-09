import type { PlanningStatus } from '../../services/wmsApi';

// Reine, UI-freie Ableitungen für die Einsatzplanung (Detailseite):
// Kapazitätsrechnung des Konflikte-/Hardware-Tabs und der Ablauf-Stepper.
// Bewusst ohne React und ohne API-Zugriffe — die Eingaben kommen aus den
// bereits geladenen Availability-Daten; die eigentliche Verfügbarkeitslogik
// bleibt im Backend.

export type PlanningPhaseState = 'done' | 'active' | 'upcoming';

export function addDaysIso(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatGermanDateShort(isoDate: string): string {
  const [year, month, day] = (isoDate ?? '').split('-');
  if (!year || !month || !day) return isoDate ?? '';
  return `${day}.${month}.${year}`;
}

// ---------------------------------------------------------------------------
// Kapazitätsrechnung: Bedarf | Frei im Zeitraum | Puffer | Status je Kategorie.
// ---------------------------------------------------------------------------

// Knapp-Schwelle: Puffer (frei − Bedarf) <= Schwelle gilt als "Knapp".
export const CAPACITY_TIGHT_THRESHOLD = 1;

export type CapacityState = 'gedeckt' | 'knapp' | 'konflikt' | 'unbekannt';

export type CapacityRow = {
  categoryKey: string;
  demand: number;
  // Kleinster freier Bestand über alle Tage des Zeitraums (usableStock −
  // Bedarf ANDERER Planungen). null = Kategorie noch nicht serverseitig
  // geprüft (frisch hinzugefügte, ungespeicherte Position).
  free: number | null;
  buffer: number | null;
  state: CapacityState;
};

export type CapacityAvailabilityDay = {
  categoryKey: string;
  usableStock: number;
  otherPlannedQty: number;
};

export function buildCapacityRows(
  demands: Array<{ categoryKey: string; qty: number }>,
  availabilityItems: CapacityAvailabilityDay[],
  normalizeCategory: (key: string) => string,
): CapacityRow[] {
  const freeByCategory = new Map<string, number>();
  for (const item of availabilityItems) {
    const key = normalizeCategory(item.categoryKey);
    const free = Math.max(0, (item.usableStock ?? 0) - (item.otherPlannedQty ?? 0));
    const current = freeByCategory.get(key);
    if (current === undefined || free < current) freeByCategory.set(key, free);
  }

  const rows: CapacityRow[] = [];
  for (const demand of demands) {
    const qty = Math.max(0, Number(demand.qty) || 0);
    const free = freeByCategory.get(normalizeCategory(demand.categoryKey)) ?? null;
    let buffer: number | null = null;
    let state: CapacityState = 'unbekannt';
    if (free !== null) {
      buffer = free - qty;
      state = buffer < 0 ? 'konflikt' : buffer <= CAPACITY_TIGHT_THRESHOLD ? 'knapp' : 'gedeckt';
    }
    rows.push({ categoryKey: demand.categoryKey, demand: qty, free, buffer, state });
  }
  rows.sort((a, b) => a.categoryKey.localeCompare(b.categoryKey, 'de'));
  return rows;
}

export function countCapacityConflicts(rows: CapacityRow[]): number {
  return rows.filter((row) => row.state === 'konflikt').length;
}

// ---------------------------------------------------------------------------
// Ablauf-Stepper (Übersicht-Tab): Geplant → Ausgegeben → Rückgabe → Abschluss.
// Kein gespeicherter Status — reine Ableitung aus Status/Ausgabestand/Datum.
// ---------------------------------------------------------------------------

export type FlowStep = {
  key: 'geplant' | 'ausgegeben' | 'rueckgabe' | 'abschluss';
  label: string;
  state: PlanningPhaseState;
};

export function deriveFlowSteps(input: {
  status: PlanningStatus;
  issuedQty: number;
  today: string;
  endDate: string;
  returnBufferDays?: number;
}): { steps: FlowStep[]; cancelled: boolean } {
  const keys: Array<FlowStep['key']> = ['geplant', 'ausgegeben', 'rueckgabe', 'abschluss'];
  const labelText: Record<FlowStep['key'], string> = {
    geplant: 'Geplant',
    ausgegeben: 'Ausgegeben',
    rueckgabe: 'Rückgabe',
    abschluss: 'Abschluss',
  };
  const build = (activeIndex: number, allDone = false): FlowStep[] =>
    keys.map((key, index) => ({
      key,
      label: labelText[key],
      state: allDone ? 'done' : index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'upcoming',
    }));

  const status = input.status === 'Bestaetigt' ? 'Bestätigt' : input.status;
  if (status === 'Storniert') {
    return { steps: keys.map((key) => ({ key, label: labelText[key], state: 'upcoming' })), cancelled: true };
  }
  if (status === 'Abgeschlossen') {
    return { steps: build(keys.length, true), cancelled: false };
  }
  if (input.issuedQty <= 0) {
    return { steps: build(0), cancelled: false };
  }
  const returnEnd = addDaysIso(input.endDate, Math.max(0, input.returnBufferDays ?? 0));
  if (input.today > input.endDate || input.today > returnEnd) {
    return { steps: build(2), cancelled: false };
  }
  return { steps: build(1), cancelled: false };
}
