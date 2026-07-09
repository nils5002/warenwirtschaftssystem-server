import { Link2 } from 'lucide-react';

import { LoadingButton } from '../../../../components/loading';
import type { HandoverStatusResponse } from '../../../../services/wmsApi';
import { formatGermanDateShort } from '../../../pages/planningCockpit';
import type { HardwareDraftItem } from './HardwareTab';

export type HandoverPartnerOption = { id: string; label: string };

type HandoverSectionProps = {
  items: HardwareDraftItem[];
  partnerOptions: HandoverPartnerOption[];
  handoverStatus: HandoverStatusResponse | null;
  canEdit: boolean;
  busy: boolean;
  onChangeItem: (index: number, patch: Partial<HardwareDraftItem>) => void;
  onRunHandover: () => void;
  onUndoHandover: () => void;
};

// Kompakte Projektübergabe-Verwaltung (aus dem alten Editor-Modal portiert):
// pro Position Partnerprojekt verknüpfen/lösen, plus manueller Fallback
// "Jetzt ausführen"/"Rückgängig". Standardweg bleibt der automatische
// Übergabe-Scheduler; Verknüpfungen werden mit dem Entwurf gespeichert.
export function HandoverSection({
  items,
  partnerOptions,
  handoverStatus,
  canEdit,
  busy,
  onChangeItem,
  onRunHandover,
  onUndoHandover,
}: HandoverSectionProps) {
  const relevantItems = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.categoryKey.trim());
  const activeCount = relevantItems.filter(({ item }) => item.handoverEnabled).length;

  return (
    <details className="rounded-xl border border-line bg-surface-2 p-3" open={activeCount > 0}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm font-semibold text-ink">
        <Link2 className="h-4 w-4 text-sky-500" aria-hidden="true" />
        Projektübergabe
        {activeCount > 0 ? (
          <span className="rounded-full bg-sky-500/15 px-1.5 text-[10px] font-semibold text-sky-600 dark:text-sky-300">
            {activeCount} aktiv
          </span>
        ) : (
          <span className="text-xs font-normal text-ink-muted">— keine Übergabe geplant</span>
        )}
      </summary>
      <p className="mt-1.5 text-[11px] text-ink-muted">
        Verknüpfte Geräte gehen nach Projektende direkt an das Partnerprojekt über (automatischer
        Scheduler). Änderungen hier werden mit „Speichern“ übernommen.
      </p>

      <div className="mt-2 space-y-2">
        {relevantItems.map(({ item, index }) => (
          <div key={index} className="grid gap-2 rounded-lg border border-line bg-surface p-2 sm:grid-cols-[minmax(0,0.7fr)_auto_minmax(0,1.3fr)] sm:items-center">
            <span className="truncate text-xs font-medium text-ink" title={item.categoryKey}>
              {item.categoryKey} × {item.qty}
            </span>
            <label className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
              <input
                type="checkbox"
                checked={item.handoverEnabled}
                disabled={!canEdit}
                onChange={(event) =>
                  onChangeItem(index, {
                    handoverEnabled: event.target.checked,
                    ...(event.target.checked ? {} : { linkedPlanningId: '' }),
                  })
                }
              />
              Übergabe
            </label>
            {item.handoverEnabled ? (
              <select
                className="field-input h-8 w-full text-xs"
                value={item.linkedPlanningId}
                disabled={!canEdit}
                onChange={(event) => onChangeItem(index, { linkedPlanningId: event.target.value })}
              >
                <option value="">– Partnerprojekt wählen –</option>
                {partnerOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-xs text-ink-faint">–</span>
            )}
          </div>
        ))}
        {relevantItems.length === 0 ? (
          <p className="text-xs text-ink-muted">Erst Positionen anlegen, dann Übergaben verknüpfen.</p>
        ) : null}
      </div>

      {handoverStatus ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 text-xs text-ink-muted">
          <span>
            Übergabefähig: {handoverStatus.totalTransferable} · bereits übergeben:{' '}
            {handoverStatus.totalAlreadyTransferred}
            {handoverStatus.sourceReturnDay
              ? ` · Übergabetag ${formatGermanDateShort(handoverStatus.sourceReturnDay)}`
              : ''}
            {handoverStatus.dueNow ? ' · fällig' : ''}
          </span>
          {canEdit ? (
            <span className="flex items-center gap-2">
              <LoadingButton
                type="button"
                className="btn-secondary px-2.5 py-1 text-[11px]"
                isLoading={busy}
                loadingText="…"
                disabled={handoverStatus.totalTransferable <= 0}
                onClick={onRunHandover}
              >
                Jetzt ausführen (Fallback)
              </LoadingButton>
              <LoadingButton
                type="button"
                className="btn-secondary px-2.5 py-1 text-[11px]"
                isLoading={busy}
                loadingText="…"
                disabled={handoverStatus.totalAlreadyTransferred <= 0}
                onClick={onUndoHandover}
              >
                Rückgängig
              </LoadingButton>
            </span>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}
