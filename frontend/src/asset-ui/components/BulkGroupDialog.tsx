import { Handshake, PackageCheck, Undo2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { LoadingButton } from '../../components/loading';
import {
  listPlannings,
  qrGroupCheckin,
  qrGroupCheckout,
  resolveQrGroup,
  type PlanningListItem,
  type QrGroup,
  type QrGroupBookingResult,
} from '../../services/wmsApi';
import type { UserItem } from '../types';

type Mode = 'checkout' | 'checkin';

type BulkGroupDialogProps = {
  group: QrGroup;
  initialMode: Mode;
  users?: UserItem[];
  defaultProject?: string;
  onClose: () => void;
  onBooked: (result: QrGroupBookingResult) => void;
};

function toIsoDate(value: Date): string {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function BulkGroupDialog({
  group,
  initialMode,
  users,
  defaultProject,
  onClose,
  onBooked,
}: BulkGroupDialogProps) {
  const [liveGroup, setLiveGroup] = useState<QrGroup>(group);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [quantity, setQuantity] = useState<string>('1');
  const [project, setProject] = useState<string>(defaultProject?.trim() || '');
  const [assignee, setAssignee] = useState<string>('');
  const [dueDate, setDueDate] = useState<string>(() => toIsoDate(new Date(Date.now() + 2 * 86400000)));
  // F1: Rückgabedatum folgt der gewählten Planung, solange es der Nutzer
  // nicht bewusst manuell ändert (kein stiller "heute+2"-Default bei Planung).
  const [dueDateIsManual, setDueDateIsManual] = useState(false);
  const [note, setNote] = useState<string>('');
  const [plannings, setPlannings] = useState<PlanningListItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Aktuelle Mengen frisch laden (Scan/Listen-Eintrag könnten veraltet sein).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const fresh = await resolveQrGroup(group.qrToken);
        if (!cancelled) setLiveGroup(fresh);
      } catch {
        // Stiller Fallback auf die übergebenen Werte.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [group.qrToken]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await listPlannings();
        if (!cancelled) {
          setPlannings(list.filter((item) => ['Geplant', 'Bestätigt', 'Entwurf'].includes(item.status)));
        }
      } catch {
        if (!cancelled) setPlannings([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const projectOptions = useMemo(() => {
    const options = plannings.map((p) => `${p.customerName} · ${p.projectName}`);
    if (defaultProject?.trim()) options.unshift(defaultProject.trim());
    return [...new Set(options)];
  }, [plannings, defaultProject]);

  // Eindeutige Planungs-ID je Projekt-Anzeigetext (Schritt B). Mehrdeutige
  // Texte (gleicher Name in mehreren Planungen) werden NICHT zugeordnet.
  const planningIdByOption = useMemo(() => {
    const counts = new Map<string, number>();
    const ids = new Map<string, string>();
    for (const p of plannings) {
      const key = `${p.customerName} · ${p.projectName}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      ids.set(key, p.id);
    }
    const map = new Map<string, string>();
    for (const [key, id] of ids) {
      if (counts.get(key) === 1) map.set(key, id);
    }
    return map;
  }, [plannings]);

  const userOptions = useMemo(
    () => [...new Set((users ?? []).filter((u) => u.status === 'Aktiv').map((u) => u.name))],
    [users],
  );

  // F1: Enddatum der eindeutig gewählten Planung als Vorbelegung des
  // Rückgabedatums (fachlicher Rückgabetag); manuelle Änderung hat Vorrang.
  const selectedPlanningId = planningIdByOption.get(project.trim()) ?? null;
  const selectedPlanningEndDate = useMemo(() => {
    if (!selectedPlanningId) return null;
    const planning = plannings.find((item) => item.id === selectedPlanningId);
    const endDate = (planning?.endDate ?? '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? endDate : null;
  }, [selectedPlanningId, plannings]);

  const prevPlanningIdRef = useRef<string | null>(selectedPlanningId);
  useEffect(() => {
    const planningChanged = prevPlanningIdRef.current !== selectedPlanningId;
    prevPlanningIdRef.current = selectedPlanningId;
    if (planningChanged) {
      setDueDateIsManual(false);
    } else if (dueDateIsManual) {
      return;
    }
    if (selectedPlanningEndDate) {
      setDueDate(selectedPlanningEndDate);
    } else if (planningChanged) {
      setDueDate(toIsoDate(new Date(Date.now() + 2 * 86400000)));
    }
  }, [selectedPlanningId, selectedPlanningEndDate, dueDateIsManual]);

  const maxForMode = mode === 'checkout' ? liveGroup.availableCount : liveGroup.loanedCount;
  const parsedQty = Number.parseInt(quantity, 10);
  const qtyValid = Number.isFinite(parsedQty) && parsedQty >= 1 && parsedQty <= maxForMode;

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    const nextMax = next === 'checkout' ? liveGroup.availableCount : liveGroup.loanedCount;
    setQuantity(String(Math.min(Math.max(1, parsedQty || 1), Math.max(1, nextMax))));
  };

  const submit = async () => {
    if (!qtyValid) {
      setError(
        mode === 'checkout'
          ? `Bitte 1 bis ${maxForMode} eingeben.`
          : `Bitte 1 bis ${maxForMode} eingeben.`,
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let result: QrGroupBookingResult;
      if (mode === 'checkout') {
        const planningId = planningIdByOption.get(project.trim()) ?? null;
        result = await qrGroupCheckout(group.id, {
          quantity: parsedQty,
          assignee: assignee.trim() || null,
          projectName: project.trim() || null,
          planningId,
          dueDate: dueDate || null,
          note: note.trim() || null,
        });
      } else {
        result = await qrGroupCheckin(group.id, {
          quantity: parsedQty,
          projectName: project.trim() || null,
          condition: note.trim() || null,
        });
      }
      onBooked(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Buchung fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'checkout' ? `${liveGroup.name} ausgeben` : `${liveGroup.name} zurücknehmen`;
  const countLabel =
    mode === 'checkout'
      ? `${liveGroup.availableCount} verfügbar`
      : `${liveGroup.loanedCount} verliehen`;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-900/55 p-3 sm:items-center"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-panel dark:border-slate-700 dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">
              Sammel-QR
            </p>
            <h3 className="truncate text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {liveGroup.category} · Dieser QR-Code bucht mehrere vorhandene Geräte gesammelt.
            </p>
          </div>
          <button
            type="button"
            className="btn-ghost h-9 w-9 shrink-0 p-0"
            onClick={onClose}
            disabled={busy}
            aria-label="Schließen"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Modus-Umschalter: derselbe QR kann Ausgabe oder Rücknahme. */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
              mode === 'checkout'
                ? 'border-brand-300 bg-brand-50 text-brand-800'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
            }`}
            onClick={() => switchMode('checkout')}
            disabled={busy}
          >
            <Handshake className="h-4 w-4" />
            Ausgabe
          </button>
          <button
            type="button"
            className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
              mode === 'checkin'
                ? 'border-slate-400 bg-slate-100 text-slate-900'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
            }`}
            onClick={() => switchMode('checkin')}
            disabled={busy}
          >
            <Undo2 className="h-4 w-4" />
            Rücknahme
          </button>
        </div>

        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-200">
          {countLabel}
        </div>

        <label className="field mt-3">
          {mode === 'checkout'
            ? 'Wie viele Geräte sollen ausgegeben werden?'
            : 'Wie viele Geräte werden zurückgegeben?'}
          <input
            type="number"
            min={1}
            max={Math.max(1, maxForMode)}
            inputMode="numeric"
            className="field-input h-12 text-base"
            value={quantity}
            disabled={busy || maxForMode < 1}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </label>

        <label className="field mt-2">
          {mode === 'checkout' ? 'Projekt' : 'Projekt (optional)'}
          <input
            list="bulk-group-project-options"
            className="field-input h-12 text-base"
            placeholder="Projekt wählen oder eintragen"
            value={project}
            disabled={busy}
            onChange={(event) => setProject(event.target.value)}
          />
          <datalist id="bulk-group-project-options">
            {projectOptions.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        </label>

        {mode === 'checkout' ? (
          <>
            <label className="field mt-2">
              Person (optional)
              <input
                list="bulk-group-person-options"
                className="field-input h-12 text-base"
                placeholder="z. B. Max Mustermann"
                value={assignee}
                disabled={busy}
                onChange={(event) => setAssignee(event.target.value)}
              />
              <datalist id="bulk-group-person-options">
                {userOptions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </label>
            <label className="field mt-2">
              Geplante Rückgabe
              <input
                type="date"
                className="field-input h-12 text-base"
                value={dueDate}
                disabled={busy}
                onChange={(event) => {
                  setDueDate(event.target.value);
                  setDueDateIsManual(true);
                }}
              />
              <span className="text-xs text-slate-500">
                {selectedPlanningId
                  ? dueDateIsManual
                    ? 'Manuell geändert — Standard wäre der Rückgabetag der Planung.'
                    : 'Automatisch aus der Planung übernommen (Rückgabetag = Enddatum).'
                  : 'Ohne Planungsbezug: Standard ist heute + 2 Tage.'}
              </span>
            </label>
          </>
        ) : null}

        <label className="field mt-2">
          Notiz (optional)
          <input
            className="field-input h-12 text-base"
            placeholder={mode === 'checkout' ? 'Optionaler Hinweis' : 'Optionaler Zustandshinweis'}
            value={note}
            disabled={busy}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>

        {error ? (
          <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        {maxForMode < 1 ? (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {mode === 'checkout'
              ? 'Aktuell sind keine Geräte aus dieser Gruppe verfügbar.'
              : 'Aktuell ist kein Gerät aus dieser Gruppe verliehen.'}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secondary h-11" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <LoadingButton
            className={`${mode === 'checkout' ? 'btn-primary' : 'btn-dark'} h-11`}
            onClick={() => void submit()}
            isLoading={busy}
            loadingText="Wird gebucht …"
            disabled={!qtyValid || busy}
          >
            <PackageCheck className="h-4 w-4" />
            {mode === 'checkout' ? 'Ausgabe buchen' : 'Rücknahme buchen'}
          </LoadingButton>
        </div>
      </div>
    </div>
  );
}
