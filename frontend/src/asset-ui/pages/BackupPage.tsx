import { Download, RotateCcw, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useAppDialog } from '../../components/dialogs/AppDialogProvider';
import { downloadWarehouseBackup, restoreWarehouseBackup } from '../../services/wmsApi';

type BackupPageProps = {
  onRestored: () => Promise<void>;
};

export function BackupPage({ onRestored }: BackupPageProps) {
  const { alert, confirm } = useAppDialog();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
    try {
      const result = await restoreWarehouseBackup(selectedFile);
      await onRestored();
      setSuccess(
        `Wiederherstellung abgeschlossen. Assets: ${result.imported.assets ?? 0}, Benutzer: ${result.imported.users ?? 0}, Planungen: ${result.imported.plannings ?? 0}.`,
      );
      await alert({
        title: 'Backup wiederhergestellt',
        message: 'Die Daten wurden erfolgreich eingespielt.',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backup konnte nicht wiederhergestellt werden.');
    } finally {
      setIsRestoring(false);
    }
  };

  return (
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
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              void handleDownload();
            }}
            disabled={isDownloading}
          >
            <Download className="h-4 w-4" />
            {isDownloading ? 'Backup wird erstellt ...' : 'Backup herunterladen'}
          </button>

          <button
            type="button"
            className="btn-secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={isRestoring}
          >
            <Upload className="h-4 w-4" />
            Backup-Datei auswählen
          </button>

          <button
            type="button"
            className="btn-dark"
            onClick={() => {
              void handleRestore();
            }}
            disabled={isRestoring || !selectedFile}
          >
            <RotateCcw className="h-4 w-4" />
            {isRestoring ? 'Wiederherstellung läuft ...' : 'Backup wiederherstellen'}
          </button>
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

        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
        {success ? <p className="text-sm text-emerald-700">{success}</p> : null}
      </article>
    </section>
  );
}
