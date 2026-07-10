import { Check, Undo2 } from 'lucide-react';

import type { PlanningListItem } from '../../../../services/wmsApi';
import { formatGermanDate, getLastBookedDayIso } from '../../../pages/planningPeriod';
import { ResponsibleBadge } from '../../ResponsibleBadge';
import {
  buildUtilization,
  deriveTimelineStatus,
  listRangeDays,
  packTimelineLanes,
  type TimelineSegment,
  type TimelineStatus,
} from './timelineMath';

type PlanningTimelineWeekProps = {
  plannings: PlanningListItem[];
  weekStartIso: string;
  todayIso: string;
  canEdit: boolean;
  onSegmentEnter: (planning: PlanningListItem, element: HTMLElement) => void;
  onSegmentLeave: () => void;
  onSegmentClick: (planning: PlanningListItem, element: HTMLElement) => void;
  onDayCreate: (iso: string) => void;
};

const WEEKDAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

// Statusfarben der Balken (Fläche + Rahmen + Text konsistent, hell + dunkel).
const BAR_CLASSES: Record<TimelineStatus, string> = {
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

function segmentRounding(segment: TimelineSegment): string {
  if (segment.clippedStart && segment.clippedEnd) return 'rounded-none';
  if (segment.clippedStart) return 'rounded-r-lg rounded-l-none';
  if (segment.clippedEnd) return 'rounded-l-lg rounded-r-none';
  return 'rounded-lg';
}

function formatShortGermanDate(isoDate: string): string {
  const [, month, day] = isoDate.split('-');
  if (!month || !day) return isoDate;
  return `${day}.${month}.`;
}

export function formatUntilHint(planning: PlanningListItem): string {
  return `bis ${formatShortGermanDate(getLastBookedDayIso(planning.startDate, planning.endDate))} →`;
}

// Kompakte Legende — von Woche + Monat gemeinsam genutzt.
export function TimelineLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-muted">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" /> Verfügbar / aktiv
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-sky-500" aria-hidden="true" /> Übergabe / Verbund
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" /> Prüfung
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-rose-500" aria-hidden="true" /> Handlungsbedarf
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-5 rounded border border-dashed border-line-strong" aria-hidden="true" />
        Rückgabetag
      </span>
    </div>
  );
}

// Wochenansicht als Zeitleiste: Planungen sind horizontale Balken über ihre
// Einsatztage (Lane-Packing gegen Überlappung), Rückgabetage hängen als
// gestrichelte Segmente an, darunter die Auslastung pro Tag.
export function PlanningTimelineWeek({
  plannings,
  weekStartIso,
  todayIso,
  canEdit,
  onSegmentEnter,
  onSegmentLeave,
  onSegmentClick,
  onDayCreate,
}: PlanningTimelineWeekProps) {
  const days = listRangeDays(weekStartIso, 7);
  const lanes = packTimelineLanes(plannings, weekStartIso, 7);
  const utilization = buildUtilization(plannings, days);
  const weekMax = Math.max(1, ...utilization.map((entry) => entry.inUse));

  const renderSegment = (segment: TimelineSegment, laneIndex: number, segmentIndex: number) => {
    const visual = deriveTimelineStatus(segment.planning);
    const qty = Math.max(0, Number(segment.planning.totalQty ?? 0));
    const spanDays = segment.endCol - segment.startCol + 1;
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
          data-testid={`timeline-return-${segment.planning.id}`}
          className={`pointer-events-auto relative z-10 flex h-9 min-w-0 items-center gap-1.5 border border-dashed border-line-strong bg-transparent px-2 text-xs text-ink-muted transition hover:bg-surface-2/60 ${segmentRounding(segment)}`}
          style={{ gridColumn: `${segment.startCol} / ${segment.endCol + 1}` }}
          {...interaction}
        >
          <Undo2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{spanDays > 1 || qty ? `Rückgabe · ${qty}` : 'Rückgabe'}</span>
        </button>
      );
    }
    const responsible = segment.planning.responsibleUser;
    return (
      <button
        key={`${segment.planning.id}-e-${segmentIndex}`}
        type="button"
        data-testid={`timeline-bar-${segment.planning.id}`}
        className={`pointer-events-auto relative z-10 flex h-9 min-w-0 items-center gap-2 border px-2.5 text-xs transition ${BAR_CLASSES[visual.status]} ${segmentRounding(segment)} ${responsible ? 'pl-3' : ''}`}
        style={{ gridColumn: `${segment.startCol} / ${segment.endCol + 1}` }}
        title={responsible ? `Verantwortlich: ${responsible.name}` : undefined}
        {...interaction}
      >
        {/* Signaturfarbe des Verantwortlichen als linker Akzentstreifen —
            die fachliche Statusfarbe (Rahmen/Fläche) bleibt unangetastet. */}
        {responsible && !segment.clippedStart ? (
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 w-1 rounded-l-[inherit]"
            style={{ backgroundColor: responsible.signatureColor }}
          />
        ) : null}
        {visual.status === 'gray' ? (
          <Check className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden="true" />
        ) : (
          <span className={`h-2 w-2 shrink-0 rounded-full ${DOT_CLASSES[visual.status]}`} aria-hidden="true" />
        )}
        <span className="min-w-0 truncate font-semibold">{segment.planning.projectName}</span>
        {spanDays >= 2 ? (
          <span className="hidden min-w-0 truncate opacity-80 lg:inline">
            {segment.planning.customerName}
          </span>
        ) : null}
        {qty > 0 && spanDays >= 2 ? (
          <span className="hidden shrink-0 rounded-full border border-line bg-surface/70 px-1.5 py-0 text-[10px] font-semibold sm:inline">
            {qty} Geräte
          </span>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {responsible && spanDays >= 2 ? <ResponsibleBadge user={responsible} /> : null}
          {segment.clippedEnd ? (
            <span className="text-[11px] font-medium">{formatUntilHint(segment.planning)}</span>
          ) : null}
        </span>
      </button>
    );
  };

  return (
    <div data-testid="planning-timeline-week">
      {/* Tagesköpfe */}
      <div className="grid grid-cols-7 border-b border-line">
        {days.map((iso, index) => {
          const isToday = iso === todayIso;
          return (
            <div
              key={iso}
              className={`px-2 py-1.5 text-xs ${index > 0 ? 'border-l border-line/70' : ''} ${
                isToday ? 'rounded-t-lg bg-[#00b9e1]/10' : ''
              }`}
            >
              <span className={`font-semibold ${isToday ? 'text-[#00b9e1]' : 'text-ink'}`}>
                {WEEKDAY_LABELS[index]}
              </span>{' '}
              <span className={isToday ? 'text-[#00b9e1]/90' : 'text-ink-muted'}>
                {formatShortGermanDate(iso)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Lanes mit Tages-Hintergrundraster (Heute-Spalte markiert) */}
      <div className="relative">
        <div className="absolute inset-0 grid grid-cols-7" aria-hidden={!canEdit}>
          {days.map((iso, index) => (
            <button
              key={iso}
              type="button"
              tabIndex={-1}
              disabled={!canEdit}
              title={canEdit ? `Neue Planung am ${formatGermanDate(iso)}` : undefined}
              className={`${index > 0 ? 'border-l border-line/70' : ''} ${
                iso === todayIso ? 'bg-[#00b9e1]/[0.07]' : ''
              } ${canEdit ? 'cursor-cell hover:bg-surface-2/50' : 'cursor-default'}`}
              onClick={() => onDayCreate(iso)}
              aria-label={`Neue Planung am ${formatGermanDate(iso)}`}
            />
          ))}
        </div>
        {/* pointer-events-none: Klicks auf freie Stellen fallen zu den
            Tagesspalten-Buttons durch; nur die Segmente selbst sind klickbar. */}
        <div className="pointer-events-none relative space-y-1.5 py-2">
          {lanes.length === 0 ? (
            <p className="pointer-events-none relative z-10 px-3 py-8 text-center text-sm text-ink-muted">
              Keine Planungen in dieser Woche.
            </p>
          ) : null}
          {lanes.map((lane, laneIndex) => (
            <div key={laneIndex} className="grid grid-cols-7 gap-x-px px-px">
              {lane.map((segment, segmentIndex) => renderSegment(segment, laneIndex, segmentIndex))}
            </div>
          ))}
        </div>
      </div>

      {/* Auslastungszeile */}
      <div className="mt-1 border-t border-line pt-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
          Geräte im Einsatz
        </p>
        <div className="mt-1 grid grid-cols-7" data-testid="timeline-utilization">
          {utilization.map((entry, index) => {
            const iso = days[index];
            const isToday = iso === todayIso;
            return (
              <div key={iso} className={`px-2 py-1 ${index > 0 ? 'border-l border-line/70' : ''}`}>
                <p className="flex items-baseline gap-1.5 text-sm">
                  <span
                    className={`font-semibold tabular-nums ${isToday ? 'text-[#00b9e1]' : 'text-ink'}`}
                  >
                    {entry.inUse}
                  </span>
                  {entry.returning > 0 ? (
                    <span className="inline-flex items-center gap-0.5 text-[11px] tabular-nums text-ink-muted">
                      <Undo2 className="h-3 w-3" aria-hidden="true" />
                      {entry.returning}
                    </span>
                  ) : null}
                </p>
                <span className="mt-1 block h-1 overflow-hidden rounded-full bg-surface-2">
                  <span
                    className="block h-full rounded-full bg-primary"
                    style={{ width: `${Math.round((entry.inUse / weekMax) * 100)}%` }}
                  />
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-3 border-t border-line pt-2.5">
        <TimelineLegend />
      </div>
    </div>
  );
}
