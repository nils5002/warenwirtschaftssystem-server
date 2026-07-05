import {
  CalendarClock,
  PackagePlus,
  Power,
  QrCode,
  RefreshCw,
  ScanLine,
  Search,
  Trash2,
  Undo2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { useAppDialog } from '../../components/dialogs/AppDialogProvider';
import { LoadingButton } from '../../components/loading';
import { PageHeader } from '../../ui';
import {
  createExternalPool,
  createQrGroup,
  deactivateQrGroup,
  deleteAsset,
  deleteAssetsBulk,
  deleteQrGroup,
  listQrGroups,
  markAssetReturned,
  type QrGroup,
} from '../../services/wmsApi';
import type { Asset, CategoryItem, OwnershipType } from '../types';
import { AssetQrCard } from '../components/AssetQrCard';
import { BulkGroupDialog } from '../components/BulkGroupDialog';
import { KpiCard } from '../components/KpiCard';

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
  const { alert, confirm } = useAppDialog();

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
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // --- Sammel-QR (Gruppen-QR) ---
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [groups, setGroups] = useState<QrGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [createdGroup, setCreatedGroup] = useState<QrGroup | null>(null);
  const [viewQrGroup, setViewQrGroup] = useState<QrGroup | null>(null);
  const [bookingGroup, setBookingGroup] = useState<QrGroup | null>(null);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null);

  const reloadGroups = async () => {
    setGroupsLoading(true);
    try {
      setGroups(await listQrGroups());
    } catch {
      setGroups([]);
    } finally {
      setGroupsLoading(false);
    }
  };

  const reloadExternalPoolData = async () => {
    await onReloadData();
    await reloadGroups();
  };

  useEffect(() => {
    void reloadGroups();
  }, []);

  useEffect(() => {
    if (!categoryNames.length) return;
    setCreateForm((current) =>
      current.category && categoryNames.includes(current.category)
        ? current
        : { ...current, category: categoryNames[0] },
    );
  }, [categoryNames]);

  useEffect(() => {
    setSelectedIds((current) => {
      const validIds = new Set(externalAssets.map((asset) => asset.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of current) {
        if (validIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [externalAssets]);

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

  // --- Auswahl für Sammel-QR ---
  const selectedAssets = useMemo(
    () => externalAssets.filter((asset) => selectedIds.has(asset.id)),
    [externalAssets, selectedIds],
  );
  const selectedCategories = useMemo(
    () => new Set(selectedAssets.map((asset) => asset.category)),
    [selectedAssets],
  );
  const selectionSingleCategory = selectedCategories.size === 1;
  const filteredAllSelected = filtered.length > 0 && filtered.every((asset) => selectedIds.has(asset.id));

  const toggleSelect = (assetId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  };
  const toggleSelectAllFiltered = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (filtered.every((asset) => next.has(asset.id))) {
        for (const asset of filtered) next.delete(asset.id);
      } else {
        for (const asset of filtered) next.add(asset.id);
      }
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());

  const openGroupDialog = () => {
    if (selectedAssets.length === 0) return;
    const category = selectedAssets[0]?.category ?? '';
    setGroupName(`${category} Sammelbuchung`.trim());
    setGroupError(null);
    setCreatedGroup(null);
    setGroupDialogOpen(true);
  };

  const submitCreateGroup = async () => {
    if (selectedAssets.length === 0) {
      setGroupError('Bitte zuerst Mietgeräte auswählen.');
      return;
    }
    if (!selectionSingleCategory) {
      setGroupError('Alle Geräte einer Sammel-QR müssen dieselbe Kategorie haben.');
      return;
    }
    if (!groupName.trim()) {
      setGroupError('Bitte einen Namen vergeben.');
      return;
    }
    setGroupBusy(true);
    setGroupError(null);
    try {
      const category = selectedAssets[0].category;
      const stockType = selectedAssets[0].ownershipType;
      const created = await createQrGroup({
        name: groupName.trim(),
        category,
        stockType:
          stockType === 'rented' || stockType === 'borrowed' || stockType === 'external'
            ? stockType
            : null,
        sourceName: selectedAssets[0].sourceName ?? null,
        assetIds: selectedAssets.map((asset) => asset.id),
      });
      setCreatedGroup(created);
      clearSelection();
      await reloadGroups();
    } catch (error) {
      setGroupError(error instanceof Error ? error.message : 'Sammel-QR konnte nicht erstellt werden.');
    } finally {
      setGroupBusy(false);
    }
  };

  const submitDeactivateGroup = async (group: QrGroup) => {
    const confirmed = await confirm({
      title: 'Sammel-QR deaktivieren?',
      message:
        'Der QR-Code kann danach nicht mehr für Sammelbuchungen gescannt werden. Die einzelnen Geräte bleiben unverändert erhalten.',
      confirmLabel: 'Deaktivieren',
      cancelLabel: 'Abbrechen',
      tone: 'danger',
    });
    if (!confirmed) return;
    setDeactivatingId(group.id);
    try {
      await deactivateQrGroup(group.id);
      await reloadGroups();
    } catch (error) {
      await alert({
        title: 'Deaktivieren nicht möglich',
        message: error instanceof Error ? error.message : 'Unbekannter Fehler.',
      });
    } finally {
      setDeactivatingId(null);
    }
  };

  const submitDeleteGroup = async (group: QrGroup) => {
    if (group.loanedCount > 0) {
      await alert({
        title: 'Löschen nicht möglich',
        message: 'Sammel-QR kann nicht gelöscht werden, solange noch verliehene Geräte enthalten sind.',
      });
      return;
    }
    const confirmed = await confirm({
      title: 'Sammel-QR wirklich löschen?',
      message: 'Diese Aktion kann nicht rückgängig gemacht werden.',
      confirmLabel: 'Löschen',
      cancelLabel: 'Abbrechen',
      tone: 'danger',
    });
    if (!confirmed) return;
    setDeletingGroupId(group.id);
    try {
      await deleteQrGroup(group.id);
      await reloadGroups();
      await alert({
        title: 'Sammel-QR gelöscht',
        message: `Die Gruppe "${group.name}" wurde entfernt.`,
      });
    } catch (error) {
      await alert({
        title: 'Löschen nicht möglich',
        message: error instanceof Error ? error.message : 'Unbekannter Fehler.',
      });
    } finally {
      setDeletingGroupId(null);
    }
  };

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
      await reloadExternalPoolData();
    } catch (error) {
      await alert({
        title: 'Rückgabe nicht möglich',
        message: error instanceof Error ? error.message : 'Unbekannter Fehler.',
      });
    } finally {
      setReturningId(null);
    }
  };

  const submitDelete = async (asset: Asset) => {
    // Schutz vor versehentlicher Eigenbestand-Löschung — die Page rendert
    // ohnehin nur Fremdbestand, aber doppelter Boden schadet nicht.
    if (asset.ownershipType === 'owned' || !asset.ownershipType) {
      await alert({
        title: 'Eigenbestand kann hier nicht gelöscht werden',
        message: 'Diese Aktion ist nur für Fremdbestand gedacht.',
      });
      return;
    }
    if (asset.status === 'Verliehen') {
      await alert({
        title: 'Löschen nicht möglich',
        message:
          'Dieses Gerät ist aktuell ausgegeben und kann erst nach Rücknahme gelöscht werden.',
      });
      return;
    }
    const confirmed = await confirm({
      title: 'Fremdbestand löschen?',
      message:
        'Dieses Gerät wird dauerhaft aus dem Fremdbestand entfernt. Diese Aktion kann nicht rückgängig gemacht werden.',
      confirmLabel: 'Ja, löschen',
      cancelLabel: 'Abbrechen',
      tone: 'danger',
    });
    if (!confirmed) return;
    setDeletingId(asset.id);
    try {
      await deleteAsset(asset.id);
      await reloadExternalPoolData();
      await alert({
        title: 'Fremdbestand gelöscht',
        message: 'Das Gerät wurde dauerhaft entfernt.',
      });
    } catch (error) {
      // Backend liefert 409 mit verständlicher Meldung wenn doch verliehen,
      // 403 wenn Eigenbestand (kommt hier nicht vor, da Page nur Fremdbestand
      // listet). Wir reichen die Backend-Meldung durch.
      await alert({
        title: 'Löschen nicht möglich',
        message: error instanceof Error ? error.message : 'Unbekannter Fehler.',
      });
    } finally {
      setDeletingId(null);
    }
  };

  const bulkDeleteSelected = async () => {
    if (!selectedAssets.length || bulkDeleting) return;
    const loanedTargets = selectedAssets.filter((asset) => asset.status === 'Verliehen');
    const accepted = await confirm({
      title: 'Ausgewählte löschen?',
      message: [
        `${selectedAssets.length} Mietgeräte wirklich löschen?`,
        loanedTargets.length
          ? `${loanedTargets.length} ausgewählte Geräte sind aktuell ausgegeben und werden übersprungen.`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      confirmLabel: 'Ausgewählte löschen',
      cancelLabel: 'Abbrechen',
      tone: 'danger',
    });
    if (!accepted) return;

    const nameById = new Map(selectedAssets.map((asset) => [asset.id, asset.name]));
    setBulkDeleting(true);
    try {
      const result = await deleteAssetsBulk(selectedAssets.map((asset) => asset.id));
      clearSelection();
      await reloadExternalPoolData();

      const skippedLines = result.results
        .filter((item) => !item.deleted)
        .slice(0, 5)
        .map((item) => `${nameById.get(item.assetId) ?? item.assetId}: ${item.reason ?? 'Übersprungen.'}`);

      if (result.deletedCount > 0 && result.skippedCount === 0) {
        await alert({
          title: 'Auswahl gelöscht',
          message: `${result.deletedCount} Mietgeräte wurden gelöscht.`,
        });
        return;
      }

      if (result.deletedCount > 0 || result.skippedCount > 0) {
        await alert({
          title: result.deletedCount > 0 ? 'Bulk-Löschen abgeschlossen' : 'Nichts gelöscht',
          message: [
            `${result.deletedCount} gelöscht, ${result.skippedCount} übersprungen.`,
            skippedLines.length ? skippedLines.join('\n') : '',
            result.results.length - skippedLines.length > 0 && result.skippedCount > skippedLines.length
              ? 'Weitere Einträge wurden ebenfalls übersprungen.'
              : '',
          ]
            .filter(Boolean)
            .join('\n\n'),
        });
      }
    } catch (error) {
      await alert({
        title: 'Bulk-Löschen nicht möglich',
        message: error instanceof Error ? error.message : 'Unbekannter Fehler.',
      });
    } finally {
      setBulkDeleting(false);
    }
  };

  return (
    <section className={`space-y-5 ${isMobile ? 'pb-16' : ''}`}>
      <PageHeader
        kicker="Inventar"
        title="Fremdbestand"
        subtitle="Gemietete, geliehene oder externe Geräte verwalten."
        actions={
          <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
            <PackagePlus className="h-4 w-4" />
            Fremdbestand hinzufügen
          </button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Gesamt" value={String(totals.total)} trend="Alle externen Geräte" tone="neutral" icon={PackagePlus} />
        <KpiCard title="Aktiv" value={String(totals.aktiv)} trend="Aktuell verfügbar oder laufend" tone="positive" icon={Power} />
        <KpiCard title="Rückgabe bald" value={String(totals.rueckgabeBald)} trend="Innerhalb der nächsten 3 Tage" tone="warning" icon={CalendarClock} />
        <KpiCard title="Überfällig" value={String(totals.ueberfaellig)} trend="Rückgabe überschritten" tone="critical" icon={Undo2} />
      </div>

      {/* Sammel-QR: vorhandene Gruppen */}
      <article className="surface-card animate-fade-up">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="page-kicker">Sammel-QR</p>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Sammel-QR-Codes
            </h3>
            <p className="text-xs text-slate-500">
              Ein QR-Code bucht mehrere vorhandene Geräte gesammelt.
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              void reloadGroups();
            }}
          >
            <RefreshCw className="h-4 w-4" />
            Neu laden
          </button>
        </div>

        {groups.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40">
            {groupsLoading
              ? 'Wird geladen …'
              : 'Noch keine Sammel-QR-Codes. Wähle unten Mietgeräte aus und erstelle einen.'}
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {groups.map((group) => (
              <article
                key={group.id}
                className={`rounded-xl border p-3 ${
                  group.isActive
                    ? 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'
                    : 'border-slate-200 bg-slate-50 opacity-70 dark:border-slate-800 dark:bg-slate-950/40'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 dark:text-slate-100">
                      {group.name}
                      {!group.isActive ? (
                        <span className="ml-2 rounded-full border border-slate-300 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                          deaktiviert
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {group.category} · {group.memberCount} Gerät{group.memberCount === 1 ? '' : 'e'} ·{' '}
                      <span className="text-emerald-600">{group.availableCount} verfügbar</span> ·{' '}
                      <span className="text-amber-600">{group.loanedCount} verliehen</span>
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      className="btn-primary px-2.5 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => setBookingGroup(group)}
                      disabled={!group.isActive}
                    >
                      <ScanLine className="h-3.5 w-3.5" />
                      Buchen
                    </button>
                    <button
                      type="button"
                      className="btn-secondary px-2.5 py-1.5 text-xs"
                      onClick={() => setViewQrGroup(group)}
                    >
                      <QrCode className="h-3.5 w-3.5" />
                      QR anzeigen
                    </button>
                    {group.isActive ? (
                      <LoadingButton
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 px-0 py-0 text-rose-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-800/60 dark:bg-rose-950/40 dark:text-rose-200"
                        onClick={() => {
                          void submitDeactivateGroup(group);
                        }}
                        isLoading={deactivatingId === group.id}
                        loadingText=""
                        disabled={deactivatingId !== null || deletingGroupId !== null}
                        aria-label="Sammel-QR deaktivieren"
                        title="Sammel-QR deaktivieren"
                      >
                        <Power className="h-3.5 w-3.5" />
                      </LoadingButton>
                    ) : null}
                    <LoadingButton
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 px-0 py-0 text-rose-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-800/60 dark:bg-rose-950/40 dark:text-rose-200"
                      onClick={() => {
                        void submitDeleteGroup(group);
                      }}
                      isLoading={deletingGroupId === group.id}
                      loadingText=""
                      disabled={deletingGroupId !== null || deactivatingId !== null}
                      aria-label="Sammel-QR löschen"
                      title="Sammel-QR löschen"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </LoadingButton>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </article>

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
              void reloadExternalPoolData();
            }}
          >
            <RefreshCw className="h-4 w-4" />
            Neu laden
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500">{filtered.length} von {externalAssets.length} angezeigt</p>
          <button
            type="button"
            className="text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={toggleSelectAllFiltered}
            disabled={filtered.length === 0}
          >
            {filteredAllSelected ? 'Auswahl aufheben' : 'Alle auswählen'}
          </button>
        </div>

        {selectedAssets.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2.5 dark:border-brand-800/60 dark:bg-brand-950/30">
            <div className="text-sm text-slate-700 dark:text-slate-200">
              <span className="font-semibold">{selectedAssets.length}</span> Mietgerät
              {selectedAssets.length === 1 ? '' : 'e'} ausgewählt
              {!selectionSingleCategory ? (
                <span className="ml-2 text-xs font-semibold text-rose-600">
                  Bitte nur eine Kategorie auswählen.
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className="btn-ghost text-xs" onClick={clearSelection} disabled={bulkDeleting}>
                Auswahl leeren
              </button>
              <button
                type="button"
                className="btn-primary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                onClick={openGroupDialog}
                disabled={!selectionSingleCategory || bulkDeleting || groupBusy}
              >
                <QrCode className="h-4 w-4" />
                Sammel-QR erstellen
              </button>
              <LoadingButton
                type="button"
                className="btn-danger px-3 py-1.5 text-xs"
                onClick={() => {
                  void bulkDeleteSelected();
                }}
                isLoading={bulkDeleting}
                loadingText="Löscht …"
              >
                <Trash2 className="h-4 w-4" />
                Ausgewählte löschen
              </LoadingButton>
            </div>
          </div>
        ) : null}

        {/* Desktop: Tabelle. Mobile: Karten-Liste. */}
        {!isMobile ? (
          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                  <th className="w-10 px-3 py-2.5">
                    <input
                      type="checkbox"
                      className="h-4 w-4 cursor-pointer accent-brand-600"
                      checked={filteredAllSelected}
                      onChange={toggleSelectAllFiltered}
                      aria-label="Alle sichtbaren Geräte auswählen"
                    />
                  </th>
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
                    <td colSpan={8} className="px-3 py-8 text-center text-sm text-slate-500">
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
                        className={`border-t border-slate-200 text-slate-800 hover:bg-sky-50/40 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800/60 ${
                          selectedIds.has(asset.id)
                            ? 'bg-brand-50/60 dark:bg-brand-950/30'
                            : 'bg-white dark:bg-slate-900'
                        }`}
                      >
                        <td className="px-3 py-3">
                          <input
                            type="checkbox"
                            className="h-4 w-4 cursor-pointer accent-brand-600"
                            checked={selectedIds.has(asset.id)}
                            onChange={() => toggleSelect(asset.id)}
                            aria-label={`${asset.name} auswählen`}
                          />
                        </td>
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
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            {!asset.returnedAt ? (
                              <LoadingButton
                                className="btn-secondary px-2.5 py-1.5 text-xs"
                                onClick={() => {
                                  void submitMarkReturned(asset);
                                }}
                                isLoading={returningId === asset.id}
                                loadingText="Wird gespeichert …"
                                disabled={isLoaned || returningId !== null || deletingId !== null || bulkDeleting}
                                title={
                                  isLoaned
                                    ? 'Gerät ist aktuell ausgegeben — erst regulären Check-in durchführen.'
                                    : 'Gerät als zurückgegeben markieren'
                                }
                              >
                                <Undo2 className="h-3.5 w-3.5" />
                                Als zurückgegeben markieren
                              </LoadingButton>
                            ) : null}
                            <LoadingButton
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 px-0 py-0 text-rose-700 transition hover:border-rose-300 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-800/60 dark:bg-rose-950/40 dark:text-rose-200 dark:hover:bg-rose-950/60"
                              onClick={() => {
                                void submitDelete(asset);
                              }}
                              isLoading={deletingId === asset.id}
                              loadingText=""
                              disabled={isLoaned || deletingId !== null || returningId !== null || bulkDeleting}
                              title={
                                isLoaned
                                  ? 'Verliehene Geräte können erst nach Rücknahme gelöscht werden.'
                                  : 'Fremdbestand löschen'
                              }
                              aria-label="Fremdbestand löschen"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </LoadingButton>
                          </div>
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
                    <div className="flex min-w-0 items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-brand-600"
                        checked={selectedIds.has(asset.id)}
                        onChange={() => toggleSelect(asset.id)}
                        aria-label={`${asset.name} auswählen`}
                      />
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900 dark:text-slate-100">{asset.name}</p>
                        <p className="text-[11px] text-slate-500">{asset.tagNumber} · {asset.category}</p>
                      </div>
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
                    <div className="flex items-center gap-1.5">
                      {!asset.returnedAt ? (
                        <LoadingButton
                          className="btn-secondary px-2.5 py-1.5 text-xs"
                          onClick={() => {
                            void submitMarkReturned(asset);
                          }}
                          isLoading={returningId === asset.id}
                          loadingText="…"
                          disabled={isLoaned || returningId !== null || deletingId !== null || bulkDeleting}
                        >
                          <Undo2 className="h-3.5 w-3.5" />
                          Zurückgegeben
                        </LoadingButton>
                      ) : null}
                      <LoadingButton
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 text-rose-700 transition disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-800/60 dark:bg-rose-950/40 dark:text-rose-200"
                        onClick={() => {
                          void submitDelete(asset);
                        }}
                        isLoading={deletingId === asset.id}
                        loadingText=""
                        disabled={isLoaned || deletingId !== null || returningId !== null || bulkDeleting}
                        aria-label="Fremdbestand löschen"
                      >
                        <Trash2 className="h-4 w-4" />
                      </LoadingButton>
                    </div>
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

      {/* Modal: Sammel-QR erstellen / anzeigen */}
      {groupDialogOpen ? (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/55 p-3 sm:items-center"
          onClick={() => {
            if (!groupBusy) setGroupDialogOpen(false);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-panel dark:border-slate-700 dark:bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            {createdGroup ? (
              <>
                <div className="mb-3">
                  <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    Sammel-QR erstellt
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {createdGroup.name} · {createdGroup.memberCount} Gerät
                    {createdGroup.memberCount === 1 ? '' : 'e'}. QR-Code drucken und am Lagerort anbringen.
                  </p>
                </div>
                <AssetQrCard
                  qrValue={createdGroup.qrCode}
                  assetName={createdGroup.name}
                  tagNumber={createdGroup.category}
                />
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => setGroupDialogOpen(false)}
                  >
                    Fertig
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="mb-3">
                  <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    Sammel-QR erstellen
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Dieser QR-Code erzeugt keinen neuen Bestand, sondern bucht vorhandene Geräte gesammelt.
                  </p>
                </div>
                <label className="field">
                  Name der QR-Gruppe
                  <input
                    className="field-input"
                    placeholder="z. B. Miet-iPads Sammelbuchung"
                    value={groupName}
                    onChange={(event) => setGroupName(event.target.value)}
                  />
                </label>
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  <div className="surface-muted px-3 py-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Kategorie</p>
                    <p className="mt-0.5 font-semibold text-slate-900 dark:text-slate-100">
                      {selectedAssets[0]?.category ?? '—'}
                    </p>
                  </div>
                  <div className="surface-muted px-3 py-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Anzahl Geräte</p>
                    <p className="mt-0.5 font-semibold text-slate-900 dark:text-slate-100">
                      {selectedAssets.length}
                    </p>
                  </div>
                </div>
                {groupError ? (
                  <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {groupError}
                  </p>
                ) : null}
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setGroupDialogOpen(false)}
                    disabled={groupBusy}
                  >
                    Abbrechen
                  </button>
                  <LoadingButton
                    className="btn-primary"
                    onClick={() => {
                      void submitCreateGroup();
                    }}
                    isLoading={groupBusy}
                    loadingText="Wird erstellt …"
                  >
                    <QrCode className="h-4 w-4" />
                    QR-Code erzeugen
                  </LoadingButton>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {/* Modal: vorhandenen Sammel-QR anzeigen/drucken */}
      {viewQrGroup ? (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/55 p-3 sm:items-center"
          onClick={() => setViewQrGroup(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-panel dark:border-slate-700 dark:bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {viewQrGroup.name}
              </h3>
              <button
                type="button"
                className="btn-ghost h-9 w-9 p-0"
                onClick={() => setViewQrGroup(null)}
                aria-label="Schließen"
              >
                <Undo2 className="h-4 w-4" />
              </button>
            </div>
            <AssetQrCard
              qrValue={viewQrGroup.qrCode}
              assetName={viewQrGroup.name}
              tagNumber={viewQrGroup.category}
            />
          </div>
        </div>
      ) : null}

      {/* Sammelbuchung per Antippen (gleicher Dialog wie beim Scan) */}
      {bookingGroup ? (
        <BulkGroupDialog
          group={bookingGroup}
          initialMode="checkout"
          onClose={() => setBookingGroup(null)}
          onBooked={async () => {
            setBookingGroup(null);
            await onReloadData();
            await reloadGroups();
          }}
        />
      ) : null}

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
