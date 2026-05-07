import { CalendarClock, PackagePlus, RefreshCw, Search, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { useAppDialog } from '../../components/dialogs/AppDialogProvider';
import { LoadingButton } from '../../components/loading';
import { createExternalPool, markAssetReturned } from '../../services/wmsApi';
import type { Asset, CategoryItem, OwnershipType } from '../types';

type ExternalPoolPageProps = {
  assets: Asset[];
  categories: CategoryItem[];
  isMobile?: boolean;
  onReloadData: () => Promise<void>;
};

type CreateForm = {
  category: string;
  ownershipType: 'rented' | 'borrowed' | 'external';
  count: string;
  namePrefix: string;
  availableFrom: string;
  availableUntil: string;
  sourceName: string;
  externalNote: string;
};

type FremdbestandStatus = 'aktiv' | 'rueckgabe-bald' | 'ueberfaellig' | 'zurueckgegeben';

const OWNERSHIP_LABELS: Record<OwnershipType, string> = {
  owned: 'Eigenbestand',
  rented: 'Mietgerät',
  borrowed: 'Leihgerät',
  external: 'Extern',
};

const STATUS_LABELS: Record<FremdbestandStatus, string> = {
  aktiv: 'Aktiv',
  'rueckgabe-bald': 'Rückgabe bald fällig',
  ueberfaellig: 'Überfällig',
  zurueckgegeben: 'Zurückgegeben',
};

const STATUS_TONE: Record<FremdbestandStatus, string> = {
  aktiv:
    'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700/50 dark:bg-emerald-950/40 dark:text-emerald-200',
  'rueckgabe-bald':
    'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-200',
  ueberfaellig:
    'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-700/50 dark:bg-rose-950/40 dark:text-rose-200',
  zurueckgegeben:
    'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700/60 dark:bg-slate-950/40 dark:text-slate-200',
};

const OWNERSHIP_TONE: Record<OwnershipType, string> = {
  owned:
    'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200',
  rented:
    'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-700/60 dark:bg-sky-950/40 dark:text-sky-200',
  borrowed:
    'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-700/60 dark:bg-violet-950/40 dark:text-violet-200',
  external:
    'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200',
};

function todayIsoDate(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function plusDaysIso(days: number): string {
  const now = new Date();
  now.setDate(now.getDate() + days);
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const [y, m, d] = value.split('-');
  if (!y || !m || !d) return value;
  return `${d}.${m}.${y}`;
}

function determineStatus(asset: Asset): FremdbestandStatus {
  if (asset.returnedAt) return 'zurueckgegeben';
  const today = todayIsoDate();
  const due = asset.availableUntil || asset.returnDueDate;
  if (due && due < today) return 'ueberfaellig';
  if (due) {
    const diffDays = Math.round(
      (new Date(due).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24),
    );
    if (diffDays <= 3) return 'rueckgabe-bald';
  }
  return 'aktiv';
}

const initialCreateForm = (defaultCategory: string): CreateForm => ({
  category: defaultCategory,
  ownershipType: 'rented',
  count: '5',
  namePrefix: '',
  availableFrom: todayIsoDate(),
  availableUntil: plusDaysIso(14),
  sourceName: '',
  externalNote: '',
});

export function ExternalPoolPage({ assets, categories, isMobile = false, onReloadData }: ExternalPoolPageProps) {
  const { alert } = useAppDialog();

  const externalAssets = useMemo(
    () => assets.filter((asset) => (asset.ownershipType ?? 'owned') !== 'owned'),
    [assets],
  );
  const categoryNames = useMemo(() => {
    const fromCats = categories.map((category) => category.name);
    const fromAssets = externalAssets.map((asset) => asset.category);
    return Array.from(new Set([...fromCats, ...fromAssets].filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, 'de'),
    );
  }, [categories, externalAssets]);

  const [search, setSearch] = useState('');
  const [filterOwnership, setFilterOwnership] = useState<'alle' | OwnershipType>('alle');
  const [filterCategory, setFilterCategory] = useState('Alle Kategorien');
  const [filterStatus, setFilterStatus] = useState<'alle' | FremdbestandStatus>('alle');
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<CreateForm>(() =>
    initialCreateForm(categoryNames[0] ?? 'iPad'),
  );
  const [returningId, setReturningId] = useState<string | null>(null);

  useEffect(() => {
    if (!categoryNames.length) return;
    setCreateForm((current) =>
      current.category && categoryNames.includes(current.category)
        ? current
        : { ...current, category: categoryNames[0] },
    );
  }, [categoryNames]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return externalAssets
      .filter((asset) => {
        if (filterOwnership !== 'alle' && (asset.ownershipType ?? 'owned') !== filterOwnership) return false;
        if (filterCategory !== 'Alle Kategorien' && asset.category !== filterCategory) return false;
        const status = determineStatus(asset);
        if (filterStatus !== 'alle' && status !== filterStatus) return false;
        if (!needle) return true;
        return [asset.name, asset.tagNumber, asset.serialNumber, asset.sourceName ?? '']
          .join(' ')
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
  }, [externalAssets, filterCategory, filterOwnership, filterStatus, search]);

  const totals = useMemo(() => {
    const aktiv = externalAssets.filter((a) => determineStatus(a) === 'aktiv').length;
    const rueckgabeBald = externalAssets.filter((a) => determineStatus(a) === 'rueckgabe-bald').length;
    const ueberfaellig = externalAssets.filter((a) => determineStatus(a) === 'ueberfaellig').length;
    const zurueckgegeben = externalAssets.filter((a) => determineStatus(a) === 'zurueckgegeben').length;
    return { aktiv, rueckgabeBald, ueberfaellig, zurueckgegeben, total: externalAssets.length };
  }, [externalAssets]);

  const submitCreate = async () => {
    if (!createForm.category.trim()) {
      setCreateError('Bitte eine Kategorie wählen.');
      return;
    }
    const count = Number.parseInt(createForm.count, 10);
    if (!Number.isFinite(count) || count < 1 || count > 200) {
      setCreateError('Anzahl muss zwischen 1 und 200 liegen.');
      return;
    }
    if (!createForm.namePrefix.trim()) {
      setCreateError('Bitte einen Namenspräfix angeben.');
      return;
    }
    setCreateBusy(true);
    setCreateError(null);
    try {
      await createExternalPool({
        category: createForm.category,
        ownershipType: createForm.ownershipType,
        count,
        namePrefix: createForm.namePrefix.trim(),
        availableFrom: createForm.availableFrom || null,
        availableUntil: createForm.availableUntil || null,
        sourceName: createForm.sourceName.trim() || null,
        externalNote: createForm.externalNote.trim() || null,
      });
      setCreateOpen(false);
      setCreateForm(initialCreateForm(createForm.category));
      await onReloadData();
      await alert({
        title: 'Fremdbestand angelegt',
        message: `${count} ${OWNERSHIP_LABELS[createForm.ownershipType]} wurden erfasst.`,
      });
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Anlage fehlgeschlagen.');
    } finally {
      setCreateBusy(false);
    }
  };

  const submitMarkReturned = async (asset: Asset) => {
    setReturningId(asset.id);
    try {
      await markAssetReturned(asset.id);
      await onReloadData();
    } catch (error) {
      await alert({
        title: 'Rückgabe nicht möglich',
        message: error instanceof Error ? error.message : 'Unbekannter Fehler.',
      });
    } finally {
      setReturningId(null);
    }
  };

  return (
    <section className={`space-y-5 ${isMobile ? 'pb-16' : ''}`}>
      <div className="surface-card animate-fade-up">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="page-kicker">Inventar</p>
            <h2 className="page-title">Fremdbestand</h2>
            <p className="page-subtitle">Gemietete, geliehene oder externe Geräte verwalten.</p>
          </div>
          <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
            <PackagePlus className="h-4 w-4" />
            Fremdbestand hinzufügen
          </button>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-4">
          <div className="surface-muted px-3 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Gesamt</p>
            <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">{totals.total}</p>
          </div>
          <div className="surface-muted px-3 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Aktiv</p>
            <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">{totals.aktiv}</p>
          </div>
          <div className="surface-muted px-3 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Rückgabe bald</p>
            <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">{totals.rueckgabeBald}</p>
          </div>
          <div className="surface-muted px-3 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Überfällig</p>
            <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">{totals.ueberfaellig}</p>
          </div>
        </div>
      </div>

      <article className="surface-card animate-fade-up">
        <div className="grid gap-3 md:grid-cols-[1fr_auto_auto_auto_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Suche nach Name, Tag, Quelle …"
              className="field-input w-full pl-9"
            />
          </div>
          <select
            className="field-input"
            value={filterOwnership}
            onChange={(event) => setFilterOwnership(event.target.value as 'alle' | OwnershipType)}
          >
            <option value="alle">Alle Bestandsarten</option>
            <option value="rented">Mietgerät</option>
            <option value="borrowed">Leihgerät</option>
            <option value="external">Extern</option>
          </select>
          <select
            className="field-input"
            value={filterCategory}
            onChange={(event) => setFilterCategory(event.target.value)}
          >
            <option>Alle Kategorien</option>
            {categoryNames.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
          <select
            className="field-input"
            value={filterStatus}
            onChange={(event) => setFilterStatus(event.target.value as 'alle' | FremdbestandStatus)}
          >
            <option value="alle">Alle Status</option>
            <option value="aktiv">Aktiv</option>
            <option value="rueckgabe-bald">Rückgabe bald</option>
            <option value="ueberfaellig">Überfällig</option>
            <option value="zurueckgegeben">Zurückgegeben</option>
          </select>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              void onReloadData();
            }}
          >
            <RefreshCw className="h-4 w-4" />
            Neu laden
          </button>
        </div>

        <p className="mt-3 text-xs text-slate-500">{filtered.length} von {externalAssets.length} angezeigt</p>

        {/* Desktop: Tabelle. Mobile: Karten-Liste. */}
        {!isMobile ? (
          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                  <th className="px-3 py-2.5">Name</th>
                  <th className="px-3 py-2.5">Bestandsart</th>
                  <th className="px-3 py-2.5">Kategorie</th>
                  <th className="px-3 py-2.5">Quelle</th>
                  <th className="px-3 py-2.5">Verfügbar</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5 text-right">Aktion</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-500">
                      Kein Fremdbestand vorhanden. Lege oben neuen Bestand an.
                    </td>
                  </tr>
                ) : (
                  filtered.map((asset) => {
                    const status = determineStatus(asset);
                    const ownership = (asset.ownershipType ?? 'owned') as OwnershipType;
                    const isLoaned = asset.status === 'Verliehen';
                    return (
                      <tr
                        key={asset.id}
                        className="border-t border-slate-200 bg-white text-slate-800 hover:bg-sky-50/40 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800/60"
                      >
                        <td className="px-3 py-3">
                          <p className="font-semibold text-slate-900 dark:text-slate-100">{asset.name}</p>
                          <p className="text-[11px] text-slate-500">{asset.tagNumber}</p>
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${OWNERSHIP_TONE[ownership]}`}
                          >
                            {OWNERSHIP_LABELS[ownership]}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-sm">{asset.category}</td>
                        <td className="px-3 py-3 text-sm">{asset.sourceName || '—'}</td>
                        <td className="px-3 py-3 text-xs">
                          <p>
                            <CalendarClock className="mr-1 inline h-3.5 w-3.5 align-text-bottom text-slate-400" />
                            {formatDate(asset.availableFrom)} – {formatDate(asset.availableUntil)}
                          </p>
                          {asset.returnedAt ? (
                            <p className="text-slate-500">Zurückgegeben am {formatDate(asset.returnedAt)}</p>
                          ) : null}
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${STATUS_TONE[status]}`}
                          >
                            {STATUS_LABELS[status]}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right">
                          {!asset.returnedAt ? (
                            <LoadingButton
                              className="btn-secondary px-2.5 py-1.5 text-xs"
                              onClick={() => {
                                void submitMarkReturned(asset);
                              }}
                              isLoading={returningId === asset.id}
                              loadingText="Wird gespeichert …"
                              disabled={isLoaned || returningId !== null}
                              title={
                                isLoaned
                                  ? 'Gerät ist aktuell ausgegeben — erst regulären Check-in durchführen.'
                                  : 'Gerät als zurückgegeben markieren'
                              }
                            >
                              <Undo2 className="h-3.5 w-3.5" />
                              Als zurückgegeben markieren
                            </LoadingButton>
                          ) : (
                            <span className="text-xs text-slate-500">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {filtered.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40">
                Kein Fremdbestand vorhanden.
              </div>
            ) : null}
            {filtered.map((asset) => {
              const status = determineStatus(asset);
              const ownership = (asset.ownershipType ?? 'owned') as OwnershipType;
              const isLoaned = asset.status === 'Verliehen';
              return (
                <article
                  key={asset.id}
                  className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 dark:text-slate-100">{asset.name}</p>
                      <p className="text-[11px] text-slate-500">{asset.tagNumber} · {asset.category}</p>
                    </div>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${OWNERSHIP_TONE[ownership]}`}
                    >
                      {OWNERSHIP_LABELS[ownership]}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                    {formatDate(asset.availableFrom)} – {formatDate(asset.availableUntil)}
                    {asset.sourceName ? ` · ${asset.sourceName}` : ''}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_TONE[status]}`}
                    >
                      {STATUS_LABELS[status]}
                    </span>
                    {!asset.returnedAt ? (
                      <LoadingButton
                        className="btn-secondary px-2.5 py-1.5 text-xs"
                        onClick={() => {
                          void submitMarkReturned(asset);
                        }}
                        isLoading={returningId === asset.id}
                        loadingText="…"
                        disabled={isLoaned || returningId !== null}
                      >
                        <Undo2 className="h-3.5 w-3.5" />
                        Zurückgegeben
                      </LoadingButton>
                    ) : null}
                  </div>
                  {isLoaned ? (
                    <p className="mt-1 text-[11px] text-rose-600">
                      Gerät ist aktuell ausgegeben — erst regulären Check-in durchführen.
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </article>

      {/* Modal: Fremdbestand hinzufügen */}
      {createOpen ? (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/55 p-3 sm:items-center"
          onClick={() => {
            if (!createBusy) setCreateOpen(false);
          }}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-4 shadow-panel dark:border-slate-700 dark:bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Fremdbestand hinzufügen</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Erzeugt mehrere Geräte mit eigenen QR-Codes (z. B. „{createForm.namePrefix || 'Miet-iPad'} 01" bis „{createForm.namePrefix || 'Miet-iPad'}{' '}
                {String(Number(createForm.count) || 1).padStart(2, '0')}").
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="field">
                Kategorie
                <select
                  className="field-input"
                  value={createForm.category}
                  onChange={(event) => setCreateForm((current) => ({ ...current, category: event.target.value }))}
                >
                  {categoryNames.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                Bestandsart
                <select
                  className="field-input"
                  value={createForm.ownershipType}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      ownershipType: event.target.value as 'rented' | 'borrowed' | 'external',
                    }))
                  }
                >
                  <option value="rented">Mietgerät</option>
                  <option value="borrowed">Leihgerät</option>
                  <option value="external">Externes Gerät</option>
                </select>
              </label>
              <label className="field">
                Anzahl
                <input
                  type="number"
                  min={1}
                  max={200}
                  className="field-input"
                  value={createForm.count}
                  onChange={(event) => setCreateForm((current) => ({ ...current, count: event.target.value }))}
                />
              </label>
              <label className="field">
                Namenspräfix
                <input
                  className="field-input"
                  placeholder="z. B. Miet-iPad"
                  value={createForm.namePrefix}
                  onChange={(event) => setCreateForm((current) => ({ ...current, namePrefix: event.target.value }))}
                />
              </label>
              <label className="field">
                Verfügbar von
                <input
                  type="date"
                  className="field-input"
                  value={createForm.availableFrom}
                  onChange={(event) => setCreateForm((current) => ({ ...current, availableFrom: event.target.value }))}
                />
              </label>
              <label className="field">
                Verfügbar bis
                <input
                  type="date"
                  className="field-input"
                  value={createForm.availableUntil}
                  onChange={(event) => setCreateForm((current) => ({ ...current, availableUntil: event.target.value }))}
                />
              </label>
              <label className="field sm:col-span-2">
                Quelle / Vermieter (optional)
                <input
                  className="field-input"
                  placeholder="z. B. EventRent GmbH"
                  value={createForm.sourceName}
                  onChange={(event) => setCreateForm((current) => ({ ...current, sourceName: event.target.value }))}
                />
              </label>
              <label className="field sm:col-span-2">
                Notiz (optional)
                <textarea
                  className="field-input min-h-[72px]"
                  placeholder="Vertragsnummer, Ansprechpartner, …"
                  value={createForm.externalNote}
                  onChange={(event) => setCreateForm((current) => ({ ...current, externalNote: event.target.value }))}
                />
              </label>
            </div>

            {createError ? (
              <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {createError}
              </p>
            ) : null}

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setCreateOpen(false)}
                disabled={createBusy}
              >
                Abbrechen
              </button>
              <LoadingButton
                className="btn-primary"
                onClick={() => {
                  void submitCreate();
                }}
                isLoading={createBusy}
                loadingText="Wird angelegt …"
              >
                <PackagePlus className="h-4 w-4" />
                Fremdbestand erfassen
              </LoadingButton>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
