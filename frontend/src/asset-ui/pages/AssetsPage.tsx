import { Eye, Filter, Plus, QrCode, ScanLine, Search, Settings2, Trash2, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppDialog } from '../../components/dialogs/AppDialogProvider';
import { AssetQuickView } from '../components/AssetQuickView';
import { AssetQrCard } from '../components/AssetQrCard';
import { getAssetQrCode } from '../qr';
import { StatusBadge } from '../components/StatusBadge';
import type { AppPage, Asset } from '../types';

type AssetsPageProps = {
  assets: Asset[];
  isMobile?: boolean;
  canManageAssets?: boolean;
  initialSearch?: string;
  onOpenDetail: (assetId: string) => void;
  onCreateAsset: () => void;
  onCreateAssetFromInput: (payload: {
    category: string;
    name: string;
    manufacturer?: string;
    model?: string;
    serialNumber: string;
    ipAddress?: string;
    macLan?: string;
    macWlan?: string;
    tagNumber?: string;
    location?: string;
    notes?: string;
  }) => Promise<Asset>;
  onReserveAsset: (assetId: string) => void;
  onCheckoutAsset: (assetId: string) => void;
  onCheckinAsset: (assetId: string) => void;
  onAdminUpdateAsset: (assetId: string, patch: Partial<Asset>) => void;
  onAdminDeleteAsset: (assetId: string) => Promise<void>;
  onCreateMaintenance: (payload: { assetName: string; issue: string; comment: string }) => void;
  onNavigate: (page: AppPage) => void;
};

const DEFAULT_CATEGORIES = [
  'Laptop',
  'iPad',
  'Handheld',
  'Smartphone',
  'QR-Code-Scanner',
  'Drucker',
  'Kartendrucker',
  'Switch',
  'Router',
  'LTE-Router',
  'Zubehör',
  'Sonstiges',
];
const TECH_COLUMNS_STORAGE_KEY = 'inventory-show-tech-columns';

function defaultNameForCategory(category: string): string {
  const normalized = category.toLowerCase();
  if (normalized.includes('ipad')) return 'iPad';
  if (normalized.includes('laptop') || normalized.includes('notebook')) return 'Laptop';
  if (normalized.includes('smartphone')) return 'Smartphone';
  if (normalized.includes('scanner')) return 'QR-Code-Scanner';
  if (normalized.includes('handheld')) return 'Handheld';
  if (normalized.includes('kartendrucker')) return 'Kartendrucker';
  if (normalized.includes('drucker')) return 'Drucker';
  if (normalized.includes('router')) return 'Router';
  if (normalized.includes('switch')) return 'Switch';
  return category;
}

type AdminActionForm = {
  status: Asset['status'];
  statusNote: string;
  assignee: string;
  projectName: string;
  dueDate: string;
  assignmentNote: string;
  correctionNote: string;
  deleteConfirm: string;
};

type BulkActionForm = {
  status: Asset['status'] | '';
  category: string;
  location: string;
  deleteConfirm: string;
};

function createAdminActionForm(asset: Asset): AdminActionForm {
  return {
    status: asset.status,
    statusNote: '',
    assignee: asset.assignedTo === '-' ? '' : asset.assignedTo,
    projectName: '',
    dueDate: asset.nextReturn === '-' ? '' : asset.nextReturn,
    assignmentNote: '',
    correctionNote: '',
    deleteConfirm: '',
  };
}

function createBulkActionForm(): BulkActionForm {
  return {
    status: '',
    category: '',
    location: '',
    deleteConfirm: '',
  };
}

export function AssetsPage({
  assets,
  isMobile = false,
  canManageAssets = true,
  initialSearch,
  onOpenDetail,
  onCreateAsset,
  onCreateAssetFromInput,
  onReserveAsset,
  onCheckoutAsset,
  onCheckinAsset,
  onAdminUpdateAsset,
  onAdminDeleteAsset,
  onCreateMaintenance,
  onNavigate,
}: AssetsPageProps) {
  const { prompt, alert, confirm } = useAppDialog();
  const naturalSort = useMemo(() => new Intl.Collator('de', { numeric: true, sensitivity: 'base' }), []);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const serialRef = useRef<HTMLInputElement | null>(null);

  const [search, setSearch] = useState(initialSearch ?? '');
  const [category, setCategory] = useState('Alle Kategorien');
  const [location, setLocation] = useState('Alle Standorte');
  const [status, setStatus] = useState('Alle Status');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [onlyBroken, setOnlyBroken] = useState(false);
  const [showTechnicalColumns, setShowTechnicalColumns] = useState(false);
  const [quickViewId, setQuickViewId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkActionBusy, setBulkActionBusy] = useState(false);
  const [bulkActionError, setBulkActionError] = useState<string | null>(null);
  const [bulkForm, setBulkForm] = useState<BulkActionForm>(createBulkActionForm());
  const [adminActionAssetId, setAdminActionAssetId] = useState<string | null>(null);
  const [adminActionForm, setAdminActionForm] = useState<AdminActionForm | null>(null);
  const [adminActionError, setAdminActionError] = useState<string | null>(null);
  const [adminActionBusy, setAdminActionBusy] = useState(false);

  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingSaving, setOnboardingSaving] = useState(false);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const [createdAsset, setCreatedAsset] = useState<Asset | null>(null);
  const [form, setForm] = useState({
    category: DEFAULT_CATEGORIES[0],
    name: defaultNameForCategory(DEFAULT_CATEGORIES[0]),
    manufacturer: '',
    model: '',
    serialNumber: '',
    ipAddress: '',
    macLan: '',
    macWlan: '',
    tagNumber: '',
    location: 'Hauptlager',
    notes: '',
  });

  const categories = ['Alle Kategorien', ...new Set(assets.map((asset) => asset.category))];
  const locations = ['Alle Standorte', ...new Set(assets.map((asset) => asset.location))];
  const statuses = ['Alle Status', ...new Set(assets.map((asset) => asset.status))];
  const categoryOptions = useMemo(() => {
    return [...new Set([...DEFAULT_CATEGORIES, ...assets.map((asset) => asset.category).filter(Boolean)])];
  }, [assets]);

  const filteredAssets = useMemo(
    () =>
      assets
      .filter((asset) => {
        const matchesSearch = [asset.name, asset.tagNumber, asset.serialNumber, asset.assignedTo]
          .join(' ')
          .toLowerCase()
          .includes(search.toLowerCase());
        const matchesCategory = category === 'Alle Kategorien' || asset.category === category;
        const matchesLocation = location === 'Alle Standorte' || asset.location === location;
        const matchesStatus = status === 'Alle Status' || asset.status === status;
        const matchesAvailable = !onlyAvailable || asset.status === 'Verfügbar';
        const matchesBroken = !onlyBroken || ['Defekt', 'In Wartung'].includes(asset.status);
        return (
          matchesSearch &&
          matchesCategory &&
          matchesLocation &&
          matchesStatus &&
          matchesAvailable &&
          matchesBroken
        );
      })
      .sort((left, right) => {
        const categoryCompare = naturalSort.compare(left.category || '', right.category || '');
        if (categoryCompare !== 0) return categoryCompare;
        const nameCompare = naturalSort.compare(left.name || '', right.name || '');
        if (nameCompare !== 0) return nameCompare;
        return naturalSort.compare(left.id, right.id);
      }),
    [assets, category, location, naturalSort, onlyAvailable, onlyBroken, search, status],
  );

  const quickViewAsset = assets.find((asset) => asset.id === quickViewId) ?? null;
  const adminActionAsset = assets.find((asset) => asset.id === adminActionAssetId) ?? null;
  const availableCount = assets.filter((asset) => asset.status === 'Verfügbar').length;
  const loanedCount = assets.filter((asset) => asset.status === 'Verliehen').length;
  const attentionCount = assets.filter((asset) => ['Defekt', 'In Wartung'].includes(asset.status)).length;

  useEffect(() => {
    setSearch(initialSearch ?? '');
  }, [initialSearch]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(TECH_COLUMNS_STORAGE_KEY);
    if (stored === '1') setShowTechnicalColumns(true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(TECH_COLUMNS_STORAGE_KEY, showTechnicalColumns ? '1' : '0');
  }, [showTechnicalColumns]);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => assets.some((asset) => asset.id === id)));
  }, [assets]);

  const resetFilters = () => {
    setSearch('');
    setCategory('Alle Kategorien');
    setLocation('Alle Standorte');
    setStatus('Alle Status');
    setOnlyAvailable(false);
    setOnlyBroken(false);
  };

  const openByQrOrTag = async () => {
    const input = await prompt({
      title: 'Gerät suchen',
      message: 'Inventarnummer oder Seriennummer',
      placeholder: 'z. B. IMP-... oder SN-...',
      submitLabel: 'Suchen',
    });
    if (!input?.trim()) return;
    const needle = input.trim().toLowerCase();
    const match = assets.find(
      (asset) => asset.tagNumber.toLowerCase() === needle || asset.serialNumber.toLowerCase() === needle,
    );
    if (!match) {
      await alert({
        title: 'Keine Übereinstimmung',
        message: 'Kein Asset mit dieser Inventar- oder Seriennummer gefunden.',
      });
      return;
    }
    setQuickViewId(match.id);
  };

  const runQuickCheckout = async () => {
    if (filteredAssets[0]) {
      onCheckoutAsset(filteredAssets[0].id);
      return;
    }
    await alert({
      title: 'Kein Asset verfügbar',
      message: 'Es gibt aktuell kein passendes Asset für die Ausgabe. Bitte Filter anpassen.',
    });
  };

  const runQuickCheckin = async () => {
    if (filteredAssets[0]) {
      onCheckinAsset(filteredAssets[0].id);
      return;
    }
    await alert({
      title: 'Kein Asset verfügbar',
      message: 'Es gibt aktuell kein passendes Asset für die Rücknahme. Bitte Filter anpassen.',
    });
  };

  const toggleSelected = (assetId: string, rowIndex: number, withRange = false) => {
    setSelectedIds((current) => {
      if (withRange && lastSelectedIndex !== null && filteredAssets.length > 0) {
        const start = Math.min(lastSelectedIndex, rowIndex);
        const end = Math.max(lastSelectedIndex, rowIndex);
        const idsInRange = filteredAssets.slice(start, end + 1).map((asset) => asset.id);
        return [...new Set([...current, ...idsInRange])];
      }
      return current.includes(assetId) ? current.filter((id) => id !== assetId) : [...current, assetId];
    });
    setLastSelectedIndex(rowIndex);
  };

  const toggleSelectAllVisible = () => {
    const visibleIds = filteredAssets.map((asset) => asset.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
    setSelectedIds(allSelected ? selectedIds.filter((id) => !visibleIds.includes(id)) : [...new Set([...selectedIds, ...visibleIds])]);
    setLastSelectedIndex(null);
  };

  const openBulkModal = () => {
    if (!selectedIds.length) return;
    setBulkForm(createBulkActionForm());
    setBulkActionError(null);
    setBulkModalOpen(true);
  };

  const closeBulkModal = () => {
    setBulkModalOpen(false);
    setBulkActionBusy(false);
    setBulkActionError(null);
    setBulkForm(createBulkActionForm());
  };

  const applyBulkUpdate = async () => {
    if (!selectedIds.length) return;
    if (!bulkForm.status && !bulkForm.category.trim() && !bulkForm.location.trim()) {
      setBulkActionError('Bitte Status, Kategorie oder Standort setzen.');
      return;
    }
    setBulkActionBusy(true);
    setBulkActionError(null);
    for (const assetId of selectedIds) {
      onAdminUpdateAsset(assetId, {
        ...(bulkForm.status ? { status: bulkForm.status } : {}),
        ...(bulkForm.category.trim() ? { category: bulkForm.category.trim() } : {}),
        ...(bulkForm.location.trim() ? { location: bulkForm.location.trim() } : {}),
      });
    }
    setBulkActionBusy(false);
    closeBulkModal();
    setSelectedIds([]);
    await alert({ title: 'Bulk-Update', message: 'Die markierten Assets wurden aktualisiert.' });
  };

  const applyBulkDelete = async () => {
    if (!selectedIds.length) return;
    if (bulkForm.deleteConfirm.trim() !== 'LÖSCHEN') {
      setBulkActionError('Bitte zur Bestätigung LÖSCHEN eingeben.');
      return;
    }
    const selectedAssets = assets.filter((asset) => selectedIds.includes(asset.id));
    const blockedAssets = selectedAssets.filter(
      (asset) => asset.status === 'Verliehen' || (asset.nextReservation && asset.nextReservation !== '-'),
    );
    if (blockedAssets.length) {
      setBulkActionError(
        `${blockedAssets.length} ausgewählte Geräte sind aktuell verliehen oder verplant. Bitte zuerst Rückgabe/Planung klären.`,
      );
      return;
    }
    const accepted = await confirm({
      title: 'Ausgewählte Geräte löschen',
      message: `Möchtest du wirklich ${selectedIds.length} Geräte löschen?`,
      confirmLabel: 'Löschen',
      cancelLabel: 'Abbrechen',
      tone: 'danger',
    });
    if (!accepted) {
      return;
    }
    setBulkActionBusy(true);
    setBulkActionError(null);
    for (const assetId of selectedIds) {
      // eslint-disable-next-line no-await-in-loop
      await onAdminDeleteAsset(assetId);
    }
    setBulkActionBusy(false);
    closeBulkModal();
    setSelectedIds([]);
  };

  const runAdminDeleteAsset = async (asset: Asset) => {
    const accepted = await confirm({
      title: 'Gerät löschen',
      message: `${asset.name} (${asset.tagNumber}) wird dauerhaft gelöscht.`,
      confirmLabel: 'Löschen',
      cancelLabel: 'Abbrechen',
      tone: 'danger',
    });
    if (!accepted) return;
    await onAdminDeleteAsset(asset.id);
  };

  const openAdminActions = (asset: Asset) => {
    setAdminActionAssetId(asset.id);
    setAdminActionForm(createAdminActionForm(asset));
    setAdminActionError(null);
  };

  const closeAdminActions = () => {
    setAdminActionAssetId(null);
    setAdminActionForm(null);
    setAdminActionError(null);
    setAdminActionBusy(false);
  };

  const applyAdminStatus = async () => {
    if (!adminActionAsset || !adminActionForm) return;
    setAdminActionBusy(true);
    setAdminActionError(null);
    try {
      const noteLine = adminActionForm.statusNote.trim()
        ? `Admin-Statusnotiz: ${adminActionForm.statusNote.trim()}`
        : '';
      onAdminUpdateAsset(adminActionAsset.id, {
        status: adminActionForm.status,
        notes: noteLine ? `${adminActionAsset.notes}\n${noteLine}`.trim() : adminActionAsset.notes,
      });
      await alert({ title: 'Status aktualisiert', message: 'Status wurde administrativ geändert.' });
    } finally {
      setAdminActionBusy(false);
    }
  };

  const applyAdminAssignment = async () => {
    if (!adminActionAsset || !adminActionForm) return;
    if (!adminActionForm.assignee.trim()) {
      setAdminActionError('Bitte Person/Team für die Zuordnung ausfüllen.');
      return;
    }
    setAdminActionBusy(true);
    setAdminActionError(null);
    try {
      const normalizedProject = adminActionForm.projectName.trim();
      const assignmentTarget = normalizedProject
        ? `${adminActionForm.assignee.trim()} · ${normalizedProject}`
        : adminActionForm.assignee.trim();
      const noteParts = [
        normalizedProject ? `Projekt: ${normalizedProject}` : '',
        adminActionForm.assignmentNote.trim() ? `Admin-Korrektur: ${adminActionForm.assignmentNote.trim()}` : '',
      ].filter(Boolean);
      onAdminUpdateAsset(adminActionAsset.id, {
        assignedTo: assignmentTarget,
        status: 'Verliehen',
        nextReturn: adminActionForm.dueDate.trim() || '-',
        notes: noteParts.length ? `${adminActionAsset.notes}\n${noteParts.join('\n')}`.trim() : adminActionAsset.notes,
      });
      await alert({ title: 'Zuordnung gesetzt', message: 'Gerät wurde Person/Projekt zugeordnet.' });
    } finally {
      setAdminActionBusy(false);
    }
  };

  const applyAdminProjectCorrection = async () => {
    if (!adminActionAsset || !adminActionForm) return;
    if (!adminActionForm.projectName.trim() && !adminActionForm.correctionNote.trim()) {
      setAdminActionError('Bitte Projektkontext oder Korrekturnotiz eintragen.');
      return;
    }
    setAdminActionBusy(true);
    setAdminActionError(null);
    try {
      const lines = [
        adminActionForm.projectName.trim() ? `Projekt: ${adminActionForm.projectName.trim()}` : '',
        adminActionForm.correctionNote.trim() ? `Buchungskorrektur: ${adminActionForm.correctionNote.trim()}` : '',
      ].filter(Boolean);
      onAdminUpdateAsset(adminActionAsset.id, {
        notes: `${adminActionAsset.notes}\n${lines.join('\n')}`.trim(),
      });
      await alert({ title: 'Korrektur gespeichert', message: 'Projektkontext/Buchungskorrektur wurde ergänzt.' });
    } finally {
      setAdminActionBusy(false);
    }
  };

  const applyAdminReset = async () => {
    if (!adminActionAsset) return;
    setAdminActionBusy(true);
    setAdminActionError(null);
    try {
      onAdminUpdateAsset(adminActionAsset.id, {
        assignedTo: '-',
        status: 'Verfügbar',
        nextReturn: '-',
        nextReservation: '-',
      });
      await alert({ title: 'Gerät zurückgesetzt', message: 'Zuordnung entfernt und auf verfügbar gesetzt.' });
    } finally {
      setAdminActionBusy(false);
    }
  };

  const applyAdminSetMaintenance = async () => {
    if (!adminActionAsset || !adminActionForm) return;
    setAdminActionBusy(true);
    setAdminActionError(null);
    try {
      onAdminUpdateAsset(adminActionAsset.id, {
        status: 'In Wartung',
        notes: adminActionForm.statusNote.trim()
          ? `${adminActionAsset.notes}\nWartungsnotiz: ${adminActionForm.statusNote.trim()}`.trim()
          : adminActionAsset.notes,
      });
      await alert({ title: 'In Wartung gesetzt', message: 'Das Gerät wurde in den Wartungsstatus verschoben.' });
    } finally {
      setAdminActionBusy(false);
    }
  };

  const applyAdminSetDefect = async () => {
    if (!adminActionAsset || !adminActionForm) return;
    setAdminActionBusy(true);
    setAdminActionError(null);
    try {
      onAdminUpdateAsset(adminActionAsset.id, {
        status: 'Defekt',
        notes: adminActionForm.statusNote.trim()
          ? `${adminActionAsset.notes}\nDefektnotiz: ${adminActionForm.statusNote.trim()}`.trim()
          : adminActionAsset.notes,
      });
      await alert({ title: 'Defekt markiert', message: 'Das Gerät wurde als defekt markiert.' });
    } finally {
      setAdminActionBusy(false);
    }
  };

  const applyAdminDeleteFromModal = async () => {
    if (!adminActionAsset || !adminActionForm) return;
    if (adminActionForm.deleteConfirm.trim() !== adminActionAsset.tagNumber) {
      setAdminActionError(`Zum Löschen bitte die Inventarnummer "${adminActionAsset.tagNumber}" eingeben.`);
      return;
    }
    setAdminActionBusy(true);
    setAdminActionError(null);
    try {
      await onAdminDeleteAsset(adminActionAsset.id);
      closeAdminActions();
      await alert({ title: 'Asset gelöscht', message: 'Das Gerät wurde dauerhaft gelöscht.' });
    } catch {
      setAdminActionError('Löschen fehlgeschlagen.');
    } finally {
      setAdminActionBusy(false);
    }
  };

  const openOnboarding = () => {
    setOnboardingOpen(true);
    setOnboardingError(null);
    setCreatedAsset(null);
    window.setTimeout(() => {
      nameRef.current?.focus();
    }, 10);
  };

  const closeOnboarding = () => {
    setOnboardingOpen(false);
    setOnboardingError(null);
    setCreatedAsset(null);
  };

  const resetForNext = () => {
    setCreatedAsset(null);
    setOnboardingError(null);
    setForm((current) => ({
      category: current.category,
      name: defaultNameForCategory(current.category),
      manufacturer: '',
      model: '',
      serialNumber: '',
      ipAddress: '',
      macLan: '',
      macWlan: '',
      tagNumber: '',
      location: current.location || 'Hauptlager',
      notes: '',
    }));
    window.setTimeout(() => {
      serialRef.current?.focus();
    }, 10);
  };

  const validateOnboarding = (): string | null => {
    const categoryTrimmed = form.category.trim();
    if (!categoryTrimmed) return 'Bitte eine Kategorie auswählen.';
    if (!categoryOptions.includes(categoryTrimmed)) {
      return 'Bitte eine vorhandene Kategorie aus der Liste auswählen.';
    }
    if (!form.name.trim()) return 'Bitte einen Gerätenamen eingeben.';
    if (!form.serialNumber.trim()) return 'Bitte die Seriennummer eingeben.';
    if (form.ipAddress.trim()) {
      const ipv4Pattern =
        /^(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)){3}$/;
      if (!ipv4Pattern.test(form.ipAddress.trim())) {
        return 'Bitte eine gültige IPv4-Adresse eingeben.';
      }
    }
    return null;
  };

  const submitOnboarding = async (saveAndNext: boolean) => {
    const validationError = validateOnboarding();
    if (validationError) {
      setOnboardingError(validationError);
      return;
    }
    setOnboardingSaving(true);
    setOnboardingError(null);
    try {
      const created = await onCreateAssetFromInput({
        category: form.category.trim(),
        name: form.name.trim(),
        manufacturer: form.manufacturer.trim() || undefined,
        model: form.model.trim() || undefined,
        serialNumber: form.serialNumber.trim(),
        ipAddress: form.ipAddress.trim() || undefined,
        macLan: form.macLan.trim() || undefined,
        macWlan: form.macWlan.trim() || undefined,
        tagNumber: form.tagNumber.trim() || undefined,
        location: form.location.trim() || undefined,
        notes: form.notes.trim() || undefined,
      });
      setCreatedAsset(created);
      if (saveAndNext) {
        resetForNext();
      }
    } catch (error) {
      setOnboardingError(error instanceof Error ? error.message : 'Gerät konnte nicht gespeichert werden.');
    } finally {
      setOnboardingSaving(false);
    }
  };

  return (
    <section className="space-y-5">
      <div className="surface-card animate-fade-up p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="page-kicker">Inventar</p>
            <h2 className="page-title">Gerätebestand</h2>
            <p className="page-subtitle">Bestand filtern, Zustand prüfen und Aktionen direkt ausführen.</p>
          </div>
          <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:flex-wrap">
            {canManageAssets ? (
              <button className="btn-primary w-full sm:w-auto" onClick={openOnboarding}>
                <Plus className="h-4 w-4" />
                Neues Gerät erfassen
              </button>
            ) : null}
            <button
              className="btn-secondary w-full sm:w-auto"
              onClick={() => {
                void runQuickCheckout();
              }}
            >
              Ausgeben
            </button>
            <button
              className="btn-secondary w-full sm:w-auto"
              onClick={() => {
                void runQuickCheckin();
              }}
            >
              Zurücknehmen
            </button>
            <button className="btn-secondary w-full sm:w-auto" onClick={() => onNavigate('tickets')}>
              <TriangleAlert className="h-4 w-4" />
              Defekt melden
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <div className="surface-muted px-3 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Gesamt</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{assets.length}</p>
          </div>
          <div className="surface-muted px-3 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">Verfügbar</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{availableCount}</p>
          </div>
          <div className="surface-muted px-3 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">Verliehen / Wartung</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{loanedCount + attentionCount}</p>
          </div>
        </div>
      </div>

      <article className="surface-card animate-fade-up">
        <div className={`grid gap-3 ${isMobile ? 'grid-cols-1' : 'md:grid-cols-6 xl:grid-cols-12'}`}>
          <div className={`relative ${isMobile ? '' : 'md:col-span-3 xl:col-span-4'}`}>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Suche nach Asset, Inventarnummer oder Seriennummer"
              className="field-input w-full pl-9"
            />
          </div>
          <select value={category} onChange={(event) => setCategory(event.target.value)} className={`field-input ${isMobile ? 'h-11' : 'md:col-span-1 xl:col-span-2'}`}>
            {categories.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <select value={location} onChange={(event) => setLocation(event.target.value)} className={`field-input ${isMobile ? 'h-11' : 'md:col-span-1 xl:col-span-2'}`}>
            {locations.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <select value={status} onChange={(event) => setStatus(event.target.value)} className={`field-input ${isMobile ? 'h-11' : 'md:col-span-1 xl:col-span-2'}`}>
            {statuses.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <div className={`flex items-center gap-2 ${isMobile ? '' : 'md:col-span-1 xl:col-span-2'}`}>
            <button className="btn-secondary h-10 px-3 text-sm" onClick={resetFilters}>
              <Filter className="h-4 w-4" />
              Reset
            </button>
            <button
              className="btn-secondary h-10 px-3 text-sm"
              onClick={() => {
                void openByQrOrTag();
              }}
            >
              <ScanLine className="h-4 w-4" />
              QR
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
          <label className="inline-flex items-center gap-2 text-slate-600">
            <input
              type="checkbox"
              checked={onlyAvailable}
              onChange={(event) => setOnlyAvailable(event.target.checked)}
              className="rounded border-slate-300"
            />
            Nur verfügbare Assets
          </label>
          <label className="inline-flex items-center gap-2 text-slate-600">
            <input
              type="checkbox"
              checked={onlyBroken}
              onChange={(event) => setOnlyBroken(event.target.checked)}
              className="rounded border-slate-300"
            />
            Nur defekte Assets
          </label>
          <button
            type="button"
            className="btn-secondary px-2.5 py-1.5 text-xs"
            onClick={() => setShowTechnicalColumns((prev) => !prev)}
          >
            {showTechnicalColumns ? 'Technische Daten ausblenden' : 'Technische Daten anzeigen'}
          </button>
          <p className="text-slate-500">{filteredAssets.length} Treffer</p>
        </div>

        {canManageAssets ? (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/70">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={toggleSelectAllVisible}>
                  {filteredAssets.length > 0 && filteredAssets.every((asset) => selectedIds.includes(asset.id))
                    ? 'Auswahl aufheben'
                    : 'Alle sichtbaren auswählen'}
                </button>
                <span className="text-xs text-slate-600">{selectedIds.length} markiert</span>
              </div>
              <button
                type="button"
                className="btn-secondary px-2 py-1 text-xs"
                disabled={selectedIds.length < 2}
                onClick={openBulkModal}
              >
                Bulk-Aktionen
              </button>
            </div>
          </div>
        ) : null}

        <div className={`mt-4 ${isMobile ? 'hidden' : 'hidden lg:block'}`}>
          <div
            className={`soft-scrollbar relative max-h-[68vh] rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950 ${
              showTechnicalColumns ? 'overflow-auto' : 'overflow-y-auto overflow-x-hidden'
            }`}
          >
          <table
            className={`w-full border-collapse text-sm ${
              showTechnicalColumns
                ? 'w-[max(100%,1600px)] min-w-[1600px]'
                : 'w-full table-fixed'
            }`}
          >
            {!showTechnicalColumns ? (
              <colgroup>
                {canManageAssets ? <col style={{ width: '56px' }} /> : null}
                <col style={{ width: '30%' }} />
                <col style={{ width: '18%' }} />
                <col style={{ width: '20%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '20%' }} />
              </colgroup>
            ) : null}
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-600 dark:text-slate-400">
                {canManageAssets ? <th className="sticky top-0 z-20 border-b border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900">Auswahl</th> : null}
                <th className="sticky top-0 z-20 border-b border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900">Name</th>
                <th className="sticky top-0 z-20 border-b border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900">Kategorie</th>
                {showTechnicalColumns ? <th className="sticky top-0 z-20 border-b border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900">Modell</th> : null}
                {showTechnicalColumns ? <th className="sticky top-0 z-20 border-b border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900">Seriennummer</th> : null}
                {showTechnicalColumns ? <th className="sticky top-0 z-20 border-b border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900">IP-Adresse</th> : null}
                {showTechnicalColumns ? <th className="sticky top-0 z-20 border-b border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900">MAC LAN</th> : null}
                {showTechnicalColumns ? <th className="sticky top-0 z-20 border-b border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900">MAC WLAN</th> : null}
                {showTechnicalColumns ? <th className="sticky top-0 z-20 border-b border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900">QR / Asset-ID</th> : null}
                <th className="sticky top-0 z-20 border-b border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900">Zugewiesen an</th>
                <th className={`sticky top-0 z-20 border-b border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900 ${showTechnicalColumns ? 'min-w-[160px]' : 'min-w-[140px]'}`}>Status</th>
                <th
                  className={`top-0 z-30 border-b border-l border-slate-200 bg-slate-50 px-3 py-2.5 text-right dark:border-slate-800 dark:bg-slate-900 ${
                    showTechnicalColumns
                      ? 'sticky right-0 min-w-[420px] shadow-[-8px_0_10px_-10px_rgba(15,23,42,0.5)]'
                      : 'sticky min-w-[240px]'
                  }`}
                >
                  Aktion
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredAssets.map((asset, rowIndex) => (
                <tr key={asset.id} className="border-b border-slate-100 bg-white text-slate-800 hover:bg-sky-50/40 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800/70">
                  {canManageAssets ? (
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(asset.id)}
                        onChange={(event) =>
                          toggleSelected(asset.id, rowIndex, Boolean((event.nativeEvent as MouseEvent).shiftKey))
                        }
                        className="rounded border-slate-300"
                      />
                    </td>
                  ) : null}
                  <td className="px-3 py-3">
                    <p className="max-w-[220px] truncate font-semibold text-slate-900 dark:text-slate-100" title={asset.name}>{asset.name}</p>
                  </td>
                  <td className="px-3 py-3">
                    {asset.category === 'Zuordnung erforderlich' && canManageAssets ? (
                      <select
                        defaultValue=""
                        className="rounded border border-amber-400 bg-amber-50 px-2 py-1 text-sm text-amber-900"
                        onChange={(e) => {
                          if (e.target.value) onAdminUpdateAsset(asset.id, { category: e.target.value });
                        }}
                      >
                        <option value="" disabled>Kategorie wählen…</option>
                        {DEFAULT_CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="inline-block max-w-[140px] truncate align-bottom" title={asset.category}>{asset.category}</span>
                    )}
                  </td>
                  {showTechnicalColumns ? (
                    <td className="px-3 py-3">
                      <span className="inline-block max-w-[120px] truncate align-bottom" title={asset.model || '-'}>{asset.model || '-'}</span>
                    </td>
                  ) : null}
                  {showTechnicalColumns ? (
                    <td className="px-3 py-3">
                      <span className="inline-block max-w-[140px] truncate align-bottom" title={asset.serialNumber}>{asset.serialNumber}</span>
                    </td>
                  ) : null}
                  {showTechnicalColumns ? (
                    <td className="px-3 py-3">
                      <span className="inline-block max-w-[110px] truncate align-bottom" title={asset.ipAddress || '-'}>{asset.ipAddress || '-'}</span>
                    </td>
                  ) : null}
                  {showTechnicalColumns ? (
                    <td className="px-3 py-3">
                      <span className="inline-block max-w-[130px] truncate align-bottom font-mono text-xs" title={asset.macLan || '-'}>{asset.macLan || '-'}</span>
                    </td>
                  ) : null}
                  {showTechnicalColumns ? (
                    <td className="px-3 py-3">
                      <span className="inline-block max-w-[130px] truncate align-bottom font-mono text-xs" title={asset.macWlan || '-'}>{asset.macWlan || '-'}</span>
                    </td>
                  ) : null}
                  {showTechnicalColumns ? (
                    <td className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400">
                      <span className="inline-block max-w-[150px] truncate align-bottom" title={asset.qrCode || asset.tagNumber}>{asset.qrCode || asset.tagNumber}</span>
                    </td>
                  ) : null}
                  <td className="px-3 py-3">
                    <span className="inline-block max-w-[170px] truncate align-bottom" title={asset.assignedTo}>{asset.assignedTo}</span>
                  </td>
                  <td className={`whitespace-nowrap px-3 py-3 ${showTechnicalColumns ? 'min-w-[160px]' : ''}`}>
                    <StatusBadge value={asset.status} />
                  </td>
                  <td
                    className={`z-10 border-l border-slate-100 bg-white px-3 py-3 text-right dark:border-slate-800 dark:bg-slate-900 ${
                      showTechnicalColumns
                        ? 'sticky right-0 min-w-[420px] shadow-[-8px_0_10px_-10px_rgba(15,23,42,0.35)]'
                        : 'min-w-[240px]'
                    }`}
                  >
                    <div className="flex flex-nowrap items-center justify-end gap-2 whitespace-nowrap">
                      <button
                        type="button"
                        className="btn-danger shrink-0 px-2 py-1 text-xs"
                        onClick={() =>
                          onCreateMaintenance({
                            assetName: asset.name,
                            issue: 'Gerät defekt',
                            comment: '',
                          })
                        }
                      >
                        Defekt
                      </button>
                      <button
                        type="button"
                        className="btn-ghost shrink-0 px-2 py-1 text-xs"
                        onClick={() => setQuickViewId(asset.id)}
                        title="Schnellansicht"
                        aria-label="Schnellansicht"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" className="btn-primary shrink-0 px-2 py-1 text-xs" onClick={() => onOpenDetail(asset.id)}>
                        Detail
                      </button>
                      {canManageAssets ? (
                        <button type="button" className="btn-ghost shrink-0 px-2 py-1 text-xs" onClick={() => openAdminActions(asset)}>
                          <Settings2 className="h-3.5 w-3.5" />
                          Admin
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>

        <div className={`mt-4 grid gap-3 ${isMobile ? '' : 'lg:hidden'}`}>
          {filteredAssets.map((asset) => (
            <article key={asset.id} className="surface-muted p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">{asset.name}</h4>
                  <p className="text-xs text-slate-500 break-words">
                    {asset.category === 'Zuordnung erforderlich' && canManageAssets ? (
                      <select
                        defaultValue=""
                        className="rounded border border-amber-400 bg-amber-50 px-1.5 py-0.5 text-xs text-amber-900"
                        onChange={(e) => {
                          if (e.target.value) onAdminUpdateAsset(asset.id, { category: e.target.value });
                        }}
                      >
                        <option value="" disabled>Kategorie wählen…</option>
                        {DEFAULT_CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                    ) : (
                      asset.category
                    )}{' '}
                    • {asset.location}
                  </p>
                </div>
                <StatusBadge value={asset.status} />
              </div>
              <div className="mt-3 grid grid-cols-[1fr_auto] items-center gap-2">
                <p className="text-xs text-slate-500 break-all">ID: {asset.tagNumber}</p>
                <button type="button" className="btn-primary min-h-[44px] px-3 py-2 text-xs" onClick={() => setQuickViewId(asset.id)}>
                  Schnellansicht
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-500 break-all">SN: {asset.serialNumber || '-'}</p>
              <p className="mt-1 text-xs text-slate-500 break-all">MAC LAN: {asset.macLan || '-'}</p>
              <button
                type="button"
                className="btn-danger mt-2 min-h-[44px] w-full px-3 py-2 text-xs"
                onClick={() =>
                  onCreateMaintenance({
                    assetName: asset.name,
                    issue: 'Gerät defekt',
                    comment: '',
                  })
                }
              >
                Defekt für dieses Asset
              </button>
              {canManageAssets ? (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className="btn-secondary min-h-[44px] w-full px-3 py-2 text-xs"
                    onClick={() => {
                      openAdminActions(asset);
                    }}
                  >
                    Admin-Tools
                  </button>
                  <button
                    type="button"
                    className="btn-danger min-h-[44px] w-full px-3 py-2 text-xs"
                    onClick={() => {
                      void runAdminDeleteAsset(asset);
                    }}
                  >
                    Löschen
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </article>

      <AssetQuickView
        asset={quickViewAsset}
        onClose={() => setQuickViewId(null)}
        onOpenDetail={onOpenDetail}
        onReserve={onReserveAsset}
        onCheckout={onCheckoutAsset}
      />

      {canManageAssets && adminActionAsset && adminActionForm ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/55 p-3 sm:items-center">
          <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-panel sm:p-5">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">Admin / Techniker</p>
                <h3 className="text-lg font-semibold text-slate-900">Admin-Aktionen für {adminActionAsset.name}</h3>
                <p className="text-xs text-slate-500">Inventarnummer {adminActionAsset.tagNumber}</p>
              </div>
              <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={closeAdminActions}>
                Schließen
              </button>
            </div>

            {adminActionError ? (
              <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {adminActionError}
              </div>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <h4 className="text-sm font-semibold text-slate-900">Status & Verfügbarkeit</h4>
                  <div className="mt-2 grid gap-2">
                    <label className="field">
                      Status ändern
                      <select
                        className="field-input"
                        value={adminActionForm.status}
                        onChange={(event) =>
                          setAdminActionForm((current) => (current ? { ...current, status: event.target.value as Asset['status'] } : current))
                        }
                      >
                        <option value="Verfügbar">Verfügbar</option>
                        <option value="Verliehen">Verliehen</option>
                        <option value="In Wartung">In Wartung</option>
                        <option value="Defekt">Defekt</option>
                      </select>
                    </label>
                    <label className="field">
                      Notiz (optional)
                      <textarea
                        className="field-input min-h-[84px]"
                        value={adminActionForm.statusNote}
                        onChange={(event) =>
                          setAdminActionForm((current) => (current ? { ...current, statusNote: event.target.value } : current))
                        }
                      />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="btn-secondary text-xs" disabled={adminActionBusy} onClick={() => void applyAdminStatus()}>
                        Status speichern
                      </button>
                      <button type="button" className="btn-secondary text-xs" disabled={adminActionBusy} onClick={() => void applyAdminSetMaintenance()}>
                        In Wartung setzen
                      </button>
                      <button type="button" className="btn-danger text-xs" disabled={adminActionBusy} onClick={() => void applyAdminSetDefect()}>
                        Defekt setzen
                      </button>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <h4 className="text-sm font-semibold text-slate-900">Zuordnung & Korrektur</h4>
                  <div className="mt-2 grid gap-2">
                    <label className="field">
                      Person / Team
                      <input
                        className="field-input"
                        value={adminActionForm.assignee}
                        onChange={(event) =>
                          setAdminActionForm((current) => (current ? { ...current, assignee: event.target.value } : current))
                        }
                      />
                    </label>
                    <label className="field">
                      Projektkontext
                      <input
                        className="field-input"
                        value={adminActionForm.projectName}
                        onChange={(event) =>
                          setAdminActionForm((current) => (current ? { ...current, projectName: event.target.value } : current))
                        }
                      />
                    </label>
                    <label className="field">
                      Rückgabeziel
                      <input
                        className="field-input"
                        placeholder="z. B. 2026-05-01"
                        value={adminActionForm.dueDate}
                        onChange={(event) =>
                          setAdminActionForm((current) => (current ? { ...current, dueDate: event.target.value } : current))
                        }
                      />
                    </label>
                    <label className="field">
                      Korrekturnotiz
                      <textarea
                        className="field-input min-h-[84px]"
                        value={adminActionForm.assignmentNote}
                        onChange={(event) =>
                          setAdminActionForm((current) => (current ? { ...current, assignmentNote: event.target.value } : current))
                        }
                      />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="btn-secondary text-xs" disabled={adminActionBusy} onClick={() => void applyAdminAssignment()}>
                        Zuordnung speichern
                      </button>
                      <button type="button" className="btn-secondary text-xs" disabled={adminActionBusy} onClick={() => void applyAdminReset()}>
                        Reset auf verfügbar
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <h4 className="text-sm font-semibold text-slate-900">Buchungskorrektur</h4>
                  <div className="mt-2 grid gap-2">
                    <label className="field">
                      Korrekturhinweis
                      <textarea
                        className="field-input min-h-[96px]"
                        placeholder="z. B. falsches Projekt bei Ausgabe"
                        value={adminActionForm.correctionNote}
                        onChange={(event) =>
                          setAdminActionForm((current) => (current ? { ...current, correctionNote: event.target.value } : current))
                        }
                      />
                    </label>
                    <button type="button" className="btn-secondary text-xs" disabled={adminActionBusy} onClick={() => void applyAdminProjectCorrection()}>
                      Projekt/Buchung korrigieren
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                  <h4 className="text-sm font-semibold text-rose-800">Verwaltung (destruktiv)</h4>
                  <p className="mt-1 text-xs text-rose-700">
                    Für Löschen bitte die Inventarnummer zur Bestätigung eingeben.
                  </p>
                  <label className="field mt-2">
                    Inventarnummer bestätigen
                    <input
                      className="field-input border-rose-200"
                      placeholder={adminActionAsset.tagNumber}
                      value={adminActionForm.deleteConfirm}
                      onChange={(event) =>
                        setAdminActionForm((current) => (current ? { ...current, deleteConfirm: event.target.value } : current))
                      }
                    />
                  </label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" className="btn-secondary text-xs" onClick={() => onOpenDetail(adminActionAsset.id)}>
                      Asset bearbeiten
                    </button>
                    <button type="button" className="btn-danger text-xs" disabled={adminActionBusy} onClick={() => void applyAdminDeleteFromModal()}>
                      <Trash2 className="h-3.5 w-3.5" />
                      Asset löschen
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-white pt-3">
              <button type="button" className="btn-secondary" onClick={closeAdminActions}>
                Schließen
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {canManageAssets && bulkModalOpen ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/55 p-3 sm:items-center">
          <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-panel sm:p-5">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">Admin / Techniker</p>
                <h3 className="text-lg font-semibold text-slate-900">Bulk-Aktionen</h3>
                <p className="text-xs text-slate-500">{selectedIds.length} ausgewählte Geräte</p>
              </div>
              <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={closeBulkModal}>
                Schließen
              </button>
            </div>

            {bulkActionError ? (
              <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {bulkActionError}
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <h4 className="text-sm font-semibold text-slate-900">Status & Verfügbarkeit</h4>
                <div className="mt-2 grid gap-2">
                  <label className="field">
                    Status
                    <select
                      className="field-input"
                      value={bulkForm.status}
                      onChange={(event) =>
                        setBulkForm((current) => ({ ...current, status: event.target.value as Asset['status'] | '' }))
                      }
                    >
                      <option value="">Status unverändert</option>
                      <option value="Verfügbar">Auf verfügbar setzen</option>
                      <option value="Verliehen">Als verliehen markieren</option>
                      <option value="In Wartung">In Wartung setzen</option>
                      <option value="Defekt">Defekt markieren</option>
                    </select>
                  </label>
                  <button type="button" className="btn-secondary text-xs" disabled={bulkActionBusy} onClick={() => void applyBulkUpdate()}>
                    Status anwenden
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <h4 className="text-sm font-semibold text-slate-900">Stammdaten</h4>
                <div className="mt-2 grid gap-2">
                  <label className="field">
                    Kategorie
                    <input
                      list="bulk-category-options"
                      className="field-input"
                      placeholder="unverändert"
                      value={bulkForm.category}
                      onChange={(event) => setBulkForm((current) => ({ ...current, category: event.target.value }))}
                    />
                    <datalist id="bulk-category-options">
                      {categoryOptions.map((item) => (
                        <option key={item} value={item} />
                      ))}
                    </datalist>
                  </label>
                  <label className="field">
                    Standort
                    <input
                      className="field-input"
                      placeholder="unverändert"
                      value={bulkForm.location}
                      onChange={(event) => setBulkForm((current) => ({ ...current, location: event.target.value }))}
                    />
                  </label>
                  <button type="button" className="btn-secondary text-xs" disabled={bulkActionBusy} onClick={() => void applyBulkUpdate()}>
                    Stammdaten anwenden
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 md:col-span-2">
                <h4 className="text-sm font-semibold text-rose-800">Verwaltung (destruktiv)</h4>
                <p className="mt-1 text-xs text-rose-700">
                  Für Bulk-Löschen bitte <span className="font-semibold">LÖSCHEN</span> eingeben.
                </p>
                <label className="field mt-2">
                  Bestätigung
                  <input
                    className="field-input border-rose-200"
                    placeholder="LÖSCHEN"
                    value={bulkForm.deleteConfirm}
                    onChange={(event) => setBulkForm((current) => ({ ...current, deleteConfirm: event.target.value }))}
                  />
                </label>
                <button type="button" className="btn-danger mt-2 text-xs" disabled={bulkActionBusy} onClick={() => void applyBulkDelete()}>
                  <Trash2 className="h-3.5 w-3.5" />
                  {selectedIds.length} Geräte löschen
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {onboardingOpen ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/55 p-3 sm:items-center">
          <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-panel sm:p-5">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">Admin / Techniker</p>
                <h3 className="text-lg font-semibold text-slate-900">Neue Hardware erfassen</h3>
                <p className="text-xs text-slate-500">Mobile-Flow: Daten erfassen, speichern, QR-Code aufkleben.</p>
              </div>
              <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={closeOnboarding}>
                Schließen
              </button>
            </div>

            {onboardingError ? (
              <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {onboardingError}
              </div>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <h4 className="text-sm font-semibold text-slate-900">Grunddaten</h4>
                  <div className="mt-2 grid gap-2">
                    <label className="field">
                      Kategorie *
                      <select
                        className="field-input"
                        value={form.category}
                        onChange={(event) => {
                          const nextCategory = event.target.value;
                          setForm((current) => {
                            const suggestedName = defaultNameForCategory(nextCategory);
                            return {
                              ...current,
                              category: nextCategory,
                              name: current.name.trim() ? current.name : suggestedName,
                            };
                          });
                          window.setTimeout(() => {
                            nameRef.current?.focus();
                          }, 10);
                        }}
                      >
                        {categoryOptions.map((item) => (
                          <option key={item} value={item} />
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      Gerätename *
                      <input
                        ref={nameRef}
                        className="field-input"
                        value={form.name}
                        onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                      />
                    </label>
                    <label className="field">
                      Hersteller
                      <input
                        className="field-input"
                        value={form.manufacturer}
                        onChange={(event) => setForm((current) => ({ ...current, manufacturer: event.target.value }))}
                      />
                    </label>
                    <label className="field">
                      Modell
                      <input
                        className="field-input"
                        value={form.model}
                        onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))}
                      />
                    </label>
                    <label className="field">
                      IP-Adresse
                      <input
                        className="field-input"
                        placeholder="z. B. 192.168.10.141"
                        value={form.ipAddress}
                        onChange={(event) => setForm((current) => ({ ...current, ipAddress: event.target.value }))}
                      />
                    </label>
                    <label className="field">
                      MAC-Adresse LAN
                      <input
                        className="field-input"
                        placeholder="z. B. 90-2E-16-19-CF-24"
                        value={form.macLan}
                        onChange={(event) => setForm((current) => ({ ...current, macLan: event.target.value }))}
                      />
                    </label>
                    <label className="field">
                      MAC-Adresse WLAN
                      <input
                        className="field-input"
                        placeholder="z. B. F4-4E-E3-96-DC-E6"
                        value={form.macWlan}
                        onChange={(event) => setForm((current) => ({ ...current, macWlan: event.target.value }))}
                      />
                    </label>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <h4 className="text-sm font-semibold text-slate-900">Identifikation</h4>
                  <div className="mt-2 grid gap-2">
                    <label className="field">
                      Seriennummer *
                      <input
                        ref={serialRef}
                        className="field-input"
                        value={form.serialNumber}
                        onChange={(event) => setForm((current) => ({ ...current, serialNumber: event.target.value }))}
                      />
                      <button
                        type="button"
                        disabled
                        className="btn-secondary mt-1 justify-start px-2 py-1 text-xs opacity-70"
                      >
                        Seriennummer scannen (bald)
                      </button>
                    </label>
                    <label className="field">
                      Inventarnummer (optional)
                      <input
                        className="field-input"
                        placeholder="leer lassen = automatisch"
                        value={form.tagNumber}
                        onChange={(event) => setForm((current) => ({ ...current, tagNumber: event.target.value }))}
                      />
                    </label>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <h4 className="text-sm font-semibold text-slate-900">Zusatzinfos</h4>
                  <div className="mt-2 grid gap-2">
                    <label className="field">
                      Standort
                      <input
                        className="field-input"
                        value={form.location}
                        onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))}
                      />
                    </label>
                    <label className="field">
                      Notizen
                      <textarea
                        className="field-input min-h-[90px]"
                        value={form.notes}
                        onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                      />
                    </label>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="rounded-xl border border-brand-200 bg-brand-50 p-3">
                  <p className="text-sm font-semibold text-brand-900">Schneller Erfassungsmodus</p>
                  <p className="mt-1 text-xs text-brand-800">
                    Für mehrere gleiche Geräte: Kategorie bleibt erhalten, Seriennummern nacheinander erfassen.
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <QrCode className="h-4 w-4 text-brand-700" />
                    QR-Code Vorschau nach Speicherung
                  </p>
                  {createdAsset ? (
                    <div className="mt-3 space-y-3">
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                        Gerät erfolgreich angelegt: <span className="font-semibold">{createdAsset.name}</span>
                      </div>
                      <AssetQrCard
                        qrValue={getAssetQrCode(createdAsset)}
                        assetName={createdAsset.name}
                        tagNumber={createdAsset.tagNumber}
                      />
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className="btn-secondary" onClick={() => onOpenDetail(createdAsset.id)}>
                          QR-Code anzeigen
                        </button>
                        <button type="button" className="btn-secondary" onClick={closeOnboarding}>
                          Fertig
                        </button>
                        <button type="button" className="btn-primary" onClick={resetForNext}>
                          Nächstes Gerät erfassen
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-slate-500">
                      Nach dem Speichern wird der eindeutige QR-Code automatisch erzeugt und angezeigt.
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-white pt-3">
              <button type="button" className="btn-secondary" onClick={closeOnboarding}>
                Abbrechen
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  void submitOnboarding(true);
                }}
                disabled={onboardingSaving}
              >
                Speichern & nächstes Gerät
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  void submitOnboarding(false);
                }}
                disabled={onboardingSaving}
              >
                {onboardingSaving ? 'Speichern...' : 'Speichern'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

