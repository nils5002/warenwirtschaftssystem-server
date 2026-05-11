import { Sparkles, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { UPDATE_NOTES_STORAGE_KEY, updateNotes } from '../updateNotes';

function readLastSeenVersion(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(UPDATE_NOTES_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeLastSeenVersion(version: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(UPDATE_NOTES_STORAGE_KEY, version);
  } catch {
    // localStorage may be unavailable (private mode, quota). Swallow — the
    // modal will simply reappear next session, which is acceptable.
  }
}

export function UpdateNotesModal() {
  const [open, setOpen] = useState<boolean>(() => readLastSeenVersion() !== updateNotes.version);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        // Escape dismisses for this session only — the version stays
        // unmarked so the modal reappears on the next login/reload.
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  function confirm() {
    writeLastSeenVersion(updateNotes.version);
    setOpen(false);
  }

  function dismiss() {
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-900/55 px-3 pb-4 pt-6 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-notes-title"
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700 dark:bg-brand-900/60 dark:text-brand-200">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-300">
                Version {updateNotes.version}
              </p>
              <h2
                id="update-notes-title"
                className="mt-0.5 text-base font-semibold text-slate-900 dark:text-slate-50"
              >
                {updateNotes.title}
              </h2>
            </div>
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            onClick={dismiss}
            aria-label="Schließen"
            title="Schließen — Hinweis erscheint beim nächsten Login wieder"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ul className="space-y-2 px-5 py-4 text-sm text-slate-700 dark:text-slate-200">
          {updateNotes.items.map((item, index) => (
            <li key={index} className="flex gap-2">
              <span
                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500 dark:bg-brand-400"
                aria-hidden="true"
              />
              <span className="leading-relaxed">{item}</span>
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50/70 px-5 py-3 dark:border-slate-800 dark:bg-slate-950/40">
          <button type="button" className="btn-primary px-4 py-2 text-sm" onClick={confirm} autoFocus>
            Verstanden
          </button>
        </div>
      </div>
    </div>
  );
}
