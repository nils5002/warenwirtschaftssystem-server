import { X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { LoadingButton } from '../../../../components/loading';
import { createPlanning, type PlanningResponse } from '../../../../services/wmsApi';

type PlanningCreateModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated: (planning: PlanningResponse) => void;
  /** Vorbelegtes Startdatum (z. B. Klick auf eine Tagesspalte im Kalender). */
  initialStartDate?: string | null;
};

function toIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getGermanWeekday(isoDate: string): string {
  const weekdays = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const date = new Date(`${isoDate}T00:00:00`);
  return weekdays[date.getDay()] ?? 'Tag';
}

// Kompaktes "Neue Planung"-Modal (nur Pflichtfelder, kein Scrollen).
// Positionen werden nach dem Anlegen auf der Detailseite (Tab Hardware)
// gepflegt — dorthin leitet onCreated weiter.
export function PlanningCreateModal({ open, onClose, onCreated, initialStartDate }: PlanningCreateModalProps) {
  const todayIso = toIsoDate(new Date());
  const [customerName, setCustomerName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [startDate, setStartDate] = useState(todayIso);
  const [endDate, setEndDate] = useState(todayIso);
  const [returnBufferDays, setReturnBufferDays] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const presetStart = initialStartDate && /^\d{4}-\d{2}-\d{2}$/.test(initialStartDate) ? initialStartDate : todayIso;
    setCustomerName('');
    setProjectName('');
    setStartDate(presetStart);
    setEndDate(presetStart);
    setReturnBufferDays(0);
    setError(null);
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const valid =
    customerName.trim().length > 0 && projectName.trim().length > 0 && endDate >= startDate;

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createPlanning({
        customerName: customerName.trim(),
        projectName: projectName.trim(),
        eventName: null,
        startDate,
        endDate,
        notes: '',
        status: 'Entwurf',
        returnBufferDays,
        days: [{ planningDate: startDate, weekday: getGermanWeekday(startDate), items: [] }],
      });
      onCreated(created);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Planung konnte nicht angelegt werden.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[85] flex items-end justify-center bg-slate-950/60 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="w-full max-w-md overflow-hidden rounded-t-2xl border border-line bg-surface shadow-panel sm:rounded-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Neue Planung"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h3 className="text-sm font-semibold text-ink">Neue Planung</h3>
          <button
            type="button"
            className="rounded-lg p-1.5 text-ink-muted transition hover:bg-surface-2 hover:text-ink"
            aria-label="Schließen"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="field text-xs">
              Kunde
              <input
                className="field-input"
                data-testid="planning-create-customer"
                value={customerName}
                autoFocus
                onChange={(event) => setCustomerName(event.target.value)}
              />
            </label>
            <label className="field text-xs">
              Projekt
              <input
                className="field-input"
                data-testid="planning-create-project"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
              />
            </label>
            <label className="field text-xs">
              Startdatum
              <input
                type="date"
                className="field-input"
                value={startDate}
                onChange={(event) => {
                  const next = event.target.value;
                  setStartDate(next);
                  if (endDate < next) setEndDate(next);
                }}
              />
            </label>
            <label className="field text-xs">
              Enddatum
              <input
                type="date"
                className="field-input"
                value={endDate}
                min={startDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </label>
            <label className="field text-xs sm:col-span-2">
              Rückgabe-Puffer (optional)
              <select
                className="field-input"
                value={returnBufferDays}
                onChange={(event) => setReturnBufferDays(Math.min(3, Math.max(0, Number(event.target.value) || 0)))}
              >
                {[0, 1, 2, 3].map((value) => (
                  <option key={value} value={value}>
                    {value} {value === 1 ? 'Tag' : 'Tage'}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {error ? <p className="text-xs text-rose-600 dark:text-rose-300">{error}</p> : null}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
          <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={onClose} disabled={saving}>
            Abbrechen
          </button>
          <LoadingButton
            type="button"
            data-testid="planning-create-submit"
            className="btn-primary px-4 py-1.5 text-xs"
            style={{ backgroundColor: '#4361EE' }}
            isLoading={saving}
            loadingText="Wird angelegt ..."
            disabled={!valid}
            onClick={() => {
              void submit();
            }}
          >
            Planung anlegen
          </LoadingButton>
        </div>
      </div>
    </div>
  );
}
