import { ChevronDown, ChevronUp, ClipboardCheck, Handshake, QrCode, ScanLine, Undo2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppDialog } from '../../components/dialogs/AppDialogProvider';
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
  const { alert } = useAppDialog();
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
  const hasCurrentCheckoutSelection = Boolean(
    currentCheckoutAssetId &&
      checkoutAsset &&
      checkoutAsset.id === currentCheckoutAssetId &&
      (checkoutScan.trim().length > 0 || checkoutAssetId === currentCheckoutAssetId),
  );
  const hasCurrentCheckinSelection = Boolean(
    currentCheckinAssetId &&
      checkinAsset &&
      checkinAsset.id === currentCheckinAssetId &&
      (checkinScan.trim().length > 0 || checkinAssetId === currentCheckinAssetId),
  );

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
  };

  const resetCheckoutState = () => {
    setCheckoutAssetId('');
    setCurrentCheckoutAssetId(null);
    setCheckoutScan('');
    setShowCheckoutOptions(false);
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
        await alert({
          title: 'Unbekannter QR-Code',
          message: 'Kein passendes Gerät gefunden.',
        });
        focusElement(checkoutScanRef.current);
        return false;
      }

      setCheckoutScan(scanValue);
      setCheckoutAssetId(asset.id);
      setCurrentCheckoutAssetId(asset.id);
      const parsedProject = parseProjectFromAsset(asset) || parseProjectFromAssignedTo(asset);
      if (parsedProject) {
        setCheckoutProject(parsedProject);
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

      setMessage({ kind: 'info', text: `${asset.name} erkannt. Schritt 2: Projekt wählen.` });
      focusElement(checkoutProjectRef.current);
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
        await alert({
          title: 'Unbekannter QR-Code',
          message: 'Kein passendes Gerät gefunden.',
        });
        focusElement(checkinScanRef.current);
        return false;
      }

      setCheckinScan(scanValue);
      setCheckinAssetId(asset.id);
      setCurrentCheckinAssetId(asset.id);

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

      setMessage({ kind: 'info', text: `${asset.name} erkannt. Rücknahme kann bestätigt werden.` });
      focusElement(checkinSubmitRef.current);
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
    if (!checkoutAsset) {
      setMessage({ kind: 'error', text: 'Bitte zuerst ein Gerät scannen oder auswählen.' });
      focusElement(checkoutScanRef.current);
      return;
    }

    if (checkoutAsset.status === 'Verliehen') {
      setMessage({
        kind: 'error',
        text: `Gerät ist bereits vergeben an ${checkoutAsset.assignedTo}.`,
      });
      focusElement(checkoutScanRef.current);
      return;
    }

    if (checkoutAsset.status !== 'Verfügbar') {
      setMessage({
        kind: 'error',
        text: `Gerät kann nicht ausgegeben werden (Status: ${checkoutAsset.status}).`,
      });
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
    setCheckoutBusy(true);
    try {
      await onCheckout({
        assetId: checkoutAsset.id,
        assignee: normalizedAssignee,
        projectName: normalizedProject,
        dueDate: checkoutDueDate,
        note: checkoutNote.trim(),
      });

      if (checkoutAssignee.trim()) {
        setLastAssignee(checkoutAssignee.trim());
      }
      setLastProject(normalizedProject);
      setCheckoutProject(normalizedProject);
      setCheckoutNote('');
      resetCheckoutState();
      setMessage({ kind: 'success', text: `${checkoutAsset.name} wurde ausgegeben.` });
      focusElement(checkoutScanRef.current);
    } catch {
      setMessage({ kind: 'error', text: 'Check-out konnte nicht gebucht werden. Bitte erneut versuchen.' });
    } finally {
      setCheckoutBusy(false);
    }
  };

  const checkinNow = async () => {
    if (!checkinAsset) {
      setMessage({ kind: 'error', text: 'Bitte zuerst ein Gerät scannen oder auswählen.' });
      focusElement(checkinScanRef.current);
      return;
    }

    if (checkinAsset.status === 'Verfügbar') {
      setMessage({
        kind: 'error',
        text: 'Dieses Gerät wurde bereits zurückgenommen.',
      });
      focusElement(checkinScanRef.current);
      return;
    }

    if (checkinAsset.status !== 'Verliehen') {
      setMessage({
        kind: 'error',
        text: `Rücknahme nicht erlaubt für Status "${checkinAsset.status}".`,
      });
      focusElement(checkinScanRef.current);
      return;
    }

    if (checkinContextProject && checkinProject.trim() && checkinProject.trim() !== checkinContextProject) {
      setMessage({
        kind: 'error',
        text: `Projekt passt nicht. Gerät ist aktuell für "${checkinContextProject}" verbucht.`,
      });
      setShowCheckinOptions(true);
      return;
    }

    const resolvedProject = checkinProject.trim() || checkinContextProject;

    setCheckinBusy(true);
    try {
      await onCheckin({
        assetId: checkinAsset.id,
        condition: checkinCondition.trim() || 'Zustand geprüft.',
        projectName: resolvedProject,
      });

      resetCheckinState();
      setMessage({ kind: 'success', text: `${checkinAsset.name} wurde zurückgenommen.` });
      focusElement(checkinScanRef.current);
    } catch {
      setMessage({ kind: 'error', text: 'Check-in konnte nicht gebucht werden. Bitte erneut versuchen.' });
    } finally {
      setCheckinBusy(false);
    }
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

          {hasCurrentCheckoutSelection && checkoutAsset ? (
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-900">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                Ausgewähltes Gerät
              </p>
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 break-words font-semibold text-slate-900 dark:text-slate-100">
                  {getDisplayAssetName(checkoutAsset)}
                </p>
                <StatusBadge value={checkoutAsset.status} />
              </div>
            </div>
          ) : null}

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
            disabled={!hasCurrentCheckoutSelection || isAnyBusy}
            isLoading={checkoutBusy}
            loadingText="Check-out wird gebucht ..."
          >
            <Handshake className="h-4 w-4" />
            Jetzt ausgeben
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

          {hasCurrentCheckinSelection && checkinAsset ? (
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-900">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Gerät</p>
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 break-words font-semibold text-slate-900 dark:text-slate-100">
                  {getDisplayAssetName(checkinAsset)}
                </p>
                <StatusBadge value={checkinAsset.status} />
              </div>
            </div>
          ) : null}

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
            disabled={!checkinAsset || isAnyBusy}
            isLoading={checkinBusy}
            loadingText="Check-in wird gebucht ..."
          >
            <ClipboardCheck className="h-4 w-4" />
            Rücknahme bestätigen
          </LoadingButton>
        </article>
      )}

      <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 border-t border-slate-200 bg-white/95 p-3 backdrop-blur sm:hidden">
        {mode === 'checkout' ? (
          <LoadingButton
            className="btn-primary w-full py-3 text-base disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void checkoutNow()}
            disabled={!hasCurrentCheckoutSelection || isAnyBusy}
            isLoading={checkoutBusy}
            loadingText="Check-out wird gebucht ..."
          >
            <Handshake className="h-5 w-5" />
            Jetzt ausgeben
          </LoadingButton>
        ) : (
          <LoadingButton
            className="btn-dark w-full py-3 text-base disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void checkinNow()}
            disabled={!hasCurrentCheckinSelection || isAnyBusy}
            isLoading={checkinBusy}
            loadingText="Check-in wird gebucht ..."
          >
            <ClipboardCheck className="h-5 w-5" />
            Rücknahme bestätigen
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
