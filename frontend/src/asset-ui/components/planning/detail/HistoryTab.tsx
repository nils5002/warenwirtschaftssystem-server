import {
  ArrowLeftRight,
  CalendarClock,
  FilePlus2,
  Flag,
  MinusCircle,
  PackageCheck,
  PlusCircle,
  StickyNote,
} from 'lucide-react';
import { useMemo, useState, type ComponentType } from 'react';

import { LoadingButton } from '../../../../components/loading';
import type { PlanningEventItem } from '../../../../services/wmsApi';
import { formatGermanDateShort } from '../../../pages/planningCockpit';

type HistoryFilter = 'alle' | 'status' | 'hardware' | 'ausgabe' | 'notizen';

type HistoryTabProps = {
  events: PlanningEventItem[];
  canAddNotes: boolean;
  onAddNote: (text: string) => Promise<void>;
};

type EventPresentation = {
  icon: ComponentType<{ className?: string }>;
  // Titel als [normal, betont, normal, …] — betonte Teile werden fett gesetzt.
  parts: Array<{ text: string; strong?: boolean }>;
  noteText?: string;
  group: Exclude<HistoryFilter, 'alle'>;
};

function payloadStr(event: PlanningEventItem, key: string): string {
  const value = event.payload?.[key];
  return value === undefined || value === null ? '' : String(value);
}

function presentEvent(event: PlanningEventItem): EventPresentation {
  switch (event.eventType) {
    case 'planning_created':
      return {
        icon: FilePlus2,
        group: 'status',
        parts: [
          { text: payloadStr(event, 'duplicatedFrom') ? 'Planung erstellt (Duplikat)' : 'Planung erstellt' },
        ],
      };
    case 'status_changed':
      return {
        icon: Flag,
        group: 'status',
        parts: [
          { text: 'Status geändert – ' },
          { text: payloadStr(event, 'old') },
          { text: ' → ' },
          { text: payloadStr(event, 'new'), strong: true },
        ],
      };
    case 'timeframe_changed': {
      const oldRange = `${formatGermanDateShort(payloadStr(event, 'oldStart'))}–${formatGermanDateShort(payloadStr(event, 'oldEnd'))}`;
      const newRange = `${formatGermanDateShort(payloadStr(event, 'newStart'))}–${formatGermanDateShort(payloadStr(event, 'newEnd'))}`;
      const bufferChanged = payloadStr(event, 'oldBuffer') !== payloadStr(event, 'newBuffer');
      return {
        icon: CalendarClock,
        group: 'hardware',
        parts: [
          { text: 'Zeitraum geändert – ' },
          { text: oldRange },
          { text: ' → ' },
          { text: newRange, strong: true },
          ...(bufferChanged
            ? [{ text: ` · Puffer ${payloadStr(event, 'oldBuffer')} → ${payloadStr(event, 'newBuffer')}` }]
            : []),
        ],
      };
    }
    case 'position_added':
      return {
        icon: PlusCircle,
        group: 'hardware',
        parts: [
          { text: 'Position hinzugefügt – ' },
          { text: `${payloadStr(event, 'categoryKey')} × ${payloadStr(event, 'qty')}`, strong: true },
        ],
      };
    case 'position_removed':
      return {
        icon: MinusCircle,
        group: 'hardware',
        parts: [
          { text: 'Position entfernt – ' },
          { text: `${payloadStr(event, 'categoryKey')} × ${payloadStr(event, 'qty')}`, strong: true },
        ],
      };
    case 'quantity_changed':
      return {
        icon: ArrowLeftRight,
        group: 'hardware',
        parts: [
          { text: 'Menge geändert – ' },
          { text: payloadStr(event, 'categoryKey'), strong: true },
          { text: ` ${payloadStr(event, 'oldQty')} → ` },
          { text: payloadStr(event, 'newQty'), strong: true },
        ],
      };
    case 'note_added':
      return {
        icon: StickyNote,
        group: 'notizen',
        parts: [{ text: 'Notiz hinzugefügt' }],
        noteText: payloadStr(event, 'text'),
      };
    case 'issue_recorded':
      return {
        icon: PackageCheck,
        group: 'ausgabe',
        parts: [
          { text: 'Ausgabe erfasst – ' },
          { text: payloadStr(event, 'tagNumber') || payloadStr(event, 'assetName'), strong: true },
          { text: ` · ${payloadStr(event, 'categoryKey')}` },
        ],
      };
    case 'return_recorded':
      return {
        icon: PackageCheck,
        group: 'ausgabe',
        parts: [
          { text: 'Rückgabe erfasst – ' },
          { text: payloadStr(event, 'tagNumber') || payloadStr(event, 'assetName'), strong: true },
          { text: ` · ${payloadStr(event, 'categoryKey')}` },
        ],
      };
    default:
      return { icon: Flag, group: 'status', parts: [{ text: event.eventType }] };
  }
}

function formatMeta(event: PlanningEventItem): string {
  const date = new Date(event.createdAt);
  const dateLabel = Number.isNaN(date.getTime())
    ? ''
    : `${date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })} · ${date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
  const actor = event.actorName?.trim();
  return actor ? `${dateLabel} · ${actor}` : dateLabel;
}

const FILTER_CHIPS: Array<{ value: HistoryFilter; label: string }> = [
  { value: 'alle', label: 'Alle' },
  { value: 'status', label: 'Status' },
  { value: 'hardware', label: 'Hardware' },
  { value: 'ausgabe', label: 'Ausgabe' },
  { value: 'notizen', label: 'Notizen' },
];

// Tab „Historie": Notizen + Audit-Zeitleiste (ersetzt das lose Notizfeld).
export function HistoryTab({ events, canAddNotes, onAddNote }: HistoryTabProps) {
  const [filter, setFilter] = useState<HistoryFilter>('alle');
  const [noteText, setNoteText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visibleEvents = useMemo(() => {
    if (filter === 'alle') return events;
    return events.filter((event) => presentEvent(event).group === filter);
  }, [events, filter]);

  const submitNote = async () => {
    const text = noteText.trim();
    if (!text || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onAddNote(text);
      setNoteText('');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Notiz konnte nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {canAddNotes ? (
        <div className="flex items-center gap-2">
          <input
            className="field-input h-10 flex-1"
            placeholder="Notiz hinzufügen"
            value={noteText}
            onChange={(event) => setNoteText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void submitNote();
              }
            }}
          />
          <LoadingButton
            type="button"
            className="btn-secondary px-4 py-2 text-sm"
            isLoading={saving}
            loadingText="…"
            disabled={!noteText.trim()}
            onClick={() => {
              void submitNote();
            }}
          >
            Hinzufügen
          </LoadingButton>
        </div>
      ) : null}
      {error ? <p className="text-xs text-rose-600 dark:text-rose-300">{error}</p> : null}

      <div className="flex flex-wrap gap-1.5">
        {FILTER_CHIPS.map((chip) => (
          <button
            key={chip.value}
            type="button"
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              filter === chip.value
                ? 'border-transparent bg-primary text-white'
                : 'border-line bg-surface-2 text-ink-muted hover:text-ink'
            }`}
            onClick={() => setFilter(chip.value)}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <ol className="space-y-1">
        {visibleEvents.map((event) => {
          const presentation = presentEvent(event);
          const Icon = presentation.icon;
          return (
            <li key={event.id} className="flex gap-3 py-1.5">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-ink-muted">
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink">
                  {presentation.parts.map((part, index) =>
                    part.strong ? (
                      <strong key={index} className="font-semibold">
                        {part.text}
                      </strong>
                    ) : (
                      <span key={index}>{part.text}</span>
                    ),
                  )}
                </p>
                {presentation.noteText ? (
                  <p className="mt-1 rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-xs leading-relaxed text-ink">
                    {presentation.noteText}
                  </p>
                ) : null}
                <p className="mt-0.5 text-[11px] text-ink-faint">{formatMeta(event)}</p>
              </div>
            </li>
          );
        })}
        {visibleEvents.length === 0 ? (
          <li className="rounded-xl border border-dashed border-line bg-surface-2 px-3 py-6 text-center text-xs text-ink-muted">
            Noch keine Ereignisse in dieser Ansicht.
          </li>
        ) : null}
      </ol>
    </div>
  );
}
