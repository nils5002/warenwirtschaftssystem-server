import { AlertTriangle, Calendar, ChevronLeft, ChevronRight, Link2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type {
  PlanningAvailabilityResponse,
  PlanningListItem,
  PlanningResponse,
  PlanningStatus,
} from '../../services/wmsApi';
import { normalizeCategory } from '../categories';

type PlanningListHandoverSummary = NonNullable<PlanningListItem['handoverSummary']>;

type PlanningCalendarAddOnProps = {
  plannings: PlanningListItem[];
  selectedId: string;
  handoverSummaryById: Map<string, PlanningListHandoverSummary>;
  planningDetailsById: Record<string, PlanningResponse>;
  availabilityByPlanningId: Record<string, PlanningAvailabilityResponse>;
  onSelectPlanning: (planningId: string) => void;
  requestPlanningData: (planningIds: string[]) => void;
};

type CalendarVisualStatus = 'green' | 'sky' | 'amber' | 'red' | 'gray';
type NetworkTone = 'sky' | 'teal' | 'indigo' | 'violet' | 'cyan' | 'amber';
type NetworkSummary = {
  partnerLabel: string;
  memberCount: number;
};

const NETWORK_TONES: NetworkTone[] = ['sky', 'teal', 'indigo', 'violet', 'cyan', 'amber'];

function toIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatGermanDate(isoDate: string): string {
  if (!isoDate) return '';
  const [year, month, day] = isoDate.split('-');
  if (!year || !month || !day) return isoDate;
  return `${day}.${month}.${year}`;
}

function getWeekStartMonday(anchor: Date): Date {
  const start = new Date(anchor);
  start.setHours(0, 0, 0, 0);
  const day = start.getDay();
  const shift = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + shift);
  return start;
}

function buildWeekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(weekStart);
    day.setDate(weekStart.getDate() + index);
    return day;
  });
}

function addDaysIso(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

function periodEndExclusiveIso(startDate: string, endDate: string): string {
  if (endDate > startDate) return endDate;
  return addDaysIso(startDate, 1);
}

function projectOverlapsWeek(project: Pick<PlanningListItem, 'startDate' | 'endDate'>, weekStartIso: string, weekEndIso: string): boolean {
  const weekEndExclusive = addDaysIso(weekEndIso, 1);
  const projectEndExclusive = periodEndExclusiveIso(project.startDate, project.endDate);
  return project.startDate < weekEndExclusive && weekStartIso < projectEndExclusive;
}

function buildDemandSummary(items: PlanningResponse['days'][number]['items']): string {
  const qtyByCategory = new Map<string, number>();
  for (const item of items) {
    const key = normalizeCategory(item.categoryKey);
    qtyByCategory.set(key, (qtyByCategory.get(key) ?? 0) + Math.max(0, Number(item.qty || 0)));
  }
  const top = Array.from(qtyByCategory.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([key, qty]) => `${key} ${qty}`);
  return top.join(' · ');
}

function getVisualStatus(
  planning: PlanningListItem,
  handoverSummary: PlanningListHandoverSummary | undefined,
  availability: PlanningAvailabilityResponse | undefined,
): { status: CalendarVisualStatus; label: string } {
  const neutralStatuses: PlanningStatus[] = ['Entwurf', 'Abgeschlossen', 'Storniert'];
  if (neutralStatuses.includes(planning.status)) {
    return { status: 'gray', label: planning.status };
  }

  const hasHandover = Boolean(handoverSummary);
  if (!availability) {
    return hasHandover ? { status: 'sky', label: 'Übergabe geplant' } : { status: 'green', label: 'Alles verfügbar' };
  }

  const hasOpenShortage = availability.items.some((item) => {
    const hasGlobalShortage =
      Boolean(item.hasGlobalShortage) || item.shortageQty > 0 || item.remainingAfterAllPlanning < 0;
    const handoverCoveredQty = Math.max(0, Number(item.handoverCoveredQty ?? 0));
    const isFullyCoveredByHandover =
      Boolean(item.handoverEnabled && item.linkedPlanningId) &&
      handoverCoveredQty > 0 &&
      item.shortageQty <= 0;
    return hasGlobalShortage && !isFullyCoveredByHandover;
  });
  if (hasOpenShortage) {
    return { status: 'red', label: 'Offener Engpass' };
  }

  const needsReview = availability.items.some((item) => item.handoverEnabled && !item.linkedPlanningId);
  if (needsReview) {
    return { status: 'amber', label: 'Prüfung nötig' };
  }

  if (hasHandover) {
    return { status: 'sky', label: 'Verbund aktiv' };
  }

  return { status: 'green', label: 'Alles verfügbar' };
}

function barClasses(status: CalendarVisualStatus, active: boolean): string {
  const base = 'rounded-2xl border p-3 text-left transition shadow-sm hover:shadow';
  const ring = active ? ' ring-2 ring-brand-300 dark:ring-brand-700' : '';
  if (status === 'red') return `${base} border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-700 dark:bg-rose-950/35 dark:text-rose-100${ring}`;
  if (status === 'amber') return `${base} border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/35 dark:text-amber-100${ring}`;
  if (status === 'sky') return `${base} border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-700 dark:bg-sky-950/35 dark:text-sky-100${ring}`;
  if (status === 'gray') return `${base} border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-900/55 dark:text-slate-200${ring}`;
  return `${base} border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-100${ring}`;
}

function networkToneClasses(tone: NetworkTone, active: boolean): string {
  const ring = active ? ' ring-2 ring-brand-300 dark:ring-brand-700' : '';
  if (tone === 'teal') return `rounded-2xl border p-3 text-left transition shadow-sm hover:shadow border-teal-300 bg-teal-50 text-teal-900 dark:border-teal-700 dark:bg-teal-950/30 dark:text-teal-100${ring}`;
  if (tone === 'indigo') return `rounded-2xl border p-3 text-left transition shadow-sm hover:shadow border-indigo-300 bg-indigo-50 text-indigo-900 dark:border-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-100${ring}`;
  if (tone === 'violet') return `rounded-2xl border p-3 text-left transition shadow-sm hover:shadow border-violet-300 bg-violet-50 text-violet-900 dark:border-violet-700 dark:bg-violet-950/30 dark:text-violet-100${ring}`;
  if (tone === 'cyan') return `rounded-2xl border p-3 text-left transition shadow-sm hover:shadow border-cyan-300 bg-cyan-50 text-cyan-900 dark:border-cyan-700 dark:bg-cyan-950/30 dark:text-cyan-100${ring}`;
  if (tone === 'amber') return `rounded-2xl border p-3 text-left transition shadow-sm hover:shadow border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100${ring}`;
  return `rounded-2xl border p-3 text-left transition shadow-sm hover:shadow border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-700 dark:bg-sky-950/30 dark:text-sky-100${ring}`;
}

// Sekundärer Verbund-Akzent als schmaler Top-Streifen / Punkt.
// Bewusst NUR als Akzentfarbe (background-color) — die fachliche
// Statusfarbe der Karte (grün/blau/gelb/rot) wird dadurch NIE überdeckt.
function networkRibbonClasses(tone: NetworkTone): string {
  if (tone === 'teal') return 'bg-teal-500 dark:bg-teal-400';
  if (tone === 'indigo') return 'bg-indigo-500 dark:bg-indigo-400';
  if (tone === 'violet') return 'bg-violet-500 dark:bg-violet-400';
  if (tone === 'cyan') return 'bg-cyan-500 dark:bg-cyan-400';
  if (tone === 'amber') return 'bg-amber-500 dark:bg-amber-400';
  return 'bg-sky-500 dark:bg-sky-400';
}

function networkBadgeClasses(tone: NetworkTone): string {
  if (tone === 'teal') return 'border-teal-200 bg-white/80 text-teal-700 dark:border-teal-700 dark:bg-slate-950/40 dark:text-teal-100';
  if (tone === 'indigo') return 'border-indigo-200 bg-white/80 text-indigo-700 dark:border-indigo-700 dark:bg-slate-950/40 dark:text-indigo-100';
  if (tone === 'violet') return 'border-violet-200 bg-white/80 text-violet-700 dark:border-violet-700 dark:bg-slate-950/40 dark:text-violet-100';
  if (tone === 'cyan') return 'border-cyan-200 bg-white/80 text-cyan-700 dark:border-cyan-700 dark:bg-slate-950/40 dark:text-cyan-100';
  if (tone === 'amber') return 'border-amber-200 bg-white/80 text-amber-700 dark:border-amber-700 dark:bg-slate-950/40 dark:text-amber-100';
  return 'border-sky-200 bg-white/80 text-sky-700 dark:border-sky-700 dark:bg-slate-950/40 dark:text-sky-100';
}

export function PlanningCalendarAddOn({
  plannings,
  selectedId,
  handoverSummaryById,
  planningDetailsById,
  availabilityByPlanningId,
  onSelectPlanning,
  requestPlanningData,
}: PlanningCalendarAddOnProps) {
  const [anchorDate, setAnchorDate] = useState<Date>(new Date());
  const [showCalendar, setShowCalendar] = useState(true);

  const weekStart = useMemo(() => getWeekStartMonday(anchorDate), [anchorDate]);
  const weekDays = useMemo(() => buildWeekDays(weekStart), [weekStart]);
  const weekStartIso = useMemo(() => toIsoDate(weekDays[0]), [weekDays]);
  const weekEndIso = useMemo(() => toIsoDate(weekDays[6]), [weekDays]);
  const todayIso = useMemo(() => toIsoDate(new Date()), []);

  const weekPlannings = useMemo(
    () =>
      plannings
        .filter((planning) => projectOverlapsWeek(planning, weekStartIso, weekEndIso))
        .sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [plannings, weekEndIso, weekStartIso],
  );

  useEffect(() => {
    requestPlanningData(weekPlannings.map((item) => item.id));
  }, [requestPlanningData, weekPlannings]);

  const networkMetaByPlanningId = useMemo(() => {
    const visibleIds = new Set(weekPlannings.map((item) => item.id));
    const adjacency = new Map<string, Set<string>>();
    const ensureNode = (planningId: string) => {
      if (!adjacency.has(planningId)) adjacency.set(planningId, new Set<string>());
    };
    const addEdge = (fromId: string, toId: string) => {
      if (!fromId || !toId) return;
      ensureNode(fromId);
      ensureNode(toId);
      adjacency.get(fromId)?.add(toId);
      adjacency.get(toId)?.add(fromId);
    };

    for (const planningId of visibleIds) ensureNode(planningId);
    for (const [planningId, summary] of handoverSummaryById.entries()) {
      if (!visibleIds.has(planningId) || !summary.partnerPlanningId) continue;
      addEdge(planningId, summary.partnerPlanningId);
    }

    const planningById = new Map(weekPlannings.map((planning) => [planning.id, planning]));
    for (const planning of weekPlannings) {
      const details = planningDetailsById[planning.id];
      if (!details) continue;
      for (const day of details.days) {
        for (const item of day.items) {
          if (!item.handoverEnabled || !item.linkedPlanningId || !visibleIds.has(item.linkedPlanningId)) continue;
          addEdge(planning.id, item.linkedPlanningId);
        }
      }
    }

    const meta = new Map<string, { tone: NetworkTone; summary: NetworkSummary }>();
    const visited = new Set<string>();
    const components: string[][] = [];

    for (const planningId of visibleIds) {
      if (visited.has(planningId)) continue;
      const queue = [planningId];
      const component: string[] = [];
      visited.add(planningId);
      while (queue.length) {
        const current = queue.shift();
        if (!current) continue;
        component.push(current);
        for (const neighbour of adjacency.get(current) ?? []) {
          if (visited.has(neighbour) || !visibleIds.has(neighbour)) continue;
          visited.add(neighbour);
          queue.push(neighbour);
        }
      }
      if (component.length > 1) {
        components.push(component.sort((a, b) => a.localeCompare(b, 'de')));
      }
    }

    components
      .sort((a, b) => {
        const aStart = (planningById.get(a[0])?.startDate ?? '9999-12-31');
        const bStart = (planningById.get(b[0])?.startDate ?? '9999-12-31');
        if (aStart !== bStart) return aStart.localeCompare(bStart);
        return a[0].localeCompare(b[0], 'de');
      })
      .forEach((component, index) => {
        const tone = NETWORK_TONES[index % NETWORK_TONES.length];
        const labels = component
          .map((id) => planningById.get(id)?.projectName || `Projekt ${id.slice(-4)}`)
          .filter(Boolean);
        const partnerLabel = labels.slice(0, 2).join(' ↔ ');
        for (const memberId of component) {
          meta.set(memberId, {
            tone,
            summary: {
              memberCount: component.length,
              partnerLabel,
            },
          });
        }
      });

    return meta;
  }, [handoverSummaryById, planningDetailsById, weekPlannings]);

  return (
    <article className="rounded-2xl border border-slate-200/90 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/40 lg:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-slate-900">Kalenderübersicht</h3>
          <p className="text-xs text-slate-500">Wochenansicht als Add-on zur bestehenden Einsatzplanung.</p>
        </div>
        <div className="inline-flex overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <button type="button" className={`px-4 py-2 text-xs font-semibold ${!showCalendar ? 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300'}`} onClick={() => setShowCalendar(false)}>
            Planung bearbeiten
          </button>
          <button type="button" className={`px-4 py-2 text-xs font-semibold ${showCalendar ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/35 dark:text-brand-200' : 'text-slate-600 dark:text-slate-300'}`} onClick={() => setShowCalendar(true)}>
            Kalenderübersicht
          </button>
        </div>
      </div>

      {showCalendar ? (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white/85 p-2 dark:border-slate-800 dark:bg-slate-950/55">
            <button type="button" className="btn-secondary px-2.5 py-1.5 text-xs" onClick={() => setAnchorDate((current) => new Date(current.getFullYear(), current.getMonth(), current.getDate() - 7))}>
              <ChevronLeft className="h-3.5 w-3.5" />
              Vorherige Woche
            </button>
            <button type="button" className="btn-secondary px-2.5 py-1.5 text-xs" onClick={() => setAnchorDate(new Date())}>
              Heute
            </button>
            <button type="button" className="btn-secondary px-2.5 py-1.5 text-xs" onClick={() => setAnchorDate((current) => new Date(current.getFullYear(), current.getMonth(), current.getDate() + 7))}>
              Nächste Woche
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              {formatGermanDate(weekStartIso)} - {formatGermanDate(weekEndIso)}
            </span>
          </div>

          <div className="hidden min-w-[920px] gap-3 overflow-x-auto pb-1 md:grid md:grid-cols-7">
            {weekDays.map((day) => {
              const iso = toIsoDate(day);
              const isToday = iso === todayIso;
              const label = day.toLocaleDateString('de-DE', { weekday: 'short' });
              return (
                <div key={iso} className={`min-h-16 rounded-xl border px-3 py-2 text-xs ${isToday ? 'border-brand-300 bg-brand-50 text-brand-800 dark:bg-brand-900/25 dark:text-brand-200' : 'border-slate-200 bg-slate-100/70 text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300'}`}>
                  <p className="font-semibold uppercase tracking-wide">{label}</p>
                  <p className="mt-1">{formatGermanDate(iso)}</p>
                </div>
              );
            })}
          </div>

          <div className="hidden flex-wrap gap-2 text-xs md:flex">
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-200">Grün: verfügbar</span>
            <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-sky-700 dark:border-sky-700 dark:bg-sky-950/35 dark:text-sky-200">Blau: Übergabe/Verbund</span>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700 dark:border-amber-700 dark:bg-amber-950/35 dark:text-amber-200">Gelb: Prüfung</span>
            <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-rose-700 dark:border-rose-700 dark:bg-rose-950/35 dark:text-rose-200">Rot: Handlungsbedarf</span>
            <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              Farbiger Marker = Verbundgruppe
            </span>
          </div>

          <div className="hidden min-w-[920px] space-y-3 overflow-x-auto pb-1 md:block">
            {!weekPlannings.length ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/45 dark:text-slate-300">
                Keine Planungen in dieser Woche.
              </div>
            ) : null}
            {weekPlannings.map((planning) => {
              const details = planningDetailsById[planning.id];
              const demandText = details ? buildDemandSummary(details.days.flatMap((day) => day.items)) : '';
              const handoverSummary = handoverSummaryById.get(planning.id);
              const visual = getVisualStatus(planning, handoverSummary, availabilityByPlanningId[planning.id]);
              const networkMeta = networkMetaByPlanningId.get(planning.id);
              // Wrapper-Farbe MUSS dem fachlichen Availability-/Konflikt-
              // status folgen (grün/blau/gelb/rot/grau) — exakt der bereits
              // vorhandenen Kalender-Legende und der Logik der Planungsliste.
              // Frühere Variante hat hier bei Verbund-Mitgliedern den
              // Status mit einer rotierenden Verbund-Tone-Palette
              // überschrieben, wodurch z. B. rote Konflikte unsichtbar
              // wurden. Die Verbund-Information bleibt weiter über das
              // separate "Verbund aktiv (n)"-Badge sichtbar.
              const wrapperClass = barClasses(visual.status, planning.id === selectedId);
              return (
                <button key={planning.id} type="button" className={wrapperClass} onClick={() => onSelectPlanning(planning.id)}>
                  {/* Sekundärer Verbund-Akzent: schmaler Top-Streifen in der
                      Verbund-Tone. Macht verschiedene Verbundgruppen
                      unterscheidbar, OHNE die fachliche Statusfarbe
                      (grün/blau/gelb/rot) der Karte zu überschreiben. */}
                  {networkMeta ? (
                    <div
                      aria-hidden
                      className={`-mx-3 -mt-3 mb-2 h-1.5 rounded-t-2xl ${networkRibbonClasses(networkMeta.tone)}`}
                    />
                  ) : null}
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex items-start gap-2">
                      {networkMeta ? (
                        <span
                          aria-hidden
                          className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${networkRibbonClasses(networkMeta.tone)}`}
                        />
                      ) : null}
                      <div>
                        <p className="text-base font-semibold">{planning.projectName}</p>
                        <p className="text-sm opacity-90">{planning.customerName}{planning.eventName ? ` · ${planning.eventName}` : ''}</p>
                      </div>
                    </div>
                    <span className="rounded-full border border-white/70 bg-white/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide dark:border-slate-700 dark:bg-slate-950/35">
                      {visual.label}
                    </span>
                  </div>
                  <p className="mt-2 text-xs">{formatGermanDate(planning.startDate)} - {formatGermanDate(planning.endDate)}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    {demandText ? <span>{demandText}</span> : <span>Hardwarebedarf beim Öffnen sichtbar</span>}
                    {networkMeta ? (
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${networkBadgeClasses(networkMeta.tone)}`}>
                        <Link2 className="h-3 w-3" />
                        Verbund aktiv ({networkMeta.summary.memberCount})
                      </span>
                    ) : handoverSummary ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-white/75 px-2 py-0.5 text-sky-700 dark:border-sky-700 dark:bg-slate-950/40 dark:text-sky-100">
                        <Link2 className="h-3 w-3" />
                        Übergabe geplant
                      </span>
                    ) : null}
                    {visual.status === 'red' ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-white/75 px-2 py-0.5 text-rose-700 dark:border-rose-700 dark:bg-slate-950/40 dark:text-rose-100">
                        <AlertTriangle className="h-3 w-3" />
                        Handlungsbedarf
                      </span>
                    ) : null}
                  </div>
                  {networkMeta ? (
                    <p className="mt-2 text-[11px] opacity-90">
                      {networkMeta.summary.partnerLabel}
                    </p>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="space-y-2 md:hidden">
            {!weekPlannings.length ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
                Keine Planungen in dieser Woche.
              </div>
            ) : null}
            {weekPlannings.map((planning) => {
              const handoverSummary = handoverSummaryById.get(planning.id);
              const visual = getVisualStatus(planning, handoverSummary, availabilityByPlanningId[planning.id]);
              const networkMeta = networkMetaByPlanningId.get(planning.id);
              // Wrapper-Farbe MUSS dem fachlichen Availability-/Konflikt-
              // status folgen (grün/blau/gelb/rot/grau) — exakt der bereits
              // vorhandenen Kalender-Legende und der Logik der Planungsliste.
              // Frühere Variante hat hier bei Verbund-Mitgliedern den
              // Status mit einer rotierenden Verbund-Tone-Palette
              // überschrieben, wodurch z. B. rote Konflikte unsichtbar
              // wurden. Die Verbund-Information bleibt weiter über das
              // separate "Verbund aktiv (n)"-Badge sichtbar.
              const wrapperClass = barClasses(visual.status, planning.id === selectedId);
              return (
                <button key={`mobile-${planning.id}`} type="button" className={wrapperClass} onClick={() => onSelectPlanning(planning.id)}>
                  {/* Sekundärer Verbund-Akzent (mobile): dünner Top-Streifen
                      in der Verbund-Tone. Statusfarbe (grün/blau/gelb/rot)
                      der Karte bleibt unverändert. */}
                  {networkMeta ? (
                    <div
                      aria-hidden
                      className={`-mx-3 -mt-3 mb-2 h-1 rounded-t-2xl ${networkRibbonClasses(networkMeta.tone)}`}
                    />
                  ) : null}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {networkMeta ? (
                        <span
                          aria-hidden
                          className={`inline-block h-2 w-2 shrink-0 rounded-full ${networkRibbonClasses(networkMeta.tone)}`}
                        />
                      ) : null}
                      <p className="text-sm font-semibold truncate">{planning.projectName}</p>
                    </div>
                    <Calendar className="h-4 w-4 opacity-70 shrink-0" />
                  </div>
                  <p className="mt-1 text-xs">{formatGermanDate(planning.startDate)} - {formatGermanDate(planning.endDate)}</p>
                  <p className="mt-1 text-[11px]">{visual.label}</p>
                  {networkMeta ? (
                    <p className="mt-1 inline-flex items-center gap-1 text-[11px]">
                      <Link2 className="h-3 w-3" />
                      Verbund aktiv
                    </p>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </article>
  );
}
