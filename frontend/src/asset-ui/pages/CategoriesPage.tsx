import { AlertTriangle, CheckCircle2, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAppDialog } from '../../components/dialogs/AppDialogProvider';
import { InlineLoadingState, LoadingButton } from '../../components/loading';
import { PageHeader } from '../../ui';

import { AssetVisual } from '../components/AssetVisual';
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
  onUpdateCategory?: (categoryId: number, payload: { defaultImageSourceUrl?: string | null }) => Promise<CategoryItem>;
  onRefreshCategoryImage?: (categoryId: number) => Promise<CategoryItem>;
  onDeleteCategory?: (categoryId: number) => Promise<void>;
};

// Eindeutige Klartexte statt rohem Status-Code („ready"). „failed" heißt:
// die externe URL ist gespeichert, aber das Bild konnte serverseitig nicht
// lokal zwischengespeichert werden (Hotlink-Block, abgelaufene URL, …).
function categoryImageStatusText(status: string, hasImageUrl: boolean): string {
  if (status === 'failed') return 'Externe URL gespeichert, aber Cache fehlgeschlagen';
  if (status === 'pending') return 'Bild wird geladen …';
  if (hasImageUrl) return 'Bild lokal gespeichert';
  return 'Kein Standardbild';
}

export function CategoriesPage({
  assets,
  categories,
  canManageCategories = false,
  canDeleteCategories = false,
  onCreateCategory,
  onUpdateCategory,
  onRefreshCategoryImage,
  onDeleteCategory,
}: CategoriesPageProps) {
  const { confirm, alert } = useAppDialog();
  const [candidate, setCandidate] = useState('');
  const [busy, setBusy] = useState(false);
  const [savingImageId, setSavingImageId] = useState<number | null>(null);
  const [refreshingImageId, setRefreshingImageId] = useState<number | null>(null);
  // URLs, deren <img> nicht laden konnte → Platzhalter statt kaputtem
  // Browser-Icon (z. B. Cache-Datei nach Redeploy/Restore verschwunden).
  const [failedImageUrls, setFailedImageUrls] = useState<Set<string>>(new Set());
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
      defaultImageUrl: record?.defaultImageUrl ?? null,
      defaultImageSourceUrl: record?.defaultImageSourceUrl ?? '',
      defaultImageStatus: record?.defaultImageStatus ?? 'none',
      defaultImageFetchError: record?.defaultImageFetchError ?? null,
    };
  });

  const [imageDrafts, setImageDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    setImageDrafts((current) => {
      const next: Record<string, string> = {};
      for (const item of rows) {
        next[item.category] = Object.prototype.hasOwnProperty.call(current, item.category)
          ? current[item.category]
          : item.defaultImageSourceUrl;
      }
      return next;
    });
  }, [categories, categoryOptions]);

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

  const saveCategoryImage = async (
    item: (typeof rows)[number],
    sourceUrlOverride?: string | null,
  ) => {
    if (!canManageCategories || !onUpdateCategory || item.id == null) return;
    const nextUrl = (sourceUrlOverride ?? imageDrafts[item.category] ?? '').trim();
    setSavingImageId(item.id);
    setError(null);
    setMessage(null);
    try {
      const updated = await onUpdateCategory(item.id, {
        defaultImageSourceUrl: nextUrl || null,
      });
      setImageDrafts((current) => ({ ...current, [item.category]: updated.defaultImageSourceUrl ?? '' }));
      setFailedImageUrls(new Set());
      if (nextUrl && updated.defaultImageStatus === 'failed') {
        setError(
          `${item.category}: Externe URL gespeichert, aber Cache fehlgeschlagen` +
            (updated.defaultImageFetchError ? ` (${updated.defaultImageFetchError})` : '.'),
        );
      } else {
        setMessage(
          nextUrl
            ? `${item.category}: Standardbild wurde gespeichert.`
            : `${item.category}: Standardbild wurde entfernt.`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Standardbild konnte nicht gespeichert werden.');
    } finally {
      setSavingImageId(null);
    }
  };

  // „Bild neu laden": erzwingt den erneuten serverseitigen Download aus der
  // gespeicherten Quell-URL (repariert fehlende Cache-Dateien).
  const refreshCategoryImage = async (item: (typeof rows)[number]) => {
    if (!canManageCategories || !onRefreshCategoryImage || item.id == null) return;
    setRefreshingImageId(item.id);
    setError(null);
    setMessage(null);
    try {
      const updated = await onRefreshCategoryImage(item.id);
      setFailedImageUrls(new Set());
      if (updated.defaultImageStatus === 'ready') {
        setMessage(`${item.category}: Bild wurde neu geladen.`);
      } else {
        setError(
          `${item.category}: ${updated.defaultImageFetchError || 'Bild konnte nicht neu geladen werden.'}`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bild konnte nicht neu geladen werden.');
    } finally {
      setRefreshingImageId(null);
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
      <PageHeader
        kicker="Kategorien"
        title="Gerätearten"
        subtitle="Kanonische Kategorien für Import, Inventar, Planung und Availability."
      />

      <article className="surface-card animate-fade-up">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
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
                <div className="flex items-start gap-3">
                  <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white sm:h-28 sm:w-28 dark:border-slate-700 dark:bg-slate-950">
                    {item.defaultImageUrl && !failedImageUrls.has(item.defaultImageUrl) ? (
                      <img
                        src={item.defaultImageUrl}
                        alt={item.category}
                        loading="lazy"
                        onError={() => {
                          // Kaputte Cache-Datei → Platzhalter statt Browser-Icon.
                          setFailedImageUrls((current) => {
                            const next = new Set(current);
                            next.add(item.defaultImageUrl ?? '');
                            return next;
                          });
                        }}
                        className="h-full w-full object-contain p-1"
                      />
                    ) : (
                      <AssetVisual category={item.category} name={item.category} size="md" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-300">
                      {item.category}
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">{item.count}</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {item.isStandard ? 'Standard' : 'Stammdatum'}
                    </p>
                    <p
                      className={`mt-1 text-xs ${
                        item.defaultImageStatus === 'failed'
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {categoryImageStatusText(item.defaultImageStatus, Boolean(item.defaultImageUrl))}
                    </p>
                    {item.defaultImageStatus === 'failed' && item.defaultImageFetchError ? (
                      <p className="mt-0.5 text-xs text-rose-500 dark:text-rose-400" title={item.defaultImageFetchError}>
                        {item.defaultImageFetchError}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  <label className="field text-left">
                    Standardbild-URL
                    <input
                      className="field-input"
                      disabled={!canManageCategories || item.id == null}
                      placeholder="https://example.com/produktbild.jpg"
                      value={imageDrafts[item.category] ?? ''}
                      onChange={(event) =>
                        setImageDrafts((current) => ({ ...current, [item.category]: event.target.value }))
                      }
                    />
                  </label>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Greift automatisch im Inventar, wenn ein Asset kein eigenes Produktbild hat.
                  </p>
                  {canManageCategories ? (
                    <div className="flex flex-wrap gap-2">
                      <LoadingButton
                        type="button"
                        className="btn-secondary px-3 py-2 text-xs"
                        disabled={item.id == null}
                        isLoading={savingImageId === item.id}
                        loadingText="Speichert ..."
                        onClick={() => void saveCategoryImage(item)}
                      >
                        Speichern
                      </LoadingButton>
                      <LoadingButton
                        type="button"
                        className="btn-secondary px-3 py-2 text-xs"
                        disabled={item.id == null || !item.defaultImageSourceUrl || !onRefreshCategoryImage}
                        isLoading={refreshingImageId === item.id}
                        loadingText="Lädt neu ..."
                        onClick={() => void refreshCategoryImage(item)}
                      >
                        Bild neu laden
                      </LoadingButton>
                      <LoadingButton
                        type="button"
                        className="btn-secondary px-3 py-2 text-xs"
                        disabled={item.id == null || !(imageDrafts[item.category] ?? '').trim()}
                        isLoading={savingImageId === item.id}
                        loadingText="Entfernt ..."
                        onClick={() => {
                          setImageDrafts((current) => ({ ...current, [item.category]: '' }));
                          void saveCategoryImage(item, '');
                        }}
                      >
                        Bild entfernen
                      </LoadingButton>
                    </div>
                  ) : null}
                </div>
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
