import { useEffect } from 'react';
import { X } from 'lucide-react';
import type { Asset } from '../types';
import { StatusBadge } from './StatusBadge';

type AssetMatchPickerDialogProps = {
  title: string;
  query: string;
  matches: Asset[];
  onSelect: (asset: Asset) => void;
  onClose: () => void;
};

/**
 * Auswahldialog bei mehreren toleranten Suchtreffern. Bewusst als Karten-Liste
 * mit großen Tap-Flächen (mobil-tauglich) statt enger Dropdown-Tabelle. Es wird
 * KEINE Buchung automatisch ausgelöst — erst nach expliziter Auswahl läuft der
 * bestehende Buchungsflow weiter.
 */
export function AssetMatchPickerDialog({ title, query, matches, onSelect, onClose }: AssetMatchPickerDialogProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full flex-col rounded-t-2xl border border-slate-200 bg-white shadow-panel dark:border-slate-700 dark:bg-slate-950 sm:max-w-lg sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 border-b border-slate-200 p-4 dark:border-slate-800">
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h4>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {matches.length} Treffer für „{query}" — bitte das richtige Gerät wählen.
            </p>
          </div>
          <button
            type="button"
            className="btn-ghost h-10 w-10 shrink-0 p-0"
            aria-label="Schließen"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="soft-scrollbar space-y-2 overflow-y-auto p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          {matches.map((asset) => {
            const subtitle = [
              asset.category,
              asset.status === 'Verliehen' && asset.assignedTo && asset.assignedTo !== '-'
                ? asset.assignedTo
                : '',
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <button
                key={asset.id}
                type="button"
                className="flex min-h-[60px] w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left hover:border-brand-300 hover:bg-brand-50/50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-brand-400/50 dark:hover:bg-slate-800"
                onClick={() => onSelect(asset)}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {asset.name || asset.tagNumber}
                  </p>
                  {subtitle ? (
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
                  ) : null}
                </div>
                <StatusBadge value={asset.status} />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
