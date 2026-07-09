import { Check, ScanLine, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { SegmentedControl } from '../../../../ui';
import type { PlanningEventItem } from '../../../../services/wmsApi';
import { resolveAssetByScan, searchAssets } from '../../../qr';
import { formatGermanDateShort } from '../../../pages/planningCockpit';
import type { Asset } from '../../../types';

type IssueMode = 'ausgabe' | 'rueckgabe';

type IssueReturnTabProps = {
  planningId: string;
  endDate: string;
  // Bedarf je Kategorie aus dem (gespeicherten) Entwurf.
  demand: Array<{ categoryKey: string; qty: number }>;
  assets: Asset[];
  // Aktuell dieser Planung zugeordnete (= noch draußen befindliche) Geräte.
  assignedAssetIds: ReadonlySet<string>;
  assignedByCategory: ReadonlyMap<string, number>;
  events: PlanningEventItem[];
  todayIso: string;
  canOperate: boolean;
  busy: boolean;
  normalizeCategory: (key: string) => string;
  onIssue: (asset: Asset) => Promise<void>;
  onReturn: (asset: Asset) => Promise<void>;
};

type FlowMessage = { kind: 'error' | 'success'; text: string };

function formatEventTime(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

// Tab „Ausgabe und Rückgabe": scan-getriebener Workflow. Bucht über die
// bestehenden Checkout-/Checkin-Flows (Planungsbindung inkl. Rückgabedatum
// übernimmt der Server); die Zuordnung zur Position läuft über die Kategorie.
export function IssueReturnTab({
  planningId,
  endDate,
  demand,
  assets,
  assignedAssetIds,
  assignedByCategory,
  events,
  todayIso,
  canOperate,
  busy,
  normalizeCategory,
  onIssue,
  onReturn,
}: IssueReturnTabProps) {
  const [mode, setMode] = useState<IssueMode>('ausgabe');
  const [scanValue, setScanValue] = useState('');
  const [message, setMessage] = useState<FlowMessage | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const returnEnabled = todayIso >= endDate;

  // Autofokus: beim Öffnen des Tabs und nach jeder Buchung zurück ins Feld.
  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  const demandByCategory = useMemo(() => {
    const map = new Map<string, { label: string; qty: number }>();
    for (const entry of demand) {
      if (!entry.categoryKey) continue;
      map.set(normalizeCategory(entry.categoryKey), {
        label: entry.categoryKey,
        qty: Math.max(0, entry.qty),
      });
    }
    return map;
  }, [demand, normalizeCategory]);

  const plannedTotal = useMemo(
    () => Array.from(demandByCategory.values()).reduce((sum, entry) => sum + entry.qty, 0),
    [demandByCategory],
  );
  const issuedTotal = useMemo(
    () => Array.from(assignedByCategory.values()).reduce((sum, qty) => sum + qty, 0),
    [assignedByCategory],
  );

  // Rückgabe-Sicht: "jemals ausgegeben" aus der Historie ableiten (eindeutige
  // Geräte mit Ausgabe-Event) — zurückgegeben = jemals − noch draußen.
  const everIssuedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const event of events) {
      if (event.eventType === 'issue_recorded' && event.payload?.assetId) {
        ids.add(String(event.payload.assetId));
      }
    }
    return ids;
  }, [events]);
  const returnedTotal = Math.max(0, everIssuedIds.size - assignedAssetIds.size);

  const recentEvents = useMemo(
    () =>
      events
        .filter((event) =>
          mode === 'ausgabe'
            ? event.eventType === 'issue_recorded'
            : event.eventType === 'return_recorded',
        )
        .slice(0, 6),
    [events, mode],
  );

  const resolveScan = (raw: string): Asset | { error: string } => {
    const trimmed = raw.trim();
    if (!trimmed) return { error: 'Bitte eine Inventarnummer scannen oder eingeben.' };
    const exact = resolveAssetByScan(trimmed, assets);
    if (exact) return exact;
    const matches = searchAssets(trimmed, assets, 2);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      return { error: `„${trimmed}“ ist nicht eindeutig — bitte die vollständige Inventarnummer verwenden.` };
    }
    return { error: `Kein Gerät zu „${trimmed}“ gefunden.` };
  };

  const validateForIssue = (asset: Asset): string | null => {
    const category = normalizeCategory(asset.category);
    const target = demandByCategory.get(category);
    if (!target) return `${asset.category} ist in dieser Planung nicht vorgesehen.`;
    if (assignedAssetIds.has(asset.id)) return `${asset.tagNumber} ist bereits für diese Planung erfasst.`;
    if (asset.status !== 'Verfügbar') return `${asset.tagNumber} ist nicht verfügbar (Status: ${asset.status}).`;
    const issued = assignedByCategory.get(category) ?? 0;
    if (issued >= target.qty) {
      return `Soll für ${target.label} bereits erreicht (${issued} / ${target.qty}).`;
    }
    return null;
  };

  const validateForReturn = (asset: Asset): string | null => {
    if (!assignedAssetIds.has(asset.id)) {
      return `${asset.tagNumber} ist dieser Planung aktuell nicht zugeordnet.`;
    }
    return null;
  };

  const submitScan = async () => {
    if (submitting || busy) return;
    setMessage(null);
    const resolved = resolveScan(scanValue);
    if ('error' in resolved) {
      setMessage({ kind: 'error', text: resolved.error });
      inputRef.current?.select();
      return;
    }
    const validationError =
      mode === 'ausgabe' ? validateForIssue(resolved) : validateForReturn(resolved);
    if (validationError) {
      setMessage({ kind: 'error', text: validationError });
      inputRef.current?.select();
      return;
    }
    setSubmitting(true);
    try {
      if (mode === 'ausgabe') {
        await onIssue(resolved);
        setMessage({ kind: 'success', text: `${resolved.tagNumber} · ${resolved.category} ausgegeben.` });
      } else {
        await onReturn(resolved);
        setMessage({ kind: 'success', text: `${resolved.tagNumber} · ${resolved.category} zurückgenommen.` });
      }
      setScanValue('');
    } catch (error) {
      setMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Buchung fehlgeschlagen.',
      });
    } finally {
      setSubmitting(false);
      inputRef.current?.focus();
    }
  };

  const undoEvent = async (event: PlanningEventItem) => {
    if (submitting || busy) return;
    const assetId = event.payload?.assetId ? String(event.payload.assetId) : '';
    const asset = assets.find((item) => item.id === assetId);
    if (!asset) {
      setMessage({ kind: 'error', text: 'Gerät für Undo nicht gefunden.' });
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      if (event.eventType === 'issue_recorded') {
        if (!assignedAssetIds.has(asset.id)) {
          setMessage({ kind: 'error', text: `${asset.tagNumber} ist bereits zurückgenommen.` });
          return;
        }
        await onReturn(asset);
        setMessage({ kind: 'success', text: `Ausgabe von ${asset.tagNumber} rückgängig gemacht.` });
      } else {
        const validationError = validateForIssue(asset);
        if (validationError) {
          setMessage({ kind: 'error', text: validationError });
          return;
        }
        await onIssue(asset);
        setMessage({ kind: 'success', text: `Rückgabe von ${asset.tagNumber} rückgängig gemacht.` });
      }
    } catch (error) {
      setMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Undo fehlgeschlagen.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Offene Rückgaben nach Projektende: klarer Hinweis mit Kategorien.
  const outstandingByCategory = useMemo(() => {
    const parts: string[] = [];
    for (const [key, issued] of assignedByCategory) {
      if (issued <= 0) continue;
      const label = demandByCategory.get(key)?.label ?? key;
      parts.push(`${issued}× ${label}`);
    }
    return parts;
  }, [assignedByCategory, demandByCategory]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            options={[
              { value: 'ausgabe', label: 'Ausgabe' },
              { value: 'rueckgabe', label: 'Rückgabe' },
            ]}
            value={mode}
            onChange={(value) => {
              if (value === 'rueckgabe' && !returnEnabled) return;
              setMode(value);
              setMessage(null);
            }}
          />
          {!returnEnabled ? (
            <span className="text-xs text-ink-muted">Rückgabe ab {formatGermanDateShort(endDate)}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold text-ink">
            {mode === 'ausgabe'
              ? `${issuedTotal} von ${plannedTotal} ausgegeben`
              : `${returnedTotal} von ${returnedTotal + assignedAssetIds.size} zurückgegeben`}
          </span>
          <span className="inline-block h-1.5 w-24 overflow-hidden rounded-full bg-surface-2">
            <span
              className="block h-full rounded-full bg-primary"
              style={{
                width: `${
                  mode === 'ausgabe'
                    ? plannedTotal > 0
                      ? Math.min(100, Math.round((issuedTotal / plannedTotal) * 100))
                      : 0
                    : returnedTotal + assignedAssetIds.size > 0
                      ? Math.round((returnedTotal / (returnedTotal + assignedAssetIds.size)) * 100)
                      : 0
                }%`,
              }}
            />
          </span>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-surface-2 p-3">
        <div className="flex items-center gap-2">
          <ScanLine className="h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />
          <input
            ref={inputRef}
            className="field-input h-10 flex-1"
            placeholder="Inventarnummer scannen oder eingeben"
            value={scanValue}
            disabled={!canOperate || (mode === 'rueckgabe' && !returnEnabled)}
            onChange={(event) => setScanValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void submitScan();
              }
            }}
          />
          <button
            type="button"
            className="btn-primary px-4 py-2 text-sm"
            style={{ backgroundColor: '#4361EE' }}
            disabled={!canOperate || submitting || busy}
            onClick={() => {
              void submitScan();
            }}
          >
            Erfassen
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-ink-muted">
          Scanner-Fokus aktiv – erfasste Geräte werden automatisch der passenden Position zugeordnet.
        </p>
        {message ? (
          <p
            className={`mt-2 rounded-lg px-2.5 py-1.5 text-xs ${
              message.kind === 'error'
                ? 'bg-rose-500/10 text-rose-600 dark:text-rose-300'
                : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
            }`}
            role="status"
          >
            {message.text}
          </p>
        ) : null}
      </div>

      {mode === 'rueckgabe' && returnEnabled && outstandingByCategory.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          Noch nicht zurück: {outstandingByCategory.join(', ')}.
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)]">
        <div className="rounded-xl border border-line bg-surface-2 p-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Fortschritt je Kategorie
          </h4>
          <div className="mt-2 space-y-2">
            {Array.from(demandByCategory.entries()).map(([key, entry]) => {
              const issued = assignedByCategory.get(key) ?? 0;
              const complete = entry.qty > 0 && issued >= entry.qty;
              const ratio = entry.qty > 0 ? Math.min(1, issued / entry.qty) : 0;
              return (
                <div key={key} className="flex items-center gap-3 text-sm">
                  <span className="w-36 shrink-0 truncate font-medium text-ink" title={entry.label}>
                    {entry.label}
                  </span>
                  <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface">
                    <span
                      className={`block h-full rounded-full ${complete ? 'bg-emerald-500' : 'bg-primary'}`}
                      style={{ width: `${Math.round(ratio * 100)}%` }}
                    />
                  </span>
                  <span
                    className={`w-14 shrink-0 text-right text-xs tabular-nums ${
                      complete ? 'font-semibold text-emerald-600 dark:text-emerald-300' : 'text-ink-muted'
                    }`}
                  >
                    {issued} / {entry.qty}
                    {complete ? <Check className="ml-1 inline h-3 w-3" aria-hidden="true" /> : null}
                  </span>
                </div>
              );
            })}
            {demandByCategory.size === 0 ? (
              <p className="text-xs text-ink-muted">Noch kein Bedarf erfasst (Tab „Hardware“).</p>
            ) : null}
          </div>
        </div>

        <div className="rounded-xl border border-line bg-surface-2 p-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Zuletzt erfasst</h4>
          <ul className="mt-2 space-y-1.5">
            {recentEvents.map((event) => (
              <li key={event.id} className="flex items-center gap-2 text-xs">
                <span className="font-mono font-medium text-ink">
                  {String(event.payload?.tagNumber ?? event.payload?.assetId ?? '?')}
                </span>
                <span className="min-w-0 flex-1 truncate text-ink-muted">
                  {String(event.payload?.categoryKey ?? '')}
                </span>
                <span className="shrink-0 tabular-nums text-ink-faint">{formatEventTime(event.createdAt)}</span>
                {canOperate ? (
                  <button
                    type="button"
                    className="shrink-0 rounded p-1 text-ink-muted transition hover:bg-surface hover:text-ink"
                    aria-label="Buchung rückgängig machen"
                    title="Rückgängig"
                    disabled={submitting || busy}
                    onClick={() => {
                      void undoEvent(event);
                    }}
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </li>
            ))}
            {recentEvents.length === 0 ? (
              <li className="text-xs text-ink-muted">
                {mode === 'ausgabe' ? 'Noch nichts ausgegeben.' : 'Noch nichts zurückgenommen.'}
              </li>
            ) : null}
          </ul>
        </div>
      </div>
    </div>
  );
}
