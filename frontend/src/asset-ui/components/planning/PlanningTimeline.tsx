import { Check } from 'lucide-react';

import type { PlanningTimelineResult } from '../../pages/planningCockpit';

// Horizontaler Phasen-Stepper (Planung → … → Abschluss), ~56px hoch.
// Reine Anzeige einer abgeleiteten Einordnung — kein gespeicherter Status.
export function PlanningTimeline({ timeline }: { timeline: PlanningTimelineResult }) {
  return (
    <div className={timeline.cancelled ? 'opacity-45' : ''} aria-label="Projekt-Timeline">
      <ol className="flex items-start">
        {timeline.phases.map((phase, index) => {
          const isFirst = index === 0;
          const isLast = index === timeline.phases.length - 1;
          const dotClass =
            phase.state === 'done'
              ? 'border-primary bg-primary text-white'
              : phase.state === 'active'
                ? 'border-primary bg-primary text-white ring-4 ring-primary-soft'
                : 'border-line bg-surface-2 text-transparent';
          const lineDone = 'bg-primary/70';
          const lineOpen = 'bg-line';
          return (
            <li key={phase.key} className="flex min-w-0 flex-1 flex-col items-center">
              <div className="flex w-full items-center">
                <span
                  className={`h-0.5 flex-1 ${isFirst ? 'invisible' : phase.state === 'upcoming' ? lineOpen : lineDone}`}
                  aria-hidden="true"
                />
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${dotClass}`}
                  aria-hidden="true"
                >
                  {phase.state === 'done' ? <Check className="h-3 w-3" /> : null}
                </span>
                <span
                  className={`h-0.5 flex-1 ${
                    isLast ? 'invisible' : phase.state === 'done' ? lineDone : lineOpen
                  }`}
                  aria-hidden="true"
                />
              </div>
              <span
                className={`mt-1 truncate px-0.5 text-[10px] font-medium ${
                  phase.state === 'active' ? 'text-ink' : 'text-ink-muted'
                }`}
              >
                {phase.label}
              </span>
            </li>
          );
        })}
      </ol>
      {timeline.cancelled ? (
        <p className="mt-1 text-center text-[11px] font-medium text-ink-muted">Planung storniert</p>
      ) : null}
    </div>
  );
}
