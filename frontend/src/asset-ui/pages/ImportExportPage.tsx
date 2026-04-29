import { Download, FileSpreadsheet, UploadCloud } from 'lucide-react';
import { useRef, useState } from 'react';
import type { Asset } from '../types';
import {
  confirmHardwareImport,
  downloadHardwareImportTemplate,
  previewHardwareImport,
  type HardwareImportConfirmResponse,
  type HardwareImportPreviewResponse,
} from '../../services/wmsApi';

type ImportExportPageProps = {
  assets: Asset[];
  onImported: () => Promise<void>;
};

export function ImportExportPage({ assets, onImported }: ImportExportPageProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isConfirmLoading, setIsConfirmLoading] = useState(false);
  const [previewResult, setPreviewResult] = useState<HardwareImportPreviewResponse | null>(null);
  const [confirmResult, setConfirmResult] = useState<HardwareImportConfirmResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelected = (file: File | null) => {
    if (file && !/\.(xlsx|xlsm)$/i.test(file.name)) {
      setError('Nur Excel-Dateien (.xlsx, .xlsm) sind erlaubt.');
      setSelectedFile(null);
      setPreviewResult(null);
      setConfirmResult(null);
      return;
    }
    setSelectedFile(file);
    setPreviewResult(null);
    setConfirmResult(null);
    setError(null);
  };

  const handleChooseFile = () => {
    fileInputRef.current?.click();
  };

  const handleDownloadTemplate = async () => {
    setError(null);
    try {
      const blob = await downloadHardwareImportTemplate();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'hardware_import_vorlage.xlsx';
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Vorlage konnte nicht heruntergeladen werden.');
    }
  };

  const runPreview = async () => {
    if (!selectedFile) {
      setError('Bitte zuerst eine Excel-Datei auswählen.');
      return;
    }
    setIsPreviewLoading(true);
    setError(null);
    setConfirmResult(null);
    try {
      const preview = await previewHardwareImport(selectedFile);
      setPreviewResult(preview);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Importprüfung fehlgeschlagen.');
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const confirmImport = async () => {
    if (!previewResult) {
      setError('Bitte zuerst den Import prüfen.');
      return;
    }
    setIsConfirmLoading(true);
    setError(null);
    try {
      const result = await confirmHardwareImport(previewResult.preview_id);
      setConfirmResult(result);
      await onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Importübernahme fehlgeschlagen.');
    } finally {
      setIsConfirmLoading(false);
    }
  };

  const exportAssetsCsv = () => {
    const header = [
      'Name',
      'Kategorie',
      'Seriennummer',
      'Inventarnummer',
      'Status',
      'Standort',
      'ZugewiesenAn',
      'Notizen',
      'QR',
    ];
    const rows = assets.map((asset) => [
      asset.name,
      asset.category,
      asset.serialNumber,
      asset.tagNumber,
      asset.status,
      asset.location,
      asset.assignedTo,
      asset.notes.replaceAll('\n', ' '),
      asset.qrCode ?? '',
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(';'))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `inventar-export-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-700">Import / Export</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">Datenmanagement</h2>
        <p className="mt-1 text-sm text-slate-500">
          Excel-Bestand importieren und Inventar als CSV exportieren.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <article className="surface-card animate-fade-up">
          <h3 className="inline-flex items-center gap-2 text-base font-semibold text-slate-900">
            <FileSpreadsheet className="h-4 w-4" />
            Excel-Import
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Ziehe eine Excel-Datei hier hinein oder wähle sie aus, um Hardware in das Inventar zu importieren.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xlsm"
            className="hidden"
            onChange={(event) => handleFileSelected(event.target.files?.[0] ?? null)}
          />
          <div
            className={`mt-4 rounded-xl border-2 border-dashed p-4 text-sm transition ${
              isDragging ? 'border-brand-500 bg-brand-50' : 'border-slate-300 bg-slate-50'
            }`}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              setIsDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              const file = event.dataTransfer.files?.[0] ?? null;
              handleFileSelected(file);
            }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <UploadCloud className="h-4 w-4 text-brand-700" />
              <span className="font-medium text-slate-700">
                {selectedFile ? selectedFile.name : 'Datei hier ablegen'}
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-500">Unterstützte Formate: .xlsx, .xlsm</p>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              onClick={handleChooseFile}
            >
              Excel-Datei auswählen
            </button>
            <button
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              onClick={() => {
                void handleDownloadTemplate();
              }}
            >
              Beispiel-Excel herunterladen
            </button>
            <button
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              onClick={() => {
                void runPreview();
              }}
              disabled={isPreviewLoading || !selectedFile}
            >
              {isPreviewLoading ? 'Prüfung läuft...' : 'Import prüfen'}
            </button>
            <button
              className="rounded-xl bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
              onClick={() => {
                void confirmImport();
              }}
              disabled={isConfirmLoading || !previewResult}
            >
              {isConfirmLoading ? 'Import läuft...' : 'Import übernehmen'}
            </button>
          </div>
          {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
          {previewResult ? (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="font-medium text-slate-900">
                Vorschau: {previewResult.file_name}
              </p>
              <p className="mt-1 text-slate-600">
                Erkannte Kategorie: {previewResult.inferred_category || '-'} ({previewResult.inferred_category_source || 'unbekannt'}) · Zeilen gesamt: {previewResult.rows_total}
              </p>
              <p className="text-slate-600">
                Gültig {previewResult.rows_valid}, Neu {previewResult.new_assets}, Duplikate {previewResult.duplicate_candidates}, Zuordnung erforderlich {previewResult.unresolved_category_rows}
              </p>
              <p className="mt-1 text-slate-600">
                Erkannte Spalten: {previewResult.recognized_columns.length ? previewResult.recognized_columns.join(', ') : 'Keine'}
              </p>
              <p className="mt-1 text-slate-600">
                Spaltenzuordnung: {Object.keys(previewResult.column_mapping || {}).length
                  ? Object.entries(previewResult.column_mapping)
                      .map(([key, value]) => `${key}: ${value}`)
                      .join(', ')
                  : 'Keine'}
              </p>
              {previewResult.auto_generated_names > 0 ? (
                <p className="mt-1 text-slate-600">
                  {previewResult.auto_generated_names} Gerätenamen wurden automatisch aus Kategorie + Nummer erzeugt.
                </p>
              ) : null}
              {previewResult.auto_generated_serials > 0 ? (
                <p className="mt-1 text-slate-600">
                  {previewResult.auto_generated_serials} AUTO-Seriennummern wurden deterministisch erzeugt.
                </p>
              ) : null}
              {previewResult.errors.length ? (
                <ul className="mt-3 space-y-1 text-xs text-rose-700">
                  {previewResult.errors.slice(0, 8).map((item) => (
                    <li key={`${item.file_name}-${item.row_number}`}>
                      {item.file_name} · Zeile {item.row_number}: {item.reason}
                    </li>
                  ))}
                </ul>
              ) : null}
              {previewResult.warnings.length ? (
                <ul className="mt-2 space-y-1 text-xs text-amber-700">
                  {previewResult.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {confirmResult ? (
            <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              Import abgeschlossen: Importiert {confirmResult.imported_count}, Aktualisiert {confirmResult.updated_count}, Übersprungen {confirmResult.skipped_count}, Fehler {confirmResult.error_count}
            </div>
          ) : null}
        </article>

        <article className="surface-card animate-fade-up">
          <h3 className="inline-flex items-center gap-2 text-base font-semibold text-slate-900">
            <Download className="h-4 w-4" />
            Export
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Exportiert den aktuellen Datenbankbestand als CSV.
          </p>
          <div className="mt-4">
            <button
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              onClick={exportAssetsCsv}
            >
              Inventar als CSV exportieren
            </button>
          </div>
          <p className="mt-3 text-xs text-slate-500">{assets.length} Assets im aktuellen Export.</p>
        </article>
      </div>
    </section>
  );
}

