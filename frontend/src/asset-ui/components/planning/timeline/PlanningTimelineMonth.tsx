import { Check, Undo2 } from 'lucide-react';

import type { PlanningListItem } from '../../../../services/wmsApi';
import { getLastBookedDayIso } from '../../../pages/planningPeriod';
import {
  buildMonthWeekStarts,
  deriveTimelineStatus,
  listRangeDays,
  packTimelineLanes,
  type TimelineSegment,
  type TimelineStatus,
} from './timelineMath';
import { TimelineLegend } from './PlanningTimelineWeek';

type PlanningTimelineMonthProps = {
  plannings: PlanningListItem[];
  monthIso: string;
  todayIso: string;
  onSegmentEnter: (planning: PlanningListItem, element: HTMLElement) => void;
  onSegmentLeave: () => void;
  onSegmentClick: (planning: PlanningListItem, element: HTMLElement) => void;
  /** Klick auf Tageszahl oder "+n weitere" → Wochenansicht dieser Woche. */
  onOpenWeek: (iso: string) => void;
};

const WEEKDAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MAX_LANES_PER_WEEK = 4;

// Flachere Streifen als in der Woche; Farben identisch zur Wochenansicht.
const STRIP_CLASSES: Record<TimelineStatus, string> = {
  green:
    'border-emerald-500/50 bg-emerald-500/15 text-emerald-800 hover:bg-emerald-500/25 dark:text-emerald-200',
  sky: 'border-sky-500/50 bg-sky-500/15 text-sky-800 hover:bg-sky-500/25 dark:text-sky-200',
  amber:
    'border-amber-500/50 bg-amber-500/15 text-amber-800 hover:bg-amber-500/25 dark:text-amber-200',
  red: 'border-rose-500/60 bg-rose-500/15 text-rose-800 hover:bg-rose-500/25 dark:text-rose-200',
  gray: 'border-line-strong bg-surface-2 text-ink-muted hover:bg-surface-2/70',
};

const DOT_CLASSES: Record<TimelineStatus, string> = {
  green: 'bg-emerald-500',
  sky: 'bg-sky-500',
  amber: 'bg-amber-500',
  red: 'bg-rose-500',
  gray: 'bg-slate-400',
};

function stripRounding(segment: TimelineSegment): string {
  if (segment.clippedStart && segment.clippedEnd) return 'rounded-none';
  if (segment.clippedStart) return 'rounded-r-md rounded-l-none';
  if (segment.clippedEnd) return 'rounded-l-md rounded-r-none';
  return 'rounded-md';
}

function formatShortGermanDate(isoDate: string): string {
  const [, month, day] = isoDate.split('-');
  if (!month || !day) return isoDate;
  return `${day}.${month}.`;
}

// Label je Wochensegment: erstes Segment voll, Folgewochen "fortlaufend",
// Schlusssegment "Ende <Datum>".
function stripLabel(segment: TimelineSegment, qty: number): React.ReactNode {
  const { planning } = segment;
  if (!segment.clippedStart) {
    return (
      <>
        <span className="min-w-0 truncate font-semibold">{planning.projectName}</span>
        <span className="hidden min-w-0 truncate opacity-80 xl:inline">{planning.customerName}</span>
        {qty > 0 ? (
          <span className="ml-auto hidden shrink-0 text-[10px] font-semibold sm:inline">
            {qty} Geräte
          </span>
        ) : null}
      </>
    );
  }
  if (!segment.clippedEnd) {
    return (
      <span className="min-w-0 truncate">
        <span className="font-semibold">{planning.projectName}</span>
        {' · Ende '}
        {formatShortGermanDate(getLastBookedDayIso(planning.startDate, planning.endDate))}
      </span>
    );
  }
  return (
    <span className="min-w-0 truncate">
      <span className="font-semibold">{planning.projectName}</span> · fortlaufend
    </span>
  );
}

// Monatsansicht: klassisches Mo–So-Raster; mehrtägige Einsätze laufen als
// durchgehende Streifen über die Wochenzeilen, Rückgabetage gestrichelt.
export function PlanningTimelineMonth({
  plannings,
  monthIso,
  todayIso,
  onSegmentEnter,
  onSegmentLeave,
  onSegmentClick,
  onOpenWeek,
}: PlanningTimelineMonthProps) {
  const monthKey = monthIso.slice(0, 7);
  const weekStarts = buildMonthWeekStarts(monthIso);

  const renderSegment = (segment: TimelineSegment, segmentIndex: number) => {
    const visual = deriveTimelineStatus(segment.planning);
    const qty = Math.max(0, Number(segment.planning.totalQty ?? 0));
    const interaction = {
      onMouseEnter: (event: React.MouseEvent<HTMLElement>) =>
        onSegmentEnter(segment.planning, event.currentTarget),
      onMouseLeave: onSegmentLeave,
      onClick: (event: React.MouseEvent<HTMLElement>) =>
        onSegmentClick(segment.planning, event.currentTarget),
    };
    if (segment.kind === 'rueckgabe') {
      return (
        <button
          key={`${segment.planning.id}-r-${segmentIndex}`}
          type="button"
          className={`flex h-7 min-w-0 items-center gap-1 border border-dashed border-line-strong bg-transparent px-1.5 text-[11px] text-ink-muted transition hover:bg-surface-2/60 ${stripRounding(segment)}`}
          style={{ gridColumn: `${segment.startCol} / ${segment.endCol + 1}` }}
          {...interaction}
        >
          <Undo2 className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="truncate">Rückgabe · {qty}</span>
        </button>
      );
    }
    return (
      <button
        key={`${segment.planning.id}-e-${segmentIndex}`}
        type="button"
        data-testid={`timeline-month-bar-${segment.planning.id}`}
        className={`flex h-7 min-w-0 items-center gap-1.5 border px-1.5 text-[11px] transition ${STRIP_CLASSES[visual.status]} ${stripRounding(segment)}`}
        style={{ gridColumn: `${segment.startCol} / ${segment.endCol + 1}` }}
        {...interaction}
      >
        {visual.status === 'gray' ? (
          <Check className="h-3 w-3 shrink-0 opacity-80" aria-hidden="true" />
        ) : (
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_CLASSES[visual.status]}`} aria-hidden="true" />
        )}
        {stripLabel(segment, qty)}
      </button>
    );
  };

  return (
    <div data-testid="planning-timeline-month">
      <div className="grid grid-cols-7 border-b border-line">
        {WEEKDAY_LABELS.map((label, index) => (
          <div
            key={label}
            className={`px-2 py-1.5 text-xs font-semibold text-ink-muted ${index > 0 ? 'border-l border-line/70' : ''}`}
          >
            {label}
          </div>
        ))}
      </div>

      {weekStarts.map((weekStartIso) => {
        const days = listRangeDays(weekStartIso, 7);
        const lanes = packTimelineLanes(plannings, weekStartIso, 7);
        const visibleLanes = lanes.slice(0, MAX_LANES_PER_WEEK);
        const hiddenCount = lanes
          .slice(MAX_LANES_PER_WEEK)
          .reduce((sum, lane) => sum + new Set(lane.map((segment) => segment.planning.id)).size, 0);
        return (
          <div key={weekStartIso} className="border-b border-line/70 last:border-b-0">
            <div className="relative">
              <div className="absolute inset-0 grid grid-cols-7" aria-hidden="true">
                {days.map((iso, index) => (
                  <div
                    key={iso}
                    className={`${index > 0 ? 'border-l border-line/70' : ''} ${
                      iso === todayIso ? 'bg-[#00b9e1]/[0.07]' : ''
                    }`}
                  />
                ))}
              </div>
              <div className="relative">
                <div className="grid grid-cols-7">
                  {days.map((iso) => {
                    const inMonth = iso.slice(0, 7) === monthKey;
                    const isToday = iso === todayIso;
                    return (
                      <div key={iso} className="px-1.5 pt-1.5">
                        <button
                          type="button"
                          className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs tabular-nums transition hover:bg-surface-2 ${
                            isToday
                              ? 'bg-[#00b9e1] font-semibold text-white hover:bg-[#00b9e1]'
                              : inMonth
                                ? 'text-ink'
                                : 'text-ink-faint'
                          }`}
                          title="Woche öffnen"
                          onClick={() => onOpenWeek(iso)}
                        >
                          {Number(iso.slice(8, 10))}
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div className="min-h-4 space-y-1 px-px pb-1.5 pt-0.5">
                  {visibleLanes.map((lane, laneIndex) => (
                    <div key={laneIndex} className="grid grid-cols-7 gap-x-px">
                      {lane.map((segment, segmentIndex) => renderSegment(segment, segmentIndex))}
                    </div>
                  ))}
                  {hiddenCount > 0 ? (
                    <button
                      type="button"
                      className="ml-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-[#00b9e1] transition hover:bg-surface-2"
                      onClick={() => onOpenWeek(weekStartIso)}
                    >
                      +{hiddenCount} weitere
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        );
      })}

      <div className="mt-3 border-t border-line pt-2.5">
        <TimelineLegend />
      </div>
    </div>
  );
}
