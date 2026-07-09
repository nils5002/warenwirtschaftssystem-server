import { forwardRef, useState } from 'react';

import type { ConflictSentence, ConflictSentenceTone } from '../../pages/planningCockpit';

const TONE_BULLET: Record<ConflictSentenceTone, string> = {
  red: 'bg-rose-500',
  yellow: 'bg-amber-500',
  blue: 'bg-sky-500',
};

const VISIBLE_LIMIT = 4;

type PlanningConflictSummaryProps = {
  sentences: ConflictSentence[];
  recommendation: string | null;
};

// "Verständliche Konflikte": kurze deutsche Sätze statt technischer Chips —
// wer blockiert, wann kommt Ware zurück, was per Übergabe gedeckt ist.
// forwardRef, damit "Konflikte lösen" im Prüf-Modal hierher scrollen kann.
export const PlanningConflictSummary = forwardRef<HTMLDivElement, PlanningConflictSummaryProps>(
  function PlanningConflictSummary({ sentences, recommendation }, ref) {
    const [expanded, setExpanded] = useState(false);
    const visible = expanded ? sentences : sentences.slice(0, VISIBLE_LIMIT);
    const hiddenCount = sentences.length - visible.length;

    return (
      <div ref={ref} className="rounded-xl border border-line bg-surface-2 p-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Verständliche Konflikte
        </h4>
        {sentences.length === 0 ? (
          <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">
            Keine Konflikte — der Bedarf ist im gesamten Zeitraum gedeckt.
          </p>
        ) : (
          <>
            <ul className="mt-2 space-y-1.5">
              {visible.map((sentence, index) => (
                <li key={`${sentence.categoryKey}-${sentence.tone}-${index}`} className="flex items-start gap-2">
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE_BULLET[sentence.tone]}`}
                    aria-hidden="true"
                  />
                  <span className="text-xs leading-relaxed text-ink">{sentence.text}</span>
                </li>
              ))}
            </ul>
            {hiddenCount > 0 ? (
              <button
                type="button"
                className="mt-1.5 text-[11px] font-medium text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                onClick={() => setExpanded(true)}
              >
                + {hiddenCount} weitere anzeigen
              </button>
            ) : null}
            {expanded && sentences.length > VISIBLE_LIMIT ? (
              <button
                type="button"
                className="mt-1.5 text-[11px] font-medium text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                onClick={() => setExpanded(false)}
              >
                Weniger anzeigen
              </button>
            ) : null}
            {recommendation ? (
              <p className="mt-2 border-t border-line pt-2 text-xs text-ink-muted">
                <span className="font-semibold text-ink">Lösungsvorschlag:</span> {recommendation}
              </p>
            ) : null}
          </>
        )}
      </div>
    );
  },
);
