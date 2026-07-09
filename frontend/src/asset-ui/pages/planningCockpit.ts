import type {
  ConflictGroup,
  PlanningAvailabilityCategorySummary,
  PlanningStatus,
} from '../../services/wmsApi';

// Reine, UI-freie Ableitungen für das Planungs-Cockpit (Detail-Panel,
// Bedarf-Tabelle, verständliche Konflikte, Prüf-Modal). Bewusst ohne React
// und ohne API-Zugriffe — die Eingaben kommen aus den bereits geladenen
// Daten der PlanningPage (insb. der bestehenden availabilityVisualMap, deren
// Status-Präzedenz hier NICHT neu berechnet, sondern nur konsumiert wird).

// ---------------------------------------------------------------------------
// Timeline: Phasen sind KEIN gespeicherter Status (siehe
// docs/STATUS_LIFECYCLE.md), sondern eine reine Ableitung aus Status, Zeitraum
// und Ausgabe-Stand — nur zur Orientierung im Detail-Panel.
// ---------------------------------------------------------------------------

export type PlanningPhaseKey =
  | 'planung'
  | 'vorbereitung'
  | 'ausgabe'
  | 'einsatz'
  | 'rueckgabe'
  | 'abschluss';

export type PlanningPhaseState = 'done' | 'active' | 'upcoming';

export type PlanningPhase = {
  key: PlanningPhaseKey;
  label: string;
  state: PlanningPhaseState;
};

export type PlanningTimelineResult = {
  phases: PlanningPhase[];
  // Storniert: Phasen sind bedeutungslos — UI dimmt den Stepper und zeigt
  // stattdessen einen Hinweis-Badge.
  cancelled: boolean;
};

const PHASE_LABELS: Record<PlanningPhaseKey, string> = {
  planung: 'Planung',
  vorbereitung: 'Vorbereitung',
  ausgabe: 'Ausgabe',
  einsatz: 'Einsatz',
  rueckgabe: 'Rückgabe',
  abschluss: 'Abschluss',
};

const PHASE_ORDER: PlanningPhaseKey[] = [
  'planung',
  'vorbereitung',
  'ausgabe',
  'einsatz',
  'rueckgabe',
  'abschluss',
];

function normalizeStatus(status: PlanningStatus): Exclude<PlanningStatus, 'Bestaetigt'> {
  return status === 'Bestaetigt' ? 'Bestätigt' : status;
}

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

export type DerivePlanningPhasesInput = {
  status: PlanningStatus;
  startDate: string;
  endDate: string;
  returnBufferDays?: number;
  // Heutiges Datum als ISO (YYYY-MM-DD) — wird hereingereicht, damit die
  // Funktion pur und testbar bleibt.
  today: string;
  // Aus PlanningAssignedAssetsResponse: bereits physisch ausgegebene vs.
  // geplante Geräte. undefined = Daten (noch) nicht geladen → Datumslogik.
  issuedQty?: number;
  plannedQty?: number;
};

export function derivePlanningPhases(input: DerivePlanningPhasesInput): PlanningTimelineResult {
  const status = normalizeStatus(input.status);
  const buildPhases = (activeIndex: number, allDone = false): PlanningPhase[] =>
    PHASE_ORDER.map((key, index) => ({
      key,
      label: PHASE_LABELS[key],
      state: allDone ? 'done' : index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'upcoming',
    }));

  if (status === 'Storniert') {
    return {
      phases: PHASE_ORDER.map((key) => ({ key, label: PHASE_LABELS[key], state: 'upcoming' })),
      cancelled: true,
    };
  }
  if (status === 'Abgeschlossen') {
    return { phases: buildPhases(PHASE_ORDER.length, true), cancelled: false };
  }
  if (status === 'Entwurf') {
    return { phases: buildPhases(0), cancelled: false };
  }

  // Status Geplant/Bestätigt: Fortschritt aus Zeitraum + Ausgabe-Stand.
  const { startDate, endDate, today } = input;
  const returnEnd = addDaysIso(endDate, Math.max(0, input.returnBufferDays ?? 0));
  const issued = input.issuedQty ?? 0;
  const planned = input.plannedQty ?? 0;
  const fullyIssued = planned > 0 && issued >= planned;
  const partiallyIssued = issued > 0 && !fullyIssued;

  if (today < startDate) {
    // Vor Projektstart: sobald etwas ausgegeben wurde, läuft die Ausgabe.
    return { phases: buildPhases(partiallyIssued || fullyIssued ? 2 : 1), cancelled: false };
  }
  if (today <= endDate) {
    // Im Einsatzzeitraum: Ausgabe gilt als abgeschlossen, sobald vollständig
    // ausgegeben wurde ODER der Einsatz läuft (Fallback ohne Ausgabedaten).
    return { phases: buildPhases(partiallyIssued ? 2 : 3), cancelled: false };
  }
  if (today <= returnEnd || issued > 0) {
    // Nach Projektende bis Pufferende — oder solange noch Geräte draußen sind.
    return { phases: buildPhases(4), cancelled: false };
  }
  // Zeitraum + Puffer vorbei, nichts mehr draußen, aber Status nicht
  // "Abgeschlossen": Der Abschluss steht als nächster Schritt an.
  return { phases: buildPhases(5), cancelled: false };
}

// ---------------------------------------------------------------------------
// Hardwarebedarf-Tabelle: Aggregation Tag×Kategorie → eine Zeile pro
// Kategorie. Konsumiert den bereits berechneten Worst-Status pro Kategorie
// (availabilityVisualByCategoryForRange in PlanningPage) — keine eigene
// Status-Logik.
// ---------------------------------------------------------------------------

// Strukturelle Untermenge von AvailabilityVisual (PlanningPage) — nur die
// Felder, die das Cockpit braucht. Hält dieses Modul frei von einem Import
// aus der Seiten-Datei.
export type CategoryVisualLike = {
  status: 'ok' | 'handover' | 'review' | 'open';
  reviewReason?: 'incomplete_link' | 'missing_link' | 'low_reserve' | null;
  shortageQty: number;
  usableStock: number;
  partnerLabel?: string;
  affectedPlanningIds?: string[];
  handoverCoveredQty?: number;
};

export type NeedRowTone = 'green' | 'yellow' | 'red' | 'blue';

export type CategoryNeedRow = {
  categoryKey: string;
  // Peak-Bedarf pro Tag — Bestand konkurriert tagesweise, daher ist der
  // Spitzenwert die fachlich richtige "Benötigt"-Zahl.
  requiredPeak: number;
  // Summe über den Zeitraum (Tooltip/Zusatzinfo).
  requiredTotal: number;
  available: number;
  missing: number;
  tone: NeedRowTone;
  statusLabel: string;
  actionHint: string | null;
};

const TONE_RANK: Record<NeedRowTone, number> = { red: 3, yellow: 2, blue: 1, green: 0 };

export function aggregateCategoryNeeds(
  categorySummary: PlanningAvailabilityCategorySummary[],
  visualByCategory: ReadonlyMap<string, CategoryVisualLike>,
  normalizeCategory: (key: string) => string,
): CategoryNeedRow[] {
  const rows: CategoryNeedRow[] = [];
  for (const summary of categorySummary) {
    const normalized = normalizeCategory(summary.categoryKey);
    const visual = visualByCategory.get(normalized);

    let tone: NeedRowTone = 'green';
    let statusLabel = 'Verfügbar';
    let actionHint: string | null = null;
    let missing = 0;

    if (visual) {
      missing = Math.max(0, visual.shortageQty);
      if (visual.status === 'open') {
        tone = 'red';
        statusLabel = 'Konflikt';
        actionHint = (visual.affectedPlanningIds?.length ?? 0) > 0
          ? 'Konflikt lösen'
          : 'Geräte mieten oder Fremdbestand buchen';
      } else if (visual.status === 'review') {
        tone = 'yellow';
        if (visual.reviewReason === 'low_reserve') {
          statusLabel = 'Bestand knapp';
          actionHint = 'Reserve im Blick behalten';
        } else {
          statusLabel = 'Prüfung nötig';
          actionHint = 'Verknüpfung prüfen';
        }
      } else if (visual.status === 'handover') {
        tone = 'blue';
        statusLabel = 'Übergabe';
        actionHint = visual.partnerLabel ? `Übergabe aus ‚${visual.partnerLabel}‘` : 'Übergabe geplant';
      }
    }

    rows.push({
      categoryKey: summary.categoryKey,
      requiredPeak: summary.maxRequestedPerDay,
      requiredTotal: summary.requestedTotal,
      available: summary.usableStock,
      missing,
      tone,
      statusLabel,
      actionHint,
    });
  }

  // Kritisches zuerst, danach alphabetisch — die Tabelle bleibt kurz genug,
  // dass keine Filterung nötig ist.
  rows.sort((a, b) => {
    const rankDiff = TONE_RANK[b.tone] - TONE_RANK[a.tone];
    if (rankDiff !== 0) return rankDiff;
    return a.categoryKey.localeCompare(b.categoryKey, 'de');
  });
  return rows;
}

export type NeedsSummary = {
  plannedTotal: number;
  coveredTotal: number;
  missingTotal: number;
};

// Summary-Zeile "X Geräte geplant · Y verfügbar · Z fehlen". "Verfügbar" ist
// hier bewusst der gedeckte Anteil (geplant − fehlend), damit die drei Zahlen
// zusammenpassen — der echte Bestand steht in der Tabellen-Spalte.
export function summarizeNeeds(rows: CategoryNeedRow[]): NeedsSummary {
  let plannedTotal = 0;
  let missingTotal = 0;
  for (const row of rows) {
    plannedTotal += Math.max(0, row.requiredPeak);
    missingTotal += Math.min(Math.max(0, row.missing), Math.max(0, row.requiredPeak));
  }
  return {
    plannedTotal,
    coveredTotal: Math.max(0, plannedTotal - missingTotal),
    missingTotal,
  };
}

// ---------------------------------------------------------------------------
// Verständliche Konflikte: baut aus den Tages-Visuals + aufgelösten
// Partner-Planungen kurze deutsche Sätze. Reine Präsentation — keine neue
// Konfliktlogik.
// ---------------------------------------------------------------------------

export type ConflictSentenceTone = 'red' | 'yellow' | 'blue';

export type ConflictSentence = {
  tone: ConflictSentenceTone;
  text: string;
  categoryKey: string;
};

export type ConflictSentencesResult = {
  // ALLE Sätze (rot > gelb > blau sortiert) — die UI zeigt die ersten vier
  // und bietet "+N weitere" zum Aufklappen an.
  sentences: ConflictSentence[];
  // Lösungsvorschlag (aus Backend-Recommendations der Konfliktgruppen, sonst
  // generischer Fallback bei roten Konflikten).
  recommendation: string | null;
};

export type DayVisualLike = CategoryVisualLike & {
  categoryKey: string;
  planningDate: string;
  otherPlannedQty?: number;
};

export type RelatedPlanningLike = {
  id: string;
  projectName: string;
  customerName?: string;
  eventName?: string | null;
  startDate: string;
  endDate: string;
  returnBufferDays?: number;
};

function formatQtyCategory(qty: number, categoryKey: string): string {
  // "2× QR-Scanner" statt riskanter Pluralbildung deutscher Substantive.
  return `${qty}× ${categoryKey}`;
}

function blockerLabel(planning: RelatedPlanningLike): string {
  return planning.eventName?.trim()
    ? `${planning.projectName} (${planning.eventName.trim()})`
    : planning.projectName;
}

export function buildConflictSentences(input: {
  dayVisuals: DayVisualLike[];
  relatedPlannings: Record<string, RelatedPlanningLike>;
  conflictGroups?: ConflictGroup[];
  ownPlanningId: string;
  ownEndDate: string;
  normalizeCategory: (key: string) => string;
}): ConflictSentencesResult {
  const { dayVisuals, relatedPlannings, conflictGroups, ownPlanningId, ownEndDate } = input;

  // Pro Kategorie den schwersten Tag wählen (open > review > handover; bei
  // gleichem Status größere Fehlmenge) — ein Satz pro Kategorie und Ton.
  const worstByCategory = new Map<string, DayVisualLike>();
  const statusRank = (v: DayVisualLike) =>
    v.status === 'open' ? 3 : v.status === 'review' ? 2 : v.status === 'handover' ? 1 : 0;
  for (const visual of dayVisuals) {
    if (visual.status === 'ok') continue;
    const key = input.normalizeCategory(visual.categoryKey);
    const current = worstByCategory.get(key);
    if (
      !current ||
      statusRank(visual) > statusRank(current) ||
      (statusRank(visual) === statusRank(current) && visual.shortageQty > current.shortageQty)
    ) {
      worstByCategory.set(key, visual);
    }
  }

  const sentences: ConflictSentence[] = [];
  let hasRed = false;

  for (const visual of worstByCategory.values()) {
    const category = visual.categoryKey;
    if (visual.status === 'open') {
      hasRed = true;
      const qty = Math.max(1, visual.shortageQty);
      const blockerId = (visual.affectedPlanningIds ?? []).find(
        (id) => id && id !== ownPlanningId && relatedPlannings[id],
      );
      const blocker = blockerId ? relatedPlannings[blockerId] : undefined;
      if (blocker) {
        const freeAgain = addDaysIso(blocker.endDate, Math.max(0, blocker.returnBufferDays ?? 0) + 1);
        if (blocker.endDate < ownEndDate) {
          // Der Blocker gibt den Bestand innerhalb des eigenen Zeitraums
          // wieder frei → das Rückgabedatum ist die hilfreichste Information.
          sentences.push({
            tone: 'red',
            categoryKey: category,
            text: `${formatQtyCategory(qty, category)} kommen erst am ${formatGermanDateShort(freeAgain)} zurück (im Einsatz für ‚${blockerLabel(blocker)}‘).`,
          });
        } else {
          sentences.push({
            tone: 'red',
            categoryKey: category,
            text: `${formatQtyCategory(qty, category)} ${qty === 1 ? 'wird' : 'werden'} bereits für Projekt ‚${blockerLabel(blocker)}‘ benötigt.`,
          });
        }
      } else if ((visual.affectedPlanningIds ?? []).length > 0) {
        sentences.push({
          tone: 'red',
          categoryKey: category,
          text: `${formatQtyCategory(qty, category)} ${qty === 1 ? 'ist' : 'sind'} im Zeitraum bereits für ein anderes Projekt eingeplant.`,
        });
      } else {
        // Kein konkurrierendes Projekt bekannt: Geräte sind verliehen oder
        // schlicht nicht im Bestand. (Rückgabedatum wäre nur mit dem
        // vorgeschlagenen Backend-Feld returnBlockers möglich.)
        sentences.push({
          tone: 'red',
          categoryKey: category,
          text: `${formatQtyCategory(qty, category)} ${qty === 1 ? 'fehlt' : 'fehlen'} im Bestand oder ${qty === 1 ? 'ist' : 'sind'} aktuell verliehen und noch nicht zurück.`,
        });
      }
    } else if (visual.status === 'review') {
      sentences.push({
        tone: 'yellow',
        categoryKey: category,
        text:
          visual.reviewReason === 'low_reserve'
            ? `${category}: Bestand reicht, aber es bleibt kaum Reserve.`
            : `${category}: Übergabe-Verknüpfung prüfen — das Partnerprojekt fehlt oder existiert nicht mehr.`,
      });
    } else if (visual.status === 'handover') {
      const qty = Math.max(1, visual.handoverCoveredQty ?? 0);
      sentences.push({
        tone: 'blue',
        categoryKey: category,
        text: visual.partnerLabel
          ? `${formatQtyCategory(qty, category)} ${qty === 1 ? 'kommt' : 'kommen'} per Übergabe aus ‚${visual.partnerLabel}‘.`
          : `${formatQtyCategory(qty, category)} ${qty === 1 ? 'ist' : 'sind'} über eine Projektübergabe gedeckt.`,
      });
    }
  }

  // Rot vor Gelb vor Blau, dann alphabetisch stabil.
  const toneRank: Record<ConflictSentenceTone, number> = { red: 2, yellow: 1, blue: 0 };
  sentences.sort((a, b) => {
    const rankDiff = toneRank[b.tone] - toneRank[a.tone];
    if (rankDiff !== 0) return rankDiff;
    return a.categoryKey.localeCompare(b.categoryKey, 'de');
  });

  let recommendation: string | null = null;
  let recommendationRank = -1;
  const priorityRank: Record<string, number> = { high: 2, medium: 1, low: 0 };
  for (const group of conflictGroups ?? []) {
    if (!group.affectedPlanningIds?.includes(ownPlanningId)) continue;
    for (const rec of group.recommendations ?? []) {
      const rank = priorityRank[rec.priority] ?? 0;
      if (rank > recommendationRank) {
        recommendation = rec.title;
        recommendationRank = rank;
      }
    }
  }
  if (!recommendation && hasRed) {
    recommendation = 'Rückgabe priorisieren, Bedarf anpassen oder Fremdbestand buchen.';
  }

  return { sentences, recommendation };
}
