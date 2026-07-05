import {
  AlertTriangle,
  Archive,
  Ban,
  Camera,
  CheckCircle2,
  CircleAlert,
  CircleSlash,
  Copy,
  Download,
  Link2,
  ListChecks,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  ScanLine,
  Search,
  Undo2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { QrScannerDialog } from '../components/QrScannerDialog';
import { useAppDialog } from '../../components/dialogs/AppDialogProvider';
import { PageHeader } from '../../ui';
import {
  archiveLabelAuditSession,
  createLabelAuditSession,
  getActiveLabelAuditSession,
  getLabelAuditSession,
  listLabelAuditSessions,
  scanLabelAuditSession,
  updateLabelAuditScan,
  updateLabelAuditSession,
} from '../../services/wmsApi';
import type {
  Asset,
  LabelAuditScan,
  LabelAuditScanKind,
  LabelAuditSession,
  LabelAuditSessionListItem,
} from '../types';

type LabelAuditPageProps = {
  assets: Asset[];
};

// Die Prüfrunde lebt jetzt serverseitig in den Tabellen label_audit_sessions /
// label_audit_scans. localStorage hält NUR noch die zuletzt gewählte Session-ID
// als Komfort-Fallback — die Wahrheit ist die Datenbank.
const LAST_SESSION_STORAGE_KEY = 'wms.labelAudit.lastSessionId';

function readLastSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(LAST_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeLastSessionId(sessionId: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (sessionId) window.localStorage.setItem(LAST_SESSION_STORAGE_KEY, sessionId);
    else window.localStorage.removeItem(LAST_SESSION_STORAGE_KEY);
  } catch {
    // Ignorieren: ohne localStorage funktioniert die Prüfung trotzdem.
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '';
  }
}

function defaultSessionName(): string {
  const now = new Date();
  const month = now.toLocaleString('de-DE', { month: 'long' });
  return `Label-Prüfung ${month} ${now.getFullYear()}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Unbekannter Fehler.';
}

// CSV-sicher quoten (Excel/DE): doppelte Anführungszeichen escapen, Wert umschließen.
function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function LabelAuditPage({ assets }: LabelAuditPageProps) {
  const { confirm, prompt, alert } = useAppDialog();
  const [session, setSession] = useState<LabelAuditSession | null>(null);
  const [sessions, setSessions] = useState<LabelAuditSessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanInput, setScanInput] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  // Ergebnis des letzten Scans für das große farbige Banner.
  const [lastResult, setLastResult] = useState<LabelAuditScan | null>(null);
  // Inline-Bearbeitung der Prüfrunde (Name/Notiz).
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editNote, setEditNote] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const refocus = useCallback(() => {
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const refreshSessions = useCallback(async () => {
    try {
      setSessions(await listLabelAuditSessions());
    } catch {
      // Liste ist nur Komfort (Runden-Auswahl) — Fehler hier nicht eskalieren.
    }
  }, []);

  // Initial laden: zuletzt gewählte Runde (falls vorhanden), sonst die aktive
  // Runde (legt serverseitig bei Bedarf eine Standardrunde an).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const lastId = readLastSessionId();
        let loaded: LabelAuditSession | null = null;
        if (lastId) {
          try {
            loaded = await getLabelAuditSession(lastId);
          } catch {
            loaded = null; // z. B. gelöschte/unbekannte ID → auf aktive zurückfallen
          }
        }
        if (!loaded) loaded = await getActiveLabelAuditSession();
        if (cancelled) return;
        setSession(loaded);
        writeLastSessionId(loaded.id);
      } catch (error) {
        if (!cancelled) setLoadError(errorMessage(error));
      } finally {
        if (!cancelled) {
          setLoading(false);
          refocus();
        }
      }
    })();
    void refreshSessions();
    return () => {
      cancelled = true;
    };
  }, [refreshSessions, refocus]);

  const checkedSet = useMemo(
    () => new Set(session?.checkedAssetIds ?? []),
    [session?.checkedAssetIds],
  );

  const openAssets = useMemo(
    () => assets.filter((asset) => !checkedSet.has(asset.id)),
    [assets, checkedSet],
  );

  const isActive = session?.status === 'active';

  const registerScan = useCallback(
    async (rawValue: string) => {
      const value = rawValue.trim();
      if (!value || !session) return;
      if (!isActive) {
        void alert({
          title: 'Prüfrunde archiviert',
          message: 'Diese Prüfrunde ist abgeschlossen. Bitte eine neue Prüfrunde starten.',
        });
        return;
      }
      setBusy(true);
      try {
        const result = await scanLabelAuditSession(session.id, value);
        setSession(result.session);
        setLastResult(result.scan);
        setScanInput('');
      } catch (error) {
        void alert({ title: 'Scan fehlgeschlagen', message: errorMessage(error) });
      } finally {
        setBusy(false);
        refocus();
      }
    },
    [session, isActive, alert, refocus],
  );

  const handleSubmit = (eventArg: FormEvent) => {
    eventArg.preventDefault();
    void registerScan(scanInput);
  };

  const reloadCurrent = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    try {
      const fresh = await getLabelAuditSession(session.id);
      setSession(fresh);
    } catch (error) {
      void alert({ title: 'Aktualisieren fehlgeschlagen', message: errorMessage(error) });
    } finally {
      setBusy(false);
      refocus();
    }
  }, [session, alert, refocus]);

  const selectSession = useCallback(
    async (sessionId: string) => {
      if (!sessionId || sessionId === session?.id) return;
      setBusy(true);
      try {
        const loaded = await getLabelAuditSession(sessionId);
        setSession(loaded);
        setLastResult(null);
        writeLastSessionId(loaded.id);
      } catch (error) {
        void alert({ title: 'Prüfrunde laden fehlgeschlagen', message: errorMessage(error) });
      } finally {
        setBusy(false);
        refocus();
      }
    },
    [session?.id, alert, refocus],
  );

  const startNewSession = useCallback(async () => {
    const name = await prompt({
      title: 'Neue Prüfrunde starten',
      message: 'Eine laufende Prüfrunde wird dabei archiviert.',
      defaultValue: defaultSessionName(),
      placeholder: 'z. B. Label-Prüfung Mai 2026',
      submitLabel: 'Starten',
      required: true,
    });
    if (!name) return;
    setBusy(true);
    try {
      const created = await createLabelAuditSession({ name: name.trim() });
      setSession(created);
      setLastResult(null);
      writeLastSessionId(created.id);
      await refreshSessions();
    } catch (error) {
      void alert({ title: 'Anlegen fehlgeschlagen', message: errorMessage(error) });
    } finally {
      setBusy(false);
      refocus();
    }
  }, [prompt, refreshSessions, alert, refocus]);

  const archiveCurrent = useCallback(async () => {
    if (!session) return;
    const confirmed = await confirm({
      title: 'Prüfrunde abschließen?',
      message:
        'Die Prüfrunde wird archiviert. Alle erfassten Scans bleiben erhalten und einsehbar; es können danach keine weiteren Scans hinzugefügt werden. Hardwaredaten bleiben unverändert.',
      confirmLabel: 'Abschließen',
      cancelLabel: 'Abbrechen',
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      const archived = await archiveLabelAuditSession(session.id);
      setSession(archived);
      await refreshSessions();
    } catch (error) {
      void alert({ title: 'Archivieren fehlgeschlagen', message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }, [session, confirm, refreshSessions, alert]);

  const beginEdit = useCallback(() => {
    if (!session) return;
    setEditName(session.name);
    setEditNote(session.note ?? '');
    setEditing(true);
  }, [session]);

  const saveEdit = useCallback(async () => {
    if (!session) return;
    const name = editName.trim();
    if (!name) {
      void alert({ title: 'Name fehlt', message: 'Der Name der Prüfrunde darf nicht leer sein.' });
      return;
    }
    setBusy(true);
    try {
      const updated = await updateLabelAuditSession(session.id, {
        name,
        note: editNote.trim() || null,
      });
      setSession(updated);
      setEditing(false);
      await refreshSessions();
    } catch (error) {
      void alert({ title: 'Speichern fehlgeschlagen', message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }, [session, editName, editNote, refreshSessions, alert]);

  const reactivateCurrent = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    try {
      const updated = await updateLabelAuditSession(session.id, { status: 'active' });
      setSession(updated);
      await refreshSessions();
    } catch (error) {
      // 409: es gibt bereits eine andere aktive Prüfrunde — Server-Message zeigen.
      void alert({ title: 'Reaktivieren nicht möglich', message: errorMessage(error) });
    } finally {
      setBusy(false);
      refocus();
    }
  }, [session, refreshSessions, alert, refocus]);

  // Zentrale Scan-Korrektur: ruft den PATCH-Endpunkt und übernimmt die Antwort.
  const applyScanUpdate = useCallback(
    async (
      scanId: string,
      payload: {
        note?: string | null;
        ignored?: boolean;
        ignoreReason?: string | null;
        assetId?: string;
      },
    ) => {
      if (!session) return;
      setBusy(true);
      try {
        const result = await updateLabelAuditScan(session.id, scanId, payload);
        setSession(result.session);
        setLastResult((prev) => (prev && prev.id === scanId ? result.scan : prev));
        await refreshSessions();
      } catch (error) {
        void alert({ title: 'Aktion fehlgeschlagen', message: errorMessage(error) });
      } finally {
        setBusy(false);
      }
    },
    [session, refreshSessions, alert],
  );

  const ignoreScan = useCallback(
    async (scan: LabelAuditScan) => {
      const reason = await prompt({
        title: 'Scan ignorieren',
        message:
          'Der Scan wird aus der Auswertung genommen (nicht gelöscht) und kann jederzeit wieder aufgenommen werden. Optionaler Grund:',
        placeholder: 'z. B. Fehlscan, Testscan',
        submitLabel: 'Ignorieren',
        cancelLabel: 'Abbrechen',
      });
      if (reason === null) return; // abgebrochen
      await applyScanUpdate(scan.id, { ignored: true, ignoreReason: reason.trim() || null });
    },
    [prompt, applyScanUpdate],
  );

  const unignoreScan = useCallback(
    (scan: LabelAuditScan) => applyScanUpdate(scan.id, { ignored: false }),
    [applyScanUpdate],
  );

  const editScanNote = useCallback(
    async (scan: LabelAuditScan) => {
      const note = await prompt({
        title: 'Notiz zum Scan',
        defaultValue: scan.note ?? '',
        placeholder: 'Freie Notiz (nur Audit, ändert keine Hardwaredaten)',
        submitLabel: 'Speichern',
        cancelLabel: 'Abbrechen',
        multiline: true,
      });
      if (note === null) return;
      await applyScanUpdate(scan.id, { note: note.trim() || null });
    },
    [prompt, applyScanUpdate],
  );

  const assignScanAsset = useCallback(
    (scanId: string, assetId: string) => applyScanUpdate(scanId, { assetId }),
    [applyScanUpdate],
  );

  const exportCsv = useCallback(() => {
    if (!session) return;
    // Zeitstempel der ersten Erfassung je stabilem Key aus dem (gekappten)
    // Protokoll — best effort. Quelle der Wahrheit für "geprüft" ist der
    // serverseitige checkedAssetIds-Satz.
    const checkedAtByKey = new Map<string, string>();
    for (const scan of session.recentScans) {
      if (scan.scanKind === 'matched' && scan.assetStableKey && !checkedAtByKey.has(scan.assetStableKey)) {
        checkedAtByKey.set(scan.assetStableKey, scan.scannedAt);
      }
    }
    const stableKey = (asset: Asset): string =>
      (asset.serialNumber?.trim() || asset.tagNumber?.trim() || asset.id).toLowerCase();

    const header = ['Asset-ID', 'Name', 'Kategorie', 'Seriennummer', 'Inventarnummer', 'Geprüft', 'Geprüft am'];
    const rows = assets.map((asset) => [
      asset.id,
      asset.name,
      asset.category,
      asset.serialNumber,
      asset.tagNumber,
      checkedSet.has(asset.id) ? 'ja' : 'nein',
      checkedAtByKey.get(stableKey(asset)) ?? '',
    ]);

    const csv = [header, ...rows].map((line) => line.map(csvCell).join(';')).join('\r\n');
    // BOM voranstellen, damit Excel die Umlaute korrekt erkennt.
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const safeName = session.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    link.download = `${safeName || 'label-pruefung'}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [session, assets, checkedSet]);

  const summary = session?.summary ?? {
    total: assets.length,
    checked: 0,
    open: assets.length,
    duplicates: 0,
    unknown: 0,
    ignored: 0,
  };

  return (
    <section className="space-y-4 sm:space-y-5">
      <PageHeader
        kicker="Admin"
        title="Label-Prüfung"
        subtitle="QR-Labels nach dem Bekleben einscannen und prüfen — reines Lesetool, ändert keine Hardwaredaten. Die Prüfrunde wird serverseitig gespeichert und bleibt nach Reload, Gerätewechsel und Redeploy erhalten."
      />

      {loadError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          Prüfrunde konnte nicht geladen werden: {loadError}
        </div>
      ) : null}

      {/* Prüfrunden-Leiste: aktuelle Runde, Auswahl, neue Runde, abschließen */}
      <article className="surface-card animate-fade-up space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <label className="field min-w-0 flex-1">
            Aktuelle Prüfrunde
            <select
              className="field-input h-11"
              value={session?.id ?? ''}
              disabled={busy || loading || !sessions.length}
              onChange={(event) => void selectSession(event.target.value)}
            >
              {session && !sessions.some((item) => item.id === session.id) ? (
                <option value={session.id}>{session.name}</option>
              ) : null}
              {sessions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.summary.checked}/{item.summary.total}
                  {item.status === 'archived' ? ' (archiviert)' : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-none">
            <button
              type="button"
              className="btn-secondary min-h-11 justify-center text-xs"
              onClick={() => void startNewSession()}
              disabled={busy}
            >
              <Plus className="h-3.5 w-3.5" />
              Neue Prüfrunde
            </button>
            <button
              type="button"
              className="btn-secondary min-h-11 justify-center text-xs"
              onClick={beginEdit}
              disabled={busy || !session || editing}
            >
              <Pencil className="h-3.5 w-3.5" />
              Bearbeiten
            </button>
            {isActive ? (
              <button
                type="button"
                className="btn-secondary min-h-11 justify-center text-xs"
                onClick={() => void archiveCurrent()}
                disabled={busy || !session}
              >
                <Archive className="h-3.5 w-3.5" />
                Abschließen
              </button>
            ) : (
              <button
                type="button"
                className="btn-secondary min-h-11 justify-center text-xs"
                onClick={() => void reactivateCurrent()}
                disabled={busy || !session}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reaktivieren
              </button>
            )}
          </div>
        </div>

        {editing && session ? (
          <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <label className="field">
              Name der Prüfrunde
              <input
                className="field-input h-11"
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                placeholder="z. B. Label-Prüfung Mai 2026"
                disabled={busy}
              />
            </label>
            <label className="field">
              Notiz (optional)
              <textarea
                className="field-input min-h-[72px]"
                value={editNote}
                onChange={(event) => setEditNote(event.target.value)}
                placeholder="Interne Notiz zur Prüfrunde"
                disabled={busy}
              />
            </label>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                className="btn-secondary min-h-11 justify-center text-xs"
                onClick={() => setEditing(false)}
                disabled={busy}
              >
                <X className="h-3.5 w-3.5" />
                Abbrechen
              </button>
              <button
                type="button"
                className="btn-primary min-h-11 justify-center text-xs"
                onClick={() => void saveEdit()}
                disabled={busy}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Speichern
              </button>
            </div>
          </div>
        ) : session ? (
          <div className="space-y-1">
            <p className="text-xs text-slate-500">
              <span className="font-semibold text-slate-700">{session.name}</span>
              {' · '}
              {session.status === 'active' ? (
                <span className="text-emerald-600">aktiv</span>
              ) : (
                <span className="text-slate-500">archiviert (nur Ansicht)</span>
              )}
            </p>
            {session.note ? <p className="text-xs text-slate-500">{session.note}</p> : null}
          </div>
        ) : null}
      </article>

      {/* Zusammenfassung */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-6">
        <SummaryCard label="Assets gesamt" value={summary.total} icon={<ListChecks className="h-4 w-4" />} />
        <SummaryCard
          label="Geprüft"
          value={summary.checked}
          icon={<CheckCircle2 className="h-4 w-4" />}
          tone="emerald"
        />
        <SummaryCard label="Offen" value={summary.open} icon={<CircleSlash className="h-4 w-4" />} tone="slate" />
        <SummaryCard
          label="Doppelte Scans"
          value={summary.duplicates}
          icon={<Copy className="h-4 w-4" />}
          tone="amber"
        />
        <SummaryCard
          label="Unbekannte Scans"
          value={summary.unknown}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone="rose"
        />
        <SummaryCard
          label="Ignoriert"
          value={summary.ignored ?? 0}
          icon={<Ban className="h-4 w-4" />}
          tone="slate"
        />
      </div>

      {/* Scan-Eingabe */}
      <article className="surface-card animate-fade-up space-y-3">
        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="field">
            QR-Code scannen oder Inventarnummer eingeben
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                ref={inputRef}
                className="field-input h-12 flex-1 text-lg"
                value={scanInput}
                onChange={(event) => setScanInput(event.target.value)}
                placeholder="QR-Code scannen … (z. B. WMS|asset-…|IMP-… oder Seriennummer)"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="done"
                disabled={busy || !session || !isActive}
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="btn-primary h-12 flex-1 sm:flex-none"
                  disabled={busy || !session || !isActive}
                >
                  <ScanLine className="h-4 w-4" />
                  Prüfen
                </button>
                <button
                  type="button"
                  className="btn-secondary h-12 flex-1 sm:flex-none"
                  onClick={() => setScannerOpen(true)}
                  disabled={busy || !session || !isActive}
                >
                  <Camera className="h-4 w-4" />
                  Kamera
                </button>
              </div>
            </div>
          </label>
        </form>

        {!isActive && session ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            Diese Prüfrunde ist archiviert. Zum Weiterprüfen bitte „Neue Prüfrunde" starten.
          </p>
        ) : null}

        {/* Letztes Ergebnis als großes farbiges Banner */}
        {lastResult ? <ScanResultBanner scan={lastResult} /> : null}

        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <button
            type="button"
            className="btn-secondary min-h-11 justify-center text-xs"
            onClick={() => void reloadCurrent()}
            disabled={busy || !session}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Aktualisieren
          </button>
          <button
            type="button"
            className="btn-secondary min-h-11 justify-center text-xs"
            onClick={exportCsv}
            disabled={!session || !assets.length}
          >
            <Download className="h-3.5 w-3.5" />
            Als CSV exportieren
          </button>
        </div>
      </article>

      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
        {/* Zuletzt gescannt */}
        <article className="surface-card animate-fade-up min-w-0">
          <h3 className="text-base font-semibold text-slate-900">Zuletzt gescannt</h3>
          <p className="mt-1 text-xs text-slate-500">Neueste Scans dieser Prüfrunde.</p>
          <div className="soft-scrollbar mt-3 max-h-[42vh] space-y-2 overflow-y-auto pr-1 sm:max-h-[50vh]">
            {session && session.recentScans.length ? (
              session.recentScans.map((scan) => (
                <RecentRow
                  key={scan.id}
                  scan={scan}
                  assets={assets}
                  busy={busy}
                  onIgnore={ignoreScan}
                  onUnignore={unignoreScan}
                  onNote={editScanNote}
                  onAssign={assignScanAsset}
                />
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-8 text-center text-sm text-slate-500">
                {loading ? 'Wird geladen …' : 'Noch keine Scans erfasst.'}
              </div>
            )}
          </div>
        </article>

        {/* Noch nicht geprüft */}
        <article className="surface-card animate-fade-up min-w-0">
          <h3 className="text-base font-semibold text-slate-900">Noch nicht geprüft ({openAssets.length})</h3>
          <p className="mt-1 text-xs text-slate-500">Assets, deren Label in dieser Runde noch nicht gescannt wurde.</p>
          <div className="soft-scrollbar mt-3 max-h-[42vh] space-y-2 overflow-y-auto pr-1 sm:max-h-[50vh]">
            {openAssets.length ? (
              openAssets.map((asset) => (
                <div key={asset.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                  <p className="truncate text-sm font-semibold text-slate-900">{asset.name}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {asset.category} · SN: {asset.serialNumber || '—'} · Inv: {asset.tagNumber || '—'}
                  </p>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-emerald-300 bg-emerald-50 px-3 py-8 text-center text-sm text-emerald-700">
                {assets.length ? 'Alle Assets wurden geprüft. 🎉' : 'Keine Assets vorhanden.'}
              </div>
            )}
          </div>
        </article>
      </div>

      {scannerOpen ? (
        <QrScannerDialog
          title="QR-Label scannen"
          onDetected={(value) => {
            setScannerOpen(false);
            void registerScan(value);
          }}
          onClose={() => {
            setScannerOpen(false);
            refocus();
          }}
        />
      ) : null}
    </section>
  );
}

type SummaryTone = 'brand' | 'emerald' | 'amber' | 'rose' | 'slate';

const SUMMARY_TONES: Record<SummaryTone, string> = {
  brand: 'border-brand-200 bg-brand-50 text-brand-700',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  amber: 'border-amber-200 bg-amber-50 text-amber-700',
  rose: 'border-rose-200 bg-rose-50 text-rose-700',
  slate: 'border-slate-200 bg-slate-50 text-slate-700',
};

function SummaryCard({
  label,
  value,
  icon,
  tone = 'brand',
}: {
  label: string;
  value: number;
  icon: ReactNode;
  tone?: SummaryTone;
}) {
  return (
    <div className={`rounded-xl border px-2.5 py-2 sm:px-3 sm:py-3 ${SUMMARY_TONES[tone]}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-medium opacity-80 sm:text-xs">
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <p className="mt-0.5 text-xl font-bold tabular-nums sm:mt-1 sm:text-2xl">{value}</p>
    </div>
  );
}

function ScanResultBanner({ scan }: { scan: LabelAuditScan }) {
  if (scan.scanKind === 'unknown') {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-rose-800">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="min-w-0">
          <p className="font-semibold">Unbekannter QR-Code</p>
          <p className="mt-0.5 break-all text-sm text-rose-700">
            Kein Asset gefunden für: <span className="font-mono">{scan.scanValue}</span>
          </p>
        </div>
      </div>
    );
  }

  const isDuplicate = scan.scanKind === 'duplicate';
  const tone = isDuplicate
    ? 'border-amber-200 bg-amber-50 text-amber-800'
    : 'border-emerald-200 bg-emerald-50 text-emerald-800';

  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${tone}`}>
      {isDuplicate ? (
        <Copy className="mt-0.5 h-5 w-5 shrink-0" />
      ) : (
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
      )}
      <div className="min-w-0">
        <p className="font-semibold">{isDuplicate ? 'Bereits geprüft (doppelter Scan)' : 'Geprüft ✓'}</p>
        <p className="mt-0.5 truncate text-base font-semibold">{scan.assetLabel || scan.assetId}</p>
        <p className="mt-0.5 text-sm opacity-90">
          {scan.category || '—'} · SN: {scan.serialNumber || '—'} · Inv: {scan.tagNumber || '—'}
        </p>
      </div>
    </div>
  );
}

type RecentRowProps = {
  scan: LabelAuditScan;
  assets: Asset[];
  busy: boolean;
  onIgnore: (scan: LabelAuditScan) => void;
  onUnignore: (scan: LabelAuditScan) => void;
  onNote: (scan: LabelAuditScan) => void;
  onAssign: (scanId: string, assetId: string) => void;
};

const SCAN_KIND_CONFIG: Record<LabelAuditScanKind, { wrap: string; icon: ReactNode; label: string }> = {
  matched: {
    wrap: 'border-emerald-200 bg-emerald-50',
    icon: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
    label: 'Geprüft',
  },
  corrected: {
    wrap: 'border-emerald-200 bg-emerald-50',
    icon: <Link2 className="h-4 w-4 text-emerald-600" />,
    label: 'Korrigiert',
  },
  duplicate: {
    wrap: 'border-amber-200 bg-amber-50',
    icon: <Copy className="h-4 w-4 text-amber-600" />,
    label: 'Doppelt',
  },
  unknown: {
    wrap: 'border-rose-200 bg-rose-50',
    icon: <CircleAlert className="h-4 w-4 text-rose-600" />,
    label: 'Unbekannt',
  },
};

function RecentRow({ scan, assets, busy, onIgnore, onUnignore, onNote, onAssign }: RecentRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [picking, setPicking] = useState(false);

  const item = SCAN_KIND_CONFIG[scan.scanKind];
  const hasAsset = scan.scanKind !== 'unknown' && Boolean(scan.assetId);
  const ignored = Boolean(scan.ignored);
  // Ignorierte Scans werden gedämpft dargestellt (Soft-Delete-Optik).
  const wrap = ignored ? 'border-slate-200 bg-slate-100 opacity-70' : item.wrap;

  const closePanel = () => {
    setExpanded(false);
    setPicking(false);
  };

  return (
    <div className={`rounded-xl border px-3 py-2.5 ${wrap}`}>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0">{item.icon}</span>
        <div className="min-w-0 flex-1">
          {hasAsset ? (
            <p className={`truncate text-sm font-semibold text-slate-900 ${ignored ? 'line-through' : ''}`}>
              {scan.assetLabel || scan.assetId}
            </p>
          ) : (
            <p className={`truncate break-all font-mono text-sm text-slate-700 ${ignored ? 'line-through' : ''}`}>
              {scan.scanValue}
            </p>
          )}
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {hasAsset
              ? `${scan.category || '—'} · SN: ${scan.serialNumber || '—'} · Inv: ${scan.tagNumber || '—'}`
              : 'Kein passendes Asset'}
          </p>
          {ignored ? (
            <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-slate-500">
              <Ban className="h-3 w-3" />
              Ignoriert{scan.ignoreReason ? `: ${scan.ignoreReason}` : ''}
            </p>
          ) : null}
          {scan.note ? <p className="mt-0.5 truncate text-[11px] italic text-slate-500">📝 {scan.note}</p> : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-xs font-semibold text-slate-600">{item.label}</span>
          <span className="text-[11px] text-slate-400">{formatTime(scan.scannedAt)}</span>
          <button
            type="button"
            className="rounded-lg p-1 text-slate-400 hover:bg-white hover:text-slate-700"
            onClick={() => (expanded ? closePanel() : setExpanded(true))}
            disabled={busy}
            aria-label="Scan bearbeiten"
            title="Scan bearbeiten"
          >
            {expanded ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="mt-2.5 border-t border-slate-200 pt-2.5">
          <div className="flex flex-wrap gap-2">
            {scan.scanKind === 'unknown' || hasAsset ? (
              <button
                type="button"
                className="btn-secondary min-h-9 justify-center px-2.5 text-xs"
                onClick={() => setPicking((value) => !value)}
                disabled={busy}
              >
                <Link2 className="h-3.5 w-3.5" />
                {hasAsset ? 'Asset ändern' : 'Asset zuordnen'}
              </button>
            ) : null}
            {ignored ? (
              <button
                type="button"
                className="btn-secondary min-h-9 justify-center px-2.5 text-xs"
                onClick={() => onUnignore(scan)}
                disabled={busy}
              >
                <Undo2 className="h-3.5 w-3.5" />
                Ignorierung aufheben
              </button>
            ) : (
              <button
                type="button"
                className="btn-secondary min-h-9 justify-center px-2.5 text-xs"
                onClick={() => onIgnore(scan)}
                disabled={busy}
              >
                <Ban className="h-3.5 w-3.5" />
                Ignorieren
              </button>
            )}
            <button
              type="button"
              className="btn-secondary min-h-9 justify-center px-2.5 text-xs"
              onClick={() => onNote(scan)}
              disabled={busy}
            >
              <Pencil className="h-3.5 w-3.5" />
              Notiz
            </button>
          </div>

          {picking ? (
            <AssetPicker
              assets={assets}
              busy={busy}
              onPick={(assetId) => {
                onAssign(scan.id, assetId);
                closePanel();
              }}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AssetPicker({
  assets,
  busy,
  onPick,
}: {
  assets: Asset[];
  busy: boolean;
  onPick: (assetId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return assets.slice(0, 8);
    return assets
      .filter((asset) =>
        [asset.name, asset.category, asset.serialNumber, asset.tagNumber]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(needle)),
      )
      .slice(0, 8);
  }, [assets, query]);

  return (
    <div className="mt-2.5 space-y-2 rounded-lg border border-slate-200 bg-white p-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          className="field-input h-9 pl-8 text-sm"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Asset suchen (Name, SN, Inv, Kategorie) …"
          autoComplete="off"
          disabled={busy}
        />
      </div>
      <div className="soft-scrollbar max-h-48 space-y-1 overflow-y-auto">
        {results.length ? (
          results.map((asset) => (
            <button
              key={asset.id}
              type="button"
              className="block w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left hover:border-brand-300 hover:bg-brand-50 disabled:opacity-50"
              onClick={() => onPick(asset.id)}
              disabled={busy}
            >
              <span className="block truncate text-sm font-medium text-slate-900">{asset.name}</span>
              <span className="block truncate text-[11px] text-slate-500">
                {asset.category} · SN: {asset.serialNumber || '—'} · Inv: {asset.tagNumber || '—'}
              </span>
            </button>
          ))
        ) : (
          <p className="px-1 py-2 text-center text-xs text-slate-400">Kein Asset gefunden.</p>
        )}
      </div>
    </div>
  );
}
