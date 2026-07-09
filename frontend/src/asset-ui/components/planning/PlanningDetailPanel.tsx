import { ClipboardCheck, PenSquare, X } from 'lucide-react';
import { forwardRef } from 'react';

import { LoadingButton } from '../../../components/loading';
import type { PlanningStatus } from '../../../services/wmsApi';
import type {
  CategoryNeedRow,
  ConflictSentence,
  NeedsSummary,
  PlanningTimelineResult,
} from '../../pages/planningCockpit';
import { PlanningPeriod } from '../../pages/planningPeriod';
import { StatusBadge } from '../StatusBadge';
import { PlanningConflictSummary } from './PlanningConflictSummary';
import { PlanningNeedsTable } from './PlanningNeedsTable';
import { PlanningTimeline } from './PlanningTimeline';

// Read-only-Kopf der ausgewählten Planung — bewusst nur die Felder, die das
// Panel anzeigt (strukturelle Untermenge von EditablePlanning).
export type PlanningPanelData = {
  id: string;
  customerName: string;
  projectName: string;
  eventName: string;
  startDate: string;
  endDate: string;
  returnBufferDays: number;
  status: PlanningStatus;
  notes: string;
};

type PlanningDetailPanelProps = {
  planning: PlanningPanelData | null;
  loading: boolean;
  timeline: PlanningTimelineResult | null;
  needsRows: CategoryNeedRow[];
  needsSummary: NeedsSummary;
  sentences: ConflictSentence[];
  recommendation: string | null;
  // Geplant vs. bereits ausgegeben (Pack-/Ausgabe-Indikator).
  issuedQty: number | null;
  managerLabel: string | null;
  statusOptions: PlanningStatus[];
  canEdit: boolean;
  saving: boolean;
  onCheck: () => void;
  onEdit: () => void;
  onClose: () => void;
  onStatusChange: (status: PlanningStatus) => void;
  conflictRef?: React.Ref<HTMLDivElement>;
  maxHeightClass: string;
};

function nextSteps(input: {
  timeline: PlanningTimelineResult | null;
  status: PlanningStatus;
  missingTotal: number;
  needsCount: number;
}): string[] {
  const steps: string[] = [];
  const status = input.status === 'Bestaetigt' ? 'Bestätigt' : input.status;
  if (status === 'Storniert') return ['Planung ist storniert — keine Schritte offen.'];
  if (status === 'Abgeschlossen') return ['Projekt abgeschlossen.'];
  if (input.needsCount === 0) steps.push('Hardwarebedarf erfassen („Bearbeiten“).');
  if (input.missingTotal > 0) steps.push('Konflikte lösen oder Bedarf anpassen.');
  const active = input.timeline?.phases.find((phase) => phase.state === 'active')?.key;
  if (status === 'Entwurf') steps.push('Projekt prüfen und als Geplant speichern.');
  else if (status === 'Geplant') steps.push('Projekt prüfen und bestätigen.');
  if (active === 'ausgabe') steps.push('Geräte über die Ein-/Auslagerung ausgeben.');
  if (active === 'rueckgabe') steps.push('Geräte zurücknehmen.');
  if (!steps.length) steps.push('Alles vorbereitet — keine offenen Schritte.');
  return steps;
}

// Rechtes Detail-Panel des Planungs-Cockpits: read-only Sicht auf die
// ausgewählte Planung (Eckdaten, Timeline, Bedarf, verständliche Konflikte,
// nächste Schritte). Bearbeitet wird weiterhin im Editor-Modal („Bearbeiten“).
export const PlanningDetailPanel = forwardRef<HTMLDivElement, PlanningDetailPanelProps>(
  function PlanningDetailPanel(
    {
      planning,
      loading,
      timeline,
      needsRows,
      needsSummary,
      sentences,
      recommendation,
      issuedQty,
      managerLabel,
      statusOptions,
      canEdit,
      saving,
      onCheck,
      onEdit,
      onClose,
      onStatusChange,
      conflictRef,
      maxHeightClass,
    },
    ref,
  ) {
    if (!planning) {
      return (
        <article ref={ref} className="surface-card flex h-full min-h-[280px] items-center justify-center">
          {loading ? (
            <p className="text-sm text-ink-muted">Planung wird geladen ...</p>
          ) : (
            <div className="px-6 text-center">
              <p className="text-sm font-semibold text-ink">Keine Planung ausgewählt</p>
              <p className="mt-1 text-xs text-ink-muted">
                Links ein Projekt anklicken — Eckdaten, Hardwarebedarf und Konflikte erscheinen hier.
              </p>
            </div>
          )}
        </article>
      );
    }

    const status = planning.status === 'Bestaetigt' ? 'Bestätigt' : planning.status;
    // Primäre Statusaktion nach Mockup: Entwurf → Geplant, Geplant → Bestätigt.
    const statusAction =
      status === 'Entwurf'
        ? { label: 'Als Geplant speichern', to: 'Geplant' as PlanningStatus }
        : status === 'Geplant'
          ? { label: 'Bestätigen', to: 'Bestätigt' as PlanningStatus }
          : null;
    const steps = nextSteps({
      timeline,
      status: planning.status,
      missingTotal: needsSummary.missingTotal,
      needsCount: needsRows.length,
    });

    return (
      <article ref={ref} className={`surface-card soft-scrollbar overflow-y-auto ${maxHeightClass}`}>
        {/* Kopf: Eckdaten + Aktionen */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-base font-semibold text-ink">
                {planning.projectName}
                {planning.eventName ? (
                  <span className="font-normal text-ink-muted"> ({planning.eventName})</span>
                ) : null}
              </h3>
              <StatusBadge value={status} />
            </div>
            <p className="mt-0.5 text-xs text-ink-muted">
              Kunde: {planning.customerName}
            </p>
            <PlanningPeriod
              start={planning.startDate}
              end={planning.endDate}
              buffer={planning.returnBufferDays}
              variant="detail"
              className="mt-1.5"
            />
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-ink-muted transition hover:bg-surface-2 hover:text-ink"
            aria-label="Detail schließen"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <LoadingButton
            type="button"
            className="btn-primary px-3 py-1.5 text-xs"
            onClick={onCheck}
            isLoading={loading}
            loadingText="Wird geprüft ..."
            disabled={saving}
          >
            <ClipboardCheck className="h-3.5 w-3.5" />
            Projekt prüfen
          </LoadingButton>
          {canEdit && statusAction ? (
            <LoadingButton
              type="button"
              className="btn-secondary px-3 py-1.5 text-xs"
              onClick={() => onStatusChange(statusAction.to)}
              isLoading={saving}
              loadingText="..."
            >
              {statusAction.label}
            </LoadingButton>
          ) : null}
          {canEdit ? (
            <button
              type="button"
              className="btn-secondary px-3 py-1.5 text-xs"
              onClick={onEdit}
              disabled={saving}
            >
              <PenSquare className="h-3.5 w-3.5" />
              Bearbeiten
            </button>
          ) : null}
        </div>

        <div className="mt-4">
          {timeline ? <PlanningTimeline timeline={timeline} /> : null}
        </div>

        {/* Summary-Zeile: X geplant · Y verfügbar · Z fehlen (+ Ausgabe-Stand) */}
        <p className="mt-3 text-sm text-ink">
          <span className="font-semibold">{needsSummary.plannedTotal} Geräte geplant</span>
          <span className="text-ink-muted"> · {needsSummary.coveredTotal} verfügbar · </span>
          <span className={needsSummary.missingTotal > 0 ? 'font-semibold text-rose-600 dark:text-rose-300' : 'text-ink-muted'}>
            {needsSummary.missingTotal} fehlen
          </span>
          {issuedQty !== null && issuedQty > 0 ? (
            <span className="text-ink-muted"> · {issuedQty} ausgegeben</span>
          ) : null}
        </p>

        <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_200px]">
          <div className="min-w-0 space-y-3">
            <PlanningNeedsTable rows={needsRows} />
            <PlanningConflictSummary
              ref={conflictRef}
              sentences={sentences}
              recommendation={recommendation}
            />
          </div>
          <aside className="space-y-3 text-xs">
            <div className="rounded-xl border border-line bg-surface-2 p-3">
              <h4 className="font-semibold uppercase tracking-wide text-ink-muted">Nächste Schritte</h4>
              <ul className="mt-1.5 list-disc space-y-1 pl-4 text-ink">
                {steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-line bg-surface-2 p-3">
              <h4 className="font-semibold uppercase tracking-wide text-ink-muted">Verantwortlich</h4>
              <p className="mt-1 text-ink">{managerLabel ?? '–'}</p>
            </div>
            {canEdit ? (
              <div className="rounded-xl border border-line bg-surface-2 p-3">
                <h4 className="font-semibold uppercase tracking-wide text-ink-muted">Status ändern</h4>
                <select
                  className="field-input mt-1.5 h-8 w-full text-xs"
                  value={status}
                  disabled={saving}
                  onChange={(event) => onStatusChange(event.target.value as PlanningStatus)}
                >
                  {statusOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {planning.notes.trim() ? (
              <div className="rounded-xl border border-line bg-surface-2 p-3">
                <h4 className="font-semibold uppercase tracking-wide text-ink-muted">Hinweise</h4>
                <p className="mt-1 whitespace-pre-line break-words text-ink">{planning.notes}</p>
              </div>
            ) : null}
          </aside>
        </div>
      </article>
    );
  },
);
