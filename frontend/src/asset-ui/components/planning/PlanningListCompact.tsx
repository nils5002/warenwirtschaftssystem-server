import { Copy, Link2, MoreVertical, Trash2 } from 'lucide-react';
import { useState, type Ref } from 'react';

import { ContextMenu, type ContextMenuItem } from '../../../ui';
import type { PlanningListItem } from '../../../services/wmsApi';
import { formatEinsatz } from '../../pages/planningPeriod';
import { ResponsibleBadge } from '../ResponsibleBadge';
import { StatusBadge } from '../StatusBadge';

type PlanningListCompactProps = {
  items: PlanningListItem[];
  selectedId: string;
  canEdit: boolean;
  busy: boolean;
  onSelect: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  // Planungen mit Übergabe-Verbund (blauer Marker in der Hardware-Spalte).
  handoverIds: ReadonlySet<string>;
  // Scroll-Container-Ref (Scroll-Restaurierung liegt in der Seite).
  scrollRef: Ref<HTMLDivElement>;
  maxHeightClass: string;
  emptyHint?: string;
};

// Kompakte Projektliste des Cockpits: eine ~52px-Zeile pro Planung statt der
// früheren 200–300px-Karten. Details (Konfliktzeilen, PM, Verbund-Panel,
// Statuswechsel) leben im Detail-Panel; Duplizieren/Löschen im „…“-Menü.
export function PlanningListCompact({
  items,
  selectedId,
  canEdit,
  busy,
  onSelect,
  onDuplicate,
  onDelete,
  handoverIds,
  scrollRef,
  maxHeightClass,
  emptyHint = 'Noch keine passende Planung gefunden.',
}: PlanningListCompactProps) {
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  const openMenu = (id: string, x: number, y: number) => {
    setMenu({ id, x, y });
  };

  const buildMenuItems = (id: string): ContextMenuItem[] => [
    {
      key: 'duplicate',
      label: 'Duplizieren',
      icon: Copy,
      onSelect: () => onDuplicate(id),
    },
    {
      key: 'delete',
      label: 'Löschen',
      icon: Trash2,
      tone: 'danger',
      separatorBefore: true,
      onSelect: () => onDelete(id),
    },
  ];

  const menuItem = menu ? items.find((item) => item.id === menu.id) ?? null : null;

  return (
    <div
      ref={scrollRef}
      className={`soft-scrollbar overflow-y-auto rounded-xl border border-line ${maxHeightClass}`}
    >
      {!items.length ? (
        <div className="px-3 py-8 text-center text-sm text-slate-500">{emptyHint}</div>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-ink-faint">
              <th className="sticky top-0 z-10 border-b border-line bg-surface-2 px-3 py-2">Projekt</th>
              <th className="sticky top-0 z-10 w-28 border-b border-line bg-surface-2 px-2 py-2">Status</th>
              <th className="sticky top-0 z-10 w-36 border-b border-line bg-surface-2 px-2 py-2">Hardware</th>
              {canEdit ? (
                <th className="sticky top-0 z-10 w-10 border-b border-line bg-surface-2 px-1 py-2">
                  <span className="sr-only">Aktionen</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const isActive = selectedId === item.id;
              const conflictCount = item.openConflictCount ?? 0;
              const hasConflict = conflictCount > 0;
              const hasHandover = handoverIds.has(item.id);
              return (
                <tr
                  key={item.id}
                  data-testid={`planning-row-${item.id}`}
                  className={`cursor-pointer border-b border-line/70 align-middle transition ${
                    isActive
                      ? 'bg-primary-soft/60'
                      : 'hover:bg-surface-2/75'
                  }`}
                  onClick={() => onSelect(item.id)}
                  onContextMenu={(event) => {
                    if (!canEdit) return;
                    event.preventDefault();
                    openMenu(item.id, event.clientX, event.clientY);
                  }}
                >
                  <td className="px-3 py-2">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                      <ResponsibleBadge user={item.responsibleUser} />
                      <span className="min-w-0 truncate" title={item.projectName}>
                        {item.projectName}
                        {item.eventName ? (
                          <span className="font-normal text-ink-muted"> · {item.eventName}</span>
                        ) : null}
                      </span>
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
                      <span className="truncate" title={item.customerName}>{item.customerName}</span>
                      <span className="shrink-0 text-ink-faint">
                        {formatEinsatz(item.startDate, item.endDate)}
                      </span>
                    </p>
                  </td>
                  <td className="px-2 py-2">
                    <StatusBadge value={item.status === 'Bestaetigt' ? 'Bestätigt' : item.status} />
                  </td>
                  <td className="px-2 py-2">
                    <span className="flex items-center gap-1.5">
                      {hasConflict ? (
                        <span
                          data-testid={`planning-conflict-badge-${item.id}`}
                          className="status-chip border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-400/50 dark:bg-rose-950/70 dark:text-rose-100"
                        >
                          <span className="status-dot bg-rose-500" aria-hidden="true" />
                          {conflictCount === 1 ? '1 Engpass' : `${conflictCount} Engpässe`}
                        </span>
                      ) : (
                        <span className="status-chip border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300">
                          <span className="status-dot bg-emerald-500" aria-hidden="true" />
                          Alles verfügbar
                        </span>
                      )}
                      {hasHandover ? (
                        <Link2
                          className="h-3.5 w-3.5 shrink-0 text-sky-500"
                          aria-label="Übergabe-Verbund aktiv"
                        />
                      ) : null}
                    </span>
                  </td>
                  {canEdit ? (
                    <td className="px-1 py-2 text-right">
                      <button
                        type="button"
                        className="rounded-lg p-1.5 text-ink-muted transition hover:bg-surface-2 hover:text-ink"
                        aria-label={`Aktionen für ${item.projectName}`}
                        disabled={busy}
                        onClick={(event) => {
                          event.stopPropagation();
                          const rect = event.currentTarget.getBoundingClientRect();
                          openMenu(item.id, rect.left, rect.bottom + 4);
                        }}
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {menu && menuItem ? (
        <ContextMenu
          position={{ x: menu.x, y: menu.y }}
          title={menuItem.projectName}
          subtitle={menuItem.customerName}
          items={buildMenuItems(menu.id)}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}
