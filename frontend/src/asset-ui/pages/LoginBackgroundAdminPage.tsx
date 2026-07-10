import { CheckCircle2, Image as ImageIcon, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useAppDialog } from '../../components/dialogs/AppDialogProvider';
import { LoadingButton } from '../../components/loading';
import { PageHeader } from '../../ui';
import {
  activateLoginBackground,
  deactivateLoginBackground,
  deleteLoginBackground,
  fetchLoginBackgrounds,
  uploadLoginBackground,
  type LoginBackground,
} from '../../services/wmsApi';

type FlashMessage = { kind: 'success' | 'error'; text: string };

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (!bytes) return '–';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function LoginBackgroundAdminPage() {
  const { confirm } = useAppDialog();
  const [items, setItems] = useState<LoginBackground[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<FlashMessage | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [pending, setPending] = useState<{ file: File; previewUrl: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const active = useMemo(() => items.find((item) => item.isActive) ?? null, [items]);

  const reload = async () => {
    setLoading(true);
    try {
      setItems(await fetchLoginBackgrounds());
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Laden fehlgeschlagen.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  // Object-URL der Vorschau sauber wieder freigeben.
  useEffect(() => {
    return () => {
      if (pending?.previewUrl) URL.revokeObjectURL(pending.previewUrl);
    };
  }, [pending]);

  const pickFile = (file: File | null | undefined) => {
    setMessage(null);
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setMessage({ kind: 'error', text: 'Nur JPG-, PNG- oder WEBP-Bilder sind erlaubt.' });
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setMessage({ kind: 'error', text: 'Das Bild ist zu groß (maximal 10 MB).' });
      return;
    }
    if (pending?.previewUrl) URL.revokeObjectURL(pending.previewUrl);
    setPending({ file, previewUrl: URL.createObjectURL(file) });
  };

  const confirmUpload = async () => {
    if (!pending || uploading) return;
    setUploading(true);
    setMessage(null);
    try {
      await uploadLoginBackground(pending.file);
      if (pending.previewUrl) URL.revokeObjectURL(pending.previewUrl);
      setPending(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setMessage({ kind: 'success', text: 'Bild hochgeladen und als Hintergrund aktiviert.' });
      await reload();
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Upload fehlgeschlagen.' });
    } finally {
      setUploading(false);
    }
  };

  const cancelPending = () => {
    if (pending?.previewUrl) URL.revokeObjectURL(pending.previewUrl);
    setPending(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const activate = async (item: LoginBackground) => {
    if (busyId) return;
    setBusyId(item.id);
    setMessage(null);
    try {
      await activateLoginBackground(item.id);
      setMessage({ kind: 'success', text: 'Hintergrundbild aktiviert.' });
      await reload();
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Aktivieren fehlgeschlagen.' });
    } finally {
      setBusyId(null);
    }
  };

  const deactivate = async () => {
    if (busyId) return;
    const accepted = await confirm({
      title: 'Hintergrundbild deaktivieren?',
      message: 'Die Login-Seite zeigt anschließend wieder den Standard-Hintergrund.',
      confirmLabel: 'Deaktivieren',
      cancelLabel: 'Abbrechen',
    });
    if (!accepted) return;
    setBusyId('__deactivate__');
    setMessage(null);
    try {
      await deactivateLoginBackground();
      setMessage({ kind: 'success', text: 'Hintergrundbild deaktiviert – Standard-Hintergrund aktiv.' });
      await reload();
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Deaktivieren fehlgeschlagen.' });
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (item: LoginBackground) => {
    if (busyId) return;
    const accepted = await confirm({
      title: 'Bild löschen?',
      message: item.isActive
        ? 'Dieses Bild ist aktuell aktiv. Nach dem Löschen zeigt die Login-Seite den Standard-Hintergrund.'
        : 'Das Bild wird dauerhaft entfernt.',
      confirmLabel: 'Löschen',
      cancelLabel: 'Abbrechen',
      tone: 'danger',
    });
    if (!accepted) return;
    setBusyId(item.id);
    setMessage(null);
    try {
      await deleteLoginBackground(item.id);
      setMessage({ kind: 'success', text: 'Bild gelöscht.' });
      await reload();
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Löschen fehlgeschlagen.' });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="space-y-4">
      <div className="surface-card">
        <PageHeader
          kicker="Darstellung"
          title="Login-Seite"
          subtitle="Hintergrundbild der öffentlichen Anmeldeseite verwalten."
        />
      </div>

      {message ? (
        <div
          className={`rounded-xl border px-3 py-2 text-sm ${
            message.kind === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
              : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300'
          }`}
          role="status"
        >
          {message.text}
        </div>
      ) : null}

      {/* Aktuelles Hintergrundbild */}
      <div className="surface-card">
        <h3 className="text-base font-semibold text-ink">Aktuelles Hintergrundbild</h3>
        {active ? (
          <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div className="overflow-hidden rounded-xl border border-line bg-surface-2">
              <img
                src={active.url}
                alt="Aktives Login-Hintergrundbild"
                className="aspect-video w-full object-cover"
              />
            </div>
            <div className="space-y-3">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-ink-muted">Dateiname</dt>
                <dd className="truncate text-ink" title={active.originalName}>{active.originalName}</dd>
                <dt className="text-ink-muted">Dateigröße</dt>
                <dd className="text-ink">{formatBytes(active.sizeBytes)}</dd>
                <dt className="text-ink-muted">Abmessungen</dt>
                <dd className="text-ink">{active.width} × {active.height} px</dd>
                <dt className="text-ink-muted">Hochgeladen</dt>
                <dd className="text-ink">{formatDate(active.createdAt)}</dd>
                <dt className="text-ink-muted">Von</dt>
                <dd className="text-ink">{active.uploadedByName ?? '–'}</dd>
                <dt className="text-ink-muted">Status</dt>
                <dd>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Aktiv
                  </span>
                </dd>
              </dl>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-secondary px-3 py-1.5 text-xs"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-3.5 w-3.5" /> Bild ersetzen
                </button>
                <LoadingButton
                  type="button"
                  className="btn-secondary px-3 py-1.5 text-xs"
                  isLoading={busyId === '__deactivate__'}
                  loadingText="…"
                  onClick={() => {
                    void deactivate();
                  }}
                >
                  Hintergrund deaktivieren
                </LoadingButton>
              </div>
            </div>
          </div>
        ) : (
          <p className="mt-3 rounded-xl border border-dashed border-line bg-surface-2 px-3 py-8 text-center text-sm text-ink-muted">
            Kein aktives Hintergrundbild – die Login-Seite zeigt den Standard-Hintergrund. Lade unten
            ein Bild hoch oder aktiviere eines aus der Galerie.
          </p>
        )}
      </div>

      {/* Neues Bild hochladen */}
      <div className="surface-card">
        <h3 className="text-base font-semibold text-ink">Neues Bild hochladen</h3>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          data-testid="login-bg-file-input"
          onChange={(event) => pickFile(event.target.files?.[0])}
        />
        {pending ? (
          <div className="mt-3 space-y-3">
            <div className="overflow-hidden rounded-xl border border-line bg-surface-2">
              <img src={pending.previewUrl} alt="Vorschau" className="aspect-video w-full object-cover" />
            </div>
            <p className="text-xs text-ink-muted">
              {pending.file.name} · {formatBytes(pending.file.size)}
            </p>
            <div className="flex flex-wrap gap-2">
              <LoadingButton
                type="button"
                className="btn-primary px-4 py-1.5 text-xs"
                style={{ backgroundColor: '#4361EE' }}
                isLoading={uploading}
                loadingText="Wird hochgeladen …"
                onClick={() => {
                  void confirmUpload();
                }}
              >
                Hochladen &amp; aktivieren
              </LoadingButton>
              <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={cancelPending} disabled={uploading}>
                Abbrechen
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            data-testid="login-bg-dropzone"
            className={`mt-3 flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-10 text-center transition ${
              dragOver ? 'border-[#00b9e1] bg-[#00b9e1]/5' : 'border-line bg-surface-2 hover:border-line-strong'
            }`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              pickFile(event.dataTransfer.files?.[0]);
            }}
          >
            <ImageIcon className="h-8 w-8 text-ink-faint" aria-hidden="true" />
            <span className="text-sm font-medium text-ink">Bild hierher ziehen oder auswählen</span>
            <span className="text-xs text-ink-muted">JPG, PNG oder WEBP · bis 10 MB</span>
          </button>
        )}
      </div>

      {/* Bildergalerie */}
      <div className="surface-card">
        <h3 className="text-base font-semibold text-ink">Bildergalerie</h3>
        {loading ? (
          <p className="mt-3 text-sm text-ink-muted">Bilder werden geladen …</p>
        ) : items.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-line bg-surface-2 px-3 py-8 text-center text-sm text-ink-muted">
            Noch keine Bilder hochgeladen.
          </p>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <div
                key={item.id}
                data-testid={`login-bg-card-${item.id}`}
                className={`overflow-hidden rounded-xl border bg-surface-2 ${
                  item.isActive ? 'border-emerald-400 ring-1 ring-emerald-300 dark:ring-emerald-500/40' : 'border-line'
                }`}
              >
                <div className="relative">
                  <img src={item.url} alt={item.originalName} className="aspect-video w-full object-cover" />
                  {item.isActive ? (
                    <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-emerald-600/90 px-2 py-0.5 text-[11px] font-semibold text-white">
                      <CheckCircle2 className="h-3 w-3" /> Aktiv
                    </span>
                  ) : null}
                </div>
                <div className="space-y-2 p-3">
                  <p className="truncate text-sm font-medium text-ink" title={item.originalName}>
                    {item.originalName}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {formatDate(item.createdAt)} · {formatBytes(item.sizeBytes)} · {item.width}×{item.height}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <LoadingButton
                      type="button"
                      className="btn-secondary px-2.5 py-1 text-xs"
                      isLoading={busyId === item.id}
                      loadingText="…"
                      disabled={item.isActive}
                      onClick={() => {
                        void activate(item);
                      }}
                    >
                      {item.isActive ? 'Als Hintergrund aktiv' : 'Als Hintergrund verwenden'}
                    </LoadingButton>
                    <button
                      type="button"
                      className="rounded-lg p-1.5 text-ink-muted transition hover:bg-surface hover:text-rose-500"
                      aria-label={`${item.originalName} löschen`}
                      disabled={busyId === item.id}
                      onClick={() => {
                        void remove(item);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
