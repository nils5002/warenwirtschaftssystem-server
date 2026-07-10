import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { PlanningListItem } from '../../../../services/wmsApi';
import { SegmentedControl } from '../../../../ui';
import { addDaysIso, formatGermanDate } from '../../../pages/planningPeriod';
import { PlanningQuickView, type QuickViewAnchor } from './PlanningQuickView';
import { PlanningTimelineMonth } from './PlanningTimelineMonth';
import { PlanningTimelineWeek } from './PlanningTimelineWeek';
import { addMonthsIso, getIsoWeekNumber, getWeekStartIso } from './timelineMath';

export type TimelineView = 'woche' | 'monat' | 'liste';

type PlanningTimelineProps = {
  view: TimelineView;
  onViewChange: (view: TimelineView) => void;
  /** Datumsanker (beliebiger Tag der sichtbaren Woche bzw. des Monats). */
  anchorIso: string;
  /** `null` = zurück zu Heute (entfernt den datum-Deep-Link). */
  onAnchorChange: (iso: string | null) => void;
  todayIso: string;
  plannings: PlanningListItem[];
  canEdit: boolean;
  onOpenPlanning: (planningId: string, tab?: 'ausgabe') => void;
  onDuplicate: (planningId: string) => void;
  onCreateAt: (iso: string) => void;
  /** Inhalt der dritten Ansicht "Liste" (bestehende Kartenliste). */
  listContent?: ReactNode;
};

type QuickViewState = {
  planning: PlanningListItem;
  anchor: QuickViewAnchor;
  pinned: boolean;
};

const HOVER_OPEN_DELAY_MS = 300;
const HOVER_CLOSE_DELAY_MS = 200;

function toAnchor(element: HTMLElement): QuickViewAnchor {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width };
}

function formatMonthLabel(monthIso: string): string {
  const date = new Date(`${monthIso.slice(0, 7)}-01T00:00:00`);
  if (Number.isNaN(date.getTime())) return monthIso;
  return date.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
}

function formatWeekLabel(weekStartIso: string): string {
  const weekEndIso = addDaysIso(weekStartIso, 6);
  const [, month, day] = weekStartIso.split('-');
  return `${day}.${month}. – ${formatGermanDate(weekEndIso)} · KW ${getIsoWeekNumber(weekStartIso)}`;
}

// Zeitleisten-Container der Einsatzplanung: Toolbar (Navigation + Umschalter
// Woche | Monat | Liste), Wochen-/Monatsraster und die Schnellansicht mit
// Hover-/Klick-Steuerung. Die "Liste" ist die bestehende Kartenliste und wird
// als listContent durchgereicht.
export function PlanningTimeline({
  view,
  onViewChange,
  anchorIso,
  onAnchorChange,
  todayIso,
  plannings,
  canEdit,
  onOpenPlanning,
  onDuplicate,
  onCreateAt,
  listContent,
}: PlanningTimelineProps) {
  const [quickView, setQuickView] = useState<QuickViewState | null>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const weekStartIso = useMemo(() => getWeekStartIso(anchorIso), [anchorIso]);

  const clearTimers = () => {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  useEffect(() => clearTimers, []);
  // Ansicht/Zeitraum gewechselt → offene Schnellansicht schließen.
  useEffect(() => {
    setQuickView(null);
    clearTimers();
  }, [view, anchorIso]);

  const handleSegmentEnter = (planning: PlanningListItem, element: HTMLElement) => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (quickView?.pinned) return;
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    const anchor = toAnchor(element);
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null;
      setQuickView({ planning, anchor, pinned: false });
    }, HOVER_OPEN_DELAY_MS);
  };

  const handleSegmentLeave = () => {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (!quickView || quickView.pinned) return;
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setQuickView(null);
    }, HOVER_CLOSE_DELAY_MS);
  };

  const handleSegmentClick = (planning: PlanningListItem, element: HTMLElement) => {
    clearTimers();
    setQuickView({ planning, anchor: toAnchor(element), pinned: true });
  };

  const handlePopoverEnter = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const handlePopoverLeave = () => {
    if (!quickView || quickView.pinned) return;
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setQuickView(null);
    }, HOVER_CLOSE_DELAY_MS);
  };

  const step = (direction: -1 | 1) => {
    if (view === 'monat') {
      onAnchorChange(addMonthsIso(anchorIso, direction));
    } else {
      onAnchorChange(addDaysIso(weekStartIso, direction * 7));
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {view === 'liste' ? (
            <h3 className="text-base font-semibold text-ink">Planungsliste</h3>
          ) : (
            <>
              <button
                type="button"
                className="btn-secondary px-2 py-1.5"
                aria-label={view === 'monat' ? 'Vorheriger Monat' : 'Vorherige Woche'}
                onClick={() => step(-1)}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="btn-secondary px-3 py-1.5 text-xs"
                onClick={() => onAnchorChange(null)}
              >
                Heute
              </button>
              <button
                type="button"
                className="btn-secondary px-2 py-1.5"
                aria-label={view === 'monat' ? 'Nächster Monat' : 'Nächste Woche'}
                onClick={() => step(1)}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
              <span className="ml-1.5 text-sm font-semibold text-ink" data-testid="timeline-range-label">
                {view === 'monat' ? formatMonthLabel(anchorIso) : formatWeekLabel(weekStartIso)}
              </span>
            </>
          )}
        </div>
        <SegmentedControl
          options={[
            { value: 'woche', label: 'Woche' },
            { value: 'monat', label: 'Monat' },
            { value: 'liste', label: 'Liste' },
          ]}
          value={view}
          onChange={(next) => onViewChange(next)}
        />
      </div>

      <div className="mt-3">
        {view === 'woche' ? (
          <PlanningTimelineWeek
            plannings={plannings}
            weekStartIso={weekStartIso}
            todayIso={todayIso}
            canEdit={canEdit}
            onSegmentEnter={handleSegmentEnter}
            onSegmentLeave={handleSegmentLeave}
            onSegmentClick={handleSegmentClick}
            onDayCreate={onCreateAt}
          />
        ) : null}
        {view === 'monat' ? (
          <PlanningTimelineMonth
            plannings={plannings}
            monthIso={anchorIso}
            todayIso={todayIso}
            onSegmentEnter={handleSegmentEnter}
            onSegmentLeave={handleSegmentLeave}
            onSegmentClick={handleSegmentClick}
            onOpenWeek={(iso) => {
              onAnchorChange(iso);
              onViewChange('woche');
            }}
          />
        ) : null}
        {view === 'liste' ? listContent : null}
      </div>

      {quickView ? (
        <PlanningQuickView
          planning={quickView.planning}
          anchor={quickView.anchor}
          todayIso={todayIso}
          canEdit={canEdit}
          onClose={() => setQuickView(null)}
          onOpenPlanning={onOpenPlanning}
          onDuplicate={onDuplicate}
          onMouseEnter={handlePopoverEnter}
          onMouseLeave={handlePopoverLeave}
        />
      ) : null}
    </div>
  );
}
