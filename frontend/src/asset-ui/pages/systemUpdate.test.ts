import { describe, expect, it } from 'vitest';

import type {
  SystemUpdateCheck,
  SystemUpdateRun,
  SystemUpdateStatus,
} from '../../services/wmsApi';
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
  statusLabel,
} from './systemUpdate';

const INSTALLED = '2601690aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const LATEST = 'abcdef1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function check(overrides: Partial<SystemUpdateCheck> = {}): SystemUpdateCheck {
  return {
    state: 'update_available',
    updateAvailable: true,
    installedCommit: INSTALLED,
    installedShortCommit: '2601690',
    latest: {
      sha: LATEST,
      shortSha: 'abcdef1',
      message: 'Dashboard-Kalender korrigieren',
      author: 'Nils Klemm',
      date: '2026-07-27T08:42:00Z',
    },
    compareUrl: 'https://github.com/nils5002/warenwirtschaftssystem-server/compare/a...b',
    checkedAt: '2026-07-27T08:45:00Z',
    message: 'Eine neue Version ist verfügbar.',
    updateEnabled: true,
    webhookConfigured: true,
    ...overrides,
  };
}

function run(overrides: Partial<SystemUpdateRun> = {}): SystemUpdateRun {
  return {
    id: 'upd-1',
    status: 'redeploy_requested',
    startedAt: '2026-07-27T08:42:00Z',
    startedByName: 'Nils Klemm',
    sourceCommit: INSTALLED,
    sourceShortCommit: '2601690',
    targetCommit: LATEST,
    targetShortCommit: 'abcdef1',
    backupReference: 'wms-update-backup-2026-07-27_08-42-00.zip',
    ...overrides,
  };
}

function status(overrides: Partial<SystemUpdateStatus> = {}): SystemUpdateStatus {
  return {
    status: 'redeploy_requested',
    inProgress: true,
    run: run(),
    installedCommit: INSTALLED,
    installedShortCommit: '2601690',
    updateEnabled: true,
    webhookConfigured: true,
    timeoutSeconds: 600,
    ...overrides,
  };
}

describe('describeCheck', () => {
  it('meldet ein System auf dem neuesten Stand', () => {
    const view = describeCheck(check({ state: 'up_to_date', updateAvailable: false }));
    expect(view.headline).toBe('Das System ist auf dem neuesten Stand.');
    expect(view.tone).toBe('success');
    expect(view.canInstall).toBe(false);
  });

  it('zeigt eine verfügbare neue Version inkl. Commit-Nachricht', () => {
    const view = describeCheck(check());
    expect(view.headline).toBe('Neue Version verfügbar');
    expect(view.newShortSha).toBe('abcdef1');
    expect(view.detail).toBe('Dashboard-Kalender korrigieren');
    expect(view.canInstall).toBe(true);
  });

  it('meldet die deaktivierte Funktion und bietet kein Update an', () => {
    const view = describeCheck(
      check({ state: 'disabled', updateAvailable: false, updateEnabled: false }),
    );
    expect(view.headline).toBe('Systemupdates sind auf diesem Server nicht aktiviert.');
    expect(view.canInstall).toBe(false);
  });

  it('bietet ohne konfigurierten Webhook kein Update an', () => {
    const view = describeCheck(check({ webhookConfigured: false }));
    expect(view.canInstall).toBe(false);
  });

  it('behandelt eine fehlgeschlagene Prüfung als Warnung ohne Installation', () => {
    const view = describeCheck(
      check({
        state: 'check_failed',
        updateAvailable: false,
        latest: null,
        message: 'GitHub ist derzeit nicht erreichbar.',
      }),
    );
    expect(view.tone).toBe('warning');
    expect(view.detail).toBe('GitHub ist derzeit nicht erreichbar.');
    expect(view.canInstall).toBe(false);
  });

  it('weist eine unbekannte installierte Version aus', () => {
    const view = describeCheck(check({ state: 'installed_version_unknown', updateAvailable: false }));
    expect(view.headline).toBe('Installierte Version unbekannt');
  });
});

describe('buildProgressSteps', () => {
  it('markiert erledigte, laufende und offene Schritte', () => {
    const steps = buildProgressSteps('restarting');
    expect(steps.map((step) => step.state)).toEqual([
      'done',
      'done',
      'done',
      'active',
      'pending',
    ]);
    expect(steps[3].label).toBe('System wird neu gestartet');
  });

  it('markiert nach Erfolg alle Schritte als erledigt', () => {
    expect(buildProgressSteps('success').every((step) => step.state === 'done')).toBe(true);
  });

  it('markiert den fehlgeschlagenen Schritt', () => {
    const steps = buildProgressSteps('failed', 'backup');
    expect(steps[0].state).toBe('done');
    expect(steps[1].state).toBe('failed');
    expect(steps[2].state).toBe('pending');
  });

  it('leitet den fehlgeschlagenen Schritt aus dem Lauf ab', () => {
    expect(failedStepFor(run({ errorDetails: 'backup_failed' }))).toBe('backup');
    expect(failedStepFor(run({ errorDetails: 'webhook_failed' }))).toBe('handoff');
    expect(failedStepFor(run({ errorDetails: 'unexpected_commit' }))).toBe('verify');
    expect(failedStepFor(run())).toBeNull();
  });
});

describe('reducePoll', () => {
  const TIMEOUT = 600_000;
  const start = initialPollState(0, 'upd-1', 'abcdef1');

  it('behandelt Netzwerkfehler als erwarteten Neustart', () => {
    const next = reducePoll(start, { kind: 'networkError' }, 5_000, TIMEOUT);
    expect(next.phase).toBe('restarting');
    expect(next.networkErrorCount).toBe(1);
    expect(isActivePhase(next.phase)).toBe(true);
  });

  it('wechselt nach Wiedererreichbarkeit in die Verifikationsphase', () => {
    const restarting = reducePoll(start, { kind: 'networkError' }, 5_000, TIMEOUT);
    const back = reducePoll(restarting, { kind: 'status', status: status() }, 30_000, TIMEOUT);
    expect(back.phase).toBe('verifying');
    expect(back.networkErrorCount).toBe(0);
  });

  it('meldet Erfolg erst, wenn der Server den Lauf als erfolgreich bestätigt', () => {
    const restarting = reducePoll(start, { kind: 'networkError' }, 5_000, TIMEOUT);
    const done = reducePoll(
      restarting,
      {
        kind: 'status',
        status: status({
          status: 'success',
          inProgress: false,
          run: run({ status: 'success', message: 'Das Update wurde erfolgreich installiert.' }),
        }),
      },
      40_000,
      TIMEOUT,
    );
    expect(done.phase).toBe('success');
    expect(done.message).toBe('Das Update wurde erfolgreich installiert.');
    expect(isActivePhase(done.phase)).toBe(false);
  });

  it('übernimmt einen Serverfehler als Fehlerzustand', () => {
    const failed = reducePoll(
      start,
      {
        kind: 'status',
        status: status({
          status: 'failed',
          inProgress: false,
          run: run({
            status: 'failed',
            message: 'Nach dem Neustart läuft eine unerwartete Version.',
            errorDetails: 'unexpected_commit',
          }),
        }),
      },
      20_000,
      TIMEOUT,
    );
    expect(failed.phase).toBe('failed');
    expect(failed.message).toContain('unerwartete Version');
  });

  it('meldet einen Fehler erst nach Ablauf des Timeouts', () => {
    let state = start;
    for (let elapsed = 5_000; elapsed <= TIMEOUT; elapsed += 5_000) {
      state = reducePoll(state, { kind: 'networkError' }, elapsed, TIMEOUT);
      expect(state.phase).toBe('restarting');
    }
    state = reducePoll(state, { kind: 'networkError' }, TIMEOUT + 1_000, TIMEOUT);
    expect(state.phase).toBe('timeout');
  });

  it('ignoriert Statusmeldungen eines fremden Laufs', () => {
    const other = reducePoll(
      start,
      { kind: 'status', status: status({ run: run({ id: 'upd-anders', status: 'success' }) }) },
      10_000,
      TIMEOUT,
    );
    expect(other.phase).toBe('redeploy_requested');
  });

  it('friert einen abgeschlossenen Zustand ein', () => {
    const done = { ...start, phase: 'success' as const };
    expect(reducePoll(done, { kind: 'networkError' }, 999_999, TIMEOUT)).toBe(done);
  });
});

describe('Bestätigungsdialog', () => {
  it('nennt Backup-Hinweis sowie alte und neue Version', () => {
    const dialog = buildConfirmDialog(check());
    expect(dialog.title).toBe('Systemupdate installieren?');
    expect(dialog.body[0]).toBe('Vor dem Update wird automatisch ein Backup erstellt.');
    expect(dialog.body[1]).toContain('kurz nicht erreichbar');
    expect(dialog.currentLabel).toBe('2601690');
    expect(dialog.newLabel).toBe('abcdef1');
    expect(dialog.confirmLabel).toBe('Backup erstellen und Update installieren');
    expect(dialog.cancelLabel).toBe('Abbrechen');
  });
});

describe('Historie', () => {
  it('formatiert einen erfolgreichen Vorgang kompakt', () => {
    const entry = describeHistoryEntry(
      run({ status: 'success', startedAt: '2026-07-27T08:42:00Z' }),
      'Europe/Berlin',
    );
    expect(entry.when).toBe('27.07.2026, 10:42 Uhr');
    expect(entry.versions).toBe('2601690 → abcdef1');
    expect(entry.status).toBe('Erfolgreich');
    expect(entry.tone).toBe('success');
    expect(entry.actor).toBe('Nils Klemm');
  });

  it('zeigt keine technischen Details in der normalen Ansicht', () => {
    const entry = describeHistoryEntry(
      run({
        status: 'failed',
        message: 'Das Backup konnte nicht erstellt werden.',
        errorDetails: 'backup_failed',
      }),
    );
    expect(entry.tone).toBe('danger');
    expect(entry.message).toBe('Das Backup konnte nicht erstellt werden.');
    expect(JSON.stringify(entry)).not.toContain('backup_failed');
  });

  it('kommt mit unbekannten Versionen zurecht', () => {
    const entry = describeHistoryEntry(
      run({ sourceShortCommit: null, targetShortCommit: null, startedAt: null }),
    );
    expect(entry.versions).toBe('unbekannt → unbekannt');
    expect(entry.when).toBe('—');
  });

  it('benennt die Statuswerte deutsch', () => {
    expect(statusLabel('timeout')).toBe('Zeitüberschreitung');
    expect(statusLabel('backing_up')).toBe('Backup wird erstellt');
  });

  it('formatiert ungültige Datumswerte robust', () => {
    expect(formatDateTime('kein-datum')).toBe('—');
    expect(formatDateTime(undefined)).toBe('—');
  });
});
