import { AlertTriangle, Check, X } from 'lucide-react';

import { LoadingButton } from '../../../components/loading';
import type { PlanningStatus } from '../../../services/wmsApi';
import type { ConflictSentence, NeedsSummary } from '../../pages/planningCockpit';

type ChecklistState = 'ok' | 'warn' | 'fail';

type PlanningCheckModalProps = {
  open: boolean;
  // true, solange die frische Verfügbarkeitsprüfung läuft.
  checking: boolean;
  saving: boolean;
  status: PlanningStatus;
  needsSummary: NeedsSummary;
  needsCount: number;
  sentences: ConflictSentence[];
  recommendation: string | null;
  canEdit: boolean;
  onResolve: () => void;
  onSaveStatus: (status: PlanningStatus) => void;
  onAdjust: () => void;
  onClose: () => void;
};

function ChecklistRow({ state, label }: { state: ChecklistState; label: string }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      {state === 'ok' ? (
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">
          <Check className="h-3.5 w-3.5" />
        </span>
      ) : state === 'warn' ? (
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-300">
          <AlertTriangle className="h-3 w-3" />
        </span>
      ) : (
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-300">
          <X className="h-3.5 w-3.5" />
        </span>
      )}
      <span className="text-ink">{label}</span>
    </li>
  );
}

// „Projektprüfung und Konfliktlösung“: orchestriert ausschließlich vorhandene
// Daten (frisch geladene Availability + abgeleitete Konfliktsätze) zu einem
// geführten Vorgang. Keine neue Fachlogik.
export function PlanningCheckModal({
  open,
  checking,
  saving,
  status,
  needsSummary,
  needsCount,
  sentences,
  recommendation,
  canEdit,
  onResolve,
  onSaveStatus,
  onAdjust,
  onClose,
}: PlanningCheckModalProps) {
  if (!open) return null;

  const normalizedStatus = status === 'Bestaetigt' ? 'Bestätigt' : status;
  const hasRed = sentences.some((sentence) => sentence.tone === 'red');
  const hasYellow = sentences.some((sentence) => sentence.tone === 'yellow');
  const allClear = !checking && !hasRed && !hasYellow && needsCount > 0;
  // Grüner Pfad: Entwurf → Geplant, Geplant → Bestätigt.
  const confirmTarget: PlanningStatus | null =
    normalizedStatus === 'Entwurf' ? 'Geplant' : normalizedStatus === 'Geplant' ? 'Bestätigt' : null;

  return (
    <div
      className="fixed inset-0 z-[90] bg-slate-900/60 p-4"
      onClick={() => {
        if (!checking && !saving) onClose();
      }}
    >
      <div className="flex h-full items-center justify-center">
        <article
          className="surface-card w-full max-w-lg overflow-y-auto rounded-2xl shadow-panel"
          style={{ maxHeight: '85vh' }}
          onClick={(event) => event.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Projektprüfung und Konfliktlösung"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold text-ink">Projektprüfung und Konfliktlösung</h3>
              <p className="mt-0.5 text-xs text-ink-muted">
                {checking
                  ? 'Verfügbarkeit wird geprüft ...'
                  : allClear
                    ? 'Alles in Ordnung — das Projekt kann bestätigt werden.'
                    : hasRed
                      ? 'Dieses Projekt kann noch nicht sauber bestätigt werden.'
                      : 'Bitte die Hinweise kurz prüfen.'}
              </p>
            </div>
            <button
              type="button"
              className="rounded-lg p-1.5 text-ink-muted transition hover:bg-surface-2 hover:text-ink"
              aria-label="Schließen"
              onClick={onClose}
              disabled={checking || saving}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <ul className="mt-3 space-y-1.5">
            <ChecklistRow
              state={needsCount > 0 ? 'ok' : 'fail'}
              label={needsCount > 0 ? `Hardwarebedarf erfasst (${needsSummary.plannedTotal} Geräte)` : 'Kein Hardwarebedarf erfasst'}
            />
            <ChecklistRow state={checking ? 'warn' : 'ok'} label="Verfügbarkeit geprüft" />
            <ChecklistRow
              state={checking ? 'warn' : hasRed ? 'fail' : hasYellow ? 'warn' : 'ok'}
              label={
                hasRed
                  ? `${needsSummary.missingTotal} Geräte fehlen im Zeitraum`
                  : hasYellow
                    ? 'Verfügbar, aber mit Hinweisen'
                    : 'Geräte im Zeitraum verfügbar'
              }
            />
          </ul>

          {!checking && sentences.length > 0 ? (
            <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50/80 p-3 dark:border-amber-600/50 dark:bg-amber-950/30">
              <ul className="space-y-1.5">
                {sentences.slice(0, 4).map((sentence, index) => (
                  <li key={index} className="flex items-start gap-2 text-xs leading-relaxed text-ink">
                    <span
                      className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                        sentence.tone === 'red' ? 'bg-rose-500' : sentence.tone === 'yellow' ? 'bg-amber-500' : 'bg-sky-500'
                      }`}
                      aria-hidden="true"
                    />
                    {sentence.text}
                  </li>
                ))}
              </ul>
              {sentences.length > 4 ? (
                <p className="mt-1 text-[11px] text-ink-muted">+ {sentences.length - 4} weitere im Detailbereich</p>
              ) : null}
              {recommendation ? (
                <p className="mt-2 border-t border-amber-300/60 pt-2 text-xs text-ink">
                  <span className="font-semibold">Lösung:</span> {recommendation}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              className="btn-ghost px-3 py-1.5 text-xs"
              onClick={onClose}
              disabled={checking || saving}
            >
              Abbrechen
            </button>
            {canEdit ? (
              <button
                type="button"
                className="btn-secondary px-3 py-1.5 text-xs"
                onClick={onAdjust}
                disabled={checking || saving}
              >
                Bedarf anpassen
              </button>
            ) : null}
            {canEdit && !allClear && confirmTarget ? (
              <LoadingButton
                type="button"
                className="btn-secondary px-3 py-1.5 text-xs"
                onClick={() => onSaveStatus(confirmTarget)}
                isLoading={saving}
                loadingText="Wird gespeichert ..."
                disabled={checking}
              >
                Trotzdem als {confirmTarget} speichern
              </LoadingButton>
            ) : null}
            {!allClear && (hasRed || hasYellow) ? (
              <button
                type="button"
                className="btn-primary px-3 py-1.5 text-xs"
                onClick={onResolve}
                disabled={checking || saving}
              >
                Konflikte lösen
              </button>
            ) : null}
            {canEdit && allClear && confirmTarget ? (
              <LoadingButton
                type="button"
                className="btn-primary px-3 py-1.5 text-xs"
                onClick={() => onSaveStatus(confirmTarget)}
                isLoading={saving}
                loadingText="Wird gespeichert ..."
              >
                {confirmTarget === 'Geplant' ? 'Als Geplant speichern' : 'Bestätigen'}
              </LoadingButton>
            ) : null}
          </div>
        </article>
      </div>
    </div>
  );
}
