import { CalendarDays, Check, Undo2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { PlanningListItem } from '../../../../services/wmsApi';
import {
  formatEinsatz,
  formatRueckgabe,
  getBookedDayCount,
  getReturnDayIso,
  isDateBooked,
} from '../../../pages/planningPeriod';
import { ResponsibleBadge } from '../../ResponsibleBadge';
import { StatusBadge } from '../../StatusBadge';
import { deriveTimelineStatus, isActivePlanningStatus } from './timelineMath';

export type QuickViewAnchor = { left: number; top: number; bottom: number; width: number };

type PlanningQuickViewProps = {
  planning: PlanningListItem;
  anchor: QuickViewAnchor;
  todayIso: string;
  canEdit: boolean;
  onClose: () => void;
  onOpenPlanning: (planningId: string, tab?: 'ausgabe') => void;
  onDuplicate: (planningId: string) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
};

const POPOVER_WIDTH = 340;
const VIEWPORT_GUTTER = 8;

function dayNumberWithinPeriod(todayIso: string, startIso: string): number {
  const start = new Date(`${startIso}T00:00:00`).getTime();
  const today = new Date(`${todayIso}T00:00:00`).getTime();
  if (Number.isNaN(start) || Number.isNaN(today)) return 1;
  return Math.max(1, Math.round((today - start) / 86400000) + 1);
}

// Schnellansicht am Planungsbalken: Bedarf, Fortschritt und Aktionen — alle
// Daten kommen aus dem Listen-Endpoint, kein Roundtrip pro Hover. Flippt
// automatisch nach oben, wenn unter dem Balken kein Platz ist; schließt bei
// Escape und Klick außerhalb.
export function PlanningQuickView({
  planning,
  anchor,
  todayIso,
  canEdit,
  onClose,
  onOpenPlanning,
  onDuplicate,
  onMouseEnter,
  onMouseLeave,
}: PlanningQuickViewProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<{ left: number; top: number; caretX: number } | null>(
    null,
  );

  // Position nach dem Rendern anhand der echten Popover-Höhe bestimmen
  // (Flip nach oben, wenn unten kein Platz; horizontal in den Viewport geklemmt).
  useLayoutEffect(() => {
    const node = popoverRef.current;
    if (!node) return;
    const height = node.offsetHeight;
    const anchorCenterX = anchor.left + anchor.width / 2;
    const left = Math.min(
      Math.max(anchorCenterX - POPOVER_WIDTH / 2, VIEWPORT_GUTTER),
      window.innerWidth - POPOVER_WIDTH - VIEWPORT_GUTTER,
    );
    const fitsBelow = anchor.bottom + 10 + height <= window.innerHeight - VIEWPORT_GUTTER;
    const top = fitsBelow
      ? anchor.bottom + 10
      : Math.max(VIEWPORT_GUTTER, anchor.top - height - 10);
    const caretX = Math.min(Math.max(anchorCenterX - left, 20), POPOVER_WIDTH - 20);
    setPlacement({ left, top, caretX });
  }, [anchor, planning.id]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const handlePointerDown = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) onClose();
    };
    const handleScroll = () => onClose();
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [onClose]);

  const visual = deriveTimelineStatus(planning);
  const active = isActivePlanningStatus(planning.status);
  const returnDay = getReturnDayIso(planning.startDate, planning.endDate);
  const runningToday = active && isDateBooked(todayIso, planning.startDate, planning.endDate);
  const returnDue = active && todayIso >= returnDay && (planning.assignedCount ?? 0) > 0;
  const totalQty = Math.max(0, Number(planning.totalQty ?? 0));
  const assignedCount = Math.max(0, Number(planning.assignedCount ?? 0));
  const categoryTotals = planning.categoryTotals ?? [];

  // Fortschritt: während der Ausgabephase "Ausgegeben x/y"; ab Rückgabetag
  // "Zurückgegeben x/y" (zurück = geplant − noch draußen).
  const returnContext = active && todayIso >= returnDay;
  const progressLabel = returnContext ? 'Zurückgegeben' : 'Ausgegeben';
  const progressValue = returnContext ? Math.max(0, totalQty - assignedCount) : assignedCount;
  const progressRatio = totalQty > 0 ? Math.min(1, progressValue / totalQty) : 0;
  const progressComplete = totalQty > 0 && progressValue >= totalQty;

  // Kontextabhängige Sekundäraktion je Status/Phase.
  const secondaryAction = (() => {
    if (planning.status === 'Abgeschlossen' && canEdit) {
      return { label: 'Duplizieren', run: () => onDuplicate(planning.id) };
    }
    if (planning.status === 'Storniert' || planning.status === 'Abgeschlossen') return null;
    if (returnDue) {
      return { label: 'Rückgabe starten', run: () => onOpenPlanning(planning.id, 'ausgabe') };
    }
    if (runningToday) {
      return { label: 'Rückgabe planen', run: () => onOpenPlanning(planning.id, 'ausgabe') };
    }
    return { label: 'Ausgabe starten', run: () => onOpenPlanning(planning.id, 'ausgabe') };
  })();

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={`Schnellansicht ${planning.projectName}`}
      data-testid="planning-quick-view"
      className="fixed z-40 rounded-2xl border border-line bg-surface p-4 shadow-panel"
      style={{
        width: POPOVER_WIDTH,
        left: placement?.left ?? -9999,
        top: placement?.top ?? -9999,
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {placement ? (
        <span
          aria-hidden="true"
          className="absolute -top-1 h-2.5 w-2.5 rotate-45 border-l border-t border-line bg-surface"
          style={{ left: placement.caretX - 5 }}
        />
      ) : null}

      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-semibold text-ink">{planning.projectName}</p>
        {runningToday ? (
          <span className="shrink-0 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
            Aktiv · Tag {dayNumberWithinPeriod(todayIso, planning.startDate)} von{' '}
            {getBookedDayCount(planning.startDate, planning.endDate)}
          </span>
        ) : (
          <StatusBadge value={planning.status} />
        )}
      </div>
      <p className="mt-0.5 truncate text-xs text-ink-muted">
        {planning.customerName}
        {planning.eventName ? ` · ${planning.eventName}` : ''}
      </p>
      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-muted">
        {planning.responsibleUser ? (
          <>
            <ResponsibleBadge user={planning.responsibleUser} />
            Verantwortlich: <span className="text-ink">{planning.responsibleUser.name}</span>
          </>
        ) : (
          <>
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-[9px] font-semibold text-ink-faint">
              ?
            </span>
            Verantwortlich: Nicht zugewiesen
          </>
        )}
      </p>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {formatEinsatz(planning.startDate, planning.endDate)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Undo2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Rückgabe {formatRueckgabe(planning.startDate, planning.endDate)}
        </span>
      </p>
      {visual.status === 'red' ? (
        <p className="mt-2 rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-xs font-medium text-rose-700 dark:text-rose-300">
          {planning.openConflictCount === 1
            ? '1 offener Konflikt'
            : `${planning.openConflictCount} offene Konflikte`}{' '}
          — Details auf der Planungsseite.
        </p>
      ) : null}

      <div className="mt-3 border-t border-line pt-3">
        <p className="text-xs font-semibold text-ink">
          Hardwarebedarf · {totalQty} {totalQty === 1 ? 'Gerät' : 'Geräte'}
        </p>
        {categoryTotals.length ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {categoryTotals.map((entry) => (
              <span
                key={entry.categoryKey}
                className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink"
              >
                {entry.qty}× {entry.categoryKey}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-1.5 text-xs text-ink-muted">Noch kein Bedarf erfasst.</p>
        )}
        {totalQty > 0 ? (
          <div className="mt-2 flex items-center gap-2 text-xs text-ink-muted">
            <span className="shrink-0">
              {progressLabel}{' '}
              <span className="tabular-nums text-ink">
                {progressValue} / {totalQty}
              </span>
            </span>
            <span className="block h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
              <span
                className={`block h-full rounded-full ${progressComplete ? 'bg-emerald-500' : 'bg-primary'}`}
                style={{ width: `${Math.round(progressRatio * 100)}%` }}
              />
            </span>
            {progressComplete ? (
              <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex items-center justify-end gap-2 border-t border-line pt-3">
        {secondaryAction ? (
          <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={secondaryAction.run}>
            {secondaryAction.label}
          </button>
        ) : null}
        <button
          type="button"
          className="btn-primary px-3 py-1.5 text-xs"
          style={{ backgroundColor: '#4361EE' }}
          onClick={() => onOpenPlanning(planning.id)}
        >
          Planung öffnen
        </button>
      </div>
    </div>
  );
}
