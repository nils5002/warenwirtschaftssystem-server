import { AlertTriangle, CheckCircle2, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAppDialog } from '../../components/dialogs/AppDialogProvider';
import { InlineLoadingState, LoadingButton } from '../../components/loading';

import { CANONICAL_CATEGORIES, categoryHint, categoryOptionsFromRecords, normalizeCategory } from '../categories';
import type { Asset, CategoryItem } from '../types';

type CategoriesPageProps = {
  assets: Asset[];
  categories: CategoryItem[];
  canManageCategories?: boolean;
  // canDeleteCategories ist eine eigene Berechtigung (Admin / Techniker /
  // Projektmanager). Anlegen bleibt enger (Admin / Techniker), siehe
  // canManageCategories.
  canDeleteCategories?: boolean;
  onCreateCategory: (name: string) => Promise<CategoryItem>;
  onDeleteCategory?: (categoryId: number) => Promise<void>;
};

export function CategoriesPage({
  assets,
  categories,
  canManageCategories = false,
  canDeleteCategories = false,
  onCreateCategory,
  onDeleteCategory,
}: CategoriesPageProps) {
  const { confirm, alert } = useAppDialog();
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

  // Map vom Kategorie-Namen auf das vollständige Backend-Record (inkl. id),
  // damit beim Löschen die richtige id mitgeschickt werden kann.
  const recordByName = useMemo(() => {
    const map = new Map<string, CategoryItem>();
    for (const item of categories) {
      if (item?.name) map.set(item.name, item);
    }
    return map;
  }, [categories]);

  const rows = categoryOptions.map((category) => {
    const record = recordByName.get(category);
    return {
      category,
      count: counts.get(category) ?? 0,
      isStandard: CANONICAL_CATEGORIES.includes(category as (typeof CANONICAL_CATEGORIES)[number]),
      id: record?.id,
    };
  });

  const [deletingId, setDeletingId] = useState<number | null>(null);

  const requestDelete = async (categoryName: string, categoryId: number | undefined, count: number) => {
    if (!canDeleteCategories || !onDeleteCategory) return;
    if (categoryId == null) {
      // Kategorien ohne id sind nur abgeleitete (z. B. aus Asset-Liste) und
      // existieren noch nicht im Backend — Löschen wäre ein No-Op.
      await alert({
        title: 'Kategorie kann nicht gelöscht werden',
        message: 'Diese Kategorie existiert noch nicht als Stammdatum.',
      });
      return;
    }
    if (count > 0) {
      await alert({
        title: 'Kategorie wird noch verwendet',
        message:
          'Diese Kategorie wird noch von Geräten verwendet und kann deshalb nicht gelöscht werden.',
      });
      return;
    }
    const confirmed = await confirm({
      title: 'Kategorie wirklich löschen?',
      message: `Die Kategorie "${categoryName}" wird dauerhaft entfernt.`,
      confirmLabel: 'Löschen',
      cancelLabel: 'Abbrechen',
      tone: 'danger',
    });
    if (!confirmed) return;
    setDeletingId(categoryId);
    setError(null);
    setMessage(null);
    try {
      await onDeleteCategory(categoryId);
      setMessage(`${categoryName} wurde gelöscht.`);
    } catch (err) {
      // Backend liefert HTTP 409 mit verständlicher Meldung im detail.
      // parseResponse() im API-Layer wirft `Error("WMS API Fehler (409): ...")`,
      // wir zeigen die Meldung direkt an, sofern sie sinnvoll ist.
      const fallback = 'Diese Kategorie wird noch von Geräten verwendet und kann deshalb nicht gelöscht werden.';
      const raw = err instanceof Error ? err.message : '';
      const friendly = raw.includes('409') ? fallback : raw || fallback;
      setError(friendly);
      await alert({
        title: 'Kategorie konnte nicht gelöscht werden',
        message: friendly,
      });
    } finally {
      setDeletingId(null);
    }
  };

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
          {rows.map((item) => {
            const canDeleteThisOne =
              canDeleteCategories && item.id != null && item.count === 0;
            const deleteDisabledReason =
              !canDeleteCategories
                ? 'Kein Löschrecht'
                : item.id == null
                  ? 'Kategorie noch nicht gespeichert'
                  : item.count > 0
                    ? `Noch ${item.count} Gerät(e) zugeordnet`
                    : 'Kategorie löschen';
            return (
              <div
                key={item.category}
                className="relative rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/60"
              >
                <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-300">
                  {item.category}
                </p>
                <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">{item.count}</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {item.isStandard ? 'Standard' : 'Stammdatum'}
                </p>
                {canDeleteCategories ? (
                  <button
                    type="button"
                    onClick={() => {
                      void requestDelete(item.category, item.id, item.count);
                    }}
                    disabled={!canDeleteThisOne || deletingId === item.id}
                    title={deleteDisabledReason}
                    aria-label={`Kategorie ${item.category} löschen`}
                    className="absolute right-2 top-2 inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-400 dark:text-slate-500 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            );
          })}
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
          <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300">
            {canManageCategories
              ? 'Admin / Techniker / Projektmanager'
              : 'Nur Auswahl'}
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
          <LoadingButton
            type="button"
            className="btn-secondary self-end"
            disabled={!canSubmit}
            isLoading={busy}
            loadingText="Kategorie wird angelegt ..."
            onClick={() => void submitCategory()}
          >
            Kategorie anlegen
          </LoadingButton>
        </div>
        {busy ? <InlineLoadingState className="mt-3" message="Kategorie wird gespeichert ..." /> : null}

        {!canManageCategories ? (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Kategorien verwalten nur Admin / Techniker / Projektmanager.
            Mitarbeiter und Junior wählen vorhandene Kategorien.
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
