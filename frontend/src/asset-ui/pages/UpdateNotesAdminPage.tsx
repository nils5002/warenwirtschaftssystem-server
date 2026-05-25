import { Plus, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
  createUpdateNote,
  deleteUpdateNote,
  listUpdateNotes,
  publishUpdateNote,
  updateUpdateNote,
  type UpdateNote,
} from '../../services/wmsApi';

type EditorState = {
  id: string | null; // null = neuer Entwurf
  version: string;
  date: string; // YYYY-MM-DD oder ''
  title: string;
  items: string[];
};

type FlashMessage = { kind: 'success' | 'error'; text: string };

function emptyEditor(version = ''): EditorState {
  return { id: null, version, date: '', title: '', items: [''] };
}

function bumpVersion(version: string, kind: 'patch' | 'minor'): string {
  const parts = version.split('.');
  const major = parseInt(parts[0] ?? '0', 10) || 0;
  const minor = parseInt(parts[1] ?? '0', 10) || 0;
  const patch = parseInt(parts[2] ?? '0', 10) || 0;
  if (kind === 'patch') return `${major}.${minor}.${patch + 1}`;
  return `${major}.${minor + 1}.0`;
}

function formatGermanDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '';
  const [year, month, day] = isoDate.split('-');
  if (!year || !month || !day) return isoDate;
  return `${day}.${month}.${year}`;
}

export function UpdateNotesAdminPage() {
  const [notes, setNotes] = useState<UpdateNote[]>([]);
  const [editor, setEditor] = useState<EditorState>(emptyEditor());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<FlashMessage | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const reload = async (): Promise<UpdateNote[]> => {
    try {
      const list = await listUpdateNotes();
      setNotes(list);
      return list;
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Laden fehlgeschlagen.' });
      return [];
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const latestPublishedVersion = useMemo(() => {
    const published = notes.filter((note) => note.isPublished);
    return published.length ? published[0].version : '';
  }, [notes]);

  const startNew = () => {
    const suggested = latestPublishedVersion ? bumpVersion(latestPublishedVersion, 'minor') : '1.0.0';
    setEditor(emptyEditor(suggested));
    setShowPreview(false);
    setMessage(null);
  };

  const startEdit = (note: UpdateNote) => {
    setEditor({
      id: note.id,
      version: note.version,
      date: note.date ?? '',
      title: note.title ?? '',
      items: note.items.length ? [...note.items] : [''],
    });
    setShowPreview(false);
    setMessage(null);
  };

  const setItem = (index: number, value: string) =>
    setEditor((prev) => ({ ...prev, items: prev.items.map((it, i) => (i === index ? value : it)) }));
  const addItem = () => setEditor((prev) => ({ ...prev, items: [...prev.items, ''] }));
  const removeItem = (index: number) =>
    setEditor((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== index) }));

  const cleanedItems = () => editor.items.map((s) => s.trim()).filter(Boolean);

  const save = async (): Promise<string | null> => {
    const items = cleanedItems();
    if (!editor.version.trim()) {
      setMessage({ kind: 'error', text: 'Bitte eine Version eingeben.' });
      return null;
    }
    if (!items.length) {
      setMessage({ kind: 'error', text: 'Bitte mindestens einen Punkt eingeben.' });
      return null;
    }
    setBusy(true);
    try {
      const payload = {
        version: editor.version.trim(),
        date: editor.date || null,
        title: editor.title.trim() || null,
        items,
      };
      const saved = editor.id
        ? await updateUpdateNote(editor.id, payload)
        : await createUpdateNote(payload);
      await reload();
      setEditor((prev) => ({ ...prev, id: saved.id }));
      setMessage({ kind: 'success', text: 'Entwurf gespeichert.' });
      return saved.id;
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Speichern fehlgeschlagen.' });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    const id = editor.id ?? (await save());
    if (!id) return;
    setBusy(true);
    try {
      await publishUpdateNote(id);
      await reload();
      setMessage({ kind: 'success', text: 'Veröffentlicht. Nutzer sehen den Hinweis beim nächsten Login.' });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Veröffentlichen fehlgeschlagen.' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (note: UpdateNote) => {
    setBusy(true);
    try {
      await deleteUpdateNote(note.id);
      if (editor.id === note.id) startNew();
      await reload();
      setMessage({ kind: 'success', text: 'Gelöscht.' });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Löschen fehlgeschlagen.' });
    } finally {
      setBusy(false);
    }
  };

  const previewItems = cleanedItems();

  return (
    <div className="surface-card p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-brand-700 dark:bg-brand-900/60 dark:text-brand-200">
            <Sparkles className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50">Update-Notizen</h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Versionshinweise pflegen und veröffentlichen — ohne Code-Änderung.
            </p>
          </div>
        </div>
        <button type="button" className="btn-secondary px-3 py-2 text-sm" onClick={startNew} disabled={busy}>
          Neue Notiz
        </button>
      </div>

      {message ? (
        <div
          className={`mt-3 rounded-xl border px-3 py-2 text-sm ${
            message.kind === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
        >
          {message.text}
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Liste */}
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vorhandene Notizen</p>
          {notes.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white px-3 py-3 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-950">
              Noch keine Update-Notizen angelegt.
            </p>
          ) : (
            notes.map((note) => (
              <div
                key={note.id}
                className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm dark:border-slate-700 dark:bg-slate-950"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">v{note.version}</span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                        note.isPublished
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-slate-200 bg-slate-50 text-slate-600'
                      }`}
                    >
                      {note.isPublished ? 'Veröffentlicht' : 'Entwurf'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" className="btn-secondary px-2.5 py-1 text-xs" onClick={() => startEdit(note)} disabled={busy}>
                      Bearbeiten
                    </button>
                    <button
                      type="button"
                      className="rounded-lg p-1.5 text-rose-600 transition hover:bg-rose-50"
                      onClick={() => remove(note)}
                      disabled={busy}
                      aria-label="Löschen"
                      title="Löschen"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {note.title ? <p className="mt-1 text-xs text-slate-700 dark:text-slate-300">{note.title}</p> : null}
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {note.date ? `Datum ${formatGermanDate(note.date)} · ` : ''}
                  {note.items.length} Punkt(e)
                </p>
              </div>
            ))
          )}
        </div>

        {/* Editor */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {editor.id ? 'Notiz bearbeiten' : 'Neue Notiz'}
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
              Version
              <input
                className="field-input mt-1"
                value={editor.version}
                placeholder="z. B. 1.7.0"
                onChange={(e) => setEditor((prev) => ({ ...prev, version: e.target.value }))}
              />
              {latestPublishedVersion ? (
                <span className="mt-1 flex gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100"
                    onClick={() => setEditor((prev) => ({ ...prev, version: bumpVersion(latestPublishedVersion, 'patch') }))}
                  >
                    Patch → {bumpVersion(latestPublishedVersion, 'patch')}
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100"
                    onClick={() => setEditor((prev) => ({ ...prev, version: bumpVersion(latestPublishedVersion, 'minor') }))}
                  >
                    Minor → {bumpVersion(latestPublishedVersion, 'minor')}
                  </button>
                </span>
              ) : null}
            </label>
            <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
              Datum
              <input
                type="date"
                className="field-input mt-1"
                value={editor.date}
                onChange={(e) => setEditor((prev) => ({ ...prev, date: e.target.value }))}
              />
            </label>
          </div>

          <label className="mt-3 block text-xs font-medium text-slate-600 dark:text-slate-300">
            Titel
            <input
              className="field-input mt-1"
              value={editor.title}
              placeholder="z. B. Einsatzplanung mit Gerätezuordnung"
              onChange={(e) => setEditor((prev) => ({ ...prev, title: e.target.value }))}
            />
          </label>

          <div className="mt-3">
            <p className="text-xs font-medium text-slate-600 dark:text-slate-300">Punkte</p>
            <div className="mt-1 space-y-2">
              {editor.items.map((item, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    className="field-input"
                    value={item}
                    placeholder="Was ist neu?"
                    onChange={(e) => setItem(index, e.target.value)}
                  />
                  <button
                    type="button"
                    className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-200"
                    onClick={() => removeItem(index)}
                    aria-label="Punkt entfernen"
                    title="Punkt entfernen"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <button type="button" className="btn-secondary mt-2 inline-flex items-center gap-1 px-2.5 py-1 text-xs" onClick={addItem}>
              <Plus className="h-3.5 w-3.5" /> Punkt hinzufügen
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="btn-secondary px-3 py-2 text-sm" onClick={save} disabled={busy}>
              Entwurf speichern
            </button>
            <button type="button" className="btn-secondary px-3 py-2 text-sm" onClick={() => setShowPreview((v) => !v)} disabled={busy}>
              {showPreview ? 'Vorschau ausblenden' : 'Vorschau anzeigen'}
            </button>
            <button type="button" className="btn-primary px-3 py-2 text-sm" onClick={publish} disabled={busy}>
              Veröffentlichen
            </button>
          </div>

          {showPreview ? (
            <div className="mt-4 rounded-2xl border border-brand-200 bg-white p-3 dark:border-brand-800 dark:bg-slate-950">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-300">
                Version {editor.version || '—'}
              </p>
              {editor.title ? (
                <h3 className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-slate-50">{editor.title}</h3>
              ) : null}
              <ul className="mt-2 space-y-1.5 text-sm text-slate-700 dark:text-slate-200">
                {previewItems.length ? (
                  previewItems.map((item, index) => (
                    <li key={index} className="flex gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                      <span className="leading-relaxed">{item}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-xs text-slate-400">Noch keine Punkte.</li>
                )}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
