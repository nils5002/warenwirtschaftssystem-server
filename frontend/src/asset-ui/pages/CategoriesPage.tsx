import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import { CANONICAL_CATEGORIES, categoryHint, categoryOptionsFromRecords, normalizeCategory } from '../categories';
import type { Asset, CategoryItem } from '../types';

type CategoriesPageProps = {
  assets: Asset[];
  categories: CategoryItem[];
  canManageCategories?: boolean;
  onCreateCategory: (name: string) => Promise<CategoryItem>;
};

export function CategoriesPage({
  assets,
  categories,
  canManageCategories = false,
  onCreateCategory,
}: CategoriesPageProps) {
  const [candidate, setCandidate] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const categoryOptions = useMemo(() => categoryOptionsFromRecords(categories), [categories]);
  const categorySet = useMemo(() => new Set(categoryOptions), [categoryOptions]);

  const counts = useMemo(() => {
    const result = new Map<string, number>();
    for (const asset of assets) {
      const normalized = normalizeCategory(asset.category);
      const category = categorySet.has(asset.category) ? asset.category : normalized;
      result.set(category, (result.get(category) ?? 0) + 1);
    }
    return result;
  }, [assets, categorySet]);

  const rows = categoryOptions.map((category) => ({
    category,
    count: counts.get(category) ?? 0,
    isStandard: CANONICAL_CATEGORIES.includes(category as (typeof CANONICAL_CATEGORIES)[number]),
  }));

  const candidateTrimmed = candidate.trim();
  const normalizedCandidate = candidateTrimmed ? normalizeCategory(candidateTrimmed) : null;
  const duplicateHint = candidateTrimmed ? categoryHint(candidateTrimmed) : null;
  const candidateExists = categorySet.has(candidateTrimmed);
  const canSubmit = canManageCategories && candidateTrimmed && !duplicateHint && !candidateExists && !busy;

  const submitCategory = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const created = await onCreateCategory(candidateTrimmed);
      setCandidate('');
      setMessage(`${created.name} wurde als Kategorie angelegt.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kategorie konnte nicht angelegt werden.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-700">Kategorien</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">Gerätearten</h2>
        <p className="mt-1 text-sm text-slate-500">
          Kanonische Kategorien für Import, Inventar, Planung und Availability.
        </p>
      </div>

      <article className="surface-card animate-fade-up">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((item) => (
            <div key={item.category} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">{item.category}</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">{item.count}</p>
              <p className="mt-1 text-xs text-slate-500">{item.isStandard ? 'Standard' : 'Stammdatum'}</p>
            </div>
          ))}
        </div>
      </article>

      <article className="surface-card animate-fade-up">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Kategorie anlegen oder prüfen</h3>
            <p className="mt-1 text-sm text-slate-500">
              Neue Stammdaten werden hier kontrolliert geprüft; Assets selbst erlauben nur diese Liste.
            </p>
          </div>
          <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600">
            {canManageCategories ? 'Admin / Techniker' : 'Nur Auswahl'}
          </span>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <label className="field">
            Neuer Kategoriename
            <input
              className="field-input"
              disabled={!canManageCategories}
              placeholder="z. B. Notebook"
              value={candidate}
              onChange={(event) => setCandidate(event.target.value)}
            />
          </label>
          <button type="button" className="btn-secondary self-end" disabled={!canSubmit} onClick={() => void submitCategory()}>
            Kategorie anlegen
          </button>
        </div>

        {!canManageCategories ? (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Kategorien verwalten nur Admins und Techniker. Projektmanager und Mitarbeiter wählen vorhandene Kategorien.
          </p>
        ) : error ? (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        ) : message ? (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            {message}
          </p>
        ) : candidateTrimmed && duplicateHint ? (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Diese Kategorie entspricht wahrscheinlich {duplicateHint}. Bitte die kanonische Kategorie verwenden.
          </p>
        ) : candidateTrimmed && candidateExists ? (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            Diese Kategorie ist bereits als {normalizedCandidate} vorhanden.
          </p>
        ) : candidateTrimmed ? (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            Diese Kategorie kann als neues Stammdatum angelegt werden.
          </p>
        ) : null}
      </article>
    </section>
  );
}
