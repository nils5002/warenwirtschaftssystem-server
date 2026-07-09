import { describe, expect, it } from 'vitest';

import {
  addDaysIso,
  buildCapacityRows,
  countCapacityConflicts,
  deriveFlowSteps,
} from './planningCockpit';

const normalize = (key: string) => key.trim().toLowerCase();

describe('buildCapacityRows', () => {
  const availability = [
    // Laptop: Tag 1 großzügig, Tag 2 eng → Minimum über die Tage zählt.
    { categoryKey: 'Laptop', usableStock: 14, otherPlannedQty: 0 },
    { categoryKey: 'Laptop', usableStock: 14, otherPlannedQty: 4 },
    { categoryKey: 'QR-Code-Scanner', usableStock: 11, otherPlannedQty: 0 },
    { categoryKey: 'Kartendrucker', usableStock: 2, otherPlannedQty: 1 },
  ];

  it('berechnet Frei (min über Tage), Puffer und Status', () => {
    const rows = buildCapacityRows(
      [
        { categoryKey: 'Laptop', qty: 6 },
        { categoryKey: 'QR-Code-Scanner', qty: 10 },
        { categoryKey: 'Kartendrucker', qty: 3 },
      ],
      availability,
      normalize,
    );
    const byKey = new Map(rows.map((row) => [row.categoryKey, row]));
    // Laptop: frei = min(14, 10) = 10, Puffer +4 → gedeckt.
    expect(byKey.get('Laptop')).toMatchObject({ free: 10, buffer: 4, state: 'gedeckt' });
    // Scanner: frei 11, Bedarf 10 → Puffer +1 = Knapp-Schwelle → knapp.
    expect(byKey.get('QR-Code-Scanner')).toMatchObject({ free: 11, buffer: 1, state: 'knapp' });
    // Kartendrucker: frei 1, Bedarf 3 → Puffer −2 → Konflikt.
    expect(byKey.get('Kartendrucker')).toMatchObject({ free: 1, buffer: -2, state: 'konflikt' });
  });

  it('markiert Kategorien ohne Availability-Daten als unbekannt', () => {
    const rows = buildCapacityRows([{ categoryKey: 'Switch', qty: 1 }], availability, normalize);
    expect(rows[0]).toMatchObject({ free: null, buffer: null, state: 'unbekannt' });
  });

  it('countCapacityConflicts zählt nur Konflikt-Zeilen', () => {
    const rows = buildCapacityRows(
      [
        { categoryKey: 'Laptop', qty: 6 },
        { categoryKey: 'Kartendrucker', qty: 3 },
      ],
      availability,
      normalize,
    );
    expect(countCapacityConflicts(rows)).toBe(1);
  });
});

describe('deriveFlowSteps', () => {
  const base = { endDate: '2026-07-20', returnBufferDays: 1 };

  it('ohne Ausgabe: Geplant aktiv', () => {
    const result = deriveFlowSteps({ ...base, status: 'Geplant', issuedQty: 0, today: '2026-07-10' });
    expect(result.steps.map((step) => step.state)).toEqual(['active', 'upcoming', 'upcoming', 'upcoming']);
  });

  it('mit Ausgabe im Zeitraum: Ausgegeben aktiv', () => {
    const result = deriveFlowSteps({ ...base, status: 'Geplant', issuedQty: 5, today: '2026-07-19' });
    expect(result.steps[1].state).toBe('active');
  });

  it('nach Projektende mit Geräten draußen: Rückgabe aktiv', () => {
    const result = deriveFlowSteps({ ...base, status: 'Bestätigt', issuedQty: 5, today: '2026-07-22' });
    expect(result.steps[2].state).toBe('active');
  });

  it('Abgeschlossen: alle Schritte done', () => {
    const result = deriveFlowSteps({ ...base, status: 'Abgeschlossen', issuedQty: 0, today: '2026-08-01' });
    expect(result.steps.every((step) => step.state === 'done')).toBe(true);
  });

  it('Storniert: cancelled, kein aktiver Schritt', () => {
    const result = deriveFlowSteps({ ...base, status: 'Storniert', issuedQty: 2, today: '2026-07-19' });
    expect(result.cancelled).toBe(true);
    expect(result.steps.some((step) => step.state === 'active')).toBe(false);
  });

  it('normalisiert Legacy-Status "Bestaetigt"', () => {
    const result = deriveFlowSteps({ ...base, status: 'Bestaetigt', issuedQty: 0, today: '2026-07-10' });
    expect(result.cancelled).toBe(false);
    expect(result.steps[0].state).toBe('active');
  });
});

describe('addDaysIso', () => {
  it('addiert über Monatsgrenzen', () => {
    expect(addDaysIso('2026-07-30', 3)).toBe('2026-08-02');
  });
});
