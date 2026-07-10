import { Check, ChevronDown, Copy, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAppDialog } from '../../components/dialogs/AppDialogProvider';
import { LoadingButton } from '../../components/loading';
import { useUrlQueryState } from '../../hooks/useUrlQueryState';
import { canonicalPathForPage, planningDetailPath } from '../../routing/appRoutes';
import { navigate } from '../../routing/router';
import {
  duplicatePlanning,
  getHandoverStatus,
  getPlanning,
  getPlanningAssignedAssets,
  getPlanningAvailability,
  listPlanningEvents,
  listPlannings,
  addPlanningNote,
  runHandover,
  undoHandover,
  updatePlanning,
  updatePlanningStatus,
  type HandoverStatusResponse,
  type PlanningAssignedAssetsResponse,
  type PlanningAvailabilityResponse,
  type PlanningEventItem,
  type PlanningListItem,
  type PlanningResponse,
  type PlanningStatus,
  type PlanningUpsertPayload,
} from '../../services/wmsApi';
import { StatusBadge } from '../components/StatusBadge';
import { ConflictsTab, type OverlapRow } from '../components/planning/detail/ConflictsTab';
import { HandoverSection } from '../components/planning/detail/HandoverSection';
import { HardwareTab, type HardwareDraftItem } from '../components/planning/detail/HardwareTab';
import { HistoryTab } from '../components/planning/detail/HistoryTab';
import { IssueReturnTab } from '../components/planning/detail/IssueReturnTab';
import {
  buildCapacityRows,
  countCapacityConflicts,
  deriveFlowSteps,
  formatGermanDateShort,
} from './planningCockpit';
import { getBookedDayCount, getStockFreeAgainIso } from './planningPeriod';
import type { Asset, CategoryItem, UserItem } from '../types';

const STATUS_OPTIONS: PlanningStatus[] = ['Entwurf', 'Geplant', 'Bestätigt', 'Abgeschlossen', 'Storniert'];

type DetailTab = 'uebersicht' | 'hardware' | 'ausgabe' | 'konflikte' | 'historie';

type DetailDraft = {
  customerName: string;
  projectName: string;
  eventName: string;
  projectManagerUserId: string;
  onSiteResponsibleUserId: string;
  startDate: string;
  endDate: string;
  returnBufferDays: number;
  notes: string;
  status: PlanningStatus;
  items: HardwareDraftItem[];
};

type PlanningDetailPageProps = {
  planningId: string;
  categories: CategoryItem[];
  users: UserItem[];
  assets: Asset[];
  canEdit: boolean;
  canOperateCheckout: boolean;
  isMobile: boolean;
  onCheckoutFromForm: (payload: {
    assetId: string;
    assignee: string;
    projectName?: string;
    planningId?: string | null;
    dueDate: string;
    dueDateIsManual?: boolean;
    note: string;
  }) => Promise<void>;
  onCheckinFromForm: (payload: { assetId: string; condition: string; projectName?: string }) => Promise<void>;
  onReloadData: () => Promise<void>;
};

const normalizeCategory = (key: string): string => key.trim().toLowerCase();

function getGermanWeekday(isoDate: string): string {
  const weekdays = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const date = new Date(`${isoDate}T00:00:00`);
  return weekdays[date.getDay()] ?? 'Tag';
}

function toIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeStatus(status: PlanningStatus): PlanningStatus {
  return status === 'Bestaetigt' ? 'Bestätigt' : status;
}

function draftFromPlanning(planning: PlanningResponse): DetailDraft {
  // Ein-Tages-Modell: die Positionen aller Tage werden je Kategorie gemergt
  // (identisch zum bisherigen buildRangePlanningDays der PlanningPage).
  const merged = new Map<string, HardwareDraftItem>();
  for (const day of planning.days) {
    for (const item of day.items) {
      const key = normalizeCategory(item.categoryKey ?? '');
      if (!key) continue;
      const existing = merged.get(key);
      if (existing) {
        existing.qty += Math.max(0, item.qty ?? 0);
        if (!existing.notes && item.notes) existing.notes = item.notes;
        existing.handoverEnabled = existing.handoverEnabled || Boolean(item.handoverEnabled);
        existing.linkedPlanningId = existing.linkedPlanningId || item.linkedPlanningId || '';
        existing.handoverNote = existing.handoverNote || item.handoverNote || '';
      } else {
        merged.set(key, {
          categoryKey: item.categoryKey,
          qty: Math.max(0, item.qty ?? 0),
          notes: item.notes ?? '',
          handoverEnabled: Boolean(item.handoverEnabled),
          linkedPlanningId: item.linkedPlanningId ?? '',
          handoverNote: item.handoverNote ?? '',
        });
      }
    }
  }
  const items = Array.from(merged.values()).sort((a, b) =>
    a.categoryKey.localeCompare(b.categoryKey, 'de'),
  );
  return {
    customerName: planning.customerName,
    projectName: planning.projectName,
    eventName: planning.eventName ?? '',
    projectManagerUserId: planning.projectManagerUserId ?? '',
    onSiteResponsibleUserId: planning.onSiteResponsibleUserId ?? '',
    startDate: planning.startDate,
    endDate: planning.endDate,
    returnBufferDays: Math.min(3, Math.max(0, Number(planning.returnBufferDays ?? 0))),
    notes: planning.notes ?? '',
    status: normalizeStatus(planning.status),
    items,
  };
}

function cloneDraft(draft: DetailDraft): DetailDraft {
  return { ...draft, items: draft.items.map((item) => ({ ...item })) };
}

function draftToPayload(planningId: string, draft: DetailDraft): PlanningUpsertPayload {
  return {
    id: planningId,
    customerName: draft.customerName.trim(),
    projectName: draft.projectName.trim(),
    eventName: draft.eventName.trim() || null,
    projectManagerUserId: draft.projectManagerUserId || null,
    onSiteResponsibleUserId: draft.onSiteResponsibleUserId || null,
    startDate: draft.startDate,
    endDate: draft.endDate,
    notes: draft.notes,
    status: draft.status,
    returnBufferDays: draft.returnBufferDays,
    days: [
      {
        planningDate: draft.startDate,
        weekday: getGermanWeekday(draft.startDate),
        items: draft.items
          .filter((item) => item.categoryKey.trim())
          .map((item) => ({
            categoryKey: item.categoryKey,
            qty: Math.max(0, Number(item.qty) || 0),
            notes: item.notes || null,
            handoverEnabled: item.handoverEnabled,
            linkedPlanningId: item.linkedPlanningId || null,
            handoverNote: item.handoverNote || null,
          })),
      },
    ],
  };
}

// Vollwertige Planungs-Detailseite mit fünf Tabs — ersetzt das frühere
// Scroll-Modal. Kein Edit-Modus: Felder sind direkt editierbar, gesammelt
// gespeichert wird über die Dirty-Leiste unten.
export function PlanningDetailPage({
  planningId,
  categories,
  users,
  assets,
  canEdit,
  canOperateCheckout,
  isMobile,
  onCheckoutFromForm,
  onCheckinFromForm,
  onReloadData,
}: PlanningDetailPageProps) {
  const { confirm, alert } = useAppDialog();
  const [tabParam, setTabParam] = useUrlQueryState('tab', 'uebersicht');
  const tab: DetailTab = ['hardware', 'ausgabe', 'konflikte', 'historie'].includes(tabParam)
    ? (tabParam as DetailTab)
    : 'uebersicht';

  const [draft, setDraft] = useState<DetailDraft | null>(null);
  const [baseline, setBaseline] = useState<DetailDraft | null>(null);
  const [availability, setAvailability] = useState<PlanningAvailabilityResponse | null>(null);
  const [assignedAssets, setAssignedAssets] = useState<PlanningAssignedAssetsResponse | null>(null);
  const [events, setEvents] = useState<PlanningEventItem[]>([]);
  const [overlaps, setOverlaps] = useState<OverlapRow[]>([]);
  const [handoverStatus, setHandoverStatus] = useState<HandoverStatusResponse | null>(null);
  const [handoverBusy, setHandoverBusy] = useState(false);
  const [allPlannings, setAllPlannings] = useState<PlanningListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const requestSeq = useRef(0);

  const todayIso = toIsoDate(new Date());
  const dirty = useMemo(
    () => Boolean(draft && baseline && JSON.stringify(draft) !== JSON.stringify(baseline)),
    [draft, baseline],
  );

  // --- Laden -------------------------------------------------------------
  const loadAll = useCallback(async () => {
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    setLoading(true);
    setNotFound(false);
    setError(null);
    try {
      const [planning, planningAvailability, planningAssigned, planningEvents, planningList, planningHandover] =
        await Promise.all([
          getPlanning(planningId),
          getPlanningAvailability(planningId).catch(() => null),
          getPlanningAssignedAssets(planningId).catch(() => null),
          listPlanningEvents(planningId).catch(() => []),
          listPlannings().catch(() => []),
          getHandoverStatus(planningId).catch(() => null),
        ]);
      if (requestSeq.current !== seq) return;
      const nextDraft = draftFromPlanning(planning);
      setDraft(nextDraft);
      setBaseline(cloneDraft(nextDraft));
      setAvailability(planningAvailability);
      setAssignedAssets(planningAssigned);
      setEvents(planningEvents);
      setHandoverStatus(planningHandover);
      setAllPlannings(planningList);
      const allPlannings = planningList;

      // Überschneidende Planungen (inkl. Puffer) + gebundene Mengen laden.
      const ownFreeEnd = getStockFreeAgainIso(
        nextDraft.startDate,
        nextDraft.endDate,
        nextDraft.returnBufferDays,
      );
      const activeStatuses = new Set(['Entwurf', 'Geplant', 'Bestätigt', 'Bestaetigt']);
      const overlapping = allPlannings
        .filter((item) => {
          if (item.id === planningId || !activeStatuses.has(item.status)) return false;
          const itemFreeEnd = getStockFreeAgainIso(item.startDate, item.endDate, item.returnBufferDays);
          return item.startDate <= ownFreeEnd && nextDraft.startDate <= itemFreeEnd;
        })
        .slice(0, 10);
      const details = await Promise.all(
        overlapping.map((item) => getPlanning(item.id).catch(() => null)),
      );
      if (requestSeq.current !== seq) return;
      setOverlaps(
        overlapping.map((item, index) => {
          const detail = details[index];
          const bound = new Map<string, { label: string; qty: number }>();
          for (const day of detail?.days ?? []) {
            for (const entry of day.items) {
              const key = normalizeCategory(entry.categoryKey);
              const current = bound.get(key);
              if (current) current.qty += Math.max(0, entry.qty ?? 0);
              else bound.set(key, { label: entry.categoryKey, qty: Math.max(0, entry.qty ?? 0) });
            }
          }
          const parts = Array.from(bound.values())
            .filter((entry) => entry.qty > 0)
            .slice(0, 3)
            .map((entry) => `${entry.qty}× ${entry.label}`);
          return {
            id: item.id,
            customerName: item.customerName,
            projectName: item.projectName,
            startDate: item.startDate,
            endDate: item.endDate,
            boundLabel: parts.length ? `bindet ${parts.join(', ')}` : '',
          };
        }),
      );
    } catch (loadError) {
      if (requestSeq.current !== seq) return;
      const status = (loadError as { status?: number }).status;
      if (status === 404) {
        setNotFound(true);
      } else {
        setError(
          loadError instanceof Error ? loadError.message : 'Planung konnte nicht geladen werden.',
        );
      }
    } finally {
      if (requestSeq.current === seq) setLoading(false);
    }
  }, [planningId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Buchungsdaten (Ausgabe/Rückgabe) nachladen, ohne den Draft anzufassen.
  const refreshBookingData = useCallback(async () => {
    const [planningAssigned, planningEvents, planningAvailability] = await Promise.all([
      getPlanningAssignedAssets(planningId).catch(() => null),
      listPlanningEvents(planningId).catch(() => []),
      getPlanningAvailability(planningId).catch(() => null),
    ]);
    setAssignedAssets(planningAssigned);
    setEvents(planningEvents);
    if (planningAvailability) setAvailability(planningAvailability);
  }, [planningId]);

  // --- Dirty-Guard beim Verlassen (Reload/Schließen) ----------------------
  useEffect(() => {
    if (!dirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);

  // --- Ableitungen ---------------------------------------------------------
  const demandItems = useMemo(
    () =>
      (draft?.items ?? [])
        .filter((item) => item.categoryKey.trim())
        .map((item) => ({ categoryKey: item.categoryKey, qty: Math.max(0, Number(item.qty) || 0) })),
    [draft],
  );
  const capacityRows = useMemo(
    () => buildCapacityRows(demandItems, availability?.items ?? [], normalizeCategory),
    [demandItems, availability],
  );
  const capacityByCategory = useMemo(
    () => new Map(capacityRows.map((row) => [normalizeCategory(row.categoryKey), row])),
    [capacityRows],
  );
  const conflictCount = useMemo(() => countCapacityConflicts(capacityRows), [capacityRows]);
  const totalQty = demandItems.reduce((sum, item) => sum + item.qty, 0);

  const assignedByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const asset of assignedAssets?.assets ?? []) {
      const key = normalizeCategory(asset.category);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [assignedAssets]);
  const assignedAssetIds = useMemo(
    () => new Set((assignedAssets?.assets ?? []).map((asset) => asset.id)),
    [assignedAssets],
  );
  const issuedTotal = assignedAssets?.assets.length ?? 0;

  const flow = useMemo(
    () =>
      draft
        ? deriveFlowSteps({
            status: draft.status,
            issuedQty: issuedTotal,
            today: todayIso,
            endDate: draft.endDate,
            returnBufferDays: draft.returnBufferDays,
          })
        : null,
    [draft, issuedTotal, todayIso],
  );

  const categoryOptions = useMemo(
    () =>
      categories
        .filter((item) => item.isActive !== false)
        .map((item) => item.name)
        .sort((a, b) => a.localeCompare(b, 'de')),
    [categories],
  );

  const managerLabel = useMemo(() => {
    if (!draft?.projectManagerUserId) return null;
    const user = users.find((item) => item.id === draft.projectManagerUserId);
    return user ? user.name : null;
  }, [draft, users]);

  // On-Site-Verantwortlicher: neu auswaehlbar sind nur aktive Benutzer; eine
  // bestehende Zuweisung an einen inzwischen inaktiven/geloeschten Benutzer
  // bleibt sichtbar (markiert bzw. als "Ehemaliger Benutzer"), damit die
  // Auswahl beim Speichern nicht stillschweigend verloren geht.
  const onSiteOptions = useMemo(() => {
    const active = users
      .filter((item) => item.status === 'Aktiv')
      .map((item) => ({ id: item.id, label: item.name }));
    const currentId = draft?.onSiteResponsibleUserId ?? '';
    if (currentId && !active.some((option) => option.id === currentId)) {
      const current = users.find((item) => item.id === currentId);
      active.push({
        id: currentId,
        label: current ? `${current.name} (inaktiv)` : 'Ehemaliger Benutzer',
      });
    }
    return active.sort((a, b) => a.label.localeCompare(b.label, 'de'));
  }, [draft, users]);

  const onSiteLabel = useMemo(() => {
    const currentId = draft?.onSiteResponsibleUserId ?? '';
    if (!currentId) return null;
    const user = users.find((item) => item.id === currentId);
    return user ? user.name : 'Ehemaliger Benutzer';
  }, [draft, users]);

  // Partneroptionen für die Übergabe-Verknüpfung (aktive Planungen ohne die
  // eigene).
  const handoverPartnerOptions = useMemo(() => {
    const activeStatuses = new Set(['Entwurf', 'Geplant', 'Bestätigt', 'Bestaetigt']);
    return allPlannings
      .filter((item) => item.id !== planningId && activeStatuses.has(item.status))
      .map((item) => ({
        id: item.id,
        label: `${item.customerName} · ${item.projectName} – ${formatGermanDateShort(item.startDate)}`,
      }));
  }, [allPlannings, planningId]);

  const runHandoverNow = async () => {
    if (handoverBusy) return;
    setHandoverBusy(true);
    setError(null);
    try {
      const result = await runHandover(planningId, true);
      setHandoverStatus(await getHandoverStatus(planningId).catch(() => null));
      await refreshBookingData();
      void onReloadData();
      if (result.transferredCount === 0) {
        setError('Keine übergabefähigen Geräte gefunden (Konfiguration, Mengen oder Zeitpunkt prüfen).');
      }
    } catch (handoverError) {
      setError(handoverError instanceof Error ? handoverError.message : 'Übergabe konnte nicht ausgeführt werden.');
    } finally {
      setHandoverBusy(false);
    }
  };

  const undoHandoverNow = async () => {
    if (handoverBusy) return;
    setHandoverBusy(true);
    setError(null);
    try {
      await undoHandover(planningId);
      setHandoverStatus(await getHandoverStatus(planningId).catch(() => null));
      await refreshBookingData();
      void onReloadData();
    } catch (handoverError) {
      setError(
        handoverError instanceof Error ? handoverError.message : 'Übergabe konnte nicht rückgängig gemacht werden.',
      );
    } finally {
      setHandoverBusy(false);
    }
  };

  // --- Aktionen -------------------------------------------------------------
  const patchDraft = (patch: Partial<DetailDraft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const save = async () => {
    if (!draft || saving) return;
    if (!draft.customerName.trim() || !draft.projectName.trim()) {
      await alert({ title: 'Pflichtfelder fehlen', message: 'Bitte Kunde und Projekt ausfüllen.' });
      return;
    }
    if (draft.endDate < draft.startDate) {
      await alert({
        title: 'Zeitraum ungültig',
        message: 'Das Enddatum darf nicht vor dem Startdatum liegen.',
      });
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await updatePlanning(planningId, draftToPayload(planningId, draft));
      const nextDraft = draftFromPlanning(updated);
      setDraft(nextDraft);
      setBaseline(cloneDraft(nextDraft));
      await refreshBookingData();
      void onReloadData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Speichern fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    if (baseline) setDraft(cloneDraft(baseline));
  };

  const changeStatus = async (nextStatus: PlanningStatus) => {
    if (!draft || statusBusy || nextStatus === draft.status) return;
    setStatusMenuOpen(false);
    if (nextStatus === 'Storniert') {
      const accepted = await confirm({
        title: 'Planung stornieren?',
        message: 'Die Planung wird auf „Storniert“ gesetzt und bindet keinen Bestand mehr.',
        confirmLabel: 'Stornieren',
        cancelLabel: 'Abbrechen',
        tone: 'danger',
      });
      if (!accepted) return;
    }
    setStatusBusy(true);
    setError(null);
    try {
      const updated = await updatePlanningStatus(planningId, nextStatus);
      const normalized = normalizeStatus(updated.status);
      // Nur den Status übernehmen — ungespeicherte Feldänderungen bleiben.
      setDraft((current) => (current ? { ...current, status: normalized } : current));
      setBaseline((current) => (current ? { ...current, status: normalized } : current));
      setEvents(await listPlanningEvents(planningId).catch(() => events));
      void onReloadData();
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Status konnte nicht gesetzt werden.');
    } finally {
      setStatusBusy(false);
    }
  };

  const duplicate = async () => {
    if (saving || statusBusy) return;
    try {
      const duplicated = await duplicatePlanning(planningId);
      void onReloadData();
      navigate(planningDetailPath(duplicated.id), { state: { plPanel: true } });
    } catch (duplicateError) {
      setError(
        duplicateError instanceof Error ? duplicateError.message : 'Duplizieren fehlgeschlagen.',
      );
    }
  };

  const planningLabel = draft ? `${draft.customerName} · ${draft.projectName}` : '';

  const issueAsset = async (asset: Asset) => {
    await onCheckoutFromForm({
      assetId: asset.id,
      assignee: '-',
      projectName: planningLabel,
      planningId,
      // Kein manuelles Datum: der Server bindet das Rückgabedatum an das
      // Planungs-Ende (F1).
      dueDate: '',
      dueDateIsManual: false,
      note: '',
    });
    await refreshBookingData();
  };

  const returnAsset = async (asset: Asset) => {
    await onCheckinFromForm({ assetId: asset.id, condition: 'Einwandfrei', projectName: planningLabel });
    await refreshBookingData();
  };

  const openTab = (nextTab: DetailTab) => {
    setTabParam(nextTab === 'uebersicht' ? 'uebersicht' : nextTab);
  };

  const backToList = () => {
    navigate(canonicalPathForPage('planning'));
  };

  // --- Sonderzustände --------------------------------------------------------
  if (notFound) {
    return (
      <div className="surface-card space-y-4 p-6">
        <div>
          <h2 className="text-base font-semibold">Planung nicht gefunden</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Unter dieser Adresse ist keine Planung (mehr) vorhanden — möglicherweise wurde sie gelöscht.
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={backToList}>
          Zur Planungsliste
        </button>
      </div>
    );
  }
  if (!draft) {
    return (
      <div className="surface-card p-6 text-sm text-ink-muted">
        {loading ? 'Planung wird geladen ...' : error ?? 'Planung konnte nicht geladen werden.'}
      </div>
    );
  }

  const dayCount = getBookedDayCount(draft.startDate, draft.endDate);
  const freeAgain = getStockFreeAgainIso(draft.startDate, draft.endDate, draft.returnBufferDays);
  const nextSteps = (() => {
    if (draft.status === 'Storniert') return 'Planung ist storniert — keine Schritte offen.';
    if (draft.status === 'Abgeschlossen') return 'Projekt abgeschlossen.';
    const parts: string[] = [];
    if (conflictCount > 0) parts.push(`${conflictCount} Konflikte prüfen (Tab Konflikte).`);
    if (issuedTotal < totalQty) {
      parts.push(`Hardware zuordnen – ${issuedTotal} von ${totalQty} Geräten ausgegeben.`);
    } else if (issuedTotal > 0 && todayIso > draft.endDate) {
      parts.push('Geräte zurücknehmen und Projekt abschließen.');
    } else if (totalQty === 0) {
      parts.push('Hardwarebedarf im Tab Hardware erfassen.');
    } else {
      parts.push('Alles vorbereitet.');
    }
    return parts.join(' ');
  })();

  const tabDefs: Array<{ key: DetailTab; label: string; badge?: { text: string; tone: 'neutral' | 'green' | 'red' } }> = [
    { key: 'uebersicht', label: 'Übersicht' },
    { key: 'hardware', label: 'Hardware', badge: { text: String(totalQty), tone: 'neutral' } },
    { key: 'ausgabe', label: 'Ausgabe und Rückgabe' },
    {
      key: 'konflikte',
      label: 'Konflikte',
      badge: { text: String(conflictCount), tone: conflictCount > 0 ? 'red' : 'green' },
    },
    { key: 'historie', label: 'Historie' },
  ];

  return (
    <section className="space-y-4 pb-20">
      {/* Sticky: Breadcrumb + Titel + Aktionen + Tab-Leiste (unter der Topbar) */}
      <div className="sticky z-10 -mx-3 bg-canvas px-3 pb-0 pt-1 sm:-mx-4 sm:px-4 md:-mx-8 md:px-8" style={{ top: 64 }}>
        <div className="surface-card rounded-b-none border-b-0 !p-4 !pb-0">
          <p className="text-[11px] text-ink-muted">
            <button type="button" className="hover:text-ink hover:underline" onClick={backToList}>
              Einsatzplanung
            </button>
            {' › '}
            <button type="button" className="hover:text-ink hover:underline" onClick={backToList}>
              Planungen
            </button>
          </p>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="truncate text-base font-semibold text-ink">{planningLabel}</h2>
              <StatusBadge value={draft.status} />
              <span className="hidden text-[11px] text-ink-faint sm:inline">{planningId}</span>
            </div>
            <div className="flex items-center gap-2">
              {canEdit ? (
                <button
                  type="button"
                  className="btn-secondary px-3 py-1.5 text-xs"
                  onClick={() => {
                    void duplicate();
                  }}
                  disabled={saving || statusBusy}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Duplizieren
                </button>
              ) : null}
              {canEdit ? (
                <div className="relative">
                  <button
                    type="button"
                    className="btn-secondary px-3 py-1.5 text-xs"
                    onClick={() => setStatusMenuOpen((open) => !open)}
                    disabled={statusBusy}
                    aria-haspopup="menu"
                    aria-expanded={statusMenuOpen}
                  >
                    Status ändern
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  {statusMenuOpen ? (
                    <div
                      className="absolute right-0 top-full z-30 mt-1 w-44 rounded-xl border border-line bg-surface p-1 shadow-panel"
                      role="menu"
                    >
                      {STATUS_OPTIONS.map((option) => (
                        <button
                          key={option}
                          type="button"
                          role="menuitem"
                          className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition hover:bg-surface-2 ${
                            option === draft.status ? 'font-semibold text-ink' : 'text-ink-muted'
                          }`}
                          onClick={() => {
                            void changeStatus(option);
                          }}
                        >
                          {option === draft.status ? <Check className="h-3 w-3" /> : <span className="w-3" />}
                          {option}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {canEdit ? (
                <LoadingButton
                  type="button"
                  className="btn-primary px-4 py-1.5 text-xs"
                  style={{ backgroundColor: '#4361EE' }}
                  isLoading={saving}
                  loadingText="Wird gespeichert ..."
                  disabled={!dirty}
                  onClick={() => {
                    void save();
                  }}
                >
                  Speichern
                </LoadingButton>
              ) : null}
            </div>
          </div>
          <div className="soft-scrollbar -mb-px mt-2 flex gap-1 overflow-x-auto">
            {tabDefs.map((definition) => {
              const active = tab === definition.key;
              return (
                <button
                  key={definition.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition ${
                    active
                      ? 'border-[#00b9e1] text-ink'
                      : 'border-transparent text-ink-muted hover:text-ink'
                  }`}
                  onClick={() => openTab(definition.key)}
                >
                  {definition.label}
                  {definition.badge ? (
                    <span
                      className={`rounded-full px-1.5 py-0 text-[10px] font-semibold ${
                        definition.badge.tone === 'red'
                          ? 'bg-rose-500/15 text-rose-600 dark:text-rose-300'
                          : definition.badge.tone === 'green'
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
                            : 'border border-line bg-surface-2 text-ink-muted'
                      }`}
                    >
                      {definition.badge.text}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="surface-card -mt-4 rounded-t-none border-t-0">
        {/* KPI-Zeile */}
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <div className="surface-muted px-3 py-2">
            <p className="text-[11px] text-ink-muted">Zeitraum</p>
            <p className="mt-0.5 text-sm font-semibold text-ink">
              {formatGermanDateShort(draft.startDate)}
              {draft.endDate !== draft.startDate ? ` – ${formatGermanDateShort(draft.endDate)}` : ''}
              <span className="font-normal text-ink-muted">
                {' '}· {dayCount} {dayCount === 1 ? 'Tag' : 'Tage'}
                {draft.returnBufferDays > 0 ? ` · Puffer +${draft.returnBufferDays}` : ''}
              </span>
            </p>
          </div>
          <div className="surface-muted px-3 py-2">
            <p className="text-[11px] text-ink-muted">Gesamtbedarf</p>
            <p className="mt-0.5 text-sm font-semibold text-ink">{totalQty} Geräte</p>
          </div>
          <div className="surface-muted px-3 py-2">
            <p className="text-[11px] text-ink-muted">Kategorien</p>
            <p className="mt-0.5 text-sm font-semibold text-ink">{demandItems.length}</p>
          </div>
          <div className="surface-muted px-3 py-2">
            <p className="text-[11px] text-ink-muted">Konflikte</p>
            <p
              className={`mt-0.5 flex items-center gap-1 text-sm font-semibold ${
                conflictCount > 0 ? 'text-rose-600 dark:text-rose-300' : 'text-emerald-600 dark:text-emerald-300'
              }`}
            >
              {conflictCount > 0 ? (
                <>
                  <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" /> {conflictCount}
                </>
              ) : (
                <>
                  <Check className="h-3.5 w-3.5" aria-hidden="true" /> Keine
                </>
              )}
            </p>
          </div>
        </div>

        {error ? (
          <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
            {error}
          </p>
        ) : null}

        {/* Tab-Inhalte */}
        <div className="mt-4">
          {tab === 'uebersicht' ? (
            <div className={`grid gap-3 ${isMobile ? '' : 'lg:grid-cols-[minmax(0,1fr)_220px]'}`}>
              <div className="min-w-0 space-y-3">
                <div className="rounded-xl border border-line bg-surface-2 p-4">
                  <h3 className="text-sm font-semibold text-ink">Projektdaten</h3>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="field text-xs">
                      Kunde
                      <input
                        className="field-input"
                        value={draft.customerName}
                        disabled={!canEdit}
                        onChange={(event) => patchDraft({ customerName: event.target.value })}
                      />
                    </label>
                    <label className="field text-xs">
                      Projekt
                      <input
                        className="field-input"
                        value={draft.projectName}
                        disabled={!canEdit}
                        onChange={(event) => patchDraft({ projectName: event.target.value })}
                      />
                    </label>
                    <label className="field text-xs sm:col-span-2">
                      Veranstaltung
                      <input
                        className="field-input"
                        placeholder="z. B. Generalversammlung 2026"
                        value={draft.eventName}
                        disabled={!canEdit}
                        onChange={(event) => patchDraft({ eventName: event.target.value })}
                      />
                    </label>
                  </div>
                </div>
                <div className="rounded-xl border border-line bg-surface-2 p-4">
                  <h3 className="text-sm font-semibold text-ink">Zeitraum</h3>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <label className="field text-xs">
                      Startdatum
                      <input
                        type="date"
                        className="field-input"
                        value={draft.startDate}
                        disabled={!canEdit}
                        onChange={(event) => patchDraft({ startDate: event.target.value })}
                      />
                    </label>
                    <label className="field text-xs">
                      Enddatum
                      <input
                        type="date"
                        className="field-input"
                        value={draft.endDate}
                        disabled={!canEdit}
                        onChange={(event) => patchDraft({ endDate: event.target.value })}
                      />
                    </label>
                    <label className="field text-xs">
                      Rückgabe-Puffer
                      <select
                        className="field-input"
                        value={draft.returnBufferDays}
                        disabled={!canEdit}
                        onChange={(event) =>
                          patchDraft({ returnBufferDays: Math.min(3, Math.max(0, Number(event.target.value) || 0)) })
                        }
                      >
                        {[0, 1, 2, 3].map((value) => (
                          <option key={value} value={value}>
                            {value} {value === 1 ? 'Tag' : 'Tage'}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {draft.endDate < draft.startDate ? (
                    <p className="mt-2 text-xs text-rose-600 dark:text-rose-300">
                      Das Enddatum darf nicht vor dem Startdatum liegen.
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-ink-muted">
                      Bestand wieder verfügbar ab {formatGermanDateShort(freeAgain)}
                    </p>
                  )}
                </div>
              </div>
              <aside className="space-y-3 text-xs">
                <div className="rounded-xl border border-line bg-surface-2 p-3">
                  <h4 className="font-semibold uppercase tracking-wide text-ink-muted">Ablauf</h4>
                  <div className={`mt-2 space-y-2 ${flow?.cancelled ? 'opacity-50' : ''}`}>
                    {flow?.steps.map((step) => (
                      <div
                        key={step.key}
                        className={`flex items-center gap-2 ${step.state === 'upcoming' ? 'text-ink-muted' : 'text-ink'}`}
                      >
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            step.state === 'active'
                              ? 'bg-[#00b9e1] ring-2 ring-[#00b9e1]/30'
                              : step.state === 'done'
                                ? 'bg-primary'
                                : 'border border-line-strong'
                          }`}
                          aria-hidden="true"
                        />
                        {step.label}
                      </div>
                    ))}
                  </div>
                  {flow?.cancelled ? <p className="mt-2 text-ink-muted">Planung storniert</p> : null}
                </div>
                <div className="rounded-xl border border-line bg-surface-2 p-3">
                  <h4 className="font-semibold uppercase tracking-wide text-ink-muted">Verantwortlich</h4>
                  {canEdit ? (
                    <select
                      className="field-input mt-2 h-8 w-full text-xs"
                      value={draft.projectManagerUserId}
                      onChange={(event) => patchDraft({ projectManagerUserId: event.target.value })}
                    >
                      <option value="">– nicht zugewiesen –</option>
                      {users.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="mt-2 text-ink">{managerLabel ?? '–'}</p>
                  )}
                </div>
                <div className="rounded-xl border border-line bg-surface-2 p-3">
                  <h4 className="font-semibold uppercase tracking-wide text-ink-muted">On-Site-Verantwortlich</h4>
                  {canEdit ? (
                    <select
                      className="field-input mt-2 h-8 w-full text-xs"
                      data-testid="planning-on-site-select"
                      value={draft.onSiteResponsibleUserId}
                      onChange={(event) => patchDraft({ onSiteResponsibleUserId: event.target.value })}
                    >
                      <option value="">– nicht zugewiesen –</option>
                      {onSiteOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="mt-2 text-ink" data-testid="planning-on-site-label">
                      {onSiteLabel ?? 'Nicht zugewiesen'}
                    </p>
                  )}
                  <p className="mt-1.5 leading-relaxed text-ink-faint">
                    Mitarbeiter, der während des Einsatzes vor Ort verantwortlich ist.
                  </p>
                </div>
                <div className="rounded-xl border border-line bg-surface-2 p-3">
                  <h4 className="font-semibold uppercase tracking-wide text-ink-muted">Nächste Schritte</h4>
                  <p className="mt-1.5 leading-relaxed text-ink-muted">{nextSteps}</p>
                </div>
              </aside>
            </div>
          ) : null}

          {tab === 'hardware' ? (
            <HardwareTab
              items={draft.items}
              categoryOptions={categoryOptions}
              capacityByCategory={capacityByCategory}
              issuedByCategory={assignedByCategory}
              issuedTotal={issuedTotal}
              conflictCount={conflictCount}
              canEdit={canEdit}
              normalizeCategory={normalizeCategory}
              onChangeItem={(index, patch) =>
                setDraft((current) => {
                  if (!current) return current;
                  const items = current.items.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, ...patch } : item,
                  );
                  return { ...current, items };
                })
              }
              onAddItem={() =>
                setDraft((current) =>
                  current
                    ? {
                        ...current,
                        items: [
                          ...current.items,
                          {
                            categoryKey: '',
                            qty: 1,
                            notes: '',
                            handoverEnabled: false,
                            linkedPlanningId: '',
                            handoverNote: '',
                          },
                        ],
                      }
                    : current,
                )
              }
              onRemoveItem={(index) => {
                void (async () => {
                  const item = draft.items[index];
                  if (item?.categoryKey) {
                    const accepted = await confirm({
                      title: 'Position löschen',
                      message: `${item.categoryKey} × ${item.qty} aus der Planung entfernen?`,
                      confirmLabel: 'Löschen',
                      cancelLabel: 'Abbrechen',
                      tone: 'danger',
                    });
                    if (!accepted) return;
                  }
                  setDraft((current) =>
                    current
                      ? { ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) }
                      : current,
                  );
                })();
              }}
              onOpenConflicts={() => openTab('konflikte')}
            />
          ) : null}
          {tab === 'hardware' ? (
            <div className="mt-3">
              <HandoverSection
                items={draft.items}
                partnerOptions={handoverPartnerOptions}
                handoverStatus={handoverStatus}
                canEdit={canEdit}
                busy={handoverBusy}
                onChangeItem={(index, patch) =>
                  setDraft((current) => {
                    if (!current) return current;
                    const items = current.items.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, ...patch } : item,
                    );
                    return { ...current, items };
                  })
                }
                onRunHandover={() => {
                  void runHandoverNow();
                }}
                onUndoHandover={() => {
                  void undoHandoverNow();
                }}
              />
            </div>
          ) : null}

          {tab === 'ausgabe' ? (
            <IssueReturnTab
              planningId={planningId}
              endDate={baseline?.endDate ?? draft.endDate}
              demand={(baseline?.items ?? [])
                .filter((item) => item.categoryKey.trim())
                .map((item) => ({ categoryKey: item.categoryKey, qty: item.qty }))}
              assets={assets}
              assignedAssetIds={assignedAssetIds}
              assignedByCategory={assignedByCategory}
              events={events}
              todayIso={todayIso}
              canOperate={canOperateCheckout && draft.status !== 'Storniert'}
              busy={saving || statusBusy}
              normalizeCategory={normalizeCategory}
              onIssue={issueAsset}
              onReturn={returnAsset}
            />
          ) : null}

          {tab === 'konflikte' ? (
            <ConflictsTab
              rows={capacityRows}
              conflictCount={conflictCount}
              overlaps={overlaps}
              canEdit={canEdit}
              onOpenHardware={() => openTab('hardware')}
              onOpenExternalPool={() => navigate(canonicalPathForPage('externalPool'))}
              onOpenPlanning={(id) => navigate(planningDetailPath(id), { state: { plPanel: true } })}
            />
          ) : null}

          {tab === 'historie' ? (
            <HistoryTab
              events={events}
              canAddNotes={canEdit}
              onAddNote={async (text) => {
                const created = await addPlanningNote(planningId, text);
                setEvents((current) => [created, ...current]);
              }}
            />
          ) : null}
        </div>
      </div>

      {/* Sticky Dirty-Leiste — mobil oberhalb der Bottom-Navigation (die ist
          an isMobile gekoppelt, nicht an einen CSS-Breakpoint), sonst verdeckt
          die Navigation die Speichern-/Verwerfen-Buttons. */}
      {dirty && canEdit ? (
        <div
          className={`fixed inset-x-0 z-30 flex justify-center px-4 ${
            isMobile ? 'bottom-[calc(4.75rem+env(safe-area-inset-bottom))]' : 'bottom-4'
          }`}
        >
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-2.5 shadow-panel">
            <span className="text-sm text-ink">Ungespeicherte Änderungen</span>
            <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={discard} disabled={saving}>
              Verwerfen
            </button>
            <LoadingButton
              type="button"
              className="btn-primary px-4 py-1.5 text-xs"
              style={{ backgroundColor: '#4361EE' }}
              isLoading={saving}
              loadingText="Wird gespeichert ..."
              onClick={() => {
                void save();
              }}
            >
              Speichern
            </LoadingButton>
          </div>
        </div>
      ) : null}
    </section>
  );
}
