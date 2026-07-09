import { describe, expect, it } from 'vitest';

import {
  addDaysIso,
  aggregateCategoryNeeds,
  buildConflictSentences,
  derivePlanningPhases,
  summarizeNeeds,
  type CategoryVisualLike,
  type DayVisualLike,
  type RelatedPlanningLike,
} from './planningCockpit';

const normalize = (key: string) => key.trim().toLowerCase();

function phaseStates(result: ReturnType<typeof derivePlanningPhases>): string[] {
  return result.phases.map((phase) => `${phase.key}:${phase.state}`);
}

describe('derivePlanningPhases', () => {
  const base = {
    startDate: '2026-07-20',
    endDate: '2026-07-24',
    returnBufferDays: 2,
  };

  it('Entwurf: Planung aktiv, Rest offen', () => {
    const result = derivePlanningPhases({ ...base, status: 'Entwurf', today: '2026-07-01' });
    expect(result.cancelled).toBe(false);
    expect(phaseStates(result)).toEqual([
      'planung:active',
      'vorbereitung:upcoming',
      'ausgabe:upcoming',
      'einsatz:upcoming',
      'rueckgabe:upcoming',
      'abschluss:upcoming',
    ]);
  });

  it('Geplant vor Start ohne Ausgabe: Vorbereitung aktiv', () => {
    const result = derivePlanningPhases({ ...base, status: 'Geplant', today: '2026-07-10' });
    expect(result.phases[1]).toMatchObject({ key: 'vorbereitung', state: 'active' });
  });

  it('Geplant vor Start mit Teil-Ausgabe: Ausgabe aktiv', () => {
    const result = derivePlanningPhases({
      ...base,
      status: 'Geplant',
      today: '2026-07-19',
      issuedQty: 2,
      plannedQty: 5,
    });
    expect(result.phases[2]).toMatchObject({ key: 'ausgabe', state: 'active' });
  });

  it('im Zeitraum, vollständig ausgegeben: Einsatz aktiv', () => {
    const result = derivePlanningPhases({
      ...base,
      status: 'Bestätigt',
      today: '2026-07-22',
      issuedQty: 5,
      plannedQty: 5,
    });
    expect(result.phases[3]).toMatchObject({ key: 'einsatz', state: 'active' });
    expect(result.phases[2].state).toBe('done');
  });

  it('normalisiert Legacy-Status "Bestaetigt"', () => {
    const result = derivePlanningPhases({ ...base, status: 'Bestaetigt', today: '2026-07-22' });
    expect(result.phases[3].state).toBe('active');
  });

  it('im Zeitraum mit Teil-Ausgabe bleibt Ausgabe aktiv', () => {
    const result = derivePlanningPhases({
      ...base,
      status: 'Geplant',
      today: '2026-07-21',
      issuedQty: 1,
      plannedQty: 4,
    });
    expect(result.phases[2]).toMatchObject({ key: 'ausgabe', state: 'active' });
  });

  it('nach Ende innerhalb Puffer: Rückgabe aktiv', () => {
    const result = derivePlanningPhases({ ...base, status: 'Geplant', today: '2026-07-25' });
    expect(result.phases[4]).toMatchObject({ key: 'rueckgabe', state: 'active' });
  });

  it('nach Pufferende mit offenen Geräten: Rückgabe bleibt aktiv', () => {
    const result = derivePlanningPhases({
      ...base,
      status: 'Geplant',
      today: '2026-08-01',
      issuedQty: 1,
      plannedQty: 4,
    });
    expect(result.phases[4]).toMatchObject({ key: 'rueckgabe', state: 'active' });
  });

  it('nach Pufferende ohne offene Geräte: Abschluss steht an', () => {
    const result = derivePlanningPhases({ ...base, status: 'Geplant', today: '2026-08-01' });
    expect(result.phases[5]).toMatchObject({ key: 'abschluss', state: 'active' });
  });

  it('Abgeschlossen: alles done', () => {
    const result = derivePlanningPhases({ ...base, status: 'Abgeschlossen', today: '2026-08-01' });
    expect(result.phases.every((phase) => phase.state === 'done')).toBe(true);
  });

  it('Storniert: cancelled, keine aktive Phase', () => {
    const result = derivePlanningPhases({ ...base, status: 'Storniert', today: '2026-07-22' });
    expect(result.cancelled).toBe(true);
    expect(result.phases.some((phase) => phase.state === 'active')).toBe(false);
  });
});

describe('aggregateCategoryNeeds', () => {
  const summary = [
    { categoryKey: 'Laptop', requestedTotal: 12, maxRequestedPerDay: 4, totalStock: 10, usableStock: 4 },
    { categoryKey: 'QR-Scanner', requestedTotal: 6, maxRequestedPerDay: 3, totalStock: 5, usableStock: 1 },
    { categoryKey: 'Drucker', requestedTotal: 2, maxRequestedPerDay: 1, totalStock: 4, usableStock: 3 },
  ];

  it('mappt Worst-Status auf Ampel + Aktionshinweis und sortiert kritisch zuerst', () => {
    const visuals = new Map<string, CategoryVisualLike>([
      ['qr-scanner', {
        status: 'open',
        shortageQty: 2,
        usableStock: 1,
        affectedPlanningIds: ['pln-x'],
      }],
      ['laptop', { status: 'review', reviewReason: 'low_reserve', shortageQty: 0, usableStock: 4 }],
      ['drucker', { status: 'ok', shortageQty: 0, usableStock: 3 }],
    ]);
    const rows = aggregateCategoryNeeds(summary, visuals, normalize);
    expect(rows.map((row) => row.categoryKey)).toEqual(['QR-Scanner', 'Laptop', 'Drucker']);
    expect(rows[0]).toMatchObject({ tone: 'red', missing: 2, statusLabel: 'Konflikt', actionHint: 'Konflikt lösen' });
    expect(rows[1]).toMatchObject({ tone: 'yellow', statusLabel: 'Bestand knapp' });
    expect(rows[2]).toMatchObject({ tone: 'green', missing: 0, actionHint: null });
  });

  it('open ohne konkurrierende Planung empfiehlt Miete/Fremdbestand', () => {
    const visuals = new Map<string, CategoryVisualLike>([
      ['qr-scanner', { status: 'open', shortageQty: 3, usableStock: 0, affectedPlanningIds: [] }],
    ]);
    const rows = aggregateCategoryNeeds(summary.slice(1, 2), visuals, normalize);
    expect(rows[0].actionHint).toBe('Geräte mieten oder Fremdbestand buchen');
  });

  it('handover wird blau mit Partner-Hinweis', () => {
    const visuals = new Map<string, CategoryVisualLike>([
      ['laptop', { status: 'handover', shortageQty: 0, usableStock: 4, partnerLabel: 'Messe Süd' }],
    ]);
    const rows = aggregateCategoryNeeds(summary.slice(0, 1), visuals, normalize);
    expect(rows[0]).toMatchObject({ tone: 'blue', actionHint: 'Übergabe aus ‚Messe Süd‘' });
  });

  it('summarizeNeeds: fehlend wird auf den Bedarf gekappt', () => {
    const visuals = new Map<string, CategoryVisualLike>([
      ['qr-scanner', { status: 'open', shortageQty: 99, usableStock: 0, affectedPlanningIds: [] }],
    ]);
    const rows = aggregateCategoryNeeds(summary, visuals, normalize);
    const totals = summarizeNeeds(rows);
    expect(totals.plannedTotal).toBe(4 + 3 + 1);
    expect(totals.missingTotal).toBe(3);
    expect(totals.coveredTotal).toBe(5);
  });
});

describe('buildConflictSentences', () => {
  const blocker: RelatedPlanningLike = {
    id: 'pln-block',
    projectName: 'Siemens Hausmesse',
    startDate: '2026-07-18',
    endDate: '2026-07-21',
    returnBufferDays: 1,
  };

  const openVisual = (overrides: Partial<DayVisualLike>): DayVisualLike => ({
    status: 'open',
    shortageQty: 2,
    usableStock: 1,
    categoryKey: 'QR-Scanner',
    planningDate: '2026-07-20',
    affectedPlanningIds: ['pln-block'],
    ...overrides,
  });

  it('nennt das blockierende Projekt mit Rückgabedatum, wenn es früher endet', () => {
    const result = buildConflictSentences({
      dayVisuals: [openVisual({})],
      relatedPlannings: { 'pln-block': blocker },
      ownPlanningId: 'pln-own',
      ownEndDate: '2026-07-30',
      normalizeCategory: normalize,
    });
    // endDate 21.07. + 1 Puffertag + 1 = frei ab 23.07.
    expect(result.sentences[0].text).toBe(
      '2× QR-Scanner kommen erst am 23.07.2026 zurück (im Einsatz für ‚Siemens Hausmesse‘).',
    );
    expect(result.recommendation).toContain('Fremdbestand');
  });

  it('nutzt die "wird bereits benötigt"-Form bei voll überlappendem Blocker', () => {
    const result = buildConflictSentences({
      dayVisuals: [openVisual({ shortageQty: 1 })],
      relatedPlannings: { 'pln-block': { ...blocker, endDate: '2026-08-15' } },
      ownPlanningId: 'pln-own',
      ownEndDate: '2026-07-30',
      normalizeCategory: normalize,
    });
    expect(result.sentences[0].text).toBe(
      '1× QR-Scanner wird bereits für Projekt ‚Siemens Hausmesse‘ benötigt.',
    );
  });

  it('fällt ohne aufgelöste Planung auf den Verliehen-Satz zurück', () => {
    const result = buildConflictSentences({
      dayVisuals: [openVisual({ affectedPlanningIds: [] })],
      relatedPlannings: {},
      ownPlanningId: 'pln-own',
      ownEndDate: '2026-07-30',
      normalizeCategory: normalize,
    });
    expect(result.sentences[0].text).toContain('verliehen und noch nicht zurück');
  });

  it('sortiert rot vor gelb vor blau (die UI kappt bei 4 Sätzen)', () => {
    const visuals: DayVisualLike[] = [
      { status: 'handover', shortageQty: 0, usableStock: 2, handoverCoveredQty: 3, partnerLabel: 'Messe Süd', categoryKey: 'Tablet', planningDate: '2026-07-20' },
      { status: 'review', reviewReason: 'low_reserve', shortageQty: 0, usableStock: 1, categoryKey: 'Router', planningDate: '2026-07-20' },
      openVisual({ categoryKey: 'QR-Scanner' }),
      openVisual({ categoryKey: 'Laptop', affectedPlanningIds: [] }),
      { status: 'review', reviewReason: 'incomplete_link', shortageQty: 0, usableStock: 1, categoryKey: 'Switch', planningDate: '2026-07-20' },
    ];
    const result = buildConflictSentences({
      dayVisuals: visuals,
      relatedPlannings: { 'pln-block': blocker },
      ownPlanningId: 'pln-own',
      ownEndDate: '2026-07-30',
      normalizeCategory: normalize,
    });
    expect(result.sentences).toHaveLength(5);
    expect(result.sentences.map((s) => s.tone)).toEqual(['red', 'red', 'yellow', 'yellow', 'blue']);
  });

  it('wählt die höchstpriorisierte Backend-Empfehlung der eigenen Konfliktgruppe', () => {
    const result = buildConflictSentences({
      dayVisuals: [openVisual({})],
      relatedPlannings: {},
      ownPlanningId: 'pln-own',
      ownEndDate: '2026-07-30',
      normalizeCategory: normalize,
      conflictGroups: [
        {
          id: 'g1',
          categoryKey: 'QR-Scanner',
          dateFrom: '2026-07-20',
          dateTo: '2026-07-21',
          maxMissingQty: 2,
          totalConflictEvents: 2,
          affectedPlanningCount: 2,
          affectedPlanningIds: ['pln-own', 'pln-block'],
          affectedPlanningLabels: ['Eigenes', 'Siemens Hausmesse'],
          days: [],
          recommendations: [
            { type: 'planning_adjustment', priority: 'low', title: 'Bedarf reduzieren', description: '' },
            { type: 'procurement', priority: 'high', title: '2 QR-Scanner zumieten', description: '' },
          ],
        },
      ],
    });
    expect(result.recommendation).toBe('2 QR-Scanner zumieten');
  });

  it('keine Sätze und keine Empfehlung bei rein grüner Lage', () => {
    const result = buildConflictSentences({
      dayVisuals: [{ status: 'ok', shortageQty: 0, usableStock: 5, categoryKey: 'Laptop', planningDate: '2026-07-20' }],
      relatedPlannings: {},
      ownPlanningId: 'pln-own',
      ownEndDate: '2026-07-30',
      normalizeCategory: normalize,
    });
    expect(result.sentences).toHaveLength(0);
    expect(result.recommendation).toBeNull();
  });
});

describe('addDaysIso', () => {
  it('addiert über Monatsgrenzen', () => {
    expect(addDaysIso('2026-07-30', 3)).toBe('2026-08-02');
  });
});
