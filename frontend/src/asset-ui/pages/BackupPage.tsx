import { Download, FileArchive, RotateCcw, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useAppDialog } from '../../components/dialogs/AppDialogProvider';
import { InlineLoadingState, LoadingButton, LoadingOverlay } from '../../components/loading';
import {
  clearWarehouseDataForImport,
  downloadAdminLogs,
  downloadWarehouseBackup,
  isWmsApiError,
  restoreWarehouseBackup,
} from '../../services/wmsApi';

type BackupPageProps = {
  onRestored: () => Promise<void>;
};

export function BackupPage({ onRestored }: BackupPageProps) {
  const { alert, confirm } = useAppDialog();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDownloadingLogs, setIsDownloadingLogs] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const showCriticalOverlay = isRestoring || isClearing;
  const criticalMessage = isRestoring
    ? 'Backup wird eingespielt. Bitte Fenster nicht schließen.'
    : 'Systemdaten werden bereinigt. Bitte Fenster nicht schließen.';

  const handleDownload = async () => {
    setError(null);
    setSuccess(null);
    setIsDownloading(true);
    try {
      const { blob, fileName } = await downloadWarehouseBackup();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
      setSuccess('Backup erfolgreich heruntergeladen.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backup konnte nicht heruntergeladen werden.');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDownloadLogs = async () => {
    setError(null);
    setSuccess(null);
    setIsDownloadingLogs(true);
    try {
      const { blob, fileName } = await downloadAdminLogs();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
      setSuccess('Logs erfolgreich heruntergeladen.');
    } catch (err) {
      if (isWmsApiError(err)) {
        if (err.status === 403) {
          setError('Nur Admins dürfen Logs herunterladen.');
        } else if (err.status === 404) {
          setError(err.detail || 'Es sind aktuell keine App-Logs verfügbar.');
        } else {
          setError(err.detail || 'Logs konnten nicht heruntergeladen werden.');
        }
      } else {
        setError('Logs konnten nicht heruntergeladen werden.');
      }
    } finally {
      setIsDownloadingLogs(false);
    }
  };

  const handleRestore = async () => {
    if (!selectedFile) {
      setError('Bitte zuerst eine Backup-Datei auswählen.');
      return;
    }
    const approved = await confirm({
      title: 'Backup wiederherstellen',
      message:
        'Diese Aktion kann aktuelle Daten überschreiben. Möchtest du die Wiederherstellung wirklich starten?',
      confirmLabel: 'Wiederherstellen',
      cancelLabel: 'Abbrechen',
      tone: 'danger',
    });
    if (!approved) return;

    setError(null);
    setSuccess(null);
    setIsRestoring(true);
    let restoreResult: Awaited<ReturnType<typeof restoreWarehouseBackup>> | null = null;
    let restoreError: string | null = null;
    try {
      restoreResult = await restoreWarehouseBackup(selectedFile);
      await onRestored();
    } catch (err) {
      restoreError = err instanceof Error ? err.message : 'Backup konnte nicht wiederhergestellt werden.';
    } finally {
      setIsRestoring(false);
    }

    if (restoreError) {
      setError(restoreError);
      return;
    }

    if (restoreResult) {
      setSuccess(
        `Wiederherstellung abgeschlossen. Assets: ${restoreResult.imported.assets ?? 0}, Benutzer: ${restoreResult.imported.users ?? 0}, Planungen: ${restoreResult.imported.plannings ?? 0}.`,
      );
      await alert({
        title: 'Backup wiederhergestellt',
        message: 'Die Daten wurden erfolgreich eingespielt.',
      });
    }
  };

  const handleClearData = async () => {
    const approved = await confirm({
      title: 'Systemdaten wirklich bereinigen?',
      message:
        'Dabei werden Inventar, Projekte, Einsatzplanung, Defekte, Tickets, Ein-/Auslagerungen, Kategorien und weitere gespeicherte WMS-Daten gelöscht. Der Admin-Zugang bleibt erhalten, damit du dich danach weiter anmelden und ein Backup importieren kannst.',
      confirmLabel: 'Endgültig bereinigen',
      cancelLabel: 'Abbrechen',
      tone: 'danger',
    });
    if (!approved) return;

    setError(null);
    setSuccess(null);
    setIsClearing(true);
    let clearResult: Awaited<ReturnType<typeof clearWarehouseDataForImport>> | null = null;
    let clearError: string | null = null;
    try {
      clearResult = await clearWarehouseDataForImport();
      await onRestored();
      setSelectedFile(null);
    } catch (err) {
      clearError = err instanceof Error ? err.message : 'Systemdaten konnten nicht bereinigt werden.';
    } finally {
      setIsClearing(false);
    }

    if (clearError) {
      setError(clearError);
      return;
    }

    if (clearResult) {
      setSuccess(clearResult.message);
      await alert({
        title: 'Bereinigung abgeschlossen',
        message: clearResult.message,
      });
    }
  };

  return (
    <LoadingOverlay show={showCriticalOverlay} message={criticalMessage} fullScreen>
      <section className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-700">Backup</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">Sicherung & Restore</h2>
        <p className="mt-1 text-sm text-slate-500">
          Hier können Sie den aktuellen Datenstand sichern oder aus einer Sicherung wiederherstellen.
        </p>
      </div>

      <article className="surface-card animate-fade-up space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <LoadingButton
            type="button"
            className="btn-secondary"
            onClick={() => {
              void handleDownload();
            }}
            isLoading={isDownloading}
            loadingText="Backup wird erstellt ..."
          >
            <Download className="h-4 w-4" />
            Backup herunterladen
          </LoadingButton>

          <button
            type="button"
            className="btn-secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={isRestoring || isClearing}
          >
            <Upload className="h-4 w-4" />
            Backup-Datei auswählen
          </button>

          <LoadingButton
            type="button"
            className="btn-dark"
            onClick={() => {
              void handleRestore();
            }}
            disabled={isClearing || !selectedFile}
            isLoading={isRestoring}
            loadingText="Backup wird wiederhergestellt ..."
          >
            <RotateCcw className="h-4 w-4" />
            Backup wiederherstellen
          </LoadingButton>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            setSelectedFile(file);
            setError(null);
            setSuccess(null);
          }}
        />

        <p className="text-sm text-slate-600">
          {selectedFile ? `Ausgewählte Datei: ${selectedFile.name}` : 'Noch keine Backup-Datei ausgewählt.'}
        </p>
        {isDownloading ? <InlineLoadingState message="Backup wird heruntergeladen ..." /> : null}

        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
        {success ? <p className="text-sm text-emerald-700">{success}</p> : null}
      </article>

      <article className="surface-card animate-fade-up space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">System &amp; Diagnose</h3>
          <p className="mt-1 text-sm text-slate-600">
            Lade die aktuellen App-Logs als ZIP herunter, um Fehler im Serverbetrieb nachzuvollziehen.
            Es werden ausschließlich App-eigene Logs bereitgestellt, keine Host- oder Systemlogs.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LoadingButton
            type="button"
            className="btn-secondary min-h-[44px]"
            onClick={() => {
              void handleDownloadLogs();
            }}
            isLoading={isDownloadingLogs}
            loadingText="Logs werden gepackt ..."
          >
            <FileArchive className="h-4 w-4" />
            Logs herunterladen
          </LoadingButton>
        </div>
        {isDownloadingLogs ? <InlineLoadingState message="Logs werden geladen ..." /> : null}
      </article>

      <article className="surface-card animate-fade-up space-y-4 border-rose-200/70">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Datenbank bereinigen</h3>
          <p className="mt-1 text-sm text-slate-600">
            Bereinigt alle WMS-Daten, damit anschließend ein Backup sauber importiert werden kann. Der Admin-Zugang
            bleibt erhalten.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Löscht alle Fach- und Bewegungsdaten, behält aber den Admin-Zugang.
          </p>
        </div>
        <div>
          <LoadingButton
            type="button"
            className="btn-danger"
            disabled={isRestoring}
            isLoading={isClearing}
            loadingText="Systemdaten werden bereinigt ..."
            onClick={() => {
              void handleClearData();
            }}
          >
            Systemdaten bereinigen
          </LoadingButton>
        </div>
      </article>
    </section>
    </LoadingOverlay>
  );
}
