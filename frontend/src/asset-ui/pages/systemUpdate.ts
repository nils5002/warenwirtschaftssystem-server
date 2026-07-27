/**
 * Ableitungen für die Adminseite „Systemupdate".
 *
 * Bewusst frei von React und `fetch`: Zustandsübergänge, Fortschrittsschritte
 * und Textbausteine liegen hier als reine Funktionen und sind damit direkt
 * testbar (gleiches Muster wie `planningCockpit.ts`).
 */
import type {
  SystemUpdateCheck,
  SystemUpdateRun,
  SystemUpdateStatus,
  UpdateRunStatus,
} from '../../services/wmsApi';

/** Phasen aus Sicht der Oberfläche (Server-Status + lokale Neustart-Erkennung). */
export type UpdatePhase =
  | 'idle'
  | 'starting'
  | 'backing_up'
  | 'redeploy_requested'
  | 'restarting'
  | 'verifying'
  | 'success'
  | 'failed'
  | 'timeout';

export const ACTIVE_PHASES: UpdatePhase[] = [
  'starting',
  'backing_up',
  'redeploy_requested',
  'restarting',
  'verifying',
];

export function isActivePhase(phase: UpdatePhase): boolean {
  return ACTIVE_PHASES.includes(phase);
}

// --- Versionsanzeige ----------------------------------------------------------

export type CheckView = {
  tone: 'neutral' | 'success' | 'info' | 'warning';
  headline: string;
  detail: string;
  /** Nur dann darf der Installieren-Button überhaupt sichtbar sein. */
  canInstall: boolean;
  /** Kurz-SHA der neuen Version (für Dialog/Anzeige). */
  newShortSha: string | null;
  newMessage: string | null;
};

export function describeCheck(
  check: SystemUpdateCheck | null,
  options: { checking?: boolean } = {},
): CheckView {
  if (options.checking && !check) {
    return {
      tone: 'neutral',
      headline: 'Version wird geprüft ...',
      detail: '',
      canInstall: false,
      newShortSha: null,
      newMessage: null,
    };
  }
  if (!check) {
    return {
      tone: 'neutral',
      headline: 'Versionsstand unbekannt',
      detail: 'Die Versionsprüfung wurde noch nicht ausgeführt.',
      canInstall: false,
      newShortSha: null,
      newMessage: null,
    };
  }

  const newShortSha = check.latest?.shortSha ?? null;
  const newMessage = check.latest?.message ?? null;

  switch (check.state) {
    case 'disabled':
      return {
        tone: 'neutral',
        headline: 'Systemupdates sind auf diesem Server nicht aktiviert.',
        detail: 'Die Funktion kann nur serverseitig freigeschaltet werden.',
        canInstall: false,
        newShortSha: null,
        newMessage: null,
      };
    case 'up_to_date':
      return {
        tone: 'success',
        headline: 'Das System ist auf dem neuesten Stand.',
        detail: newShortSha ? `Aktueller Stand auf GitHub: ${newShortSha}` : '',
        canInstall: false,
        newShortSha,
        newMessage,
      };
    case 'update_available':
      return {
        tone: 'info',
        headline: 'Neue Version verfügbar',
        detail: newMessage ?? '',
        // Ohne hinterlegten Webhook kann der Server den Redeploy nicht anstoßen.
        canInstall: check.webhookConfigured,
        newShortSha,
        newMessage,
      };
    case 'installed_version_unknown':
      return {
        tone: 'warning',
        headline: 'Installierte Version unbekannt',
        detail: check.message,
        // Ein Update bleibt möglich, wird aber nicht als "verfügbar" behauptet.
        canInstall: check.webhookConfigured,
        newShortSha,
        newMessage,
      };
    case 'check_failed':
    default:
      return {
        tone: 'warning',
        headline: 'Versionsprüfung fehlgeschlagen',
        detail: check.message,
        canInstall: false,
        newShortSha: null,
        newMessage: null,
      };
  }
}

// --- Fortschrittsanzeige ------------------------------------------------------

export type ProgressStepKey = 'checked' | 'backup' | 'handoff' | 'restart' | 'verify';
export type ProgressStepState = 'pending' | 'active' | 'done' | 'failed';

export type ProgressStep = {
  key: ProgressStepKey;
  label: string;
  state: ProgressStepState;
};

const STEP_LABELS: Record<ProgressStepKey, string> = {
  checked: 'Version geprüft',
  backup: 'Backup erstellt',
  handoff: 'Update an Portainer übergeben',
  restart: 'System wird neu gestartet',
  verify: 'Neue Version wird überprüft',
};

const STEP_ORDER: ProgressStepKey[] = ['checked', 'backup', 'handoff', 'restart', 'verify'];

// Wie weit ist eine Phase gekommen? Index in STEP_ORDER, der gerade läuft.
const PHASE_STEP_INDEX: Record<UpdatePhase, number> = {
  idle: 0,
  starting: 0,
  backing_up: 1,
  redeploy_requested: 2,
  restarting: 3,
  verifying: 4,
  success: STEP_ORDER.length,
  failed: -1,
  timeout: -1,
};

export function buildProgressSteps(
  phase: UpdatePhase,
  failedStep: ProgressStepKey | null = null,
): ProgressStep[] {
  if (phase === 'failed' || phase === 'timeout') {
    const failedIndex = failedStep ? STEP_ORDER.indexOf(failedStep) : STEP_ORDER.length - 1;
    return STEP_ORDER.map((key, index) => ({
      key,
      label: STEP_LABELS[key],
      state: index < failedIndex ? 'done' : index === failedIndex ? 'failed' : 'pending',
    }));
  }
  const activeIndex = PHASE_STEP_INDEX[phase];
  return STEP_ORDER.map((key, index) => ({
    key,
    label: STEP_LABELS[key],
    state: index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'pending',
  }));
}

/** Ordnet einen Fehlerlauf dem Schritt zu, an dem er gescheitert ist. */
export function failedStepFor(run: SystemUpdateRun | null | undefined): ProgressStepKey | null {
  switch (run?.errorDetails) {
    case 'github_check_failed':
    case 'no_update_available':
      return 'checked';
    case 'backup_failed':
      return 'backup';
    case 'webhook_failed':
      return 'handoff';
    case 'unexpected_commit':
    case 'installed_version_unknown':
    case 'timeout_unexpected_commit':
      return 'verify';
    default:
      return null;
  }
}

// --- Polling ------------------------------------------------------------------

export type PollState = {
  phase: UpdatePhase;
  /** Laufende Kette an Netzwerkfehlern — während des Redeploys ist das normal. */
  networkErrorCount: number;
  startedAtMs: number;
  runId: string | null;
  targetShortSha: string | null;
  message: string;
};

export type PollEvent =
  | { kind: 'status'; status: SystemUpdateStatus }
  | { kind: 'networkError' }
  | { kind: 'tick' };

export function initialPollState(
  startedAtMs: number,
  runId: string | null,
  targetShortSha: string | null,
): PollState {
  return {
    phase: 'redeploy_requested',
    networkErrorCount: 0,
    startedAtMs,
    runId,
    targetShortSha,
    message: 'Das Update wurde an Portainer übergeben.',
  };
}

function phaseFromRunStatus(status: UpdateRunStatus): UpdatePhase {
  switch (status) {
    case 'checking':
      return 'starting';
    case 'backing_up':
      return 'backing_up';
    case 'redeploy_requested':
      return 'redeploy_requested';
    case 'restarting':
      return 'restarting';
    case 'success':
      return 'success';
    case 'failed':
      return 'failed';
    case 'timeout':
      return 'timeout';
    case 'idle':
    default:
      return 'idle';
  }
}

/**
 * Ein Poll-Schritt.
 *
 * Kernregeln (aus dem Redeploy-Verhalten abgeleitet):
 * - Netzwerkfehler sind während des Redeploys ERWARTET (das Backend startet
 *   gerade neu) und führen nicht zum Fehler, sondern in die Phase `restarting`.
 * - Ein Fehler wird erst nach Ablauf des Timeouts gemeldet.
 * - Erfolg gilt nur, wenn der Server den verfolgten Lauf selbst als `success`
 *   meldet — nicht schon, wenn er wieder erreichbar ist.
 */
export function reducePoll(
  state: PollState,
  event: PollEvent,
  nowMs: number,
  timeoutMs: number,
): PollState {
  if (!isActivePhase(state.phase)) {
    return state;
  }
  const expired = nowMs - state.startedAtMs > timeoutMs;

  if (event.kind === 'networkError') {
    if (expired) {
      return {
        ...state,
        phase: 'timeout',
        message:
          'Das System ist nach dem Update nicht wieder erreichbar. Bitte den Stack in Portainer prüfen.',
      };
    }
    return {
      ...state,
      phase: 'restarting',
      networkErrorCount: state.networkErrorCount + 1,
      message: 'Das System wird neu gestartet und ist kurz nicht erreichbar ...',
    };
  }

  if (event.kind === 'tick') {
    if (expired) {
      return {
        ...state,
        phase: 'timeout',
        message:
          'Zeitüberschreitung: Das Update konnte nicht innerhalb der erwarteten Zeit bestätigt werden.',
      };
    }
    return state;
  }

  const { status } = event;
  const run = status.run ?? null;
  // Antwortet der Server wieder, ist der Neustart vorbei -> Fehlerkette endet.
  const base: PollState = { ...state, networkErrorCount: 0 };

  // Ein anderer (älterer) Lauf sagt nichts über den eigenen aus.
  if (state.runId && run && run.id !== state.runId) {
    return expired ? { ...base, phase: 'timeout', message: 'Zeitüberschreitung.' } : base;
  }

  if (!run) {
    return expired ? { ...base, phase: 'timeout', message: 'Zeitüberschreitung.' } : base;
  }

  const phase = phaseFromRunStatus(run.status);
  if (phase === 'success') {
    return {
      ...base,
      phase: 'success',
      message: run.message ?? 'Das Update wurde erfolgreich installiert.',
    };
  }
  if (phase === 'failed' || phase === 'timeout') {
    return { ...base, phase, message: run.message ?? 'Das Update ist fehlgeschlagen.' };
  }
  if (expired) {
    return {
      ...base,
      phase: 'timeout',
      message:
        'Zeitüberschreitung: Das Update konnte nicht innerhalb der erwarteten Zeit bestätigt werden.',
    };
  }
  // Der Server ist wieder da, meldet aber noch keinen Abschluss: Wir sind in
  // der Verifikationsphase, sobald der Redeploy angefordert wurde.
  return {
    ...base,
    phase: state.phase === 'restarting' ? 'verifying' : phase,
    message: run.message ?? base.message,
  };
}

// --- Historie -----------------------------------------------------------------

const STATUS_LABELS: Record<UpdateRunStatus, string> = {
  idle: 'Kein Vorgang',
  checking: 'Version wird geprüft',
  backing_up: 'Backup wird erstellt',
  redeploy_requested: 'An Portainer übergeben',
  restarting: 'Neustart läuft',
  success: 'Erfolgreich',
  failed: 'Fehlgeschlagen',
  timeout: 'Zeitüberschreitung',
};

export function statusLabel(status: UpdateRunStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function statusTone(status: UpdateRunStatus): 'success' | 'danger' | 'info' | 'neutral' {
  if (status === 'success') return 'success';
  if (status === 'failed' || status === 'timeout') return 'danger';
  if (status === 'idle') return 'neutral';
  return 'info';
}

/** Deterministische Datumsausgabe (feste Zeitzone → keine Umgebungsabhängigkeit). */
export function formatDateTime(
  value: string | null | undefined,
  timeZone = 'Europe/Berlin',
): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const formatted = new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(date);
  return `${formatted} Uhr`;
}

export type HistoryEntryView = {
  id: string;
  when: string;
  versions: string;
  status: string;
  tone: 'success' | 'danger' | 'info' | 'neutral';
  actor: string | null;
  /** Verständliche Meldung; technische Details bleiben bewusst außen vor. */
  message: string | null;
  backupReference: string | null;
};

export function describeHistoryEntry(
  run: SystemUpdateRun,
  timeZone = 'Europe/Berlin',
): HistoryEntryView {
  const from = run.sourceShortCommit ?? 'unbekannt';
  const to = run.targetShortCommit ?? 'unbekannt';
  return {
    id: run.id,
    when: formatDateTime(run.startedAt, timeZone),
    versions: `${from} → ${to}`,
    status: statusLabel(run.status),
    tone: statusTone(run.status),
    actor: run.startedByName ?? null,
    message: run.message ?? null,
    backupReference: run.backupReference ?? null,
  };
}

// --- Bestätigungsdialog --------------------------------------------------------

export type ConfirmDialogView = {
  title: string;
  body: string[];
  currentLabel: string;
  newLabel: string;
  cancelLabel: string;
  confirmLabel: string;
};

export function buildConfirmDialog(check: SystemUpdateCheck | null): ConfirmDialogView {
  return {
    title: 'Systemupdate installieren?',
    body: [
      'Vor dem Update wird automatisch ein Backup erstellt.',
      'Während des Updates ist das Warehouse-System kurz nicht erreichbar.',
    ],
    currentLabel: check?.installedShortCommit ?? 'unbekannt',
    newLabel: check?.latest?.shortSha ?? 'unbekannt',
    cancelLabel: 'Abbrechen',
    confirmLabel: 'Backup erstellen und Update installieren',
  };
}
