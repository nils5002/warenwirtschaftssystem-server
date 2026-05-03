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

function projectOverlapsWeek(project: Pick<PlanningListItem, 'startDate' | 'endDate'>, weekStartIso: string, weekEndIso: string): boolean {
  return project.startDate <= weekEndIso && project.endDate >= weekStartIso;
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
    const hasLinkedHandover = Boolean(item.handoverEnabled && item.linkedPlanningId);
    const knownHandoverState = item.handoverStatus === 'planned';
    return hasGlobalShortage && !hasLinkedHandover && !knownHandoverState;
  });
  if (hasOpenShortage && !hasHandover) {
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
  const base = 'rounded-xl border p-2 text-left transition';
  const ring = active ? ' ring-2 ring-brand-300 dark:ring-brand-700' : '';
  if (status === 'red') return `${base} border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-700 dark:bg-rose-950/35 dark:text-rose-100${ring}`;
  if (status === 'amber') return `${base} border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/35 dark:text-amber-100${ring}`;
  if (status === 'sky') return `${base} border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-700 dark:bg-sky-950/35 dark:text-sky-100${ring}`;
  if (status === 'gray') return `${base} border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-900/55 dark:text-slate-200${ring}`;
  return `${base} border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-100${ring}`;
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

  return (
    <article className="surface-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-slate-900">Kalenderübersicht</h3>
          <p className="text-xs text-slate-500">Wochenansicht als Add-on zur bestehenden Einsatzplanung.</p>
        </div>
        <div className="inline-flex overflow-hidden rounded-xl border border-slate-200 bg-white">
          <button type="button" className={`px-3 py-1.5 text-xs ${!showCalendar ? 'bg-slate-100 text-slate-700' : ''}`} onClick={() => setShowCalendar(false)}>
            Planung bearbeiten
          </button>
          <button type="button" className={`px-3 py-1.5 text-xs ${showCalendar ? 'bg-brand-50 text-brand-700' : ''}`} onClick={() => setShowCalendar(true)}>
            Kalenderübersicht
          </button>
        </div>
      </div>

      {showCalendar ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
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
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
              {formatGermanDate(weekStartIso)} - {formatGermanDate(weekEndIso)}
            </span>
          </div>

          <div className="hidden gap-2 md:grid md:grid-cols-7">
            {weekDays.map((day) => {
              const iso = toIsoDate(day);
              const isToday = iso === todayIso;
              const label = day.toLocaleDateString('de-DE', { weekday: 'short' });
              return (
                <div key={iso} className={`rounded-xl border px-2 py-1.5 text-xs ${isToday ? 'border-brand-300 bg-brand-50 text-brand-800' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                  <p className="font-semibold uppercase">{label}</p>
                  <p>{formatGermanDate(iso)}</p>
                </div>
              );
            })}
          </div>

          <div className="hidden space-y-2 md:block">
            {!weekPlannings.length ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
                Keine Planungen in dieser Woche.
              </div>
            ) : null}
            {weekPlannings.map((planning) => {
              const details = planningDetailsById[planning.id];
              const demandText = details ? buildDemandSummary(details.days.flatMap((day) => day.items)) : '';
              const handoverSummary = handoverSummaryById.get(planning.id);
              const visual = getVisualStatus(planning, handoverSummary, availabilityByPlanningId[planning.id]);
              return (
                <button key={planning.id} type="button" className={barClasses(visual.status, planning.id === selectedId)} onClick={() => onSelectPlanning(planning.id)}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{planning.projectName}</p>
                      <p className="text-xs opacity-90">{planning.customerName}{planning.eventName ? ` · ${planning.eventName}` : ''}</p>
                    </div>
                    <span className="rounded-full border border-white/70 bg-white/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                      {visual.label}
                    </span>
                  </div>
                  <p className="mt-1 text-xs">{formatGermanDate(planning.startDate)} - {formatGermanDate(planning.endDate)}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                    {demandText ? <span>{demandText}</span> : <span>Hardwarebedarf beim Öffnen sichtbar</span>}
                    {handoverSummary ? (
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
              return (
                <button key={`mobile-${planning.id}`} type="button" className={barClasses(visual.status, planning.id === selectedId)} onClick={() => onSelectPlanning(planning.id)}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{planning.projectName}</p>
                    <Calendar className="h-4 w-4 opacity-70" />
                  </div>
                  <p className="mt-1 text-xs">{formatGermanDate(planning.startDate)} - {formatGermanDate(planning.endDate)}</p>
                  <p className="mt-1 text-[11px]">{visual.label}</p>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </article>
  );
}
