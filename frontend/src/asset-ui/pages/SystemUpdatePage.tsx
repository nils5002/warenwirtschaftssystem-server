import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  ExternalLink,
  GitCommitHorizontal,
  Loader2,
  RefreshCw,
  Rocket,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { LoadingButton } from '../../components/loading';
import {
  checkSystemUpdate,
  fetchSystemUpdateHistory,
  fetchSystemUpdateStatus,
  fetchSystemVersion,
  isWmsApiError,
  startSystemUpdate,
  type SystemUpdateCheck,
  type SystemUpdateRun,
  type SystemVersion,
} from '../../services/wmsApi';
import { PageHeader } from '../../ui';
import {
  buildConfirmDialog,
  buildProgressSteps,
  describeCheck,
  describeHistoryEntry,
  failedStepFor,
  formatDateTime,
  initialPollState,
  isActivePhase,
  reducePoll,
  type PollState,
  type ProgressStep,
} from './systemUpdate';

const POLL_INTERVAL_MS = 5000;

const TONE_CLASSES: Record<string, string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  info: 'border-sky-200 bg-sky-50 text-sky-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  danger: 'border-rose-200 bg-rose-50 text-rose-800',
  neutral: 'border-line bg-surface-2 text-ink-muted',
};

function StepIcon({ state }: { state: ProgressStep['state'] }) {
  if (state === 'done') return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (state === 'active') return <Loader2 className="h-4 w-4 animate-spin text-sky-600" />;
  if (state === 'failed') return <XCircle className="h-4 w-4 text-rose-600" />;
  return <Circle className="h-4 w-4 text-slate-300" />;
}

export function SystemUpdatePage() {
  const [version, setVersion] = useState<SystemVersion | null>(null);
  const [check, setCheck] = useState<SystemUpdateCheck | null>(null);
  const [history, setHistory] = useState<SystemUpdateRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [poll, setPoll] = useState<PollState | null>(null);
  // Laufender Vorgang aus Sicht des Servers (z. B. nach einem Seiten-Reload
  // mitten im Update) — Grundlage für die Fehlerzuordnung im Fortschritt.
  const [activeRun, setActiveRun] = useState<SystemUpdateRun | null>(null);
  const timeoutMsRef = useRef(600_000);

  const loadHistory = useCallback(async () => {
    try {
      const result = await fetchSystemUpdateHistory(10);
      setHistory(result.items);
    } catch {
      // Die Historie ist Zusatzinfo — ein Fehler darf die Seite nicht blockieren.
    }
  }, []);

  const runCheck = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      setCheck(await checkSystemUpdate());
    } catch (err) {
      if (isWmsApiError(err) && err.status === 403) {
        setForbidden(true);
      } else {
        setError('Die Versionsprüfung konnte nicht ausgeführt werden.');
      }
    } finally {
      setChecking(false);
    }
  }, []);

  // Erstinitialisierung: Version + Status + Prüfung + Historie.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const info = await fetchSystemVersion();
        if (cancelled) return;
        setVersion(info);

        const status = await fetchSystemUpdateStatus();
        if (cancelled) return;
        timeoutMsRef.current = Math.max(60, status.timeoutSeconds) * 1000;
        if (status.inProgress && status.run) {
          // Reload mitten im Update: Fortschritt weiterverfolgen statt neu starten.
          setActiveRun(status.run);
          setPoll(
            initialPollState(Date.now(), status.run.id, status.run.targetShortCommit ?? null),
          );
        }
        await runCheck();
        await loadHistory();
      } catch (err) {
        if (cancelled) return;
        if (isWmsApiError(err) && err.status === 403) {
          setForbidden(true);
        } else {
          setError('Die Systeminformationen konnten nicht geladen werden.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadHistory, runCheck]);

  // Fortschritts-Polling. Netzwerkfehler sind während des Redeploys erwartet
  // (das Backend startet gerade neu) und werden erst nach dem Timeout zum Fehler.
  useEffect(() => {
    if (!poll || !isActivePhase(poll.phase)) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const status = await fetchSystemUpdateStatus();
          if (cancelled) return;
          if (status.run) setActiveRun(status.run);
          setPoll((prev) =>
            prev ? reducePoll(prev, { kind: 'status', status }, Date.now(), timeoutMsRef.current) : prev,
          );
        } catch (err) {
          if (cancelled) return;
          // 401/403 während des Neustarts kann nicht auftreten (gleiche Session),
          // alles andere zählt als "Backend gerade nicht erreichbar".
          setPoll((prev) =>
            prev ? reducePoll(prev, { kind: 'networkError' }, Date.now(), timeoutMsRef.current) : prev,
          );
          void err;
        }
      })();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [poll?.phase, poll?.runId]);

  // Nach Abschluss: Version, Prüfung und Historie neu laden.
  const finishedPhase = poll && !isActivePhase(poll.phase) ? poll.phase : null;
  useEffect(() => {
    if (!finishedPhase) return;
    void (async () => {
      try {
        setVersion(await fetchSystemVersion());
      } catch {
        // Der Abschlusszustand bleibt auch ohne frische Versionsinfo gültig.
      }
      await runCheck();
      await loadHistory();
    })();
  }, [finishedPhase, loadHistory, runCheck]);

  const startUpdate = async () => {
    setConfirmOpen(false);
    setStarting(true);
    setError(null);
    try {
      const result = await startSystemUpdate();
      // Timeout-Fenster vom Server übernehmen (falls erreichbar) — danach
      // beginnt der Redeploy und das Backend ist kurz weg.
      const statusAfterStart = await fetchSystemUpdateStatus().catch(() => null);
      if (statusAfterStart) {
        timeoutMsRef.current = Math.max(60, statusAfterStart.timeoutSeconds) * 1000;
      }
      setActiveRun(result.run ?? null);
      setPoll(
        initialPollState(Date.now(), result.run?.id ?? null, result.run?.targetShortCommit ?? null),
      );
      await loadHistory();
    } catch (err) {
      if (isWmsApiError(err)) {
        setError(err.detail || 'Das Update konnte nicht gestartet werden.');
      } else {
        setError('Das Update konnte nicht gestartet werden.');
      }
      await loadHistory();
    } finally {
      setStarting(false);
    }
  };

  if (forbidden) {
    return (
      <section className="space-y-5">
        <PageHeader kicker="Administration · System" title="Systemupdate" />
        <article className="surface-card p-6 text-sm text-slate-600">
          Für Systemupdates fehlen Ihnen die Berechtigungen. Bitte wenden Sie sich an die
          Administration.
        </article>
      </section>
    );
  }

  const view = describeCheck(check, { checking: checking && !check });
  const updateDisabled = version ? !version.updateEnabled : check?.updateEnabled === false;
  const inProgress = !!poll && isActivePhase(poll.phase);
  const dialog = buildConfirmDialog(check);
  const steps = poll
    ? buildProgressSteps(poll.phase, failedStepFor(activeRun))
    : [];

  return (
    <section className="space-y-5">
      <PageHeader
        kicker="Administration · System"
        title="Systemupdate"
        subtitle="Neuesten Stand von GitHub prüfen und den Stack über Portainer neu ausrollen."
        actions={
          <>
            <LoadingButton
              className="btn-secondary h-10"
              isLoading={checking}
              onClick={() => void runCheck()}
              disabled={inProgress || updateDisabled}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Erneut prüfen
            </LoadingButton>
            {check?.compareUrl ? (
              <a
                className="btn-secondary h-10 inline-flex items-center"
                href={check.compareUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Änderungen auf GitHub ansehen
              </a>
            ) : null}
          </>
        }
      />

      {error ? (
        <p className={`rounded-xl border px-3 py-2 text-sm ${TONE_CLASSES.danger}`}>{error}</p>
      ) : null}

      {loading ? (
        <article className="surface-card p-6 text-sm text-slate-500">Wird geladen ...</article>
      ) : updateDisabled ? (
        <article className="surface-card space-y-2 p-6">
          <p className="text-base font-semibold text-slate-900">
            Systemupdates sind auf diesem Server nicht aktiviert.
          </p>
          <p className="text-sm text-slate-600">
            Die Funktion wird serverseitig über <code>SYSTEM_UPDATE_ENABLED</code> freigeschaltet.
          </p>
        </article>
      ) : (
        <>
          {/* --- Versionen --- */}
          <article className="surface-card space-y-4 p-5 animate-fade-up">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="page-kicker">Installierte Version</p>
                <p className="mt-1 inline-flex items-center gap-2 font-mono text-lg font-semibold text-slate-900">
                  <GitCommitHorizontal className="h-4 w-4 text-brand-700" />
                  {version?.installedShortCommit ?? 'unbekannt'}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {version?.installedBranch ? `Branch ${version.installedBranch}` : `Branch ${version?.branch ?? '—'}`}
                  {version?.buildTime ? ` · Build ${formatDateTime(version.buildTime)}` : ''}
                </p>
              </div>
              <div>
                <p className="page-kicker">
                  {check?.state === 'update_available' ? 'Neue Version verfügbar' : 'Stand auf GitHub'}
                </p>
                <p className="mt-1 font-mono text-lg font-semibold text-slate-900">
                  {view.newShortSha ?? '—'}
                </p>
                {view.newMessage ? (
                  <p className="mt-1 text-sm text-slate-600">{view.newMessage}</p>
                ) : null}
              </div>
            </div>

            <p className={`rounded-xl border px-3 py-2 text-sm ${TONE_CLASSES[view.tone]}`}>
              {view.headline}
              {/* Details nur, wenn sie nicht ohnehin schon oben stehen
                  (z. B. die Commit-Nachricht der neuen Version). */}
              {view.detail && view.detail !== view.headline && view.detail !== view.newMessage ? (
                <span className="block text-xs opacity-90">{view.detail}</span>
              ) : null}
            </p>

            {view.canInstall ? (
              <div>
                <LoadingButton
                  className="btn-primary h-11"
                  isLoading={starting}
                  disabled={inProgress}
                  onClick={() => setConfirmOpen(true)}
                >
                  <Rocket className="mr-2 h-4 w-4" />
                  Update installieren
                </LoadingButton>
              </div>
            ) : null}
          </article>

          {/* --- Fortschritt --- */}
          {poll ? (
            <article className="surface-card space-y-3 p-5">
              <p className="text-base font-semibold text-slate-900">
                {poll.phase === 'success'
                  ? 'Update abgeschlossen'
                  : poll.phase === 'failed' || poll.phase === 'timeout'
                    ? 'Update nicht abgeschlossen'
                    : 'Update läuft'}
              </p>
              <ul className="space-y-2">
                {steps.map((step) => (
                  <li key={step.key} className="flex items-center gap-2 text-sm text-slate-700">
                    <StepIcon state={step.state} />
                    <span className={step.state === 'pending' ? 'text-slate-400' : ''}>
                      {step.label}
                    </span>
                  </li>
                ))}
              </ul>
              <p
                className={`rounded-xl border px-3 py-2 text-sm ${
                  poll.phase === 'success'
                    ? TONE_CLASSES.success
                    : poll.phase === 'failed' || poll.phase === 'timeout'
                      ? TONE_CLASSES.danger
                      : TONE_CLASSES.info
                }`}
              >
                {poll.phase === 'failed' || poll.phase === 'timeout' ? (
                  <AlertTriangle className="mr-2 inline h-4 w-4" />
                ) : null}
                {poll.message}
              </p>
            </article>
          ) : null}

          {/* --- Historie --- */}
          <article className="surface-card space-y-3 p-5">
            <p className="text-base font-semibold text-slate-900">Letzte Updates</p>
            {history.length === 0 ? (
              <p className="text-sm text-slate-500">Es wurde noch kein Update über das WWS gestartet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {history.map((item) => {
                  const entry = describeHistoryEntry(item);
                  return (
                    <li key={entry.id} className="py-3 first:pt-0 last:pb-0">
                      <p className="text-sm text-slate-500">{entry.when}</p>
                      <p className="font-mono text-sm text-slate-900">{entry.versions}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-xs ${TONE_CLASSES[entry.tone]}`}
                        >
                          {entry.status}
                        </span>
                        {entry.actor ? (
                          <span className="text-slate-600">Ausgeführt von {entry.actor}</span>
                        ) : null}
                      </p>
                      {entry.message ? (
                        <p className="mt-1 text-xs text-slate-500">{entry.message}</p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </article>
        </>
      )}

      {/* --- Bestätigungsdialog --- */}
      {confirmOpen ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/55 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="system-update-confirm-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <h3
              id="system-update-confirm-title"
              className="text-base font-semibold text-slate-900 dark:text-slate-50"
            >
              {dialog.title}
            </h3>
            <div className="mt-2 space-y-1 text-sm text-slate-600 dark:text-slate-300">
              {dialog.body.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
            <dl className="mt-4 space-y-1 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Aktuell</dt>
                <dd className="font-mono text-slate-900 dark:text-slate-50">{dialog.currentLabel}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Neu</dt>
                <dd className="font-mono text-slate-900 dark:text-slate-50">{dialog.newLabel}</dd>
              </div>
            </dl>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button type="button" className="btn-secondary h-10" onClick={() => setConfirmOpen(false)}>
                {dialog.cancelLabel}
              </button>
              <LoadingButton
                className="btn-primary h-10"
                isLoading={starting}
                onClick={() => void startUpdate()}
              >
                {dialog.confirmLabel}
              </LoadingButton>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
