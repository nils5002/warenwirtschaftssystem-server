import { ChevronDown, ChevronUp, ClipboardCheck, Handshake, QrCode, ScanLine, Undo2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { InlineLoadingState, LoadingButton } from '../../components/loading';
import { listPlannings, type PlanningListItem } from '../../services/wmsApi';
import { resolveAssetByScan } from '../qr';
import { QrScannerDialog } from '../components/QrScannerDialog';
import { StatusBadge } from '../components/StatusBadge';
import type { AppRole, Asset, UserItem } from '../types';

type CheckinCheckoutPageProps = {
  assets: Asset[];
  users: UserItem[];
  isMobile?: boolean;
  activeRole: AppRole;
  operatorName: string;
  projectContext: string;
  onProjectContextChange: (value: string) => void;
  onCheckout: (payload: {
    assetId: string;
    assignee: string;
    projectName?: string;
    dueDate: string;
    note: string;
  }) => Promise<void>;
  onCheckin: (payload: { assetId: string; condition: string; projectName?: string }) => Promise<void>;
};

type Mode = 'checkout' | 'checkin';
type FlowMessage = { kind: 'error' | 'success' | 'info'; text: string };

type QueueEntry = {
  assetId: string;
  name: string;
  category: string;
  status: string;
  contextProject: string;
  assignedTo: string;
};

type BatchFailure = { assetId: string; name: string; reason: string };

const QUEUE_VISIBLE_LIMIT = 3;

function toIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseProjectFromAsset(asset: Asset): string {
  const projectLine = asset.notes
    .split('\n')
    .reverse()
    .find((line) => line.trim().toLowerCase().startsWith('projekt:'));
  if (!projectLine) return '';
  return projectLine.replace(/^projekt:\s*/i, '').trim();
}

function parseProjectFromAssignedTo(asset: Asset): string {
  const parts = asset.assignedTo
    .split('·')
    .map((item) => item.trim())
    .filter(Boolean);
  if (parts.length < 2) return '';
  return parts[parts.length - 1];
}

function getDisplayAssetName(asset: Asset): string {
  return (
    asset.name?.trim() ||
    asset.model?.trim() ||
    asset.serialNumber?.trim() ||
    asset.tagNumber?.trim() ||
    asset.id
  );
}

export function CheckinCheckoutPage({
  assets,
  users,
  isMobile = false,
  activeRole,
  operatorName,
  projectContext,
  onProjectContextChange,
  onCheckout,
  onCheckin,
}: CheckinCheckoutPageProps) {
  const today = useMemo(() => toIsoDate(new Date()), []);
  const plusTwoDays = useMemo(() => toIsoDate(new Date(Date.now() + 2 * 86400000)), []);

  const [mode, setMode] = useState<Mode>('checkout');
  const [message, setMessage] = useState<FlowMessage | null>(null);

  const [checkoutAssetId, setCheckoutAssetId] = useState<string>('');
  const [checkoutAssignee, setCheckoutAssignee] = useState('');
  const [checkoutProject, setCheckoutProject] = useState('');
  const [checkoutDueDate, setCheckoutDueDate] = useState(plusTwoDays);
  const [checkoutNote, setCheckoutNote] = useState('');
  const [checkoutScan, setCheckoutScan] = useState('');

  const [checkinAssetId, setCheckinAssetId] = useState<string>('');
  const [currentCheckoutAssetId, setCurrentCheckoutAssetId] = useState<string | null>(null);
  const [currentCheckinAssetId, setCurrentCheckinAssetId] = useState<string | null>(null);
  const [checkinCondition, setCheckinCondition] = useState('');
  const [checkinProject, setCheckinProject] = useState('');
  const [checkinScan, setCheckinScan] = useState('');

  const [lastAssignee, setLastAssignee] = useState('');
  const [lastProject, setLastProject] = useState('');

  const [scannerTarget, setScannerTarget] = useState<Mode | null>(null);
  const [showCheckoutOptions, setShowCheckoutOptions] = useState(false);
  const [showCheckinOptions, setShowCheckinOptions] = useState(false);
  // projectPickerMode steuert das Bottom-Sheet für die mobile Projekt-
  // auswahl. 'checkout' / 'checkin' = offen für den jeweiligen Modus,
  // null = geschlossen. Das gleiche Sheet wird so für Ausgabe und
  // Rücknahme wiederverwendet, ohne dass sich beide States gegenseitig
  // überschreiben.
  const [projectPickerMode, setProjectPickerMode] = useState<Mode | null>(null);
  const [projectPickerSearch, setProjectPickerSearch] = useState('');
  const [planningProjects, setPlanningProjects] = useState<PlanningListItem[]>([]);
  const [preferAutoFocus, setPreferAutoFocus] = useState(false);
  const [planningProjectsLoading, setPlanningProjectsLoading] = useState(false);
  const [scanBusyMode, setScanBusyMode] = useState<Mode | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkinBusy, setCheckinBusy] = useState(false);

  // Batch-Scan-State: jede Scan-Aktion legt einen Eintrag hier ab. Die
  // bestehenden Einzel-Selektion-States (checkoutAssetId, ...) bleiben
  // erhalten — sie spiegeln einfach den zuletzt gescannten Eintrag wider.
  const [checkoutQueue, setCheckoutQueue] = useState<QueueEntry[]>([]);
  const [checkinQueue, setCheckinQueue] = useState<QueueEntry[]>([]);
  const [batchSubmitting, setBatchSubmitting] = useState<Mode | null>(null);
  const [lastBatchFailures, setLastBatchFailures] = useState<BatchFailure[]>([]);
  const [showAllCheckoutQueue, setShowAllCheckoutQueue] = useState(false);
  const [showAllCheckinQueue, setShowAllCheckinQueue] = useState(false);

  const checkoutScanRef = useRef<HTMLInputElement | null>(null);
  const checkoutRecipientRef = useRef<HTMLInputElement | null>(null);
  const checkoutProjectRef = useRef<HTMLInputElement | null>(null);
  const checkoutSubmitRef = useRef<HTMLButtonElement | null>(null);
  const checkinScanRef = useRef<HTMLInputElement | null>(null);
  const checkinSubmitRef = useRef<HTMLButtonElement | null>(null);

  const focusElement = (element: HTMLElement | null) => {
    if (!element) return;
    window.requestAnimationFrame(() => {
      element.focus();
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        element.select();
      }
    });
  };

  useEffect(() => {
    void (async () => {
      setPlanningProjectsLoading(true);
      try {
        const planning = await listPlannings();
        setPlanningProjects(planning.filter((item) => ['Geplant', 'Bestätigt', 'Entwurf'].includes(item.status)));
      } catch {
        setPlanningProjects([]);
      } finally {
        setPlanningProjectsLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!assets.length) {
      setCheckoutAssetId('');
      setCheckinAssetId('');
      setCurrentCheckoutAssetId(null);
      setCurrentCheckinAssetId(null);
      return;
    }
    if (checkoutAssetId && !assets.some((asset) => asset.id === checkoutAssetId)) {
      setCheckoutAssetId('');
      setCurrentCheckoutAssetId(null);
    }
    if (checkinAssetId && !assets.some((asset) => asset.id === checkinAssetId)) {
      setCheckinAssetId('');
      setCurrentCheckinAssetId(null);
    }
  }, [assets, checkoutAssetId, checkinAssetId]);

  const checkoutAsset = assets.find((asset) => asset.id === checkoutAssetId) ?? null;
  const checkinAsset = assets.find((asset) => asset.id === checkinAssetId) ?? null;

  const checkoutContextProject = checkoutAsset
    ? parseProjectFromAsset(checkoutAsset) || parseProjectFromAssignedTo(checkoutAsset)
    : '';

  const checkinContextProject = checkinAsset
    ? parseProjectFromAsset(checkinAsset) || parseProjectFromAssignedTo(checkinAsset)
    : '';

  const userOptions = useMemo(() => {
    const names = users.filter((user) => user.status === 'Aktiv').map((user) => user.name);
    if (lastAssignee.trim()) names.unshift(lastAssignee.trim());
    return [...new Set(names)];
  }, [users, lastAssignee]);

  const projectOptions = useMemo(() => {
    const options = planningProjects.map((planning) => `${planning.customerName} · ${planning.projectName}`);
    if (projectContext.trim()) options.unshift(projectContext.trim());
    return [...new Set(options)];
  }, [planningProjects, projectContext]);

  const checkoutProjectOptions = useMemo(() => {
    const options = [...projectOptions];
    if (lastProject.trim()) options.unshift(lastProject.trim());
    return [...new Set(options)];
  }, [projectOptions, lastProject]);

  // Beim Check-in wollen wir nicht den "lastProject"-Vorschlag aus dem
  // letzten Checkout reinmischen — die Rücknahme bezieht sich auf das
  // Projekt, aus dem das Gerät zurückkommt. Deshalb: Checkout nutzt die
  // angereicherte Liste (mit lastProject), Check-in die schlichte
  // Projektliste aus aktiven Planungen + aktuellem Projektkontext.
  const checkinProjectOptions = projectOptions;

  const projectPickerSourceOptions =
    projectPickerMode === 'checkin' ? checkinProjectOptions : checkoutProjectOptions;

  const filteredProjectOptions = useMemo(() => {
    const needle = projectPickerSearch.trim().toLowerCase();
    if (!needle) return projectPickerSourceOptions;
    return projectPickerSourceOptions.filter((item) => item.toLowerCase().includes(needle));
  }, [projectPickerSourceOptions, projectPickerSearch]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const touchLike = window.matchMedia('(hover: none), (pointer: coarse)').matches;
    setPreferAutoFocus(!touchLike || window.innerWidth >= 1024);
  }, []);

  useEffect(() => {
    if (!preferAutoFocus) return;
    if (mode === 'checkout') {
      focusElement(checkoutScanRef.current);
      return;
    }
    focusElement(checkinScanRef.current);
  }, [mode, preferAutoFocus]);

  useEffect(() => {
    if (!checkoutProject.trim()) {
      if (projectContext.trim()) {
        setCheckoutProject(projectContext.trim());
        return;
      }
      if (lastProject.trim()) {
        setCheckoutProject(lastProject.trim());
      }
    }
  }, [projectContext, checkoutProject, lastProject]);

  useEffect(() => {
    if (!checkoutAssignee.trim() && lastAssignee.trim()) {
      setCheckoutAssignee(lastAssignee.trim());
    }
  }, [checkoutAssignee, lastAssignee]);

  const resetCheckinState = () => {
    setCheckinAssetId('');
    setCurrentCheckinAssetId(null);
    setCheckinProject('');
    setCheckinCondition('');
    setCheckinScan('');
    setShowCheckinOptions(false);
    setCheckinQueue([]);
    setShowAllCheckinQueue(false);
  };

  const resetCheckoutState = () => {
    setCheckoutAssetId('');
    setCurrentCheckoutAssetId(null);
    setCheckoutScan('');
    setShowCheckoutOptions(false);
    setCheckoutQueue([]);
    setShowAllCheckoutQueue(false);
  };

  const applyCheckoutScan = async (rawScan?: string): Promise<boolean> => {
    setScanBusyMode('checkout');
    const scanValue = (rawScan ?? checkoutScan).trim();
    try {
      if (!scanValue) {
        setScannerTarget('checkout');
        return false;
      }

      const asset = resolveAssetByScan(scanValue, assets);
      if (!asset) {
        setMessage({
          kind: 'error',
          text: 'Unbekannter QR-Code. Bitte erneut scannen oder Inventarnummer prüfen.',
        });
        focusElement(checkoutScanRef.current);
        return false;
      }

      // Bereits in der Zwischenablage?
      if (checkoutQueue.some((entry) => entry.assetId === asset.id)) {
        setMessage({
          kind: 'info',
          text: `${getDisplayAssetName(asset)} ist bereits in der Scan-Liste.`,
        });
        setCheckoutScan('');
        focusElement(checkoutScanRef.current);
        return true;
      }

      if (asset.status === 'Verliehen') {
        setMessage({
          kind: 'error',
          text: `Gerät ist bereits verliehen an ${asset.assignedTo}.`,
        });
        focusElement(checkoutScanRef.current);
        return true;
      }

      if (asset.status !== 'Verfügbar') {
        setMessage({
          kind: 'error',
          text: `Gerät kann derzeit nicht ausgegeben werden (Status: ${asset.status}).`,
        });
        focusElement(checkoutScanRef.current);
        return true;
      }

      // Validiert → in die Scan-Liste übernehmen.
      const parsedProject = parseProjectFromAsset(asset) || parseProjectFromAssignedTo(asset);
      if (parsedProject && !checkoutProject.trim()) {
        setCheckoutProject(parsedProject);
      }
      const displayName = getDisplayAssetName(asset);
      setCheckoutQueue((prev) => [
        ...prev,
        {
          assetId: asset.id,
          name: displayName,
          category: asset.category,
          status: asset.status,
          contextProject: parsedProject,
          assignedTo: asset.assignedTo,
        },
      ]);
      setCheckoutAssetId(asset.id);
      setCurrentCheckoutAssetId(asset.id);
      setCheckoutScan('');
      setLastBatchFailures([]);
      setMessage({ kind: 'success', text: `${displayName} hinzugefügt.` });
      focusElement(checkoutScanRef.current);
      return true;
    } finally {
      setScanBusyMode((current) => (current === 'checkout' ? null : current));
    }
  };

  const applyCheckinScan = async (rawScan?: string): Promise<boolean> => {
    setScanBusyMode('checkin');
    const scanValue = (rawScan ?? checkinScan).trim();
    try {
      if (!scanValue) {
        setScannerTarget('checkin');
        return false;
      }

      const asset = resolveAssetByScan(scanValue, assets);
      if (!asset) {
        setMessage({
          kind: 'error',
          text: 'Unbekannter QR-Code. Bitte erneut scannen oder Inventarnummer prüfen.',
        });
        focusElement(checkinScanRef.current);
        return false;
      }

      // Bereits in der Rücknahme-Liste?
      if (checkinQueue.some((entry) => entry.assetId === asset.id)) {
        setMessage({
          kind: 'info',
          text: `${getDisplayAssetName(asset)} ist bereits in der Rücknahme-Liste.`,
        });
        setCheckinScan('');
        focusElement(checkinScanRef.current);
        return true;
      }

      if (asset.status === 'Verfügbar') {
        setMessage({
          kind: 'error',
          text: 'Dieses Gerät ist bereits verfügbar und wurde schon zurückgenommen.',
        });
        focusElement(checkinScanRef.current);
        return true;
      }

      if (asset.status !== 'Verliehen') {
        setMessage({
          kind: 'error',
          text: `Rücknahme nicht möglich. Gerät ist aktuell im Status "${asset.status}".`,
        });
        focusElement(checkinScanRef.current);
        return true;
      }

      const parsedProject = parseProjectFromAsset(asset) || parseProjectFromAssignedTo(asset);
      const displayName = getDisplayAssetName(asset);
      setCheckinQueue((prev) => [
        ...prev,
        {
          assetId: asset.id,
          name: displayName,
          category: asset.category,
          status: asset.status,
          contextProject: parsedProject,
          assignedTo: asset.assignedTo,
        },
      ]);
      setCheckinAssetId(asset.id);
      setCurrentCheckinAssetId(asset.id);
      setCheckinScan('');
      setLastBatchFailures([]);
      setMessage({ kind: 'success', text: `${displayName} hinzugefügt.` });
      focusElement(checkinScanRef.current);
      return true;
    } finally {
      setScanBusyMode((current) => (current === 'checkin' ? null : current));
    }
  };

  const onDetectedByCamera = (value: string) => {
    const target = scannerTarget;
    setScannerTarget(null);
    if (!target) return;
    if (target === 'checkout') {
      void applyCheckoutScan(value);
      return;
    }
    void applyCheckinScan(value);
  };

  const checkoutNow = async () => {
    if (checkoutQueue.length === 0 || batchSubmitting === 'checkout') {
      setMessage({ kind: 'error', text: 'Bitte zuerst Geräte scannen.' });
      focusElement(checkoutScanRef.current);
      return;
    }

    const normalizedProject =
      checkoutProject.trim() ||
      projectContext.trim() ||
      checkoutContextProject ||
      lastProject.trim() ||
      checkoutProjectOptions[0] ||
      'Allgemeiner Einsatz';

    const normalizedAssignee = checkoutAssignee.trim() || '-';
    const normalizedNote = checkoutNote.trim();
    const total = checkoutQueue.length;

    setBatchSubmitting('checkout');
    setCheckoutBusy(true);
    setLastBatchFailures([]);

    const failures: BatchFailure[] = [];
    const successIds = new Set<string>();

    for (const entry of checkoutQueue) {
      try {
        await onCheckout({
          assetId: entry.assetId,
          assignee: normalizedAssignee,
          projectName: normalizedProject,
          dueDate: checkoutDueDate,
          note: normalizedNote,
        });
        successIds.add(entry.assetId);
      } catch (err) {
        const reason =
          err instanceof Error && err.message
            ? err.message
            : 'Buchung konnte nicht abgeschlossen werden.';
        failures.push({ assetId: entry.assetId, name: entry.name, reason });
      }
    }

    setCheckoutQueue((prev) => prev.filter((entry) => !successIds.has(entry.assetId)));
    setLastBatchFailures(failures);

    if (successIds.size > 0) {
      if (checkoutAssignee.trim()) {
        setLastAssignee(checkoutAssignee.trim());
      }
      setLastProject(normalizedProject);
      setCheckoutProject(normalizedProject);
    }

    const successCount = successIds.size;
    if (failures.length === 0) {
      setCheckoutNote('');
      resetCheckoutState();
      setMessage({
        kind: 'success',
        text:
          successCount === 1
            ? 'Ein Gerät wurde ausgegeben.'
            : `${successCount} Geräte wurden ausgegeben.`,
      });
    } else if (successCount === 0) {
      setMessage({
        kind: 'error',
        text: 'Keine Ausgabe gebucht. Siehe Fehlerliste.',
      });
    } else {
      setMessage({
        kind: 'error',
        text: `${successCount} von ${total} Geräten ausgegeben — ${failures.length} fehlgeschlagen.`,
      });
    }

    setCheckoutBusy(false);
    setBatchSubmitting(null);
    focusElement(checkoutScanRef.current);
  };

  const checkinNow = async () => {
    if (checkinQueue.length === 0 || batchSubmitting === 'checkin') {
      setMessage({ kind: 'error', text: 'Bitte zuerst Geräte scannen.' });
      focusElement(checkinScanRef.current);
      return;
    }

    const explicitProject = checkinProject.trim();
    const normalizedCondition = checkinCondition.trim() || 'Zustand geprüft.';
    const total = checkinQueue.length;

    setBatchSubmitting('checkin');
    setCheckinBusy(true);
    setLastBatchFailures([]);

    const failures: BatchFailure[] = [];
    const successIds = new Set<string>();

    for (const entry of checkinQueue) {
      // Projekt-Plausibilitätsprüfung pro Gerät: wenn der Nutzer ein
      // Projekt explizit gewählt hat und das Gerät einem anderen Projekt
      // zugeordnet ist, ist das ein Konflikt — Eintrag zurückbehalten.
      if (explicitProject && entry.contextProject && entry.contextProject !== explicitProject) {
        failures.push({
          assetId: entry.assetId,
          name: entry.name,
          reason: `Projekt passt nicht (zugeordnet: ${entry.contextProject}).`,
        });
        continue;
      }

      const resolvedProject = explicitProject || entry.contextProject;
      try {
        await onCheckin({
          assetId: entry.assetId,
          condition: normalizedCondition,
          projectName: resolvedProject,
        });
        successIds.add(entry.assetId);
      } catch (err) {
        const reason =
          err instanceof Error && err.message
            ? err.message
            : 'Rücknahme konnte nicht abgeschlossen werden.';
        failures.push({ assetId: entry.assetId, name: entry.name, reason });
      }
    }

    setCheckinQueue((prev) => prev.filter((entry) => !successIds.has(entry.assetId)));
    setLastBatchFailures(failures);

    const successCount = successIds.size;
    if (failures.length === 0) {
      resetCheckinState();
      setMessage({
        kind: 'success',
        text:
          successCount === 1
            ? 'Ein Gerät wurde zurückgenommen.'
            : `${successCount} Geräte wurden zurückgenommen.`,
      });
    } else if (successCount === 0) {
      setMessage({
        kind: 'error',
        text: 'Keine Rücknahme gebucht. Siehe Fehlerliste.',
      });
    } else {
      setMessage({
        kind: 'error',
        text: `${successCount} von ${total} Geräten zurückgenommen — ${failures.length} fehlgeschlagen.`,
      });
    }

    setCheckinBusy(false);
    setBatchSubmitting(null);
    focusElement(checkinScanRef.current);
  };

  const messageClass =
    message?.kind === 'error'
      ? 'border-rose-200 bg-rose-50 text-rose-800'
      : message?.kind === 'success'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
        : 'border-sky-200 bg-sky-50 text-sky-800';

  const applyProjectSelection = (value: string) => {
    const normalized = value.trim();
    if (!normalized) return;
    // Schreibt das ausgewählte Projekt in den jeweils aktiven Modus,
    // damit Checkout- und Check-in-State nicht überlappen.
    if (projectPickerMode === 'checkin') {
      setCheckinProject(normalized);
    } else {
      setCheckoutProject(normalized);
    }
    setProjectPickerMode(null);
    setProjectPickerSearch('');
  };
  const isCheckoutScanBusy = scanBusyMode === 'checkout';
  const isCheckinScanBusy = scanBusyMode === 'checkin';
  const isAnyBusy = planningProjectsLoading || checkoutBusy || checkinBusy || isCheckoutScanBusy || isCheckinScanBusy;

  const removeFromCheckoutQueue = (assetId: string) => {
    setCheckoutQueue((prev) => prev.filter((entry) => entry.assetId !== assetId));
    setLastBatchFailures((prev) => prev.filter((failure) => failure.assetId !== assetId));
  };
  const removeFromCheckinQueue = (assetId: string) => {
    setCheckinQueue((prev) => prev.filter((entry) => entry.assetId !== assetId));
    setLastBatchFailures((prev) => prev.filter((failure) => failure.assetId !== assetId));
  };

  function renderScanQueueCard(params: {
    entries: QueueEntry[];
    mode: Mode;
    showAll: boolean;
    setShowAll: (next: boolean) => void;
    onRemove: (assetId: string) => void;
    onClear: () => void;
    failures: BatchFailure[];
  }) {
    const { entries, mode, showAll, setShowAll, onRemove, onClear, failures } = params;
    if (entries.length === 0 && failures.length === 0) return null;

    const failureById = new Map(failures.map((failure) => [failure.assetId, failure]));
    const visible = showAll ? entries : entries.slice(0, QUEUE_VISIBLE_LIMIT);
    const overflow = entries.length - visible.length;
    const headlineCount = entries.length;
    const headline =
      headlineCount === 0
        ? 'Zwischenablage geleert'
        : headlineCount === 1
          ? '1 Gerät vorbereitet'
          : `${headlineCount} Geräte vorbereitet`;

    return (
      <div
        data-testid={`scan-queue-${mode}`}
        className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Gescannte Geräte
            </p>
            <p className="mt-0.5 truncate text-sm font-semibold text-slate-900 dark:text-slate-50">
              {headline}
            </p>
          </div>
          {entries.length > 0 ? (
            <button
              type="button"
              className="shrink-0 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              onClick={onClear}
              disabled={batchSubmitting === mode}
            >
              Liste leeren
            </button>
          ) : null}
        </div>

        {entries.length > 0 ? (
          <ul
            className={`mt-2 space-y-1.5 ${entries.length > QUEUE_VISIBLE_LIMIT && !showAll ? '' : 'max-h-56 overflow-y-auto pr-1 soft-scrollbar'}`}
          >
            {visible.map((entry) => {
              const failure = failureById.get(entry.assetId);
              return (
                <li
                  key={entry.assetId}
                  className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-sm ${
                    failure
                      ? 'border-rose-200 bg-rose-50 dark:border-rose-400/40 dark:bg-rose-950/30'
                      : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950/40'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-slate-900 dark:text-slate-100">{entry.name}</p>
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                      {entry.category}
                      {mode === 'checkin' && entry.assignedTo && entry.assignedTo !== '-'
                        ? ` · ${entry.assignedTo}`
                        : ''}
                    </p>
                    {failure ? (
                      <p className="mt-0.5 truncate text-xs text-rose-700 dark:text-rose-200" title={failure.reason}>
                        {failure.reason}
                      </p>
                    ) : null}
                  </div>
                  <StatusBadge value={entry.status} />
                  <button
                    type="button"
                    aria-label={`${entry.name} aus Liste entfernen`}
                    className="shrink-0 rounded-md p-2 text-slate-500 hover:bg-slate-200 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
                    onClick={() => onRemove(entry.assetId)}
                    disabled={batchSubmitting === mode}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}

        {!showAll && overflow > 0 ? (
          <button
            type="button"
            className="mt-2 text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300"
            onClick={() => setShowAll(true)}
          >
            + {overflow} weitere anzeigen
          </button>
        ) : null}
        {showAll && entries.length > QUEUE_VISIBLE_LIMIT ? (
          <button
            type="button"
            className="mt-2 text-xs font-semibold text-slate-500 hover:underline dark:text-slate-400"
            onClick={() => setShowAll(false)}
          >
            Weniger anzeigen
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <section
      className={`${isMobile ? 'space-y-2.5' : 'space-y-5'} ${
        isMobile ? 'pb-[calc(9rem+env(safe-area-inset-bottom))]' : 'pb-24 sm:pb-6'
      }`}
    >
      {/* Page-Header nur auf Desktop. Auf Mobile direkt zur Aktion. */}
      {!isMobile ? (
        <div>
          <p className="page-kicker">Ein-/Auslagerung</p>
          <h2 className="page-title">Schnellflow mit QR</h2>
          <p className="page-subtitle">Klare Trennung: Ausgabe und Rücknahme als eigene Modi.</p>
        </div>
      ) : null}

      <div className={`surface-card ${isMobile ? '!p-2' : ''}`}>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold transition ${
              mode === 'checkout'
                ? 'border-brand-300 bg-brand-50 text-brand-800'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
            onClick={() => {
              setMode('checkout');
              resetCheckoutState();
              resetCheckinState();
              setMessage(null);
            }}
          >
            <Handshake className="h-4 w-4" />
            Ausgabe (Check-out)
          </button>
          <button
            type="button"
            className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold transition ${
              mode === 'checkin'
                ? 'border-slate-400 bg-slate-100 text-slate-900'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
            onClick={() => {
              setMode('checkin');
              resetCheckoutState();
              resetCheckinState();
              setMessage(null);
            }}
          >
            <Undo2 className="h-4 w-4" />
            Rücknahme (Check-in)
          </button>
        </div>
      </div>

      {activeRole === 'Mitarbeiter' && !projectContext.trim() ? (
        <article className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">Projektkontext fehlt</p>
          <p className="mt-1">Setze den Projektkontext, damit Ausgabe und Rücknahme direkt korrekt zugeordnet werden.</p>
          <label className="field mt-2">
            Projektkontext
            <input
              className="field-input bg-white"
              placeholder="z. B. Kunde X · Akkreditierung 2026"
              value={projectContext}
              onChange={(event) => onProjectContextChange(event.target.value)}
            />
          </label>
        </article>
      ) : null}

      {message ? <div className={`rounded-xl border px-3 py-2 text-sm ${messageClass}`}>{message.text}</div> : null}
      {/* "Projektverfügbarkeiten werden geladen" auf Mobile unterdrücken
          (silentes Hintergrundladen, blockiert sonst nur den Scan-Bereich). */}
      {!isMobile && planningProjectsLoading ? (
        <InlineLoadingState message="Projektverfügbarkeiten werden geladen ..." />
      ) : null}
      {isCheckoutScanBusy ? <InlineLoadingState message="Scan wird geprüft ..." /> : null}
      {isCheckinScanBusy ? <InlineLoadingState message="Scan wird geprüft ..." /> : null}
      {checkoutBusy ? <InlineLoadingState message="Check-out wird gebucht ..." /> : null}
      {checkinBusy ? <InlineLoadingState message="Check-in wird gebucht ..." /> : null}
      {/* Ablauf-Hint auf Mobile entfernt: die Schritte werden bereits in den
          Karten ("Schritt 1", "Schritt 2") direkt am Ort der Aktion angezeigt. */}

      {mode === 'checkout' ? (
        <article
          className={`surface-card animate-fade-up ${isMobile ? 'space-y-2.5 !p-3' : 'space-y-4'}`}
        >
          {/* Article-Header und Operator-Zeile sind auf Mobile redundant zu
              den Mode-Tabs darüber und werden ausgeblendet. */}
          {!isMobile ? (
            <>
              <div className="flex items-center justify-between">
                <h3 className="inline-flex items-center gap-2 text-base font-semibold text-slate-900">
                  <Handshake className="h-4 w-4 text-brand-700" />
                  Ausgabe in 3 Schritten
                </h3>
                <span className="status-chip border-brand-200 bg-brand-50 text-brand-700">
                  <span className="status-dot bg-brand-600" />
                  Scan zuerst
                </span>
              </div>
              <p className="text-sm text-slate-600">
                Du buchst als: <span className="font-semibold text-slate-900">{operatorName}</span>
              </p>
            </>
          ) : null}

          <div
            className={`rounded-xl border border-slate-200 bg-slate-50/70 dark:border-slate-700/70 dark:bg-slate-950/30 ${isMobile ? 'p-2.5' : 'p-3'}`}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">Schritt 1</p>
            <label className={`field ${isMobile ? 'mt-1' : 'mt-1'}`}>
              <span className={isMobile ? 'sr-only' : ''}>Gerät scannen</span>
              {/* Mobile: Input über zwei Buttons in einer Zeile (2 Reihen total).
                  Desktop: Input + Scannen + Kamera in einer Zeile (3 Spalten). */}
              <div className="space-y-2 sm:grid sm:grid-cols-[1fr_auto_auto] sm:gap-2 sm:space-y-0">
                <input
                  ref={checkoutScanRef}
                  autoFocus={preferAutoFocus && mode === 'checkout'}
                  className={`field-input ${isMobile ? 'h-12 text-base' : ''}`}
                  placeholder="QR-Code oder Inventarnummer"
                  value={checkoutScan}
                  disabled={isAnyBusy}
                  onChange={(event) => setCheckoutScan(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    void applyCheckoutScan();
                  }}
                />
                <div className="grid grid-cols-2 gap-2 sm:contents">
                  <LoadingButton
                    type="button"
                    className="btn-secondary h-11 w-full sm:h-10 sm:w-auto"
                    onClick={() => void applyCheckoutScan()}
                    isLoading={isCheckoutScanBusy}
                    loadingText="Prüft ..."
                    disabled={isAnyBusy && !isCheckoutScanBusy}
                  >
                    <ScanLine className="h-4 w-4" />
                    Scannen
                  </LoadingButton>
                  <button
                    type="button"
                    className="btn-secondary h-11 w-full sm:h-10 sm:w-auto"
                    onClick={() => setScannerTarget('checkout')}
                    disabled={isAnyBusy}
                  >
                    <QrCode className="h-4 w-4" />
                    Kamera
                  </button>
                </div>
              </div>
            </label>
          </div>

          {renderScanQueueCard({
            entries: checkoutQueue,
            mode: 'checkout',
            showAll: showAllCheckoutQueue,
            setShowAll: setShowAllCheckoutQueue,
            onRemove: removeFromCheckoutQueue,
            onClear: () => {
              setCheckoutQueue([]);
              setShowAllCheckoutQueue(false);
              setLastBatchFailures([]);
            },
            failures: batchSubmitting === null ? lastBatchFailures : [],
          })}

          <div className={`rounded-xl border border-slate-200 bg-slate-50/70 dark:border-slate-700/70 dark:bg-slate-950/30 ${isMobile ? 'p-2.5' : 'p-3'}`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">Schritt 2</p>
            {isMobile ? (
              <label className="field mt-1">
                <span className="sr-only">Projekt</span>
                <button
                  type="button"
                  className="field-input flex h-12 items-center justify-between text-left"
                  onClick={() => setProjectPickerMode('checkout')}
                  disabled={isAnyBusy}
                >
                  <span className="truncate text-sm text-slate-800 dark:text-slate-100">
                    {checkoutProject.trim() || 'Projekt auswählen'}
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
                </button>
              </label>
            ) : (
              <label className="field mt-1">
                Projekt
                <input
                  ref={checkoutProjectRef}
                  list="checkout-project-options"
                  className="field-input"
                  placeholder="Projekt wählen oder eintragen"
                  value={checkoutProject}
                  disabled={isAnyBusy}
                  onChange={(event) => setCheckoutProject(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    focusElement(checkoutSubmitRef.current);
                  }}
                />
                <datalist id="checkout-project-options">
                  {checkoutProjectOptions.map((project) => (
                    <option key={project} value={project} />
                  ))}
                </datalist>
              </label>
            )}
          </div>

          <button
            type="button"
            className={`btn-secondary w-full justify-center ${isMobile ? '!py-2 text-xs' : ''}`}
            onClick={() => setShowCheckoutOptions((prev) => !prev)}
            disabled={isAnyBusy}
          >
            {showCheckoutOptions ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {showCheckoutOptions ? 'Weniger Optionen' : 'Mehr Optionen'}
          </button>

          {showCheckoutOptions ? (
            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <label className="field">
                Asset auswählen (Fallback)
                <select
                  className="field-input"
                  value={checkoutAssetId}
                  disabled={isAnyBusy}
                  onChange={(event) => {
                    setCheckoutAssetId(event.target.value);
                    setCurrentCheckoutAssetId(event.target.value || null);
                  }}
                >
                  {assets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="field">
                  Geplante Rückgabe
                  <input
                    type="date"
                    className="field-input"
                    value={checkoutDueDate}
                    disabled={isAnyBusy}
                    onChange={(event) => setCheckoutDueDate(event.target.value)}
                  />
                </label>
                <label className="field">
                  Empfänger (optional)
                  <input
                    ref={checkoutRecipientRef}
                    list="checkout-person-options"
                    className="field-input"
                    placeholder="z. B. Max Mustermann"
                    value={checkoutAssignee}
                    disabled={isAnyBusy}
                    onChange={(event) => setCheckoutAssignee(event.target.value)}
                  />
                  <datalist id="checkout-person-options">
                    {userOptions.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                  <span className="text-xs text-slate-500">
                    Nur ausfüllen, wenn das Gerät direkt einer Person zugeordnet werden soll.
                  </span>
                </label>
              </div>
              <label className="field">
                Notiz
                <textarea
                  className="field-input min-h-[96px]"
                  placeholder="Optionaler Hinweis"
                  value={checkoutNote}
                  disabled={isAnyBusy}
                  onChange={(event) => setCheckoutNote(event.target.value)}
                />
              </label>
            </div>
          ) : null}

          <LoadingButton
            ref={checkoutSubmitRef}
            className="btn-primary hidden w-full disabled:cursor-not-allowed disabled:opacity-50 sm:inline-flex"
            onClick={() => void checkoutNow()}
            disabled={checkoutQueue.length === 0 || isAnyBusy}
            isLoading={checkoutBusy}
            loadingText={`Ausgabe wird gebucht ... (${checkoutQueue.length})`}
          >
            <Handshake className="h-4 w-4" />
            {checkoutQueue.length > 0
              ? `${checkoutQueue.length} Gerät${checkoutQueue.length === 1 ? '' : 'e'} ausgeben`
              : 'Gerät scannen zum Ausgeben'}
          </LoadingButton>
        </article>
      ) : (
        <article
          className={`surface-card animate-fade-up ${isMobile ? 'space-y-2.5 !p-3' : 'space-y-4'}`}
        >
          {!isMobile ? (
            <>
              <div className="flex items-center justify-between">
                <h3 className="inline-flex items-center gap-2 text-base font-semibold text-slate-900">
                  <Undo2 className="h-4 w-4 text-slate-700" />
                  Rücknahme in 2 Schritten
                </h3>
                <span className="status-chip border-slate-200 bg-slate-50 text-slate-700">
                  <span className="status-dot bg-slate-600" />
                  Schnellmodus
                </span>
              </div>
              <p className="text-sm text-slate-600">
                Du buchst als: <span className="font-semibold text-slate-900">{operatorName}</span>
              </p>
            </>
          ) : null}

          <div className={`rounded-xl border border-slate-200 bg-slate-50/70 dark:border-slate-700/70 dark:bg-slate-950/30 ${isMobile ? 'p-2.5' : 'p-3'}`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">Schritt 1</p>
            <label className="field mt-1">
              <span className={isMobile ? 'sr-only' : ''}>Gerät scannen</span>
              <div className="space-y-2 sm:grid sm:grid-cols-[1fr_auto_auto] sm:gap-2 sm:space-y-0">
                <input
                  ref={checkinScanRef}
                  autoFocus={preferAutoFocus && mode === 'checkin'}
                  className={`field-input ${isMobile ? 'h-12 text-base' : ''}`}
                  placeholder="QR-Code oder Inventarnummer"
                  value={checkinScan}
                  disabled={isAnyBusy}
                  onChange={(event) => setCheckinScan(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    void applyCheckinScan();
                  }}
                />
                <div className="grid grid-cols-2 gap-2 sm:contents">
                  <LoadingButton
                    type="button"
                    className="btn-secondary h-11 w-full sm:h-10 sm:w-auto"
                    onClick={() => void applyCheckinScan()}
                    isLoading={isCheckinScanBusy}
                    loadingText="Prüft ..."
                    disabled={isAnyBusy && !isCheckinScanBusy}
                  >
                    <ScanLine className="h-4 w-4" />
                    Scannen
                  </LoadingButton>
                  <button
                    type="button"
                    className="btn-secondary h-11 w-full sm:h-10 sm:w-auto"
                    onClick={() => setScannerTarget('checkin')}
                    disabled={isAnyBusy}
                  >
                    <QrCode className="h-4 w-4" />
                    Kamera
                  </button>
                </div>
              </div>
            </label>
          </div>

          {renderScanQueueCard({
            entries: checkinQueue,
            mode: 'checkin',
            showAll: showAllCheckinQueue,
            setShowAll: setShowAllCheckinQueue,
            onRemove: removeFromCheckinQueue,
            onClear: () => {
              setCheckinQueue([]);
              setShowAllCheckinQueue(false);
              setLastBatchFailures([]);
            },
            failures: batchSubmitting === null ? lastBatchFailures : [],
          })}

          {/* Schritt 2 Panel: auf Mobile sehr kompakt (Asset ist schon oben in
              der Auswahl-Karte sichtbar, daher kein "Erkannt: ..." doppelt).
              Auf Desktop bleibt die volle Anzeige erhalten. */}
          <div
            className={`rounded-xl border border-slate-200 bg-slate-50/70 dark:border-slate-700/70 dark:bg-slate-950/30 ${isMobile ? 'p-2.5' : 'p-3'} text-sm`}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">Schritt 2</p>
            {!isMobile ? (
              <>
                {checkinAsset ? (
                  <p className="mt-1 font-semibold text-slate-900">
                    Erkannt: {checkinAsset.tagNumber} · {checkinAsset.name}
                  </p>
                ) : (
                  <p className="mt-1 text-slate-600">Noch kein Gerät gescannt.</p>
                )}
                <p className="mt-2 text-xs text-slate-500">Rückgabedatum: {today}</p>
              </>
            ) : (
              <p className="mt-1 text-xs text-slate-600">
                {checkinAsset
                  ? 'Rücknahme unten bestätigen.'
                  : 'Noch kein Gerät gescannt.'}
              </p>
            )}
            {/* Mobile-Projektauswahl auch beim Check-in: gleicher Bottom-
                Sheet wie beim Checkout, geöffnet via projectPickerMode='checkin'.
                Das Feld ist optional — wenn gesetzt, fließt es in onCheckin
                als projectName ein und steuert den vorhandenen Plausibilitäts-
                check gegen das aktuell verbuchte Projekt. */}
            {isMobile ? (
              <label className="field mt-2">
                <span className="sr-only">Projekt (optional)</span>
                <button
                  type="button"
                  className="field-input flex h-12 items-center justify-between text-left"
                  onClick={() => setProjectPickerMode('checkin')}
                  disabled={isAnyBusy}
                >
                  <span className="truncate text-sm text-slate-800 dark:text-slate-100">
                    {checkinProject.trim() || checkinContextProject || 'Projekt auswählen (optional)'}
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
                </button>
                {checkinProject.trim() ? (
                  <button
                    type="button"
                    className="mt-1.5 self-start text-[11px] font-semibold text-slate-500 underline-offset-2 hover:underline"
                    onClick={() => setCheckinProject('')}
                    disabled={isAnyBusy}
                  >
                    Auswahl entfernen
                  </button>
                ) : null}
              </label>
            ) : null}
          </div>

          <button
            type="button"
            className={`btn-secondary w-full justify-center ${isMobile ? '!py-2 text-xs' : ''}`}
            onClick={() => setShowCheckinOptions((prev) => !prev)}
            disabled={isAnyBusy}
          >
            {showCheckinOptions ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {showCheckinOptions ? 'Weniger Optionen' : 'Mehr Optionen'}
          </button>

          {showCheckinOptions ? (
            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <label className="field">
                Asset auswählen (Fallback)
                <select
                  className="field-input"
                  value={checkinAssetId}
                  disabled={isAnyBusy}
                  onChange={(event) => {
                    setCheckinAssetId(event.target.value);
                    setCurrentCheckinAssetId(event.target.value || null);
                  }}
                >
                  {assets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Projekt (optional)
                <input
                  list="checkin-project-options"
                  className="field-input"
                  placeholder="Projekt bestätigen"
                  value={checkinProject}
                  disabled={isAnyBusy}
                  onChange={(event) => setCheckinProject(event.target.value)}
                />
                <datalist id="checkin-project-options">
                  {projectOptions.map((project) => (
                    <option key={project} value={project} />
                  ))}
                </datalist>
              </label>
              <label className="field">
                Ausgeführt durch
                <input className="field-input bg-slate-100 text-slate-700" value={operatorName} readOnly />
              </label>
              <label className="field">
                Notiz
                <textarea
                  className="field-input min-h-[96px]"
                  placeholder="Optionaler Zustandshinweis"
                  value={checkinCondition}
                  disabled={isAnyBusy}
                  onChange={(event) => setCheckinCondition(event.target.value)}
                />
              </label>
            </div>
          ) : null}

          <LoadingButton
            ref={checkinSubmitRef}
            className="btn-dark hidden w-full disabled:cursor-not-allowed disabled:opacity-50 sm:inline-flex"
            onClick={() => void checkinNow()}
            disabled={checkinQueue.length === 0 || isAnyBusy}
            isLoading={checkinBusy}
            loadingText={`Rücknahme wird gebucht ... (${checkinQueue.length})`}
          >
            <ClipboardCheck className="h-4 w-4" />
            {checkinQueue.length > 0
              ? `${checkinQueue.length} Gerät${checkinQueue.length === 1 ? '' : 'e'} zurücknehmen`
              : 'Gerät scannen zur Rücknahme'}
          </LoadingButton>
        </article>
      )}

      <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 border-t border-slate-200 bg-white/95 p-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 sm:hidden">
        {mode === 'checkout' ? (
          <LoadingButton
            className="btn-primary w-full py-3 text-base disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void checkoutNow()}
            disabled={checkoutQueue.length === 0 || isAnyBusy}
            isLoading={checkoutBusy}
            loadingText={`Ausgabe wird gebucht ... (${checkoutQueue.length})`}
          >
            <Handshake className="h-5 w-5" />
            {checkoutQueue.length > 0
              ? `${checkoutQueue.length} Gerät${checkoutQueue.length === 1 ? '' : 'e'} ausgeben`
              : 'Gerät scannen zum Ausgeben'}
          </LoadingButton>
        ) : (
          <LoadingButton
            className="btn-dark w-full py-3 text-base disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void checkinNow()}
            disabled={checkinQueue.length === 0 || isAnyBusy}
            isLoading={checkinBusy}
            loadingText={`Rücknahme wird gebucht ... (${checkinQueue.length})`}
          >
            <ClipboardCheck className="h-5 w-5" />
            {checkinQueue.length > 0
              ? `${checkinQueue.length} Gerät${checkinQueue.length === 1 ? '' : 'e'} zurücknehmen`
              : 'Gerät scannen zur Rücknahme'}
          </LoadingButton>
        )}
      </div>

      {scannerTarget ? (
        <QrScannerDialog
          title={scannerTarget === 'checkout' ? 'Ausgabe: QR scannen' : 'Rücknahme: QR scannen'}
          onDetected={onDetectedByCamera}
          onClose={() => setScannerTarget(null)}
        />
      ) : null}

      {isMobile && projectPickerMode !== null ? (
        <div className="fixed inset-0 z-40 bg-slate-900/45" onClick={() => setProjectPickerMode(null)}>
          <div
            className="absolute inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] max-h-[70vh] rounded-t-2xl border border-slate-200 bg-white p-3 shadow-panel dark:border-slate-700 dark:bg-slate-950"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {projectPickerMode === 'checkin' ? 'Projekt auswählen (Rücknahme)' : 'Projekt auswählen'}
              </h4>
              <button type="button" className="btn-ghost h-10 w-10 p-0" onClick={() => setProjectPickerMode(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>

            <input
              className="field-input h-11"
              placeholder="Projekt suchen..."
              value={projectPickerSearch}
              onChange={(event) => setProjectPickerSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                applyProjectSelection(projectPickerSearch);
              }}
            />

            <div className="soft-scrollbar mt-2 max-h-[42vh] space-y-1 overflow-y-auto pr-1">
              {filteredProjectOptions.map((project) => (
                <button
                  key={project}
                  type="button"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-left text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  onClick={() => applyProjectSelection(project)}
                >
                  <span className="block break-words">{project}</span>
                </button>
              ))}
              {!filteredProjectOptions.length ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                  Kein Projekt gefunden.
                </div>
              ) : null}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 pb-[env(safe-area-inset-bottom)]">
              <button
                type="button"
                className="btn-secondary h-11"
                onClick={() => {
                  applyProjectSelection(projectPickerSearch);
                }}
              >
                Manuell übernehmen
              </button>
              <button type="button" className="btn-secondary h-11" onClick={() => setProjectPickerMode(null)}>
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
