import { AlertTriangle, CircleCheck, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import type { CapacityRow } from '../../../pages/planningCockpit';

// Ein Eintrag der konsolidierten Hardware-Tabelle. Die Handover-Felder werden
// unverändert durchgereicht (Fachlogik der Projektübergabe bleibt erhalten),
// die Tabelle editiert nur Kategorie/Menge/Notiz.
export type HardwareDraftItem = {
  categoryKey: string;
  qty: number;
  notes: string;
  handoverEnabled: boolean;
  linkedPlanningId: string;
  handoverNote: string;
};

type HardwareTabProps = {
  items: HardwareDraftItem[];
  categoryOptions: string[];
  capacityByCategory: ReadonlyMap<string, CapacityRow>;
  issuedByCategory: ReadonlyMap<string, number>;
  issuedTotal: number;
  conflictCount: number;
  canEdit: boolean;
  normalizeCategory: (key: string) => string;
  onChangeItem: (index: number, patch: Partial<HardwareDraftItem>) => void;
  onAddItem: () => void;
  onRemoveItem: (index: number) => void;
  onOpenConflicts: () => void;
};

const AVAILABILITY_VISUALS: Record<
  CapacityRow['state'],
  { dot: string; text: string; label: string }
> = {
  gedeckt: { dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300', label: 'Verfügbar' },
  knapp: { dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-300', label: 'Knapp' },
  konflikt: { dot: 'bg-rose-500', text: 'text-rose-700 dark:text-rose-300', label: 'Konflikt' },
  unbekannt: { dot: 'bg-slate-400', text: 'text-ink-muted', label: 'Nach Speichern geprüft' },
};

// Verfügbarkeits-Detailblock — im Desktop-Popover und in der Mobile-Karte
// identisch, daher einmal zentral.
function CapacityDetails({
  capacity,
  state,
  onOpenConflicts,
}: {
  capacity: CapacityRow | undefined;
  state: CapacityRow['state'];
  onOpenConflicts: () => void;
}) {
  return (
    <>
      {capacity && capacity.free !== null ? (
        <dl className="space-y-1 text-ink">
          <div className="flex justify-between">
            <dt className="text-ink-muted">Frei im Zeitraum</dt>
            <dd className="tabular-nums">{capacity.free}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-muted">Bedarf</dt>
            <dd className="tabular-nums">{capacity.demand}</dd>
          </div>
          <div className="flex justify-between font-semibold">
            <dt className="text-ink-muted">Puffer</dt>
            <dd className={`tabular-nums ${capacity.buffer !== null && capacity.buffer < 0 ? 'text-rose-600 dark:text-rose-300' : ''}`}>
              {capacity.buffer !== null && capacity.buffer >= 0 ? `+${capacity.buffer}` : capacity.buffer}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="text-ink-muted">
          Diese Position wird nach dem Speichern gegen den Bestand geprüft.
        </p>
      )}
      {state === 'konflikt' ? (
        <button
          type="button"
          className="mt-2 text-[11px] font-medium text-[#00b9e1] underline-offset-2 hover:underline"
          onClick={onOpenConflicts}
        >
          Zum Konflikte-Tab
        </button>
      ) : null}
    </>
  );
}

// Tab „Hardware": EINE konsolidierte Bedarfsliste. Ab md als Tabelle, unter md
// als gestapelte Kartenliste. WICHTIG: Die Tabelle darf auf schmalen Viewports
// nicht gerendert werden (nur per CSS versteckt reicht: display:none entfernt
// die Box) — mobile Browser (v. a. iOS Safari) weiten sonst den Layout-Viewport
// auf die 720px-Tabellen-Box auf und "zoomen" die ganze Seite raus, selbst wenn
// die Tabelle in einem overflow-x-auto-Container steckt.
export function HardwareTab({
  items,
  categoryOptions,
  capacityByCategory,
  issuedByCategory,
  issuedTotal,
  conflictCount,
  canEdit,
  normalizeCategory,
  onChangeItem,
  onAddItem,
  onRemoveItem,
  onOpenConflicts,
}: HardwareTabProps) {
  // Index der Zeile, deren Verfügbarkeits-Details offen sind (Desktop: Popover,
  // Mobile: Inline-Block in der Karte).
  const [popoverIndex, setPopoverIndex] = useState<number | null>(null);

  const totalQty = items.reduce((sum, item) => sum + Math.max(0, Number(item.qty) || 0), 0);
  const usedCategories = new Set(items.map((item) => normalizeCategory(item.categoryKey)));
  const categoryCount = items.filter((item) => item.categoryKey).length;

  // Abgeleitete Anzeige-Werte je Position — von Tabelle UND Kartenliste genutzt.
  const rows = items.map((item, index) => {
    const normalized = normalizeCategory(item.categoryKey);
    const capacity = item.categoryKey ? capacityByCategory.get(normalized) : undefined;
    const state = capacity?.state ?? 'unbekannt';
    const issued = issuedByCategory.get(normalized) ?? 0;
    const qty = Math.max(0, Number(item.qty) || 0);
    const progress = qty > 0 ? Math.min(1, issued / qty) : 0;
    return { item, index, capacity, state, visual: AVAILABILITY_VISUALS[state], issued, qty, progress };
  });

  const categorySelect = (index: number, className: string) => (
    <select
      className={className}
      value=""
      onChange={(event) => onChangeItem(index, { categoryKey: event.target.value })}
    >
      <option value="" disabled>
        Kategorie wählen …
      </option>
      {categoryOptions
        .filter((option) => !usedCategories.has(normalizeCategory(option)))
        .map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
    </select>
  );

  const availabilityLabel = (row: (typeof rows)[number]) =>
    row.state === 'konflikt' && row.capacity?.buffer != null
      ? `Fehlen ${Math.abs(row.capacity.buffer)}`
      : row.visual.label;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-muted">Bedarf automatisch aus Start- und Enddatum</p>
        {canEdit ? (
          <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={onAddItem}>
            <Plus className="h-3.5 w-3.5" />
            Position
          </button>
        ) : null}
      </div>

      {/* Mobile (< md): Kartenliste statt Tabelle. text-base auf den Feldern
          verhindert zusätzlich den iOS-Fokus-Zoom (< 16px Schriftgröße). */}
      <div className="space-y-2 md:hidden">
        {rows.length === 0 ? (
          <p className="rounded-xl border border-line px-3 py-6 text-center text-xs text-ink-muted">
            Noch keine Positionen — über „+ Position“ den Bedarf erfassen.
          </p>
        ) : null}
        {rows.map((row) => (
          <div key={row.index} className="rounded-xl border border-line bg-surface-2 p-3">
            <div className="flex items-center justify-between gap-2">
              {row.item.categoryKey ? (
                <p className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                  {row.item.categoryKey}
                </p>
              ) : (
                categorySelect(row.index, 'field-input h-10 min-w-0 flex-1 text-base')
              )}
              {canEdit ? (
                <button
                  type="button"
                  className="-my-1 -mr-1 shrink-0 rounded-lg p-2 text-ink-muted transition hover:bg-surface hover:text-rose-500"
                  aria-label={`Position ${row.item.categoryKey || 'ohne Kategorie'} löschen`}
                  onClick={() => onRemoveItem(row.index)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            <div className="mt-2 flex items-center gap-3">
              <label className="flex shrink-0 items-center gap-2 text-xs text-ink-muted">
                Menge
                <input
                  type="number"
                  min={0}
                  className="field-input h-10 w-20 text-center text-base"
                  value={row.item.qty}
                  disabled={!canEdit}
                  onChange={(event) =>
                    onChangeItem(row.index, { qty: Math.max(0, Number(event.target.value) || 0) })
                  }
                />
              </label>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-ink-muted">
                  Ausgegeben{' '}
                  <span className="tabular-nums text-ink">
                    {row.issued} / {row.qty}
                  </span>
                </p>
                <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-surface">
                  <span
                    className={`block h-full rounded-full ${row.progress >= 1 && row.qty > 0 ? 'bg-emerald-500' : 'bg-primary'}`}
                    style={{ width: `${Math.round(row.progress * 100)}%` }}
                  />
                </span>
              </div>
            </div>
            <button
              type="button"
              className={`mt-2 inline-flex min-h-9 items-center gap-1.5 text-xs font-medium ${row.visual.text}`}
              onClick={() => setPopoverIndex(popoverIndex === row.index ? null : row.index)}
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${row.visual.dot}`} aria-hidden="true" />
              {availabilityLabel(row)}
            </button>
            {popoverIndex === row.index ? (
              <div className="rounded-lg border border-line bg-surface p-3 text-xs">
                <CapacityDetails capacity={row.capacity} state={row.state} onOpenConflicts={onOpenConflicts} />
              </div>
            ) : null}
            <input
              className="field-input mt-2 h-10 w-full text-base"
              placeholder="Notiz"
              value={row.item.notes}
              disabled={!canEdit}
              onChange={(event) => onChangeItem(row.index, { notes: event.target.value })}
            />
          </div>
        ))}
        {rows.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm">
            <span className="font-semibold text-ink">
              Summe · {categoryCount} {categoryCount === 1 ? 'Kategorie' : 'Kategorien'}
            </span>
            <span className="tabular-nums text-ink-muted">
              {totalQty} geplant · {issuedTotal} / {totalQty} ausgegeben
            </span>
          </div>
        ) : null}
      </div>

      {/* Desktop (>= md): kompakte Tabelle mit internem Scroll. */}
      <div className="hidden overflow-x-auto rounded-xl border border-line md:block">
        <table className="w-full min-w-[720px] border-collapse text-sm" style={{ tableLayout: 'fixed' }}>
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-ink-faint">
              <th className="w-[20%] border-b border-line bg-surface-2 px-3 py-2">Kategorie</th>
              <th className="w-[9%] border-b border-line bg-surface-2 px-2 py-2">Menge</th>
              <th className="w-[18%] border-b border-line bg-surface-2 px-2 py-2">Ausgegeben</th>
              <th className="w-[19%] border-b border-line bg-surface-2 px-2 py-2">Verfügbarkeit</th>
              <th className="w-[26%] border-b border-line bg-surface-2 px-2 py-2">Notiz</th>
              <th className="w-[8%] border-b border-line bg-surface-2 px-2 py-2">
                <span className="sr-only">Aktion</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-xs text-ink-muted">
                  Noch keine Positionen — über „+ Position“ den Bedarf erfassen.
                </td>
              </tr>
            ) : null}
            {rows.map((row) => (
              <tr key={row.index} className="border-b border-line/70 align-middle last:border-b-0">
                <td className="px-3 py-2 font-medium text-ink">
                  {row.item.categoryKey
                    ? row.item.categoryKey
                    : categorySelect(row.index, 'field-input h-8 w-full text-xs')}
                </td>
                <td className="px-2 py-2">
                  <input
                    type="number"
                    min={0}
                    className="field-input h-8 w-16 text-center text-xs"
                    value={row.item.qty}
                    disabled={!canEdit}
                    onChange={(event) =>
                      onChangeItem(row.index, { qty: Math.max(0, Number(event.target.value) || 0) })
                    }
                  />
                </td>
                <td className="px-2 py-2">
                  <span className="inline-flex items-center gap-2">
                    <span className="tabular-nums text-ink-muted">
                      {row.issued} / {row.qty}
                    </span>
                    <span className="inline-block h-1 w-14 overflow-hidden rounded-full bg-surface-2">
                      <span
                        className={`block h-full rounded-full ${row.progress >= 1 && row.qty > 0 ? 'bg-emerald-500' : 'bg-primary'}`}
                        style={{ width: `${Math.round(row.progress * 100)}%` }}
                      />
                    </span>
                  </span>
                </td>
                <td className="relative px-2 py-2">
                  <button
                    type="button"
                    className={`inline-flex items-center gap-1.5 text-xs font-medium ${row.visual.text}`}
                    onClick={() => setPopoverIndex(popoverIndex === row.index ? null : row.index)}
                    title="Details anzeigen"
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${row.visual.dot}`} aria-hidden="true" />
                    {availabilityLabel(row)}
                  </button>
                  {popoverIndex === row.index ? (
                    <div className="absolute left-0 top-full z-20 mt-1 w-60 rounded-xl border border-line bg-surface p-3 text-xs shadow-panel">
                      <CapacityDetails capacity={row.capacity} state={row.state} onOpenConflicts={onOpenConflicts} />
                    </div>
                  ) : null}
                </td>
                <td className="px-2 py-2">
                  <input
                    className="field-input h-8 w-full text-xs"
                    placeholder="–"
                    value={row.item.notes}
                    disabled={!canEdit}
                    onChange={(event) => onChangeItem(row.index, { notes: event.target.value })}
                  />
                </td>
                <td className="px-2 py-2 text-right">
                  {canEdit ? (
                    <button
                      type="button"
                      className="rounded-lg p-1.5 text-ink-muted transition hover:bg-surface-2 hover:text-rose-500"
                      aria-label={`Position ${row.item.categoryKey || 'ohne Kategorie'} löschen`}
                      onClick={() => onRemoveItem(row.index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line">
              <td className="px-3 py-2 text-sm font-semibold text-ink">
                Summe · {categoryCount} Kategorien
              </td>
              <td className="px-2 py-2 text-center font-semibold tabular-nums text-ink">{totalQty}</td>
              <td className="px-2 py-2 tabular-nums text-ink-muted">
                {issuedTotal} / {totalQty}
              </td>
              <td colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>

      {conflictCount > 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {conflictCount === 1 ? '1 Konflikt' : `${conflictCount} Konflikte`} im Zeitraum.{' '}
            <button
              type="button"
              className="font-semibold text-[#00b9e1] underline-offset-2 hover:underline"
              onClick={onOpenConflicts}
            >
              Zum Konflikte-Tab
            </button>
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
          <CircleCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
          Keine Konflikte – der Bedarf ist im gesamten Zeitraum gedeckt.
        </div>
      )}
    </div>
  );
}
