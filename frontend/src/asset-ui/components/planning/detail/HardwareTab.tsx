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

// Tab „Hardware": EINE konsolidierte Tabelle ersetzt die drei alten Sektionen
// (Positions-Editor, Geplant-vs-Ausgegeben-Kacheln, Availability-Übersicht).
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
  // Index der Zeile, deren Verfügbarkeits-Popover offen ist.
  const [popoverIndex, setPopoverIndex] = useState<number | null>(null);

  const totalQty = items.reduce((sum, item) => sum + Math.max(0, Number(item.qty) || 0), 0);
  const usedCategories = new Set(items.map((item) => normalizeCategory(item.categoryKey)));

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

      <div className="overflow-x-auto rounded-xl border border-line">
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
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-xs text-ink-muted">
                  Noch keine Positionen — über „+ Position“ den Bedarf erfassen.
                </td>
              </tr>
            ) : null}
            {items.map((item, index) => {
              const normalized = normalizeCategory(item.categoryKey);
              const capacity = item.categoryKey ? capacityByCategory.get(normalized) : undefined;
              const state = capacity?.state ?? 'unbekannt';
              const visual = AVAILABILITY_VISUALS[state];
              const issued = issuedByCategory.get(normalized) ?? 0;
              const qty = Math.max(0, Number(item.qty) || 0);
              const progress = qty > 0 ? Math.min(1, issued / qty) : 0;
              return (
                <tr key={index} className="border-b border-line/70 align-middle last:border-b-0">
                  <td className="px-3 py-2 font-medium text-ink">
                    {item.categoryKey ? (
                      item.categoryKey
                    ) : (
                      <select
                        className="field-input h-8 w-full text-xs"
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
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="number"
                      min={0}
                      className="field-input h-8 w-16 text-center text-xs"
                      value={item.qty}
                      disabled={!canEdit}
                      onChange={(event) =>
                        onChangeItem(index, { qty: Math.max(0, Number(event.target.value) || 0) })
                      }
                    />
                  </td>
                  <td className="px-2 py-2">
                    <span className="inline-flex items-center gap-2">
                      <span className="tabular-nums text-ink-muted">
                        {issued} / {qty}
                      </span>
                      <span className="inline-block h-1 w-14 overflow-hidden rounded-full bg-surface-2">
                        <span
                          className={`block h-full rounded-full ${progress >= 1 && qty > 0 ? 'bg-emerald-500' : 'bg-primary'}`}
                          style={{ width: `${Math.round(progress * 100)}%` }}
                        />
                      </span>
                    </span>
                  </td>
                  <td className="relative px-2 py-2">
                    <button
                      type="button"
                      className={`inline-flex items-center gap-1.5 text-xs font-medium ${visual.text}`}
                      onClick={() => setPopoverIndex(popoverIndex === index ? null : index)}
                      title="Details anzeigen"
                    >
                      <span className={`h-2 w-2 shrink-0 rounded-full ${visual.dot}`} aria-hidden="true" />
                      {state === 'konflikt' && capacity?.buffer != null
                        ? `Fehlen ${Math.abs(capacity.buffer)}`
                        : visual.label}
                    </button>
                    {popoverIndex === index ? (
                      <div className="absolute left-0 top-full z-20 mt-1 w-60 rounded-xl border border-line bg-surface p-3 text-xs shadow-panel">
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
                            onClick={() => {
                              setPopoverIndex(null);
                              onOpenConflicts();
                            }}
                          >
                            Zum Konflikte-Tab
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-2 py-2">
                    <input
                      className="field-input h-8 w-full text-xs"
                      placeholder="–"
                      value={item.notes}
                      disabled={!canEdit}
                      onChange={(event) => onChangeItem(index, { notes: event.target.value })}
                    />
                  </td>
                  <td className="px-2 py-2 text-right">
                    {canEdit ? (
                      <button
                        type="button"
                        className="rounded-lg p-1.5 text-ink-muted transition hover:bg-surface-2 hover:text-rose-500"
                        aria-label={`Position ${item.categoryKey || 'ohne Kategorie'} löschen`}
                        onClick={() => onRemoveItem(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-line">
              <td className="px-3 py-2 text-sm font-semibold text-ink">
                Summe · {items.filter((item) => item.categoryKey).length} Kategorien
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
