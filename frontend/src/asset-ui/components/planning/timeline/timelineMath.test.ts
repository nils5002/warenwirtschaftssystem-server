import { describe, expect, it } from 'vitest';

import type { PlanningListItem } from '../../../../services/wmsApi';
import {
  buildMonthWeekStarts,
  buildUtilization,
  deriveTimelineStatus,
  getIsoWeekNumber,
  getReturnWindow,
  getWeekStartIso,
  packTimelineLanes,
} from './timelineMath';

function planning(overrides: Partial<PlanningListItem>): PlanningListItem {
  return {
    id: 'pln-1',
    customerName: 'Kunde',
    projectName: 'Projekt',
    startDate: '2026-07-07',
    endDate: '2026-07-22',
    status: 'Geplant',
    updatedAt: '2026-07-01T00:00:00Z',
    returnBufferDays: 0,
    totalQty: 12,
    ...overrides,
  } as PlanningListItem;
}

describe('deriveTimelineStatus', () => {
  it('meldet Abgeschlossen/Storniert als neutral', () => {
    expect(deriveTimelineStatus(planning({ status: 'Abgeschlossen' })).status).toBe('gray');
    expect(deriveTimelineStatus(planning({ status: 'Storniert' })).status).toBe('gray');
  });

  it('priorisiert Konflikte vor Prüfung vor Verbund vor Grün', () => {
    expect(
      deriveTimelineStatus(planning({ openConflictCount: 2, handoverNeedsReview: true })).status,
    ).toBe('red');
    expect(deriveTimelineStatus(planning({ handoverNeedsReview: true })).status).toBe('amber');
    expect(
      deriveTimelineStatus(
        planning({
          handoverSummary: { direction: 'outgoing', partnerPlanningCount: 1, categoryKeys: [] },
        }),
      ).status,
    ).toBe('sky');
    expect(deriveTimelineStatus(planning({})).status).toBe('green');
  });
});

describe('Wochen-Mathematik', () => {
  it('liefert Montag als Wochenstart (Sonntag gehört zur Vorwoche)', () => {
    expect(getWeekStartIso('2026-07-09')).toBe('2026-07-06'); // Do -> Mo
    expect(getWeekStartIso('2026-07-06')).toBe('2026-07-06'); // Mo -> Mo
    expect(getWeekStartIso('2026-07-12')).toBe('2026-07-06'); // So -> Mo
  });

  it('berechnet die ISO-Kalenderwoche', () => {
    expect(getIsoWeekNumber('2026-07-09')).toBe(28);
    expect(getIsoWeekNumber('2026-01-01')).toBe(1);
  });

  it('liefert alle Wochenzeilen eines Monats', () => {
    const weeks = buildMonthWeekStarts('2026-07-09');
    expect(weeks[0]).toBe('2026-06-29');
    expect(weeks[weeks.length - 1]).toBe('2026-07-27');
    expect(weeks).toHaveLength(5);
  });
});

describe('getReturnWindow', () => {
  it('ist ohne Puffer genau der Rückgabetag', () => {
    expect(getReturnWindow(planning({}))).toEqual({
      startIso: '2026-07-22',
      endExclusiveIso: '2026-07-23',
    });
  });

  it('verlängert sich um den Rückgabe-Puffer', () => {
    expect(getReturnWindow(planning({ returnBufferDays: 2 }))).toEqual({
      startIso: '2026-07-22',
      endExclusiveIso: '2026-07-24',
    });
  });

  it('Eintages-Planung: Rückgabetag ist der Folgetag', () => {
    expect(getReturnWindow(planning({ startDate: '2026-07-07', endDate: '2026-07-07' }))).toEqual({
      startIso: '2026-07-08',
      endExclusiveIso: '2026-07-09',
    });
  });
});

describe('packTimelineLanes', () => {
  it('clippt einen langen Einsatz auf die Woche und markiert den Überlauf', () => {
    const lanes = packTimelineLanes([planning({})], '2026-07-06', 7);
    expect(lanes).toHaveLength(1);
    const [einsatz] = lanes[0];
    expect(einsatz.kind).toBe('einsatz');
    expect(einsatz.startCol).toBe(2); // Di 07.07.
    expect(einsatz.endCol).toBe(7); // bis So einschließlich
    expect(einsatz.clippedStart).toBe(false);
    expect(einsatz.clippedEnd).toBe(true);
    // Rückgabefenster (22.07.) liegt außerhalb dieser Woche.
    expect(lanes[0]).toHaveLength(1);
  });

  it('zeigt in der Rückgabewoche Einsatz-Ende + gestricheltes Segment', () => {
    const lanes = packTimelineLanes([planning({})], '2026-07-20', 7);
    const [einsatz, rueckgabe] = lanes[0];
    expect(einsatz.kind).toBe('einsatz');
    expect(einsatz.startCol).toBe(1);
    expect(einsatz.endCol).toBe(2); // letzter Einsatztag 21.07.
    expect(einsatz.clippedStart).toBe(true);
    expect(einsatz.clippedEnd).toBe(false);
    expect(rueckgabe.kind).toBe('rueckgabe');
    expect(rueckgabe.startCol).toBe(3); // 22.07.
    expect(rueckgabe.endCol).toBe(3);
  });

  it('legt überlappende Planungen in getrennte Lanes, nicht überlappende in dieselbe', () => {
    const a = planning({ id: 'pln-a', startDate: '2026-07-06', endDate: '2026-07-09' });
    const b = planning({ id: 'pln-b', startDate: '2026-07-08', endDate: '2026-07-10' });
    // c beginnt erst nach dem Rückgabefenster von a (Rückgabetag 09.07.).
    const c = planning({ id: 'pln-c', startDate: '2026-07-10', endDate: '2026-07-11' });
    const lanes = packTimelineLanes([a, b, c], '2026-07-06', 7);
    expect(lanes).toHaveLength(2);
    const laneIds = lanes.map((lane) => new Set(lane.map((segment) => segment.planning.id)));
    expect(laneIds[0]).toEqual(new Set(['pln-a', 'pln-c']));
    expect(laneIds[1]).toEqual(new Set(['pln-b']));
  });

  it('blockiert die Lane auch über das Rückgabefenster (Puffer)', () => {
    const a = planning({ id: 'pln-a', startDate: '2026-07-06', endDate: '2026-07-08', returnBufferDays: 2 });
    // b beginnt am 09.07. — Rückgabefenster von a läuft bis einschließlich 09.07.
    const b = planning({ id: 'pln-b', startDate: '2026-07-09', endDate: '2026-07-10' });
    const lanes = packTimelineLanes([a, b], '2026-07-06', 7);
    expect(lanes).toHaveLength(2);
  });
});

describe('buildUtilization', () => {
  it('summiert Geräte pro Tag und weist Rückgabemengen aus', () => {
    const a = planning({ id: 'pln-a', startDate: '2026-07-06', endDate: '2026-07-08', totalQty: 10 });
    const b = planning({ id: 'pln-b', startDate: '2026-07-07', endDate: '2026-07-09', totalQty: 5 });
    const days = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09'];
    expect(buildUtilization([a, b], days)).toEqual([
      { inUse: 10, returning: 0 },
      { inUse: 15, returning: 0 },
      { inUse: 5, returning: 10 }, // a: Rückgabetag 08.07., b läuft noch
      { inUse: 0, returning: 5 },
    ]);
  });

  it('ignoriert stornierte und abgeschlossene Planungen', () => {
    const cancelled = planning({ status: 'Storniert', totalQty: 99 });
    const done = planning({ id: 'pln-d', status: 'Abgeschlossen', totalQty: 50 });
    expect(buildUtilization([cancelled, done], ['2026-07-08'])).toEqual([
      { inUse: 0, returning: 0 },
    ]);
  });
});
