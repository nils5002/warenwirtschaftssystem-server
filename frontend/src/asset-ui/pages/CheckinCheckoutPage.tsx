import { ChevronDown, ChevronUp, ClipboardCheck, Handshake, QrCode, ScanLine, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppDialog } from '../../components/dialogs/AppDialogProvider';
import { listPlannings, type PlanningListItem } from '../../services/wmsApi';
import { resolveAssetByScan } from '../qr';
import { QrScannerDialog } from '../components/QrScannerDialog';
import { StatusBadge } from '../components/StatusBadge';
import type { AppRole, Asset, UserItem } from '../types';

type CheckinCheckoutPageProps = {
  assets: Asset[];
  users: UserItem[];
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
  }) => void;
  onCheckin: (payload: { assetId: string; condition: string; projectName?: string }) => void;
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

export function CheckinCheckoutPage({
  assets,
  users,
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

  const [checkoutAssetId, setCheckoutAssetId] = useState<string>(assets[0]?.id ?? '');
  const [checkoutAssignee, setCheckoutAssignee] = useState('');
  const [checkoutProject, setCheckoutProject] = useState('');
  const [checkoutDueDate, setCheckoutDueDate] = useState(plusTwoDays);
  const [checkoutNote, setCheckoutNote] = useState('');
  const [checkoutScan, setCheckoutScan] = useState('');

  const [checkinAssetId, setCheckinAssetId] = useState<string>('');
  const [checkinCondition, setCheckinCondition] = useState('');
  const [checkinProject, setCheckinProject] = useState('');
  const [checkinScan, setCheckinScan] = useState('');

  const [lastAssignee, setLastAssignee] = useState('');
  const [lastProject, setLastProject] = useState('');

  const [scannerTarget, setScannerTarget] = useState<Mode | null>(null);
  const [showCheckoutOptions, setShowCheckoutOptions] = useState(false);
  const [showCheckinOptions, setShowCheckinOptions] = useState(false);
  const [planningProjects, setPlanningProjects] = useState<PlanningListItem[]>([]);
  const [preferAutoFocus, setPreferAutoFocus] = useState(false);

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
      try {
        const planning = await listPlannings();
        setPlanningProjects(planning.filter((item) => ['Geplant', 'Bestätigt', 'Entwurf'].includes(item.status)));
      } catch {
        setPlanningProjects([]);
      }
    })();
  }, []);

  useEffect(() => {
    if (!assets.length) {
      setCheckoutAssetId('');
      setCheckinAssetId('');
      return;
    }
    if (!assets.some((asset) => asset.id === checkoutAssetId)) {
      setCheckoutAssetId(assets[0].id);
    }
    if (checkinAssetId && !assets.some((asset) => asset.id === checkinAssetId)) {
      setCheckinAssetId('');
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
    setCheckinProject('');
    setCheckinCondition('');
    setCheckinScan('');
    setShowCheckinOptions(false);
  };

  const applyCheckoutScan = async (rawScan?: string): Promise<boolean> => {
    const scanValue = (rawScan ?? checkoutScan).trim();
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
  };

  const applyCheckinScan = async (rawScan?: string): Promise<boolean> => {
    const scanValue = (rawScan ?? checkinScan).trim();
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
    onCheckout({
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
    setCheckoutScan('');
    setMessage({ kind: 'success', text: `${checkoutAsset.name} wurde ausgegeben.` });
    focusElement(checkoutScanRef.current);
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

    onCheckin({
      assetId: checkinAsset.id,
      condition: checkinCondition.trim() || 'Zustand geprüft.',
      projectName: resolvedProject,
    });

    resetCheckinState();
    setMessage({ kind: 'success', text: `${checkinAsset.name} wurde zurückgenommen.` });
    focusElement(checkinScanRef.current);
  };

  const messageClass =
    message?.kind === 'error'
      ? 'border-rose-200 bg-rose-50 text-rose-800'
      : message?.kind === 'success'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
        : 'border-sky-200 bg-sky-50 text-sky-800';

  return (
    <section className="space-y-5 pb-24 sm:pb-6">
      <div>
        <p className="page-kicker">Ein-/Auslagerung</p>
        <h2 className="page-title">Schnellflow mit QR</h2>
        <p className="page-subtitle">Klare Trennung: Ausgabe und Rücknahme als eigene Modi.</p>
      </div>

      <div className="surface-card">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold transition ${
              mode === 'checkout'
                ? 'border-brand-300 bg-brand-50 text-brand-800'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
            onClick={() => {
              setMode('checkout');
              setMessage(null);
            }}
          >
            <Handshake className="h-4 w-4" />
            Ausgabe (Check-out)
          </button>
          <button
            type="button"
            className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold transition ${
              mode === 'checkin'
                ? 'border-slate-400 bg-slate-100 text-slate-900'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
            onClick={() => {
              setMode('checkin');
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

      {mode === 'checkout' ? (
        <article className="surface-card animate-fade-up space-y-4">
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
          <p className="text-sm text-slate-600">Du buchst als: <span className="font-semibold text-slate-900">{operatorName}</span></p>

          <div className="rounded-xl border border-brand-100 bg-brand-50/70 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Schritt 1</p>
            <label className="field mt-1">
              Gerät scannen
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]">
                <input
                  ref={checkoutScanRef}
                  autoFocus={preferAutoFocus && mode === 'checkout'}
                  className="field-input"
                  placeholder="QR-Code oder Inventarnummer"
                  value={checkoutScan}
                  onChange={(event) => setCheckoutScan(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    void applyCheckoutScan();
                  }}
                />
                <button type="button" className="btn-secondary w-full sm:w-auto" onClick={() => void applyCheckoutScan()}>
                  <ScanLine className="h-4 w-4" />
                  Scannen
                </button>
                <button type="button" className="btn-secondary w-full sm:w-auto" onClick={() => setScannerTarget('checkout')}>
                  <QrCode className="h-4 w-4" />
                  Kamera
                </button>
              </div>
            </label>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">Schritt 2</p>
            <label className="field mt-1">
              Projekt
              <input
                ref={checkoutProjectRef}
                list="checkout-project-options"
                className="field-input"
                placeholder="Projekt wählen oder eintragen"
                value={checkoutProject}
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
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">Schritt 3</p>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-slate-900">{checkoutAsset?.name ?? 'Kein Gerät ausgewählt'}</p>
              {checkoutAsset ? <StatusBadge value={checkoutAsset.status} /> : null}
            </div>
            <button
              ref={checkoutSubmitRef}
              className="btn-primary mt-3 hidden w-full sm:inline-flex"
              onClick={() => void checkoutNow()}
            >
              <Handshake className="h-4 w-4" />
              Jetzt ausgeben
            </button>
          </div>

          <button
            type="button"
            className="btn-secondary w-full justify-center"
            onClick={() => setShowCheckoutOptions((prev) => !prev)}
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
                  onChange={(event) => setCheckoutAssetId(event.target.value)}
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
                  onChange={(event) => setCheckoutNote(event.target.value)}
                />
              </label>
            </div>
          ) : null}
        </article>
      ) : (
        <article className="surface-card animate-fade-up space-y-4">
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
          <p className="text-sm text-slate-600">Du buchst als: <span className="font-semibold text-slate-900">{operatorName}</span></p>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">Schritt 1</p>
            <label className="field mt-1">
              Gerät scannen
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]">
                <input
                  ref={checkinScanRef}
                  autoFocus={preferAutoFocus && mode === 'checkin'}
                  className="field-input"
                  placeholder="QR-Code oder Inventarnummer"
                  value={checkinScan}
                  onChange={(event) => setCheckinScan(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    void applyCheckinScan();
                  }}
                />
                <button type="button" className="btn-secondary w-full sm:w-auto" onClick={() => void applyCheckinScan()}>
                  <ScanLine className="h-4 w-4" />
                  Scannen
                </button>
                <button type="button" className="btn-secondary w-full sm:w-auto" onClick={() => setScannerTarget('checkin')}>
                  <QrCode className="h-4 w-4" />
                  Kamera
                </button>
              </div>
            </label>
          </div>

          <div className="rounded-xl border border-brand-100 bg-brand-50/60 p-3 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Schritt 2</p>
            {checkinAsset ? (
              <>
                <p className="mt-1 font-semibold text-slate-900">
                  Erkannt: {checkinAsset.tagNumber} · {checkinAsset.name}
                </p>
              </>
            ) : (
              <p className="mt-1 text-slate-600">Noch kein Gerät gescannt.</p>
            )}
            <button
              ref={checkinSubmitRef}
              className="btn-dark mt-2 hidden w-full disabled:cursor-not-allowed disabled:opacity-50 sm:inline-flex"
              onClick={() => void checkinNow()}
              disabled={!checkinAsset}
            >
              <ClipboardCheck className="h-4 w-4" />
              Rücknahme bestätigen
            </button>
            <p className="mt-2 text-xs text-slate-500">Rückgabedatum: {today}</p>
          </div>

          <button
            type="button"
            className="btn-secondary w-full justify-center"
            onClick={() => setShowCheckinOptions((prev) => !prev)}
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
                  onChange={(event) => setCheckinAssetId(event.target.value)}
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
                  onChange={(event) => setCheckinCondition(event.target.value)}
                />
              </label>
            </div>
          ) : null}
        </article>
      )}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 p-3 backdrop-blur sm:hidden">
        {mode === 'checkout' ? (
          <button className="btn-primary w-full py-3 text-base" onClick={() => void checkoutNow()}>
            <Handshake className="h-5 w-5" />
            Jetzt ausgeben
          </button>
        ) : (
          <button
            className="btn-dark w-full py-3 text-base disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void checkinNow()}
            disabled={!checkinAsset}
          >
            <ClipboardCheck className="h-5 w-5" />
            Rücknahme bestätigen
          </button>
        )}
      </div>

      {scannerTarget ? (
        <QrScannerDialog
          title={scannerTarget === 'checkout' ? 'Ausgabe: QR scannen' : 'Rücknahme: QR scannen'}
          onDetected={onDetectedByCamera}
          onClose={() => setScannerTarget(null)}
        />
      ) : null}
    </section>
  );
}
