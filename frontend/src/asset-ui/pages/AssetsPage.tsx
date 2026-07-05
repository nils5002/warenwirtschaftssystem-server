import {
  Boxes,
  Eye,
  Filter,
  Handshake,
  PackageSearch,
  Plus,
  QrCode,
  RefreshCcw,
  ScanLine,
  Search,
  Settings2,
  ShieldAlert,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppDialog } from '../../components/dialogs/AppDialogProvider';
import { InlineLoadingState, LoadingButton } from '../../components/loading';
import { AssetQuickView } from '../components/AssetQuickView';
import { AssetImage } from '../components/AssetImage';
import { AssetQrCard } from '../components/AssetQrCard';
import { AssetQrCodePreview } from '../components/AssetQrCodePreview';
import { KpiCard } from '../components/KpiCard';
import { getAssetQrCode } from '../qr';
import { StatusBadge } from '../components/StatusBadge';
import { PageHeader, ToggleSwitch } from '../../ui';
import type { AppPage, Asset, CategoryItem } from '../types';

type AssetsPageProps = {
  assets: Asset[];
  // Backend-Kategorien (Stammdaten). Damit erscheinen im Onboarding-Dropdown
  // auch frisch angelegte Kategorien, die noch keinem Asset zugeordnet sind.
  categories?: CategoryItem[];
  isMobile?: boolean;
  canManageAssets?: boolean;
  initialSearch?: string;
  // Statusfilter für einen Deep-Link (z. B. Dashboard-Kachel). Wird einmalig
  // als Startwert übernommen und über onInitialStatusConsumed wieder geleert.
  initialStatus?: string;
  onInitialStatusConsumed?: () => void;
  // True solange der erste Overview-Call noch läuft. Wenn true, zeigt die
  // Seite Skeleton-Platzhalter ("—") in den Statuskacheln an, statt
  // irreführend "0" auszugeben.
  isInitialLoading?: boolean;
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
    // Planungsrelevante Asset-Flags (analog CreateAssetInput im Controller).
    cardPrinterCompatible?: boolean;
    availableForPlanning?: boolean;
  }) => Promise<Asset>;
  onReserveAsset: (assetId: string) => void;
  onCheckoutAsset: (assetId: string) => void;
  // Wird von WmsPageView weiterhin übergeben, aktuell aber nicht genutzt:
  // Rücknahmen laufen bewusst nur über die Ein-/Auslagerung (Scan-Flow).
  onCheckinAsset?: (assetId: string) => void;
  onAdminUpdateAsset: (assetId: string, patch: Partial<Asset>) => void;
  onAdminDeleteAsset: (assetId: string) => Promise<void>;
  onCreateMaintenance: (payload: { assetName: string; issue: string; comment: string }) => void;
  onCleanupUnusedLocations: () => Promise<{
    keptLocation: string;
    deletedLocations: string[];
    skippedLocations: string[];
  }>;
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
const MAIN_WAREHOUSE_NAME = 'Hauptlager';

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

function getOwnershipLabel(type?: Asset['ownershipType']): string | null {
  if (!type || type === 'owned') return null;
  if (type === 'rented') return 'Miete';
  if (type === 'borrowed') return 'Leihe';
  return 'Extern';
}

function formatRatio(part: number, total: number): string {
  if (total <= 0) return '0,0';
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
    (part / total) * 100,
  );
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
  productImageSourceUrl: string;
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
    productImageSourceUrl: '',
    deleteConfirm: '',
  };
}

export function AssetsPage({
  assets,
  categories: backendCategories = [],
  isMobile = false,
  canManageAssets = true,
  initialSearch,
  initialStatus,
  onInitialStatusConsumed,
  isInitialLoading = false,
  onOpenDetail,
  onCreateAsset,
  onCreateAssetFromInput,
  onReserveAsset,
  onCheckoutAsset,
  onAdminUpdateAsset,
  onAdminDeleteAsset,
  onCreateMaintenance,
  onCleanupUnusedLocations,
  onNavigate,
}: AssetsPageProps) {
  const { prompt, alert, confirm } = useAppDialog();
  const naturalSort = useMemo(() => new Intl.Collator('de', { numeric: true, sensitivity: 'base' }), []);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const serialRef = useRef<HTMLInputElement | null>(null);

  const [search, setSearch] = useState(initialSearch ?? '');
  const [category, setCategory] = useState('Alle Kategorien');
  const [location, setLocation] = useState('Alle Standorte');
  const [status, setStatus] = useState(initialStatus ?? 'Alle Status');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [onlyBroken, setOnlyBroken] = useState(false);
  const [showTechnicalColumns, setShowTechnicalColumns] = useState(false);
  const [quickViewId, setQuickViewId] = useState<string | null>(null);
  // Verzögerte QR-Vorschau per Hover (nur Desktop/Maus). Wird nach 3 s gefüllt.
  const [hoverPreview, setHoverPreview] = useState<{ asset: Asset; left: number; top: number } | null>(null);
  const hoverOpenTimerRef = useRef<number | null>(null);
  const hoverCloseTimerRef = useRef<number | null>(null);
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
    cardPrinterCompatible: true,
    availableForPlanning: true,
  });

  // Deep-Link-Status nur als Startwert nutzen und sofort im Controller leeren,
  // damit ein späterer regulärer Inventar-Aufruf wieder "Alle Status" zeigt.
  // Manuelle Statuswechsel des Nutzers bleiben davon unberührt.
  useEffect(() => {
    if (initialStatus) onInitialStatusConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categories = ['Alle Kategorien', ...new Set(assets.map((asset) => asset.category))];
  const locations = ['Alle Standorte', ...new Set(assets.map((asset) => asset.location))];
  const statuses = ['Alle Status', ...new Set(assets.map((asset) => asset.status))];
  const categoryOptions = useMemo(() => {
    // DEFAULT_CATEGORIES als Fallback, falls die Backend-Kategorien noch
    // nicht geladen sind. Aktive Backend-Kategorien sorgen dafür, dass neu
    // angelegte Stammdaten sofort wählbar sind — auch ohne zugeordnetes
    // Asset. Asset-Kategorien decken Altbestand/abweichende Schreibweisen ab.
    const backendNames = backendCategories
      .filter((item) => item.isActive !== false)
      .map((item) => item.name.trim())
      .filter(Boolean);
    return [
      ...new Set([
        ...DEFAULT_CATEGORIES,
        ...backendNames,
        ...assets.map((asset) => asset.category).filter(Boolean),
      ]),
    ];
  }, [assets, backendCategories]);

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
  const selectedAssets = useMemo(() => assets.filter((asset) => selectedIds.includes(asset.id)), [assets, selectedIds]);

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

  // --- Verzögerte QR-Vorschau per Hover (Desktop/Maus) ---------------------
  const POPOVER_WIDTH = 224; // px, muss zur Popover-Breite (w-56) passen
  const POPOVER_HEIGHT = 240; // px, grobe Höhe fürs vertikale Clamping

  const clearHoverTimers = () => {
    if (hoverOpenTimerRef.current !== null) {
      window.clearTimeout(hoverOpenTimerRef.current);
      hoverOpenTimerRef.current = null;
    }
    if (hoverCloseTimerRef.current !== null) {
      window.clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
  };

  const handleNameHoverEnter = (asset: Asset, event: React.MouseEvent<HTMLElement>) => {
    clearHoverTimers();
    const el = event.currentTarget;
    hoverOpenTimerRef.current = window.setTimeout(() => {
      const rect = el.getBoundingClientRect();
      const gap = 8;
      let left = rect.right + gap;
      if (left + POPOVER_WIDTH > window.innerWidth - 8) {
        left = rect.left - POPOVER_WIDTH - gap; // klappt nach links, wenn rechts kein Platz
      }
      left = Math.max(8, left);
      let top = rect.top;
      if (top + POPOVER_HEIGHT > window.innerHeight - 8) {
        top = window.innerHeight - POPOVER_HEIGHT - 8;
      }
      top = Math.max(8, top);
      setHoverPreview({ asset, left, top });
    }, 3000);
  };

  const handleNameHoverLeave = () => {
    if (hoverOpenTimerRef.current !== null) {
      window.clearTimeout(hoverOpenTimerRef.current);
      hoverOpenTimerRef.current = null;
    }
    // Kurze Gnadenfrist, damit die Maus ins Popover wandern kann.
    hoverCloseTimerRef.current = window.setTimeout(() => {
      setHoverPreview(null);
    }, 120);
  };

  // Escape schließt die Vorschau; Timer-Cleanup verhindert setState-after-unmount.
  useEffect(() => {
    if (!hoverPreview) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        clearHoverTimers();
        setHoverPreview(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hoverPreview]);

  useEffect(() => () => clearHoverTimers(), []);

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
    if (!bulkForm.status && !bulkForm.category.trim() && !bulkForm.location.trim() && !bulkForm.productImageSourceUrl.trim()) {
      setBulkActionError('Bitte Status, Kategorie, Standort oder Produktbild setzen.');
      return;
    }
    setBulkActionBusy(true);
    setBulkActionError(null);
    try {
      for (const assetId of selectedIds) {
        // eslint-disable-next-line no-await-in-loop
        await onAdminUpdateAsset(assetId, {
          ...(bulkForm.status ? { status: bulkForm.status } : {}),
          ...(bulkForm.category.trim() ? { category: bulkForm.category.trim() } : {}),
          ...(bulkForm.location.trim() ? { location: bulkForm.location.trim() } : {}),
          ...(bulkForm.productImageSourceUrl.trim() ? { productImageSourceUrl: bulkForm.productImageSourceUrl.trim() } : {}),
        });
      }
      closeBulkModal();
      setSelectedIds([]);
      await alert({ title: 'Bulk-Update', message: 'Die markierten Assets wurden aktualisiert.' });
    } catch {
      setBulkActionError('Bulk-Update fehlgeschlagen.');
    } finally {
      setBulkActionBusy(false);
    }
  };

  const removeBulkProductImage = async () => {
    if (!selectedIds.length) return;
    const accepted = await confirm({
      title: 'Produktbild entfernen',
      message: `Produktbild für ${selectedIds.length} ausgewählte Geräte entfernen?`,
      confirmLabel: 'Entfernen',
      cancelLabel: 'Abbrechen',
      tone: 'danger',
    });
    if (!accepted) return;
    setBulkActionBusy(true);
    setBulkActionError(null);
    try {
      for (const assetId of selectedIds) {
        // eslint-disable-next-line no-await-in-loop
        await onAdminUpdateAsset(assetId, { productImageSourceUrl: null });
      }
      closeBulkModal();
      setSelectedIds([]);
      await alert({ title: 'Produktbild entfernt', message: 'Die Produktbilder der markierten Assets wurden entfernt.' });
    } catch {
      setBulkActionError('Produktbild konnte nicht entfernt werden.');
    } finally {
      setBulkActionBusy(false);
    }
  };

  const moveSelectionToMainWarehouse = async (cleanupAfter = false) => {
    if (!selectedIds.length) return;
    setBulkActionBusy(true);
    setBulkActionError(null);
    try {
      for (const assetId of selectedIds) {
        // eslint-disable-next-line no-await-in-loop
        await onAdminUpdateAsset(assetId, { location: MAIN_WAREHOUSE_NAME });
      }
      let cleanupSummary = '';
      if (cleanupAfter) {
        const cleanup = await onCleanupUnusedLocations();
        cleanupSummary = cleanup.deletedLocations.length
          ? ` ${cleanup.deletedLocations.length} ungenutzte Standorte wurden entfernt.`
          : ' Es wurden keine weiteren ungenutzten Standorte gefunden.';
      }
      closeBulkModal();
      setSelectedIds([]);
      await alert({
        title: 'Hauptlager gesetzt',
        message: `Die markierten Assets liegen jetzt im ${MAIN_WAREHOUSE_NAME}.${cleanupSummary}`,
      });
    } catch {
      setBulkActionError(`Standortwechsel nach ${MAIN_WAREHOUSE_NAME} fehlgeschlagen.`);
    } finally {
      setBulkActionBusy(false);
    }
  };

  const cleanupLocationsOnly = async () => {
    setBulkActionBusy(true);
    setBulkActionError(null);
    try {
      const cleanup = await onCleanupUnusedLocations();
      const deletedLabel = cleanup.deletedLocations.length
        ? `${cleanup.deletedLocations.length} Standorte gelöscht`
        : 'Keine ungenutzten Standorte gefunden';
      const skippedLabel = cleanup.skippedLocations.length
        ? ` ${cleanup.skippedLocations.length} aktive Standorte blieben erhalten.`
        : '';
      await alert({
        title: 'Standorte bereinigt',
        message: `${deletedLabel}.${skippedLabel}`,
      });
    } catch {
      setBulkActionError('Standortbereinigung fehlgeschlagen.');
    } finally {
      setBulkActionBusy(false);
    }
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
    try {
      for (const assetId of selectedIds) {
        // eslint-disable-next-line no-await-in-loop
        await onAdminDeleteAsset(assetId);
      }
      closeBulkModal();
      setSelectedIds([]);
    } catch {
      setBulkActionError('Bulk-Löschen fehlgeschlagen.');
    } finally {
      setBulkActionBusy(false);
    }
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

  const applyAdminCardPrinterCompatible = async (next: boolean) => {
    if (!adminActionAsset) return;
    setAdminActionBusy(true);
    setAdminActionError(null);
    try {
      await onAdminUpdateAsset(adminActionAsset.id, { cardPrinterCompatible: next });
    } catch {
      setAdminActionError('Kompatibilitäts-Einstellung konnte nicht gespeichert werden.');
    } finally {
      setAdminActionBusy(false);
    }
  };

  const applyAdminAvailableForPlanning = async (next: boolean) => {
    if (!adminActionAsset) return;
    setAdminActionBusy(true);
    setAdminActionError(null);
    try {
      await onAdminUpdateAsset(adminActionAsset.id, { availableForPlanning: next });
    } catch {
      setAdminActionError('Planungs-Einstellung konnte nicht gespeichert werden.');
    } finally {
      setAdminActionBusy(false);
    }
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
      // Kompatibilitäts-Flag bleibt im Schnellerfassungsmodus erhalten,
      // damit z. B. 7 MacBook Neo in Folge nicht jedes Mal neu deaktiviert
      // werden müssen.
      cardPrinterCompatible: current.cardPrinterCompatible,
      // Globaler Planungs-Ausschluss bleibt ebenfalls erhalten — z. B. wenn
      // mehrere Server-Laptops in Folge erfasst werden.
      availableForPlanning: current.availableForPlanning,
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
        // Nur für Laptop fachlich relevant; für andere Kategorien ist der
        // Default-true-Wert bedeutungslos und wird nie ausgewertet.
        cardPrinterCompatible: form.category.trim() === 'Laptop' ? form.cardPrinterCompatible : true,
        availableForPlanning: form.availableForPlanning,
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
      <PageHeader
        kicker="Inventar"
        title="Gerätebestand & Verfügbarkeit"
        subtitle="Bestand filtern, Zustand prüfen und Aktionen direkt ausführen."
        actions={
          <>
            {canManageAssets ? (
              <button className="btn-primary w-full sm:w-auto" onClick={openOnboarding}>
                <Plus className="h-4 w-4" />
                Neues Gerät
              </button>
            ) : null}
            <button className="btn-secondary w-full sm:w-auto" onClick={() => onNavigate('checkinCheckout')}>
              <ScanLine className="h-4 w-4" />
              QR Scan
            </button>
            <button className="btn-secondary w-full sm:w-auto" onClick={() => onNavigate('tickets')}>
              <TriangleAlert className="h-4 w-4" />
              Defekt melden
            </button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="Gesamtbestand"
          value={isInitialLoading && assets.length === 0 ? '—' : String(assets.length)}
          trend="Alle registrierten Geräte"
          tone="neutral"
          icon={Boxes}
        />
        <KpiCard
          title="Verfügbar"
          value={isInitialLoading && assets.length === 0 ? '—' : String(availableCount)}
          trend={`${formatRatio(availableCount, assets.length)}% des Bestands`}
          tone="positive"
          icon={PackageSearch}
        />
        <KpiCard
          title="Verliehen"
          value={isInitialLoading && assets.length === 0 ? '—' : String(loanedCount)}
          trend={`${formatRatio(loanedCount, assets.length)}% des Bestands`}
          tone="neutral"
          icon={Handshake}
        />
        <KpiCard
          title="Defekt / Wartung"
          value={isInitialLoading && assets.length === 0 ? '—' : String(attentionCount)}
          trend={`${formatRatio(attentionCount, assets.length)}% des Bestands`}
          tone="warning"
          icon={ShieldAlert}
        />
      </div>

      <article className="surface-card animate-fade-up space-y-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,2.2fr)_repeat(4,minmax(0,1fr))]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Suche nach Asset, Inventarnummer, Seriennummer..."
              className="field-input h-11 w-full pl-9"
            />
          </div>
          <select value={category} onChange={(event) => setCategory(event.target.value)} className="field-input h-11">
            {categories.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <select value={location} onChange={(event) => setLocation(event.target.value)} className="field-input h-11">
            {locations.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="field-input h-11">
            {statuses.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <button
            type="button"
            className="btn-secondary h-11"
            onClick={() => {
              void openByQrOrTag();
            }}
          >
            <ScanLine className="h-4 w-4" />
            QR Scan
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <ToggleSwitch checked={onlyAvailable} onChange={setOnlyAvailable} label="Nur verfügbare" />
          <ToggleSwitch checked={onlyBroken} onChange={setOnlyBroken} label="Nur defekte" />
          <ToggleSwitch
            checked={showTechnicalColumns}
            onChange={setShowTechnicalColumns}
            label="Technische Daten anzeigen"
          />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="text-sm text-ink-muted">
              {isInitialLoading && assets.length === 0 ? 'Lädt …' : `${filteredAssets.length} Geräte`}
            </span>
            <button type="button" className="btn-secondary h-11 px-3" onClick={resetFilters}>
              <RefreshCcw className="h-4 w-4" />
              Reset
            </button>
            <button
              type="button"
              className="btn-secondary h-11 px-3"
              onClick={() => setShowTechnicalColumns((prev) => !prev)}
            >
              <Filter className="h-4 w-4" />
              Mehr Filter
            </button>
          </div>
        </div>

        {canManageAssets && selectedIds.length > 0 ? (
          <div className="rounded-2xl border border-primary/30 bg-primary/15 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-primary/20 text-primary">
                <Boxes className="h-3.5 w-3.5" />
              </span>
              <span className="text-sm font-medium text-ink">{selectedIds.length} Geräte ausgewählt</span>
              <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={toggleSelectAllVisible}>
                {filteredAssets.length > 0 && filteredAssets.every((asset) => selectedIds.includes(asset.id))
                  ? 'Auswahl aufheben'
                  : 'Alle sichtbaren auswählen'}
              </button>
              <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={openBulkModal}>
                Bulk-Aktionen
              </button>
              <LoadingButton
                type="button"
                className="btn-secondary px-3 py-1.5 text-xs"
                isLoading={bulkActionBusy}
                loadingText="Verschiebt ..."
                onClick={() => void moveSelectionToMainWarehouse(false)}
              >
                Alles ins Hauptlager
              </LoadingButton>
              <button
                type="button"
                className="btn-danger px-3 py-1.5 text-xs"
                onClick={() => setBulkModalOpen(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Ausgewählte löschen
              </button>
            </div>
          </div>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className={`${isMobile ? 'hidden' : 'hidden lg:block'}`}>
            <div className="soft-scrollbar relative max-h-[68vh] overflow-y-auto overflow-x-auto rounded-2xl border border-line bg-surface shadow-sm">
              <table className="w-full min-w-[1120px] border-collapse text-sm table-fixed">
            <colgroup>
              {canManageAssets ? <col style={{ width: '56px' }} /> : null}
              <col style={{ width: '28%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '10%' }} />
            </colgroup>
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-ink-faint">
                {canManageAssets ? <th className="sticky top-0 z-20 border-b border-line bg-surface-2 px-3 py-3"> </th> : null}
                <th className="sticky top-0 z-20 border-b border-line bg-surface-2 px-3 py-3">Asset / Inventarnummer</th>
                <th className="sticky top-0 z-20 border-b border-line bg-surface-2 px-3 py-3">Kategorie</th>
                <th className="sticky top-0 z-20 border-b border-line bg-surface-2 px-3 py-3">Status</th>
                <th className="sticky top-0 z-20 border-b border-line bg-surface-2 px-3 py-3">Zugewiesen / Projekt</th>
                <th className="sticky top-0 z-20 border-b border-line bg-surface-2 px-3 py-3">Standort</th>
                <th className="sticky top-0 z-20 border-b border-line bg-surface-2 px-3 py-3">Letzter Scan</th>
                <th className="sticky top-0 z-20 border-b border-line bg-surface-2 px-3 py-3 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {filteredAssets.map((asset, rowIndex) => (
                <Fragment key={asset.id}>
                <tr
                  className={`border-b border-line/70 text-ink transition hover:bg-surface-2/75 ${
                    quickViewId === asset.id ? 'bg-primary/8' : ''
                  } ${showTechnicalColumns ? '' : 'last:border-0'}`}
                >
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
                  <td className="px-3 py-3" onMouseEnter={(event) => handleNameHoverEnter(asset, event)} onMouseLeave={handleNameHoverLeave}>
                    <div className="flex items-center gap-3">
                      <AssetImage asset={asset} size="sm" />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="max-w-[220px] cursor-default truncate font-semibold text-ink" title={asset.name}>
                            {asset.name}
                          </p>
                          {getOwnershipLabel(asset.ownershipType) ? (
                            <span className="inline-flex items-center rounded-full border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold text-sky-300">
                              {getOwnershipLabel(asset.ownershipType)}
                            </span>
                          ) : null}
                          {asset.availableForPlanning === false ? (
                            <span className="inline-flex items-center rounded-full border border-white/10 bg-slate-500/10 px-2 py-0.5 text-[10px] font-semibold text-ink-muted">
                              Nicht planbar
                            </span>
                          ) : null}
                          {asset.category === 'Laptop' && asset.cardPrinterCompatible === false ? (
                            <span className="inline-flex items-center rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                              Kein Kartendrucker
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-ink-faint">{asset.tagNumber}</p>
                        <p className="text-xs text-ink-muted">{asset.serialNumber}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-ink-muted">
                    {asset.category === 'Zuordnung erforderlich' && canManageAssets ? (
                      <select
                        defaultValue=""
                        className="field-input h-10"
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
                  <td className="whitespace-nowrap px-3 py-3 pr-6">
                    <StatusBadge value={asset.status} />
                  </td>
                  <td className="px-3 py-3">
                    <div className="max-w-[220px]">
                      <p className="truncate text-sm font-medium text-ink" title={asset.assignedTo}>{asset.assignedTo}</p>
                      <p className="truncate text-xs text-ink-faint">{asset.nextReservation !== '-' ? asset.nextReservation : 'Kein Projekt aktiv'}</p>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="text-sm text-ink">{asset.location}</div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2 text-sm text-ink">
                      <span>{asset.lastCheckout}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <div className="flex flex-nowrap items-center justify-end gap-2 whitespace-nowrap">
                      <button type="button" className="btn-secondary shrink-0 px-2 py-1 text-xs" onClick={() => setQuickViewId(asset.id)}>
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      {canManageAssets ? (
                        <button type="button" className="btn-secondary shrink-0 px-2 py-1 text-xs" onClick={() => openAdminActions(asset)}>
                          <Settings2 className="h-3.5 w-3.5" />
                          <span>Admin</span>
                        </button>
                      ) : null}
                      <button type="button" className="btn-primary shrink-0 px-2.5 py-1 text-xs" onClick={() => onOpenDetail(asset.id)}>
                        Detail
                      </button>
                    </div>
                  </td>
                </tr>
                {showTechnicalColumns ? (
                  <tr className="border-b border-line/70 bg-surface-2/60">
                    <td colSpan={canManageAssets ? 8 : 7} className="px-3 pb-3 pt-1">
                      <div className="grid gap-x-6 gap-y-1.5 text-xs text-ink-muted sm:grid-cols-2 lg:grid-cols-3">
                        <div className="flex min-w-0 gap-2">
                          <span className="w-24 shrink-0 uppercase tracking-wide text-[10px] text-ink-faint">Modell</span>
                          <span className="truncate" title={asset.model || '-'}>{asset.model || '-'}</span>
                        </div>
                        <div className="flex min-w-0 gap-2">
                          <span className="w-24 shrink-0 uppercase tracking-wide text-[10px] text-ink-faint">Seriennummer</span>
                          <span className="truncate" title={asset.serialNumber || '-'}>{asset.serialNumber || '-'}</span>
                        </div>
                        <div className="flex min-w-0 gap-2">
                          <span className="w-24 shrink-0 uppercase tracking-wide text-[10px] text-ink-faint">IP-Adresse</span>
                          <span className="truncate" title={asset.ipAddress || '-'}>{asset.ipAddress || '-'}</span>
                        </div>
                        <div className="flex min-w-0 gap-2">
                          <span className="w-24 shrink-0 uppercase tracking-wide text-[10px] text-ink-faint">MAC LAN</span>
                          <span className="truncate font-mono" title={asset.macLan || '-'}>{asset.macLan || '-'}</span>
                        </div>
                        <div className="flex min-w-0 gap-2">
                          <span className="w-24 shrink-0 uppercase tracking-wide text-[10px] text-ink-faint">MAC WLAN</span>
                          <span className="truncate font-mono" title={asset.macWlan || '-'}>{asset.macWlan || '-'}</span>
                        </div>
                        <div className="flex min-w-0 gap-2">
                          <span className="w-24 shrink-0 uppercase tracking-wide text-[10px] text-ink-faint">QR / Asset-ID</span>
                          <span className="truncate" title={asset.qrCode || asset.tagNumber}>{asset.qrCode || asset.tagNumber || '-'}</span>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
            </div>
          </div>

          <div className={`grid gap-3 ${isMobile ? '' : 'lg:hidden'}`}>
          {filteredAssets.map((asset) => (
            <article key={asset.id} className="surface-muted p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-start gap-3">
                    <AssetImage asset={asset} size="sm" />
                    <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h4 className="truncate text-sm font-semibold text-ink">{asset.name}</h4>
                    {asset.availableForPlanning === false ? (
                      <span
                        className="inline-flex items-center rounded-full border border-white/10 bg-slate-500/10 px-2 py-0.5 text-[10px] font-semibold text-ink-muted"
                        title="Aus Einsatzplanung ausgeschlossen — bleibt im Inventar nutzbar"
                      >
                        Nicht planbar
                      </span>
                    ) : null}
                    {asset.category === 'Laptop' && asset.cardPrinterCompatible === false ? (
                      <span
                        className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800"
                        title="Nicht kartendrucker-kompatibel — wird in Projekten mit Kartendrucker-Bedarf nicht eingeplant"
                      >
                        Kein Kartendrucker
                      </span>
                    ) : null}
                  </div>
                  <p className="break-words text-xs text-ink-muted">
                    {asset.category === 'Zuordnung erforderlich' && canManageAssets ? (
                      <select
                        defaultValue=""
                        className="field-input h-9 text-xs"
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
                      <p className="mt-1 break-all text-xs text-ink-faint">{asset.tagNumber}</p>
                    </div>
                  </div>
                </div>
                <StatusBadge value={asset.status} />
              </div>
              <div className="mt-3 grid grid-cols-[1fr_auto] items-center gap-2">
                <p className="break-all text-xs text-ink-muted">SN: {asset.serialNumber || '-'}</p>
                <button type="button" className="btn-primary min-h-[44px] px-3 py-2 text-xs" onClick={() => setQuickViewId(asset.id)}>
                  Schnellansicht
                </button>
              </div>
              <p className="mt-1 break-all text-xs text-ink-faint">Letzter Scan: {asset.lastCheckout}</p>
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

          <div className="hidden xl:block">
            {quickViewAsset ? (
              <AssetQuickView
                asset={quickViewAsset}
                variant="panel"
                onOpenDetail={onOpenDetail}
                onReserve={onReserveAsset}
                onCheckout={onCheckoutAsset}
              />
            ) : (
              <aside className="surface-card sticky top-24 animate-fade-up p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">Detailpanel</p>
                <h3 className="mt-2 text-lg font-semibold text-ink">Gerät auswählen</h3>
                <p className="mt-2 text-sm text-ink-muted">
                  Öffne eine Schnellansicht aus der Tabelle, um Stammdaten, Verfügbarkeit und QR-Details rechts anzuzeigen.
                </p>
                {selectedAssets.length > 0 ? (
                  <div className="mt-4 rounded-2xl border border-line bg-surface-2 p-4">
                    <p className="text-sm font-medium text-ink">{selectedAssets.length} Geräte markiert</p>
                    <p className="mt-1 text-xs text-ink-faint">Bulk-Aktionen bleiben über die blaue Auswahlleiste erreichbar.</p>
                  </div>
                ) : null}
              </aside>
            )}
          </div>
        </div>
      </article>

      {!isMobile ? <div className="xl:hidden">{quickViewAsset ? (
        <AssetQuickView
          asset={quickViewAsset}
          onClose={() => setQuickViewId(null)}
          onOpenDetail={onOpenDetail}
          onReserve={onReserveAsset}
          onCheckout={onCheckoutAsset}
        />
      ) : null}</div> : (
        <AssetQuickView
          asset={quickViewAsset}
          onClose={() => setQuickViewId(null)}
          onOpenDetail={onOpenDetail}
          onReserve={onReserveAsset}
          onCheckout={onCheckoutAsset}
        />
      )}

      {/* Verzögerte QR-Vorschau: per Portal über der Tabelle, damit der
          scroll-/overflow-Container sie nicht abschneidet. Kein Modal/Backdrop. */}
      {hoverPreview
        ? createPortal(
            <div
              role="tooltip"
              className="fixed z-[80] w-56 rounded-xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-900"
              style={{ left: hoverPreview.left, top: hoverPreview.top }}
              onMouseEnter={() => {
                if (hoverCloseTimerRef.current !== null) {
                  window.clearTimeout(hoverCloseTimerRef.current);
                  hoverCloseTimerRef.current = null;
                }
              }}
              onMouseLeave={() => setHoverPreview(null)}
            >
              <div className="flex flex-col items-center gap-2">
                <AssetQrCodePreview
                  qrValue={getAssetQrCode(hoverPreview.asset)}
                  assetName={hoverPreview.asset.name}
                />
                <div className="w-full min-w-0 text-center">
                  <p
                    className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100"
                    title={hoverPreview.asset.name}
                  >
                    {hoverPreview.asset.name}
                  </p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {hoverPreview.asset.category}
                  </p>
                  <div className="mt-1.5 flex justify-center">
                    <StatusBadge value={hoverPreview.asset.status} />
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

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
            {adminActionBusy ? <InlineLoadingState className="mb-3" message="Änderungen werden gespeichert ..." /> : null}

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
                      <LoadingButton type="button" className="btn-secondary text-xs" isLoading={adminActionBusy} loadingText="Speichert ..." onClick={() => void applyAdminStatus()}>
                        Status speichern
                      </LoadingButton>
                      <LoadingButton type="button" className="btn-secondary text-xs" isLoading={adminActionBusy} loadingText="Setzt ..." onClick={() => void applyAdminSetMaintenance()}>
                        In Wartung setzen
                      </LoadingButton>
                      <LoadingButton type="button" className="btn-danger text-xs" isLoading={adminActionBusy} loadingText="Setzt ..." onClick={() => void applyAdminSetDefect()}>
                        Defekt setzen
                      </LoadingButton>
                    </div>
                  </div>
                </div>

                {adminActionAsset.category === 'Laptop' ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <h4 className="text-sm font-semibold text-slate-900">Kompatibilität</h4>
                    <label className="mt-2 flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                        checked={adminActionAsset.cardPrinterCompatible !== false}
                        disabled={adminActionBusy}
                        onChange={(event) => void applyAdminCardPrinterCompatible(event.target.checked)}
                      />
                      <span className="leading-snug">
                        <span className="font-semibold text-slate-900">Kartendrucker-kompatibel</span>
                        <br />
                        Deaktivieren, wenn dieses Gerät keine Kartendrucker bedienen kann (z. B. MacBook Neo).
                        Solche Laptops werden in Projekten mit Kartendrucker-Bedarf nicht eingeplant. Änderungen
                        werden sofort gespeichert.
                      </span>
                    </label>
                  </div>
                ) : null}

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <h4 className="text-sm font-semibold text-slate-900">Planung</h4>
                  <label className="mt-2 flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                      checked={adminActionAsset.availableForPlanning !== false}
                      disabled={adminActionBusy}
                      onChange={(event) => void applyAdminAvailableForPlanning(event.target.checked)}
                    />
                    <span className="leading-snug">
                      <span className="font-semibold text-slate-900">In Einsatzplanung verwenden</span>
                      <br />
                      Dieses Gerät bleibt im Inventar sichtbar und nutzbar (Checkout/Scan funktionieren), zählt aber
                      nicht als verfügbarer Bestand in der Einsatzplanung. Deaktivieren z. B. für interne
                      Server-Laptops. Änderungen werden sofort gespeichert.
                    </span>
                  </label>
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
                      <LoadingButton type="button" className="btn-secondary text-xs" isLoading={adminActionBusy} loadingText="Speichert ..." onClick={() => void applyAdminAssignment()}>
                        Zuordnung speichern
                      </LoadingButton>
                      <LoadingButton type="button" className="btn-secondary text-xs" isLoading={adminActionBusy} loadingText="Setzt zurück ..." onClick={() => void applyAdminReset()}>
                        Reset auf verfügbar
                      </LoadingButton>
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
                    <LoadingButton type="button" className="btn-secondary text-xs" isLoading={adminActionBusy} loadingText="Speichert ..." onClick={() => void applyAdminProjectCorrection()}>
                      Projekt/Buchung korrigieren
                    </LoadingButton>
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
                    <LoadingButton type="button" className="btn-danger text-xs" isLoading={adminActionBusy} loadingText="Löscht ..." onClick={() => void applyAdminDeleteFromModal()}>
                      <Trash2 className="h-3.5 w-3.5" />
                      Asset löschen
                    </LoadingButton>
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
            {bulkActionBusy ? <InlineLoadingState className="mb-3" message="Bulk-Aktion wird ausgeführt ..." /> : null}

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
                  <LoadingButton type="button" className="btn-secondary text-xs" isLoading={bulkActionBusy} loadingText="Wendet an ..." onClick={() => void applyBulkUpdate()}>
                    Status anwenden
                  </LoadingButton>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <h4 className="text-sm font-semibold text-slate-900">Stammdaten</h4>
                <p className="mt-1 text-xs text-slate-500">
                  Wenn ihr real nur ein Lager habt, kannst du hier alle markierten Geräte gesammelt ins {MAIN_WAREHOUSE_NAME} setzen.
                </p>
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
                      placeholder={MAIN_WAREHOUSE_NAME}
                      value={bulkForm.location}
                      onChange={(event) => setBulkForm((current) => ({ ...current, location: event.target.value }))}
                    />
                  </label>
                  <label className="field">
                    Produktbild-URL
                    <input
                      className="field-input"
                      placeholder="https://example.com/produktbild.jpg"
                      value={bulkForm.productImageSourceUrl}
                      onChange={(event) =>
                        setBulkForm((current) => ({ ...current, productImageSourceUrl: event.target.value }))
                      }
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <LoadingButton type="button" className="btn-secondary text-xs" isLoading={bulkActionBusy} loadingText="Wendet an ..." onClick={() => void applyBulkUpdate()}>
                      Stammdaten anwenden
                    </LoadingButton>
                    <LoadingButton
                      type="button"
                      className="btn-secondary text-xs"
                      isLoading={bulkActionBusy}
                      loadingText="Entfernt ..."
                      onClick={() => void removeBulkProductImage()}
                    >
                      Produktbild entfernen
                    </LoadingButton>
                    <LoadingButton
                      type="button"
                      className="btn-secondary text-xs"
                      isLoading={bulkActionBusy}
                      loadingText="Verschiebt ..."
                      onClick={() => void moveSelectionToMainWarehouse(false)}
                    >
                      Alles ins Hauptlager
                    </LoadingButton>
                    <LoadingButton
                      type="button"
                      className="btn-primary text-xs"
                      isLoading={bulkActionBusy}
                      loadingText="Bereinigt ..."
                      onClick={() => void moveSelectionToMainWarehouse(true)}
                    >
                      Ins Hauptlager + Standorte bereinigen
                    </LoadingButton>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 md:col-span-2">
                <h4 className="text-sm font-semibold text-amber-900">Standorte bereinigen</h4>
                <p className="mt-1 text-xs text-amber-800">
                  Entfernt nur ungenutzte Standort-Stammdaten. Standorte mit vorhandenen Assets bleiben bestehen.
                </p>
                <LoadingButton
                  type="button"
                  className="btn-secondary mt-2 text-xs"
                  isLoading={bulkActionBusy}
                  loadingText="Bereinigt ..."
                  onClick={() => void cleanupLocationsOnly()}
                >
                  Ungenutzte Standorte löschen
                </LoadingButton>
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
                <LoadingButton type="button" className="btn-danger mt-2 text-xs" isLoading={bulkActionBusy} loadingText="Löscht ..." onClick={() => void applyBulkDelete()}>
                  <Trash2 className="h-3.5 w-3.5" />
                  {selectedIds.length} Geräte löschen
                </LoadingButton>
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
                          <option key={item} value={item}>{item}</option>
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
                    {form.category === 'Laptop' ? (
                      <label className="mt-1 flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                          checked={form.cardPrinterCompatible}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, cardPrinterCompatible: event.target.checked }))
                          }
                        />
                        <span className="leading-snug">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            Kartendrucker-kompatibel
                          </span>
                          <span className="ml-1 text-slate-500 dark:text-slate-400">
                            (Standard: aktiv)
                          </span>
                          <br />
                          Deaktivieren, wenn der Laptop keine Kartendrucker bedienen kann (z. B. MacBook Neo). Solche
                          Geräte werden in Projekten mit Kartendrucker-Bedarf nicht eingeplant.
                        </span>
                      </label>
                    ) : null}
                    <label className="mt-1 flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                        checked={form.availableForPlanning}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, availableForPlanning: event.target.checked }))
                        }
                      />
                      <span className="leading-snug">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          In Einsatzplanung verwenden
                        </span>
                        <span className="ml-1 text-slate-500 dark:text-slate-400">
                          (Standard: aktiv)
                        </span>
                        <br />
                        Dieses Gerät bleibt im Inventar sichtbar, zählt aber nicht als verfügbarer Bestand in der
                        Einsatzplanung. Deaktivieren z. B. für interne Server-Laptops.
                      </span>
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
              {onboardingSaving ? <InlineLoadingState className="w-full" message="Gerät wird gespeichert ..." /> : null}
              <button type="button" className="btn-secondary" onClick={closeOnboarding}>
                Abbrechen
              </button>
              <LoadingButton
                type="button"
                className="btn-secondary"
                onClick={() => {
                  void submitOnboarding(true);
                }}
                isLoading={onboardingSaving}
                loadingText="Speichert ..."
              >
                Speichern & nächstes Gerät
              </LoadingButton>
              <LoadingButton
                type="button"
                className="btn-primary"
                onClick={() => {
                  void submitOnboarding(false);
                }}
                isLoading={onboardingSaving}
                loadingText="Speichern ..."
              >
                Speichern
              </LoadingButton>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

