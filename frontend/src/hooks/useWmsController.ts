import { useCallback, useEffect, useMemo, useState } from 'react';

import { getAssetQrCode } from '../asset-ui/qr';
import type {
  ActivityItem,
  AppPage,
  AppRole,
  Asset,
  CategoryItem,
  LocationItem,
  MaintenanceItem,
  ReservationItem,
  UserItem,
} from '../asset-ui/types';
import {
  deleteAsset,
  deleteCategory as deleteCategoryRequest,
  deleteUser as deleteUserRequest,
  listCategories as listCategoriesRequest,
  deleteUsersBulk,
  fetchWmsOverview,
  getApiAccessContext,
  getAuthSession,
  resetUserPassword,
  setApiAccessContext,
  upsertActivity,
  upsertAsset,
  upsertLocation,
  upsertMaintenance,
  upsertReservation,
  upsertUser,
  type BulkUserDeleteResponse,
  type WmsOverview,
} from '../services/wmsApi';
import { useAppDialog } from '../components/dialogs/AppDialogProvider';
import { canonicalPathForPage, normalizePathname, resolvePageFromPath } from '../routing/appRoutes';
import { useTheme } from './useTheme';

type CreateMaintenancePayload = {
  assetName: string;
  issue: string;
  comment: string;
  priority?: MaintenanceItem['priority'];
  status?: MaintenanceItem['status'];
  location?: string;
};
type CheckoutPayload = {
  assetId: string;
  assignee: string;
  projectName?: string;
  dueDate: string;
  note: string;
};
type CheckinPayload = {
  assetId: string;
  condition: string;
  projectName?: string;
};
type CreateAssetInput = {
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
};
type UserUpsertInput = {
  id?: string;
  name: string;
  email: string;
  role: UserItem['role'];
  status: UserItem['status'];
  department?: string;
  location?: string;
};

type UseWmsControllerOptions = {
  activeRole: AppRole;
  isAuthenticated: boolean;
};

function canTransitionMaintenanceStatus(
  from: MaintenanceItem['status'],
  to: MaintenanceItem['status'],
): boolean {
  if (from === to) return true;
  if (from === 'Offen' && to === 'In Bearbeitung') return true;
  if (from === 'In Bearbeitung' && to === 'Erledigt') return true;
  return false;
}

function normalizeAssetStatus(value: Asset['status'] | string): Asset['status'] {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'verfuegbar' || normalized === 'verfügbar' || normalized === 'ok') {
    return 'Verfügbar';
  }
  if (
    normalized === 'verliehen' ||
    normalized === 'ausgegeben' ||
    normalized === 'unterwegs' ||
    normalized === 'reserviert' ||
    normalized === 'entliehen'
  ) {
    return 'Verliehen';
  }
  if (normalized.includes('wartung') || normalized.includes('service')) {
    return 'In Wartung';
  }
  if (normalized.includes('defekt') || normalized.includes('kaputt') || normalized.includes('verlor')) {
    return 'Defekt';
  }
  return 'Verfügbar';
}

function normalizeUserRole(value: UserItem['role'] | string): UserItem['role'] {
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'admin') return 'Admin';
  if (normalized === 'projektmanager') return 'Projektmanager';
  if (normalized === 'junior') return 'Junior';
  return 'Mitarbeiter';
}

function normalizeUserStatus(value: UserItem['status'] | string): UserItem['status'] {
  return value === 'Aktiv' ? 'Aktiv' : 'Inaktiv';
}

function findAssetForMaintenance(assets: Asset[], assetName: string): Asset | undefined {
  const normalizedAssetName = assetName.trim();
  return assets.find(
    (asset) =>
      asset.name === normalizedAssetName ||
      Boolean(asset.tagNumber && normalizedAssetName.includes(asset.tagNumber)),
  );
}

function sanitizeActivityDetail(detail: string, knownUsers: UserItem[]): string {
  const byId = new Map(knownUsers.map((user) => [user.id, user.name]));
  return detail.replace(/Ausgeführt durch:\s*(usr-[a-z0-9-]+)/gi, (_, rawId: string) => {
    const name = byId.get(rawId.trim());
    return `Ausgeführt durch: ${name || 'Unbekannter Benutzer'}`;
  });
}

function isHiddenLegacyCheckoutCheckinActivity(title: string): boolean {
  const normalized = title.trim().toLowerCase();
  return normalized === 'asset ausgegeben' || normalized === 'asset zurückgenommen';
}

export function useWmsController(options: UseWmsControllerOptions) {
  const accessContext = getApiAccessContext();
  const { activeRole, isAuthenticated } = options;
  const { theme, toggleTheme } = useTheme();
  const { alert, prompt } = useAppDialog();
  const [activePage, setActivePageState] = useState<AppPage>(() => {
    if (typeof window === 'undefined') return 'dashboard';
    return resolvePageFromPath(window.location.pathname).page;
  });
  const [projectContext, setProjectContextState] = useState<string>(accessContext.projectContext ?? '');
  const [search, setSearch] = useState('');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [reservations, setReservations] = useState<ReservationItem[]>([]);
  const [maintenanceItems, setMaintenanceItems] = useState<MaintenanceItem[]>([]);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [planningSummary, setPlanningSummary] = useState<WmsOverview['planningSummary']>(null);
  const [extraCategories, setExtraCategories] = useState<CategoryItem[]>([]);
  // Backend-Stammdaten der Kategorien (mit ids), damit das Frontend bei
  // Delete die richtige id mitschicken kann. Wird einmal nach Login
  // geladen und nach create/delete neu eingespielt.
  const [categoryRecords, setCategoryRecords] = useState<CategoryItem[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [wmsError, setWmsError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // hasLoadedOnce flippt von false → true beim ersten erfolgreichen
  // /api/wms/overview-Response. Pages nutzen den davon abgeleiteten
  // isInitialLoading-Flag, um statt irreführender 0-Werte (z. B.
  // "Gerätebestand: 0") Skeleton/„—"-Platzhalter anzuzeigen, solange
  // echte Daten noch nicht eingetroffen sind.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const currentOperatorName = getAuthSession()?.user.name?.trim() || 'Unbekannt';

  const setActivePage = useCallback((page: AppPage, options?: { replace?: boolean }) => {
    setActivePageState(page);
    if (typeof window === 'undefined') return;
    const currentPath = normalizePathname(window.location.pathname);
    const targetPath = canonicalPathForPage(page);
    if (currentPath === targetPath) return;
    if (options?.replace) {
      window.history.replaceState(null, '', targetPath);
      return;
    }
    window.history.pushState(null, '', targetPath);
  }, []);

  // loadWms ist als useCallback ausgeführt, damit untergeordnete Komponenten
  // (z. B. PlanningPage) nicht bei jedem Render eine neue Funktionsreferenz
  // erhalten und damit unnötig erneut Effekte feuern.
  const loadWms = useCallback(async (options?: { initial?: boolean }) => {
    if (options?.initial) {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }
    // Slow-Request-Log nur im Dev-Modus, damit Performance-Regressionen
    // beim Overview-Endpoint sofort auffallen, ohne Production-Logs zu
    // verschmutzen. import.meta.env.DEV ist von Vite zur Build-Zeit auf
    // false gesetzt → kein Code-Path in der Production-Bundle.
    const startedAt = typeof performance !== 'undefined' ? performance.now() : 0;
    try {
      const payload = await fetchWmsOverview();
      const normalizedUsers = payload.users.map((user) => ({
        ...user,
        role: normalizeUserRole(user.role),
        status: normalizeUserStatus(user.status),
      }));
      setAssets(
        payload.assets.map((asset) => ({
          ...asset,
          status: normalizeAssetStatus(asset.status),
          qrCode: getAssetQrCode(asset),
        })),
      );
      setActivities(
        payload.activities
          .filter((item) => !isHiddenLegacyCheckoutCheckinActivity(item.title))
          .map((item) => ({
            ...item,
            detail: sanitizeActivityDetail(item.detail, normalizedUsers),
          })),
      );
      setReservations(payload.reservations);
      setMaintenanceItems(payload.maintenanceItems);
      setLocations(payload.locations);
      setUsers(normalizedUsers);
      setPlanningSummary(payload.planningSummary ?? null);
      setSelectedAssetId((current) => {
        if (current && payload.assets.some((item) => item.id === current)) {
          return current;
        }
        return payload.assets[0]?.id ?? null;
      });
      setWmsError(null);
      setHasLoadedOnce(true);
      if (import.meta.env.DEV) {
        const elapsedMs =
          typeof performance !== 'undefined' ? performance.now() - startedAt : 0;
        if (elapsedMs > 1500) {
          // eslint-disable-next-line no-console
          console.warn(
            `[wms] /api/wms/overview dauerte ${Math.round(elapsedMs)} ms — Performance prüfen.`,
          );
        }
      }
    } catch {
      setWmsError('Backend nicht erreichbar oder fehlerhafte API-Antwort.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  // Lädt Kategorien-Stammdaten (mit ids) aus dem Backend. Wird einmal nach
  // Login geladen und nach create/delete neu eingespielt.
  const refreshCategoryRecords = useCallback(async () => {
    try {
      const records = await listCategoriesRequest();
      setCategoryRecords(records);
    } catch {
      // Stillschweigend ignorieren — die abgeleitete Kategorienliste aus
      // Assets reicht weiter aus, das Delete-Feature ist dann nur lokal
      // ohne id verfügbar.
    }
  }, []);

  useEffect(() => {
    setApiAccessContext({ projectContext });
  }, [projectContext]);

  useEffect(() => {
    if (!isAuthenticated) return;
    void refreshCategoryRecords();
  }, [isAuthenticated, refreshCategoryRecords]);

  useEffect(() => {
    if (!isAuthenticated) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;

    // Initial-Load setzt explizit isLoading=true, damit der globale Banner
    // wirklich nur beim ersten Aufruf erscheint.
    const initial = async () => {
      if (cancelled) return;
      await loadWms({ initial: true });
    };

    // Hintergrund-Polling DARF KEIN isLoading auslösen, sonst flackert der
    // globale "Daten werden geladen ..."-Hinweis alle 15 Sekunden und das
    // Layout springt (was z. B. die Backup-Seite optisch leerziehen lässt).
    const refresh = async () => {
      if (cancelled) return;
      await loadWms();
    };

    void initial();
    const intervalId = window.setInterval(() => {
      void refresh();
    }, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isAuthenticated, loadWms]);

  useEffect(() => {
    if (typeof window === 'undefined' || !isAuthenticated) return;

    const syncFromBrowserPath = () => {
      const resolved = resolvePageFromPath(window.location.pathname);
      setActivePageState(resolved.page);

      if (window.location.pathname === resolved.canonicalPath) return;
      const suffix = `${window.location.search}${window.location.hash}`;
      window.history.replaceState(null, '', `${resolved.canonicalPath}${suffix}`);
    };

    syncFromBrowserPath();
    window.addEventListener('popstate', syncFromBrowserPath);
    return () => {
      window.removeEventListener('popstate', syncFromBrowserPath);
    };
  }, [isAuthenticated]);

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedAssetId) ?? null,
    [assets, selectedAssetId],
  );

  const categories = useMemo<CategoryItem[]>(() => {
    const fromAssets = new Set<string>();
    for (const asset of assets) {
      const trimmed = asset.category?.trim();
      if (trimmed && trimmed !== 'Zuordnung erforderlich') fromAssets.add(trimmed);
    }
    const merged = new Map<string, CategoryItem>();
    // Backend-Records zuerst eintragen — sie haben die echte id und das
    // korrekte isStandard-Flag. Lokale Asset-Ableitungen werden danach nur
    // ergänzt, wenn die Kategorie nicht schon im Backend bekannt ist.
    for (const item of categoryRecords) {
      if (item?.name) merged.set(item.name, item);
    }
    for (const name of fromAssets) {
      if (!merged.has(name)) merged.set(name, { name, isActive: true });
    }
    for (const item of extraCategories) {
      if (!merged.has(item.name)) merged.set(item.name, item);
    }
    return [...merged.values()];
  }, [assets, extraCategories, categoryRecords]);

  const createCategory = useCallback(
    async (name: string): Promise<CategoryItem> => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error('Kategoriename darf nicht leer sein.');
      const item: CategoryItem = { name: trimmed, isActive: true };
      setExtraCategories((prev) => (prev.some((existing) => existing.name === trimmed) ? prev : [...prev, item]));
      // Backend-Records nachladen, damit die neue Kategorie ihre id bekommt
      // und im UI gelöscht werden kann.
      void refreshCategoryRecords();
      return item;
    },
    [refreshCategoryRecords],
  );

  const deleteCategoryAction = useCallback(
    async (categoryId: number): Promise<void> => {
      // Backend wirft auf 409, wenn die Kategorie noch verwendet wird —
      // wir lassen den Fehler nach oben durch, damit die Page eine
      // verständliche Meldung anzeigen kann.
      await deleteCategoryRequest(categoryId);
      // Optimistisch lokal entfernen + Backend-Records frisch nachladen.
      setCategoryRecords((prev) => prev.filter((item) => item.id !== categoryId));
      setExtraCategories((prev) => prev.filter((item) => item.id !== categoryId));
      void refreshCategoryRecords();
    },
    [refreshCategoryRecords],
  );

  const openAssetDetail = (assetId: string) => {
    setSelectedAssetId(assetId);
    setActivePage('assetDetail');
  };

  const createId = (prefix: string) => `${prefix}-${Date.now().toString(36)}`;

  const saveAsset = async (asset: Asset) => {
    const normalizedAsset = { ...asset, qrCode: getAssetQrCode(asset) };
    setAssets((prev) => prev.map((item) => (item.id === normalizedAsset.id ? normalizedAsset : item)));
    try {
      await upsertAsset(normalizedAsset);
    } catch {
      setWmsError('Asset konnte nicht im Backend gespeichert werden.');
    }
  };

  const adminUpdateAsset = async (assetId: string, patch: Partial<Asset>) => {
    const asset = assets.find((item) => item.id === assetId);
    if (!asset) return;
    const updated: Asset = {
      ...asset,
      ...patch,
      qrCode: getAssetQrCode({ ...asset, ...patch }),
    };
    await saveAsset(updated);
    await addActivity('Asset korrigiert', `${updated.name} wurde administrativ angepasst.`, updated.id);
  };

  const adminDeleteAsset = async (assetId: string) => {
    const asset = assets.find((item) => item.id === assetId);
    if (!asset) return;
    setAssets((prev) => prev.filter((item) => item.id !== assetId));
    try {
      await deleteAsset(assetId);
      await addActivity('Asset gelöscht', `${asset.name} wurde aus dem Bestand entfernt.`, assetId);
      if (selectedAssetId === assetId) {
        setSelectedAssetId(null);
        setActivePage('inventory');
      }
    } catch {
      setWmsError('Asset konnte nicht gelöscht werden.');
      await loadWms();
      throw new Error('Asset konnte nicht gelöscht werden.');
    }
  };

  const addActivity = async (title: string, detail: string, assetId?: string) => {
    const activity: ActivityItem = {
      id: createId('act'),
      title,
      detail,
      timestamp: new Date().toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }),
      assetId,
    };
    setActivities((prev) => [activity, ...prev].slice(0, 80));
    try {
      await upsertActivity(activity);
    } catch {
      setWmsError('Aktivität konnte nicht im Backend gespeichert werden.');
    }
  };

  const createAsset = async () => {
    const name = await prompt({
      title: 'Neues Gerät anlegen',
      message: 'Gerätename',
      placeholder: 'z. B. iPad Air 11',
      required: true,
      submitLabel: 'Anlegen',
    });
    if (!name?.trim()) return;
    const category =
      (await prompt({
        title: 'Kategorie',
        message: 'Gerätekategorie auswählen oder eingeben',
        defaultValue: 'Sonstiges',
      })) || 'Sonstiges';
    const location =
      (await prompt({
        title: 'Standort',
        message: 'Aktueller Standort',
        defaultValue: 'Hauptlager',
      })) || 'Hauptlager';
    const newAsset: Asset = {
      id: createId('asset'),
      name: name.trim(),
      category: category.trim(),
      location: location.trim(),
      status: 'Verfügbar',
      assignedTo: '-',
      nextReturn: '-',
      tagNumber: `HW-${Math.floor(Math.random() * 9000) + 1000}`,
      serialNumber: `SN-${Math.floor(Math.random() * 900000) + 100000}`,
      qrCode: '',
      maintenanceState: 'Neu erfasst',
      notes: '',
      lastCheckout: '-',
      nextReservation: '-',
    };
    const normalizedAsset = { ...newAsset, qrCode: getAssetQrCode(newAsset) };
    setAssets((prev) => [normalizedAsset, ...prev]);
    setSelectedAssetId(normalizedAsset.id);
    setActivePage('assetDetail');
    await addActivity('Asset angelegt', `${normalizedAsset.name} wurde neu angelegt.`, normalizedAsset.id);
    try {
      await upsertAsset(normalizedAsset);
    } catch {
      setWmsError('Neues Asset konnte nicht im Backend gespeichert werden.');
    }
  };

  const createAssetFromInput = async (input: CreateAssetInput) => {
    const trimmedCategory = input.category.trim();
    const trimmedName = input.name.trim();
    const trimmedLocation = input.location?.trim() || 'Hauptlager';
    const trimmedSerial = input.serialNumber.trim();
    const trimmedTag = input.tagNumber?.trim();
    const baseNotes = input.notes?.trim() || '';
    const metaParts = [
      input.manufacturer?.trim() ? `Hersteller: ${input.manufacturer.trim()}` : '',
      input.model?.trim() ? `Modell: ${input.model.trim()}` : '',
      input.ipAddress?.trim() ? `IP-Adresse: ${input.ipAddress.trim()}` : '',
      input.macLan?.trim() ? `MAC LAN: ${input.macLan.trim()}` : '',
      input.macWlan?.trim() ? `MAC WLAN: ${input.macWlan.trim()}` : '',
      baseNotes,
    ].filter(Boolean);

    const newAsset: Asset = {
      id: createId('asset'),
      name: trimmedName,
      category: trimmedCategory,
      location: trimmedLocation,
      status: 'Verfügbar',
      assignedTo: '-',
      nextReturn: '-',
      tagNumber: trimmedTag || `HW-${Math.floor(Math.random() * 9000) + 1000}`,
      serialNumber: trimmedSerial,
      model: input.model?.trim() || undefined,
      ipAddress: input.ipAddress?.trim() || undefined,
      macLan: input.macLan?.trim() || undefined,
      macWlan: input.macWlan?.trim() || undefined,
      qrCode: '',
      maintenanceState: 'Neu erfasst',
      notes: metaParts.join('\n'),
      lastCheckout: '-',
      nextReservation: '-',
    };

    const normalizedAsset = { ...newAsset, qrCode: getAssetQrCode(newAsset) };
    setAssets((prev) => [normalizedAsset, ...prev]);
    setSelectedAssetId(normalizedAsset.id);
    await addActivity('Asset angelegt', `${normalizedAsset.name} wurde neu angelegt.`, normalizedAsset.id);
    try {
      await upsertAsset(normalizedAsset);
    } catch {
      setWmsError('Neues Asset konnte nicht im Backend gespeichert werden.');
      throw new Error('Neues Asset konnte nicht im Backend gespeichert werden.');
    }
    return normalizedAsset;
  };

  const reserveAsset = async (assetId: string) => {
    const asset = assets.find((item) => item.id === assetId);
    if (!asset) return;
    const team = await prompt({
      title: 'Gerät verleihen',
      message: 'Für welches Team oder welche Person?',
      defaultValue: asset.assignedTo === '-' ? 'Team/Person' : asset.assignedTo,
      required: true,
      submitLabel: 'Speichern',
    });
    if (!team?.trim()) return;
    const date =
      (await prompt({
        title: 'Geplante Rückgabe',
        message: 'Bis wann ist das Gerät verliehen?',
        defaultValue: asset.nextReturn === '-' ? 'in 3 Tagen' : asset.nextReturn,
      })) || asset.nextReturn;
    const updated: Asset = {
      ...asset,
      status: 'Verliehen',
      assignedTo: team.trim(),
      nextReturn: date,
      nextReservation: date,
    };
    await saveAsset(updated);
    await addActivity('Asset reserviert', `${asset.name} wurde für ${team.trim()} reserviert.`, asset.id);
  };

  const checkoutAsset = async (
    assetId: string,
    assigneeHint?: string,
    dueHint?: string,
    noteHint?: string,
    projectHint?: string,
  ) => {
    const asset = assets.find((item) => item.id === assetId);
    if (!asset) return;
    const assignee =
      assigneeHint ||
      (await prompt({
        title: 'Gerät ausgeben',
        message: 'Ausgeben an',
        defaultValue: asset.assignedTo === '-' ? 'Team/Person' : asset.assignedTo,
        required: true,
      })) ||
      '';
    if (!assignee.trim()) return;
    const due =
      dueHint ||
      (await prompt({
        title: 'Rückgabe',
        message: 'Rückgabe geplant bis',
        defaultValue: asset.nextReturn === '-' ? 'in 2 Tagen' : asset.nextReturn,
      })) ||
      asset.nextReturn;
    const note = noteHint || '';
    const project = projectHint?.trim() || '';
    const recipient = assignee.trim() || '-';
    const metadataLines = [
      project ? `Projekt: ${project}` : '',
      `Ausgabe durch: ${currentOperatorName}`,
      note ? `Notiz: ${note}` : '',
    ].filter(Boolean);
    const assignedToValue =
      project && recipient === '-' ? `- · ${project}` : recipient !== '-' && project ? `${recipient} · ${project}` : recipient;
    const updated: Asset = {
      ...asset,
      status: 'Verliehen',
      assignedTo: assignedToValue,
      nextReturn: due,
      lastCheckout: new Date().toLocaleDateString('de-DE'),
      notes: metadataLines.length ? `${asset.notes}\n${metadataLines.join('\n')}`.trim() : asset.notes,
    };
    await saveAsset(updated);
  };

  const checkinAsset = async (assetId: string, conditionNote?: string, projectHint?: string) => {
    const asset = assets.find((item) => item.id === assetId);
    if (!asset) return;
    const note =
      conditionNote ||
      (await prompt({
        title: 'Rücknahme-Notiz',
        message: 'Optionaler Zustand/Kommentar',
        defaultValue: '',
      })) ||
      '';
    const project = projectHint?.trim() || '';
    const returnLines = [
      `Rücknahme: ${note}`,
      `Rücknahme durch: ${currentOperatorName}`,
      project ? `Projektkontext: ${project}` : '',
    ].filter(Boolean);
    const updated: Asset = {
      ...asset,
      status: 'Verfügbar',
      assignedTo: '-',
      nextReturn: '-',
      nextReservation: '-',
      notes: `${asset.notes}\n${returnLines.join('\n')}`.trim(),
    };
    await saveAsset(updated);
  };

  const setAssetMaintenance = async (assetId: string) => {
    const asset = assets.find((item) => item.id === assetId);
    if (!asset) return;
    const note = await prompt({
      title: 'In Wartung setzen',
      message: 'Wartungsgrund',
      defaultValue: 'Prüfung erforderlich',
      required: true,
      submitLabel: 'Setzen',
    });
    if (!note?.trim()) return;
    const updated: Asset = {
      ...asset,
      status: 'In Wartung',
      maintenanceState: note.trim(),
    };
    await saveAsset(updated);
    await addActivity('Asset in Wartung', `${asset.name}: ${note.trim()}`, asset.id);
  };

  const editAsset = async (assetId: string) => {
    const asset = assets.find((item) => item.id === assetId);
    if (!asset) return;
    const name = (await prompt({
      title: 'Gerät bearbeiten',
      message: 'Gerätename',
      defaultValue: asset.name,
      required: true,
      submitLabel: 'Weiter',
    })) || asset.name;
    const location = (await prompt({
      title: 'Gerät bearbeiten',
      message: 'Standort',
      defaultValue: asset.location,
      required: true,
      submitLabel: 'Weiter',
    })) || asset.location;
    const notes =
      (await prompt({
        title: 'Gerät bearbeiten',
        message: 'Notizen',
        defaultValue: asset.notes,
        multiline: true,
      })) ?? asset.notes;
    const updated: Asset = { ...asset, name: name.trim(), location: location.trim(), notes };
    await saveAsset(updated);
    await addActivity('Asset bearbeitet', `${updated.name} wurde aktualisiert.`, updated.id);
  };

  const createReservation = async () => {
    const team = await prompt({
      title: 'Reservierung anlegen',
      message: 'Team',
      required: true,
      submitLabel: 'Weiter',
    });
    if (!team?.trim()) return;
    const requestedBy =
      (await prompt({
        title: 'Reservierung anlegen',
        message: 'Ansprechpartner',
        defaultValue: 'Unbekannt',
        submitLabel: 'Weiter',
      })) || 'Unbekannt';
    const period =
      (await prompt({
        title: 'Reservierung anlegen',
        message: 'Zeitraum',
        defaultValue: 'Heute - Morgen',
        submitLabel: 'Weiter',
      })) || 'Heute - Morgen';
    const location =
      (await prompt({
        title: 'Reservierung anlegen',
        message: 'Ort',
        defaultValue: 'Hauptlager',
        submitLabel: 'Weiter',
      })) || 'Hauptlager';
    const assetsCsv =
      (await prompt({
        title: 'Reservierung anlegen',
        message: 'Assets (kommagetrennt)',
        defaultValue: assets
          .slice(0, 2)
          .map((a) => a.name)
          .join(', '),
        submitLabel: 'Erstellen',
      })) || '';
    const reservation: ReservationItem = {
      id: createId('res'),
      team: team.trim(),
      requestedBy: requestedBy.trim(),
      period: period.trim(),
      assets: assetsCsv
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
      status: 'Angefragt',
      location: location.trim(),
    };
    setReservations((prev) => [reservation, ...prev]);
    try {
      await upsertReservation(reservation);
      await addActivity('Reservierung erstellt', `${reservation.team} wurde als Reservierung angelegt.`);
    } catch {
      setWmsError('Reservierung konnte nicht im Backend gespeichert werden.');
    }
  };

  const editReservation = async (id: string) => {
    const existing = reservations.find((item) => item.id === id);
    if (!existing) return;
    const period =
      (await prompt({
        title: 'Reservierung bearbeiten',
        message: 'Zeitraum',
        defaultValue: existing.period,
        submitLabel: 'Weiter',
      })) || existing.period;
    const statusInput =
      ((await prompt({
        title: 'Reservierung bearbeiten',
        message: 'Status (Angefragt, Bestätigt, Aktiv, Abgeschlossen, Storniert)',
        defaultValue: existing.status,
        submitLabel: 'Speichern',
      })) as ReservationItem['status']) || existing.status;
    const updated: ReservationItem = { ...existing, period: period.trim(), status: statusInput };
    setReservations((prev) => prev.map((item) => (item.id === id ? updated : item)));
    try {
      await upsertReservation(updated);
    } catch {
      setWmsError('Reservierung konnte nicht aktualisiert werden.');
    }
  };

  const checkoutReservation = async (id: string) => {
    const existing = reservations.find((item) => item.id === id);
    if (!existing) return;
    const updated: ReservationItem = { ...existing, status: 'Aktiv' };
    setReservations((prev) => prev.map((item) => (item.id === id ? updated : item)));
    try {
      await upsertReservation(updated);
    } catch {
      setWmsError('Reservierung konnte nicht auf Aktiv gesetzt werden.');
    }
    const matchedAssets = assets.filter((asset) => existing.assets.includes(asset.name));
    for (const asset of matchedAssets) {
      // eslint-disable-next-line no-await-in-loop
      await checkoutAsset(asset.id, existing.team, existing.period);
    }
  };

  const cancelReservation = async (id: string) => {
    const existing = reservations.find((item) => item.id === id);
    if (!existing) return;
    const updated: ReservationItem = { ...existing, status: 'Storniert' };
    setReservations((prev) => prev.map((item) => (item.id === id ? updated : item)));
    try {
      await upsertReservation(updated);
      await addActivity('Reservierung storniert', `${existing.id} wurde storniert.`);
    } catch {
      setWmsError('Reservierung konnte nicht storniert werden.');
    }
  };

  const createMaintenance = async (payload: CreateMaintenancePayload) => {
    const item: MaintenanceItem = {
      id: createId('mnt'),
      assetName: payload.assetName,
      issue: payload.issue,
      comment: payload.comment || 'Neu erfasst',
      reportedAt: new Date().toLocaleDateString('de-DE'),
      dueDate: new Date(Date.now() + 4 * 86400000).toLocaleDateString('de-DE'),
      priority: payload.priority ?? 'Mittel',
      status: payload.status ?? 'Offen',
      location: payload.location?.trim() || 'Werkstatt',
    };
    setMaintenanceItems((prev) => [item, ...prev]);
    try {
      await upsertMaintenance(item);
      const relatedAsset = findAssetForMaintenance(assets, item.assetName);
      if (relatedAsset) {
        await saveAsset({
          ...relatedAsset,
          status: 'Defekt',
          maintenanceState: 'Defekt gemeldet',
        });
      }
      await addActivity('Defektmeldung erstellt', `${item.assetName}: ${item.issue}`);
    } catch {
      setWmsError('Defektmeldung konnte nicht gespeichert werden.');
      setMaintenanceItems((prev) => prev.filter((entry) => entry.id !== item.id));
      await loadWms();
    }
  };

  const updateMaintenanceStatus = async (maintenanceId: string, status: MaintenanceItem['status']) => {
    const existing = maintenanceItems.find((item) => item.id === maintenanceId);
    if (!existing) return;
    if (!canTransitionMaintenanceStatus(existing.status, status)) {
      await alert({
        title: 'Statuswechsel nicht erlaubt',
        message: `Erlaubt ist nur Offen → In Bearbeitung → Erledigt.`,
      });
      return;
    }

    const updatedItem: MaintenanceItem = { ...existing, status };
    setMaintenanceItems((prev) => prev.map((item) => (item.id === maintenanceId ? updatedItem : item)));

    try {
      await upsertMaintenance(updatedItem);
    } catch {
      setWmsError('Defektstatus konnte nicht gespeichert werden.');
      setMaintenanceItems((prev) => prev.map((item) => (item.id === maintenanceId ? existing : item)));
      await loadWms();
      await alert({
        title: 'Defektstatus nicht gespeichert',
        message: 'Der Statuswechsel wurde nicht übernommen. Die Daten wurden neu geladen.',
      });
      return;
    }

    const relatedAsset = findAssetForMaintenance(assets, existing.assetName);
    if (!relatedAsset) {
      await addActivity('Defektstatus aktualisiert', `${existing.assetName}: ${status}`);
      return;
    }

    let nextAssetStatus: Asset['status'] = relatedAsset.status;
    let nextMaintenanceState = relatedAsset.maintenanceState;

    if (status === 'Offen') {
      nextAssetStatus = 'Defekt';
      nextMaintenanceState = 'Defekt gemeldet';
    } else if (status === 'In Bearbeitung') {
      nextAssetStatus = 'In Wartung';
      nextMaintenanceState = 'Reparatur in Bearbeitung';
    } else if (status === 'Erledigt') {
      const activeOtherItems = maintenanceItems
        .map((item) => (item.id === maintenanceId ? updatedItem : item))
        .filter(
          (item) =>
            item.id !== maintenanceId &&
            (item.assetName === existing.assetName ||
              findAssetForMaintenance(assets, item.assetName)?.id === relatedAsset.id) &&
            (
              item.status === 'Offen' ||
              item.status === 'In Bearbeitung' ||
              item.status === 'In Arbeit' ||
              item.status === 'Wartet auf Teile'
            ),
        );

      if (activeOtherItems.some((item) => item.status === 'In Bearbeitung')) {
        nextAssetStatus = 'In Wartung';
        nextMaintenanceState = 'Reparatur in Bearbeitung';
      } else if (activeOtherItems.length) {
        nextAssetStatus = 'Defekt';
        nextMaintenanceState = 'Defekt gemeldet';
      } else if (relatedAsset.status === 'Defekt' || relatedAsset.status === 'In Wartung') {
        nextAssetStatus = 'Verfügbar';
        nextMaintenanceState = 'Wartung erledigt';
      }
    }

    await saveAsset({
      ...relatedAsset,
      status: nextAssetStatus,
      maintenanceState: nextMaintenanceState,
    });
    await addActivity('Defektstatus aktualisiert', `${relatedAsset.name}: ${status}`, relatedAsset.id);
  };

  const inviteUser = async (payload: UserUpsertInput) => {
    const user: UserItem = {
      id: createId('usr'),
      name: payload.name.trim(),
      email: payload.email.trim(),
      role: normalizeUserRole(payload.role),
      lastActive: 'Gerade erstellt',
      status: normalizeUserStatus(payload.status),
      department: payload.department?.trim() || undefined,
      location: payload.location?.trim() || undefined,
    };
    setUsers((prev) => [user, ...prev]);
    try {
      await upsertUser(user);
      await addActivity('Benutzer erstellt', `${user.name} wurde eingeladen.`);
    } catch {
      setWmsError('Benutzer konnte nicht gespeichert werden.');
      throw new Error('Benutzer konnte nicht gespeichert werden.');
    }
  };

  const editUser = async (payload: UserUpsertInput) => {
    if (!payload.id) return;
    const existing = users.find((user) => user.id === payload.id);
    if (!existing) return;

    const updated: UserItem = {
      ...existing,
      name: payload.name.trim(),
      email: payload.email.trim(),
      role: normalizeUserRole(payload.role),
      status: normalizeUserStatus(payload.status),
      department: payload.department?.trim() || undefined,
      location: payload.location?.trim() || undefined,
      lastActive: 'Gerade bearbeitet',
    };

    setUsers((prev) => prev.map((item) => (item.id === payload.id ? updated : item)));
    try {
      await upsertUser(updated);
      await addActivity('Benutzer bearbeitet', `${updated.name} wurde aktualisiert.`);
    } catch {
      setWmsError('Benutzer konnte nicht aktualisiert werden.');
      throw new Error('Benutzer konnte nicht aktualisiert werden.');
    }
  };

  const adminBulkDeleteUsers = async (userIds: string[]): Promise<BulkUserDeleteResponse> => {
    const sessionUserId = getAuthSession()?.user.userId;
    const trimmed = userIds
      .map((id) => id.trim())
      .filter((id, index, arr) => Boolean(id) && arr.indexOf(id) === index);
    if (sessionUserId && trimmed.includes(sessionUserId)) {
      throw new Error('Du kannst deinen eigenen Benutzer nicht löschen.');
    }
    if (!trimmed.length) {
      return { deletedCount: 0, skippedCount: 0, results: [] };
    }

    const previousUsers = users;
    const optimistic = users.filter((user) => !trimmed.includes(user.id));
    setUsers(optimistic);
    try {
      const result = await deleteUsersBulk(trimmed);
      if (result.deletedCount > 0) {
        await addActivity(
          'Benutzer gelöscht',
          `${result.deletedCount} Benutzer wurden gelöscht.`,
        );
      }
      if (result.skippedCount > 0) {
        await loadWms();
      }
      return result;
    } catch (error) {
      setUsers(previousUsers);
      setWmsError('Bulk-Löschen fehlgeschlagen.');
      await loadWms();
      if (error instanceof Error) throw error;
      throw new Error('Bulk-Löschen fehlgeschlagen.');
    }
  };

  const adminDeleteUser = async (userId: string) => {
    const currentUserId = getAuthSession()?.user.userId;
    if (currentUserId && currentUserId === userId) {
      throw new Error('Du kannst deinen eigenen Benutzer nicht löschen.');
    }

    const target = users.find((user) => user.id === userId);
    if (!target) {
      return;
    }

    setUsers((prev) => prev.filter((item) => item.id !== userId));
    try {
      const result = await deleteUserRequest(userId);
      if (!result.deleted) {
        throw new Error('Benutzer wurde nicht gefunden.');
      }
      await addActivity('Benutzer gelöscht', `${target.name} wurde gelöscht.`);
    } catch (error) {
      setWmsError('Benutzer konnte nicht gelöscht werden.');
      await loadWms();
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Benutzer konnte nicht gelöscht werden.');
    }
  };

  const adminResetUserPassword = async (
    userId: string,
    payload: { newPassword?: string; generateTemporary?: boolean },
  ) => {
    try {
      const response = await resetUserPassword(userId, payload);
      const target = users.find((item) => item.id === userId);
      await addActivity('Passwort zurückgesetzt', `${target?.name ?? userId} Passwort zurückgesetzt.`);
      return response;
    } catch (error) {
      setWmsError('Passwort konnte nicht zurückgesetzt werden.');
      if (error instanceof Error) throw error;
      throw new Error('Passwort konnte nicht zurückgesetzt werden.');
    }
  };

  const openLocationInventory = (name: string) => {
    setSearch(name);
    setActivePage('inventory');
  };

  const openInventoryWithQuery = (query: string) => {
    setSearch(query);
    setActivePage('inventory');
  };

  const editLocation = async (name: string) => {
    const location = locations.find((item) => item.name === name);
    if (!location) return;
    const manager =
      (await prompt({
        title: `Standort ${name}`,
        message: 'Verantwortlich',
        defaultValue: location.manager,
        submitLabel: 'Weiter',
      })) || location.manager;
    const capacity =
      (await prompt({
        title: `Standort ${name}`,
        message: 'Kapazität',
        defaultValue: location.capacity,
        submitLabel: 'Speichern',
      })) || location.capacity;
    const updated: LocationItem = { ...location, manager: manager.trim(), capacity: capacity.trim() };
    setLocations((prev) => prev.map((item) => (item.name === name ? updated : item)));
    try {
      await upsertLocation(updated);
    } catch {
      setWmsError('Standort konnte nicht aktualisiert werden.');
    }
  };

  const openHelp = () => {
    window.open('/api/docs', '_blank', 'noopener,noreferrer');
  };

  const openNotifications = () => {
    void (async () => {
      const latest = activities.slice(0, 3);
      if (!latest.length) {
        await alert({
          title: 'Aktivitäten',
          message: 'Keine neuen Aktivitäten.',
        });
        return;
      }
      const message = latest.map((item) => `- ${item.title}: ${item.detail}`).join('\n');
      await alert({
        title: 'Neueste Aktivitäten',
        message,
      });
    })();
  };

  const openProfile = () => {
    setActivePage(activeRole === 'Admin' ? 'users' : 'dashboard');
  };

  const setProjectContext = (value: string) => {
    setProjectContextState(value);
  };

  const checkoutFromForm = async (payload: CheckoutPayload) => {
    await checkoutAsset(
      payload.assetId,
      payload.assignee,
      payload.dueDate,
      payload.note,
      payload.projectName,
    );
  };

  const checkinFromForm = async (payload: CheckinPayload) => {
    await checkinAsset(payload.assetId, payload.condition, payload.projectName);
  };

  return {
    loadWms,
    theme,
    toggleTheme,
    activeRole,
    projectContext,
    setProjectContext,
    isLoading,
    isRefreshing,
    // True solange der erste Overview-Call noch läuft / fehlgeschlagen ist.
    // Pages nutzen das, um Skeleton/Platzhalter statt 0-Werten anzuzeigen.
    isInitialLoading: !hasLoadedOnce,
    wmsError,
    activePage,
    setActivePage,
    search,
    setSearch,
    mobileSidebarOpen,
    setMobileSidebarOpen,
    selectedAsset,
    assets,
    activities,
    reservations,
    maintenanceItems,
    locations,
    users,
    planningSummary,
    categories,
    createCategory,
    deleteCategory: deleteCategoryAction,
    openAssetDetail,
    createAsset,
    createAssetFromInput,
    adminUpdateAsset,
    adminDeleteAsset,
    reserveAsset,
    checkoutAsset,
    checkinAsset,
    setAssetMaintenance,
    editAsset,
    createReservation,
    editReservation,
    checkoutReservation,
    cancelReservation,
    createMaintenance,
    updateMaintenanceStatus,
    inviteUser,
    editUser,
    adminResetUserPassword,
    adminDeleteUser,
    adminBulkDeleteUsers,
    openLocationInventory,
    openInventoryWithQuery,
    editLocation,
    openHelp,
    openNotifications,
    openProfile,
    checkoutFromForm,
    checkinFromForm,
  };
}
