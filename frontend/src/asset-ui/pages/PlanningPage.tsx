import {
  AlertTriangle,
  CalendarPlus,
  Clock3,
  Copy,
  Link2,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { useAppDialog } from '../../components/dialogs/AppDialogProvider';
import {
  createPlanning,
  deletePlanning,
  duplicatePlanning,
  getPlanning,
  getPlanningAvailability,
  listPlannings,
  updatePlanning,
  updatePlanningStatus,
  type PlanningAvailabilityResponse,
  type PlanningListItem,
  type PlanningStatus,
  type PlanningResponse,
  type PlanningUpsertPayload,
} from '../../services/wmsApi';
import { categoryOptionsFromRecords, normalizeCategory } from '../categories';
import type { Asset, CategoryItem, UserItem } from '../types';

type PlanningPageProps = {
  assets: Asset[];
  categories: CategoryItem[];
  users: UserItem[];
  onOpenInventoryWithQuery: (query: string) => void;
  canEdit?: boolean;
};

type EditablePlanning = {
  id: string;
  customerName: string;
  projectName: string;
  eventName: string;
  projectManagerUserId: string;
  calendarWeek: number | null;
  startDate: string;
  endDate: string;
  notes: string;
  status: PlanningStatus;
  days: Array<{
    planningDate: string;
    weekday: string;
    items: Array<{
      categoryKey: string;
      qty: number;
      notes: string;
      handoverEnabled: boolean;
      linkedPlanningId: string;
      handoverNote: string;
    }>;
  }>;
};

type PlanningSummary = PlanningListItem | PlanningResponse;

type HandoverVisualStatus = 'ok' | 'handover' | 'review' | 'open';

type IncomingHandoverInfo = {
  partnerPlanningId: string;
  partnerLabel: string;
  note: string;
};

type AvailabilityVisual = {
  key: string;
  planningDate: string;
  weekday: string;
  categoryKey: string;
  status: HandoverVisualStatus;
  source: 'outgoing' | 'incoming' | 'none';
  partnerPlanningId: string;
  partnerLabel: string;
  note: string;
  totalStock: number;
  usableStock: number;
  currentPlanningQty: number;
  otherPlannedQty: number;
  totalPlannedQtyForDateCategory: number;
  remainingAfterAllPlanning: number;
  shortageQty: number;
  hasGlobalShortage: boolean;
  affectedPlanningIds: string[];
  linkedPlanningId: string;
  linkedPlanningLabel: string;
};

const STATUS_OPTIONS: PlanningStatus[] = ['Entwurf', 'Geplant', 'Bestätigt', 'Abgeschlossen', 'Storniert'];

function toIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getGermanWeekday(isoDate: string): string {
  const weekdays = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const date = new Date(`${isoDate}T00:00:00`);
  return weekdays[date.getDay()] ?? 'Tag';
}

function formatPeriod(start: string, end: string): string {
  if (!start && !end) return '-';
  return `${start || '-'} bis ${end || '-'}`;
}

function formatGermanDate(isoDate: string): string {
  if (!isoDate) return '';
  const [year, month, day] = isoDate.split('-');
  if (!year || !month || !day) return isoDate;
  return `${day}.${month}.${year}`;
}

function buildPlanningLabel(planning: Pick<PlanningSummary, 'projectName' | 'eventName' | 'startDate'>): string {
  const datePart = planning.startDate ? ` – ${formatGermanDate(planning.startDate)}` : '';
  if (planning.eventName?.trim()) return `${planning.projectName} (${planning.eventName})${datePart}`;
  return `${planning.projectName}${datePart}`;
}

function buildDaysInRange(startDate: string, endDate: string): EditablePlanning['days'] {
  if (!startDate || !endDate) return [];
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return [];
  }
  const days: EditablePlanning['days'] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const iso = toIsoDate(cursor);
    days.push({
      planningDate: iso,
      weekday: getGermanWeekday(iso),
      items: [],
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function toEditablePlanning(item: PlanningResponse): EditablePlanning {
  return {
    id: item.id,
    customerName: item.customerName,
    projectName: item.projectName,
    eventName: item.eventName ?? '',
    projectManagerUserId: item.projectManagerUserId ?? '',
    calendarWeek: item.calendarWeek ?? null,
    startDate: item.startDate,
    endDate: item.endDate,
    notes: item.notes,
    status: item.status === 'Bestaetigt' ? 'Bestätigt' : item.status,
    days: [...item.days]
      .sort((a, b) => a.planningDate.localeCompare(b.planningDate))
      .map((day) => ({
        planningDate: day.planningDate,
        weekday: day.weekday,
        items: day.items.map((entry) => ({
          categoryKey: normalizeCategory(entry.categoryKey),
          qty: entry.qty,
          notes: entry.notes ?? '',
          handoverEnabled: Boolean(entry.handoverEnabled),
          linkedPlanningId: entry.linkedPlanningId ?? '',
          handoverNote: entry.handoverNote ?? '',
        })),
      })),
  };
}

function toUpsertPayload(item: EditablePlanning): PlanningUpsertPayload {
  return {
    id: item.id,
    customerName: item.customerName.trim(),
    projectName: item.projectName.trim(),
    eventName: item.eventName.trim() || null,
    projectManagerUserId: item.projectManagerUserId || null,
    calendarWeek: item.calendarWeek ?? null,
    startDate: item.startDate,
    endDate: item.endDate,
    notes: item.notes,
    status: item.status,
    days: item.days.map((day) => ({
      planningDate: day.planningDate,
      weekday: day.weekday || getGermanWeekday(day.planningDate),
      items: day.items
        .filter((entry) => entry.categoryKey.trim().length > 0)
        .map((entry) => ({
          categoryKey: normalizeCategory(entry.categoryKey),
          qty: Number.isFinite(entry.qty) ? Math.max(0, entry.qty) : 0,
          notes: entry.notes.trim() || null,
          handoverEnabled: Boolean(entry.handoverEnabled),
          linkedPlanningId: entry.linkedPlanningId.trim() || null,
          handoverNote: entry.handoverNote.trim() || null,
        })),
    })),
  };
}

function handoverKey(dayIndex: number, itemIndex: number): string {
  return `${dayIndex}:${itemIndex}`;
}

function isDateWithinRange(isoDate: string, startDate: string, endDate: string): boolean {
  return isoDate >= startDate && isoDate <= endDate;
}

function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

function buildPlanningFallbackLabel(
  planningId: string,
  plannings: Awaited<ReturnType<typeof listPlannings>>,
): string {
  const match = plannings.find((item) => item.id === planningId);
  if (!match) return `Projektverknüpfung (${planningId.slice(-6)})`;
  return buildPlanningLabel(match);
}

function updatePlanningItemInEditor(
  planning: EditablePlanning,
  dayIndex: number,
  itemIndex: number,
  updater: (item: EditablePlanning['days'][number]['items'][number]) => EditablePlanning['days'][number]['items'][number],
): EditablePlanning {
  const nextDays = [...planning.days];
  const nextItems = [...nextDays[dayIndex].items];
  nextItems[itemIndex] = updater(nextItems[itemIndex]);
  nextDays[dayIndex] = { ...nextDays[dayIndex], items: nextItems };
  return { ...planning, days: nextDays };
}

export function PlanningPage({ assets: _assets, categories, users, onOpenInventoryWithQuery, canEdit = true }: PlanningPageProps) {
  const { alert, confirm } = useAppDialog();
  const [plannings, setPlannings] = useState<Awaited<ReturnType<typeof listPlannings>>>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [editor, setEditor] = useState<EditablePlanning | null>(null);
  const [availability, setAvailability] = useState<PlanningAvailabilityResponse | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listSearch, setListSearch] = useState('');
  const [listStatus, setListStatus] = useState<'Alle' | PlanningStatus>('Alle');
  const [createOpen, setCreateOpen] = useState(false);
  const [handoverEditorKey, setHandoverEditorKey] = useState<string | null>(null);
  const [handoverSnapshot, setHandoverSnapshot] = useState<Record<string, EditablePlanning['days'][number]['items'][number]>>({});
  const [relatedPlannings, setRelatedPlannings] = useState<Record<string, PlanningResponse>>({});
  const [createForm, setCreateForm] = useState({
    customerName: '',
    projectName: '',
    eventName: '',
    projectManagerUserId: '',
    startDate: toIsoDate(new Date()),
    endDate: toIsoDate(new Date()),
    calendarWeek: '',
    notes: '',
    status: 'Entwurf' as PlanningStatus,
  });

  const categoryOptions = useMemo(() => categoryOptionsFromRecords(categories), [categories]);

  const selectableProjectManagers = useMemo(
    () =>
      users.filter(
        (user) =>
          user.status === 'Aktiv' && (user.role === 'Projektmanager' || user.role === 'Admin'),
      ),
    [users],
  );

  const managerLabelById = useMemo(
    () =>
      new Map(users.map((user) => [user.id, user.department ? `${user.name} (${user.department})` : user.name])),
    [users],
  );

  const planningListItemById = useMemo(() => new Map(plannings.map((item) => [item.id, item])), [plannings]);

  const availabilityByDayCategory = useMemo(() => {
    const map = new Map<string, PlanningAvailabilityResponse['items'][number]>();
    for (const item of availability?.items ?? []) {
      map.set(`${item.planningDate}|${normalizeCategory(item.categoryKey)}`, item);
    }
    return map;
  }, [availability]);

  const localHandoverByDayCategory = useMemo(() => {
    const map = new Map<
      string,
      {
        handoverEnabled: boolean;
        linkedPlanningId: string;
        linkedPlanningLabel?: string;
        handoverNote: string;
      }
    >();
    if (!editor) return map;
    for (const day of editor.days) {
      for (const item of day.items) {
        const key = `${day.planningDate}|${normalizeCategory(item.categoryKey)}`;
        map.set(key, {
          handoverEnabled: item.handoverEnabled,
          linkedPlanningId: item.linkedPlanningId,
          linkedPlanningLabel: item.linkedPlanningId
            ? buildPlanningFallbackLabel(item.linkedPlanningId, plannings)
            : undefined,
          handoverNote: item.handoverNote,
        });
      }
    }
    return map;
  }, [editor, plannings]);

  useEffect(() => {
    if (!editor || !availability) {
      setRelatedPlannings({});
      return;
    }
    const relatedIds = new Set<string>();
    for (const item of availability.items) {
      for (const affectedId of item.affectedPlanningIds ?? []) {
        if (affectedId && affectedId !== editor.id) relatedIds.add(affectedId);
      }
      if (item.linkedPlanningId && item.linkedPlanningId !== editor.id) {
        relatedIds.add(item.linkedPlanningId);
      }
    }
    for (const localEntry of localHandoverByDayCategory.values()) {
      if (localEntry.linkedPlanningId && localEntry.linkedPlanningId !== editor.id) {
        relatedIds.add(localEntry.linkedPlanningId);
      }
    }
    const candidateIds = Array.from(relatedIds);
    if (!candidateIds.length) {
      setRelatedPlannings({});
      return;
    }

    let cancelled = false;
    void Promise.all(
      candidateIds.map(async (planningId) => {
        try {
          return await getPlanning(planningId);
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      const next: Record<string, PlanningResponse> = {};
      for (const planning of results) {
        if (planning) next[planning.id] = planning;
      }
      setRelatedPlannings(next);
    });

    return () => {
      cancelled = true;
    };
  }, [availability, editor?.id, localHandoverByDayCategory]);

  const incomingHandoverByDayCategory = useMemo(() => {
    const map = new Map<string, IncomingHandoverInfo>();
    if (!editor) return map;

    for (const planning of Object.values(relatedPlannings)) {
      const planningLabel = buildPlanningLabel(planning);
      for (const day of planning.days) {
        for (const item of day.items) {
          if (!item.handoverEnabled || item.linkedPlanningId !== editor.id) continue;
          const key = `${day.planningDate}|${normalizeCategory(item.categoryKey)}`;
          if (!map.has(key)) {
            map.set(key, {
              partnerPlanningId: planning.id,
              partnerLabel: planningLabel,
              note: item.handoverNote ?? '',
            });
          }
        }
      }
    }

    return map;
  }, [editor, relatedPlannings]);

  const availabilityVisualMap = useMemo(() => {
    const map = new Map<string, AvailabilityVisual>();

    for (const item of availability?.items ?? []) {
      const key = `${item.planningDate}|${normalizeCategory(item.categoryKey)}`;
      const localHandover = localHandoverByDayCategory.get(key);
      const incomingHandover = incomingHandoverByDayCategory.get(key);
      const effectiveHandoverEnabled = localHandover?.handoverEnabled ?? Boolean(item.handoverEnabled);
      const effectiveLinkedPlanningId = localHandover?.linkedPlanningId ?? (item.linkedPlanningId || '');
      const linkedPlanning =
        (effectiveLinkedPlanningId ? relatedPlannings[effectiveLinkedPlanningId] : undefined) ??
        (effectiveLinkedPlanningId ? planningListItemById.get(effectiveLinkedPlanningId) : undefined);
      const effectiveLinkedPlanningLabel =
        localHandover?.linkedPlanningLabel ||
        item.linkedPlanningLabel ||
        (linkedPlanning ? buildPlanningLabel(linkedPlanning) : '') ||
        (effectiveLinkedPlanningId ? buildPlanningFallbackLabel(effectiveLinkedPlanningId, plannings) : '');
      const effectiveHandoverNote = localHandover?.handoverNote ?? (item.handoverNote || '');
      const hasGlobalShortage =
        Boolean(item.hasGlobalShortage) ||
        item.shortageQty > 0 ||
        item.remainingAfterAllPlanning < 0;
      const resolvedByHandover =
        (effectiveHandoverEnabled && Boolean(effectiveLinkedPlanningId)) || Boolean(incomingHandover);
      const hasOpenShortage = hasGlobalShortage && !resolvedByHandover && !effectiveHandoverEnabled;
      const hasResolvedShortage = hasGlobalShortage && resolvedByHandover;

      let status: HandoverVisualStatus = 'ok';
      let source: AvailabilityVisual['source'] = 'none';
      let partnerPlanningId = '';
      let partnerLabel = '';
      let note = '';

      if (hasResolvedShortage) {
        status = 'handover';
      } else if (hasGlobalShortage && effectiveHandoverEnabled && !effectiveLinkedPlanningId) {
        status = 'review';
      } else if (hasOpenShortage) {
        status = 'open';
      } else if (item.availabilityState === 'yellow') {
        status = 'review';
      }

      if (effectiveHandoverEnabled && effectiveLinkedPlanningId) {
        source = 'outgoing';
        partnerPlanningId = effectiveLinkedPlanningId;
        partnerLabel = effectiveLinkedPlanningLabel;
        note = effectiveHandoverNote;
      } else if (incomingHandover) {
        source = 'incoming';
        partnerPlanningId = incomingHandover.partnerPlanningId;
        partnerLabel = incomingHandover.partnerLabel;
        note = incomingHandover.note;
      } else if (effectiveHandoverEnabled && !effectiveLinkedPlanningId) {
        note = effectiveHandoverNote;
      }

      map.set(key, {
        key,
        planningDate: item.planningDate,
        weekday: item.weekday,
        categoryKey: item.categoryKey,
        status,
        source,
        partnerPlanningId,
        partnerLabel,
        note,
        totalStock: item.totalStock,
        usableStock: item.usableStock,
        currentPlanningQty: item.currentPlanningQty,
        otherPlannedQty: item.otherPlannedQty,
        totalPlannedQtyForDateCategory: item.totalPlannedQtyForDateCategory,
        remainingAfterAllPlanning: item.remainingAfterAllPlanning,
        shortageQty: item.shortageQty,
        hasGlobalShortage,
        affectedPlanningIds: item.affectedPlanningIds,
        linkedPlanningId: effectiveLinkedPlanningId,
        linkedPlanningLabel: effectiveLinkedPlanningLabel,
      });
    }

    return map;
  }, [
    availability,
    incomingHandoverByDayCategory,
    localHandoverByDayCategory,
    planningListItemById,
    plannings,
    relatedPlannings,
  ]);

  const availabilityVisuals = useMemo(
    () =>
      Array.from(availabilityVisualMap.values()).sort((a, b) => {
        if (a.planningDate !== b.planningDate) return a.planningDate.localeCompare(b.planningDate);
        return a.categoryKey.localeCompare(b.categoryKey, 'de');
      }),
    [availabilityVisualMap],
  );

  const planningStats = useMemo(() => {
    const openStatuses: PlanningStatus[] = ['Entwurf', 'Geplant', 'Bestätigt'];
    const openCount = plannings.filter((item) => openStatuses.includes(item.status)).length;
    const doneCount = plannings.filter((item) => item.status === 'Abgeschlossen').length;
    const redCount = availabilityVisuals.filter((item) => item.status === 'open').length;
    return {
      total: plannings.length,
      openCount,
      doneCount,
      redCount,
    };
  }, [availabilityVisuals, plannings]);

  const networkVisuals = useMemo(
    () => availabilityVisuals.filter((item) => item.status === 'handover'),
    [availabilityVisuals],
  );

  const incompleteVisuals = useMemo(
    () => availabilityVisuals.filter((item) => item.status === 'review'),
    [availabilityVisuals],
  );

  const shortageVisuals = useMemo(
    () => availabilityVisuals.filter((item) => item.status === 'open'),
    [availabilityVisuals],
  );

  const healthyCategoryCount = useMemo(() => {
    const blockedCategories = new Set(
      availabilityVisuals
        .filter((item) => item.status !== 'ok')
        .map((item) => normalizeCategory(item.categoryKey)),
    );
    return (availability?.categorySummary ?? []).filter(
      (item) => !blockedCategories.has(normalizeCategory(item.categoryKey)),
    ).length;
  }, [availability, availabilityVisuals]);

  const currentPlanningLabel = useMemo(() => {
    if (!editor) return '';
    return buildPlanningLabel({
      projectName: editor.projectName,
      eventName: editor.eventName,
      startDate: editor.startDate,
    });
  }, [editor]);

  const visiblePlannings = useMemo(() => {
    return plannings.filter((item) => {
      const matchesStatus = listStatus === 'Alle' || item.status === listStatus;
      const needle = listSearch.trim().toLowerCase();
      const haystack = `${item.customerName} ${item.projectName} ${item.eventName ?? ''}`.toLowerCase();
      const matchesSearch = !needle || haystack.includes(needle);
      return matchesStatus && matchesSearch;
    });
  }, [listSearch, listStatus, plannings]);

  const handoverProjectOptions = useMemo(() => {
    const activeStatuses: PlanningStatus[] = ['Entwurf', 'Geplant', 'Bestätigt', 'Bestaetigt'];
    return plannings.filter((planning) => activeStatuses.includes(planning.status));
  }, [plannings]);

  const handoverOptionsByDay = useMemo(() => {
    if (!editor) return new Map<string, Array<{ id: string; label: string }>>();
    const map = new Map<string, Array<{ id: string; label: string }>>();

    for (const day of editor.days) {
      const options = handoverProjectOptions
        .filter((planning) => planning.id !== editor.id)
        .map((planning) => {
          const sameDay = isDateWithinRange(day.planningDate, planning.startDate, planning.endDate);
          const overlapsEditorRange = rangesOverlap(
            editor.startDate,
            editor.endDate,
            planning.startDate,
            planning.endDate,
          );
          const priority = sameDay ? 0 : overlapsEditorRange ? 1 : 2;
          const suffix = sameDay
            ? 'gleicher Tag'
            : overlapsEditorRange
              ? 'Zeitraum überschneidet sich'
              : 'andere aktive Planung';
          return {
            id: planning.id,
            priority,
            startDate: planning.startDate,
            label: `${planning.projectName} (${planning.customerName}) - ${suffix}`,
          };
        })
        .sort((a, b) => {
          if (a.priority !== b.priority) return a.priority - b.priority;
          if (a.startDate !== b.startDate) return a.startDate.localeCompare(b.startDate);
          return a.label.localeCompare(b.label, 'de');
        })
        .map((item) => ({ id: item.id, label: item.label }));
      map.set(day.planningDate, options);
    }
    return map;
  }, [editor, handoverProjectOptions]);

  const editorStats = useMemo(() => {
    if (!editor) {
      return {
        requestedQty: 0,
        dayCount: 0,
        categoryCount: 0,
      };
    }
    const allItems = editor.days.flatMap((day) => day.items);
    const requestedQty = allItems.reduce((total, item) => total + Math.max(0, Number(item.qty || 0)), 0);
    const categoryCount = new Set(allItems.map((item) => normalizeCategory(item.categoryKey)).filter(Boolean)).size;
    return {
      requestedQty,
      dayCount: editor.days.length,
      categoryCount,
    };
  }, [editor]);

  const loadPlannings = async (selectId?: string) => {
    setListLoading(true);
    setError(null);
    try {
      const data = await listPlannings();
      setPlannings(data);
      if (selectId) {
        setSelectedId(selectId);
      } else if (!selectedId && data[0]) {
        setSelectedId(data[0].id);
      } else if (selectedId && !data.some((item) => item.id === selectedId)) {
        setSelectedId(data[0]?.id ?? '');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Planungen konnten nicht geladen werden.');
    } finally {
      setListLoading(false);
    }
  };

  const openPlanning = async (planningId: string) => {
    setSelectedId(planningId);
    setDetailLoading(true);
    setError(null);
    try {
      const [planning, planningAvailability] = await Promise.all([
        getPlanning(planningId),
        getPlanningAvailability(planningId),
      ]);
      setEditor(toEditablePlanning(planning));
      setAvailability(planningAvailability);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Planungsdetail konnte nicht geladen werden.');
    } finally {
      setDetailLoading(false);
    }
  };

  const persistPlanning = async (planning: EditablePlanning) => {
    if (!planning.customerName.trim() || !planning.projectName.trim()) {
      await alert({
        title: 'Pflichtfelder fehlen',
        message: 'Bitte Kunde und Projekt ausfüllen.',
      });
      return null;
    }
    if (planning.endDate < planning.startDate) {
      await alert({
        title: 'Zeitraum ungültig',
        message: 'Das Enddatum darf nicht vor dem Startdatum liegen.',
      });
      return null;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await updatePlanning(planning.id, toUpsertPayload(planning));
      const savedEditor = toEditablePlanning(saved);
      setEditor(savedEditor);
      const [planningAvailability] = await Promise.all([getPlanningAvailability(saved.id), loadPlannings(saved.id)]);
      setAvailability(planningAvailability);
      return savedEditor;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Planung konnte nicht gespeichert werden.');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const saveCurrent = async () => {
    if (!editor) return;
    await persistPlanning(editor);
  };

  const createNewPlanning = async () => {
    if (!createForm.customerName.trim() || !createForm.projectName.trim()) {
      await alert({
        title: 'Pflichtfelder fehlen',
        message: 'Bitte Kunde und Projekt ausfüllen.',
      });
      return;
    }
    if (createForm.endDate < createForm.startDate) {
      await alert({
        title: 'Zeitraum ungültig',
        message: 'Das Enddatum darf nicht vor dem Startdatum liegen.',
      });
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await createPlanning({
        customerName: createForm.customerName.trim(),
        projectName: createForm.projectName.trim(),
        eventName: createForm.eventName.trim() || null,
        projectManagerUserId: createForm.projectManagerUserId || null,
        calendarWeek: createForm.calendarWeek ? Number(createForm.calendarWeek) : null,
        startDate: createForm.startDate,
        endDate: createForm.endDate,
        notes: createForm.notes,
        status: createForm.status,
        days: buildDaysInRange(createForm.startDate, createForm.endDate),
      });
      setCreateOpen(false);
      setCreateForm((current) => ({
        ...current,
        customerName: '',
        projectName: '',
        eventName: '',
        projectManagerUserId: '',
        notes: '',
      }));
      await loadPlannings(created.id);
      await openPlanning(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Planung konnte nicht angelegt werden.');
    } finally {
      setSaving(false);
    }
  };

  const duplicate = async (planningId: string) => {
    setSaving(true);
    setError(null);
    try {
      const duplicated = await duplicatePlanning(planningId);
      await loadPlannings(duplicated.id);
      await openPlanning(duplicated.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Planung konnte nicht dupliziert werden.');
    } finally {
      setSaving(false);
    }
  };

  const deleteCurrent = async (planningId: string) => {
    const accepted = await confirm({
      title: 'Planung löschen',
      message: 'Diese Planung wird dauerhaft gelöscht. Fortfahren?',
      confirmLabel: 'Löschen',
      cancelLabel: 'Abbrechen',
      tone: 'danger',
    });
    if (!accepted) return;
    setSaving(true);
    setError(null);
    try {
      await deletePlanning(planningId);
      if (selectedId === planningId) {
        setEditor(null);
        setAvailability(null);
      }
      await loadPlannings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Planung konnte nicht gelöscht werden.');
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (planningId: string, status: PlanningStatus) => {
    setSaving(true);
    setError(null);
    try {
      await updatePlanningStatus(planningId, status);
      await loadPlannings(planningId);
      if (selectedId === planningId) {
        await openPlanning(planningId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Status konnte nicht gesetzt werden.');
    } finally {
      setSaving(false);
    }
  };

  const patchEditor = (updater: (value: EditablePlanning) => EditablePlanning) => {
    setEditor((current) => (current ? updater(current) : current));
  };

  const patchPlanningItem = (
    dayIndex: number,
    itemIndex: number,
    updater: (item: EditablePlanning['days'][number]['items'][number]) => EditablePlanning['days'][number]['items'][number],
  ) => {
    patchEditor((current) => updatePlanningItemInEditor(current, dayIndex, itemIndex, updater));
  };

  const findPlanningItemPosition = (planningDate: string, categoryKey: string) => {
    if (!editor) return null;
    for (let dayIndex = 0; dayIndex < editor.days.length; dayIndex += 1) {
      if (editor.days[dayIndex].planningDate !== planningDate) continue;
      const itemIndex = editor.days[dayIndex].items.findIndex(
        (item) => normalizeCategory(item.categoryKey) === normalizeCategory(categoryKey),
      );
      if (itemIndex >= 0) return { dayIndex, itemIndex };
    }
    return null;
  };

  const openHandoverEditor = (
    dayIndex: number,
    itemIndex: number,
    preset?: Partial<EditablePlanning['days'][number]['items'][number]>,
  ) => {
    if (!editor) return;
    const key = handoverKey(dayIndex, itemIndex);
    setHandoverSnapshot((current) => ({ ...current, [key]: { ...editor.days[dayIndex].items[itemIndex] } }));
    if (preset) {
      patchPlanningItem(dayIndex, itemIndex, (item) => ({
        ...item,
        ...preset,
      }));
    }
    setHandoverEditorKey(key);
  };

  const cancelHandoverEditor = (dayIndex: number, itemIndex: number) => {
    const key = handoverKey(dayIndex, itemIndex);
    const snapshot = handoverSnapshot[key];
    if (snapshot) {
      patchPlanningItem(dayIndex, itemIndex, () => snapshot);
    }
    setHandoverEditorKey((current) => (current === key ? null : current));
  };

  const clearHandoverSnapshot = (key: string) => {
    setHandoverSnapshot((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const saveHandoverEditor = async (dayIndex: number, itemIndex: number) => {
    if (!editor) return;
    const key = handoverKey(dayIndex, itemIndex);
    const saved = await persistPlanning(editor);
    if (!saved) return;
    clearHandoverSnapshot(key);
    setHandoverEditorKey((current) => (current === key ? null : current));
  };

  const removeHandover = async (dayIndex: number, itemIndex: number) => {
    if (!editor) return;
    const key = handoverKey(dayIndex, itemIndex);
    const nextEditor = updatePlanningItemInEditor(editor, dayIndex, itemIndex, (item) => ({
      ...item,
      handoverEnabled: false,
      linkedPlanningId: '',
      handoverNote: '',
    }));
    setEditor(nextEditor);
    const saved = await persistPlanning(nextEditor);
    if (!saved) return;
    clearHandoverSnapshot(key);
    setHandoverEditorKey((current) => (current === key ? null : current));
  };

  const openHandoverEditorByKey = (
    planningDate: string,
    categoryKey: string,
    preset?: Partial<EditablePlanning['days'][number]['items'][number]>,
  ) => {
    const position = findPlanningItemPosition(planningDate, categoryKey);
    if (!position) return;
    openHandoverEditor(position.dayIndex, position.itemIndex, preset);
  };

  const removeHandoverByKey = async (planningDate: string, categoryKey: string) => {
    const position = findPlanningItemPosition(planningDate, categoryKey);
    if (!position) return;
    await removeHandover(position.dayIndex, position.itemIndex);
  };

  const addDay = () => {
    patchEditor((current) => {
      const lastDate = current.days[current.days.length - 1]?.planningDate || current.startDate;
      const next = new Date(`${lastDate}T00:00:00`);
      next.setDate(next.getDate() + 1);
      const iso = toIsoDate(next);
      return {
        ...current,
        days: [
          ...current.days,
          {
            planningDate: iso,
            weekday: getGermanWeekday(iso),
            items: [],
          },
        ],
      };
    });
  };

  useEffect(() => {
    void loadPlannings();
  }, []);

  return (
    <section className="space-y-5">
      <div className="surface-card animate-fade-up">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="page-kicker">Einsatzplanung</p>
            <h2 className="page-title">Projektbezogene Hardwareplanung</h2>
            <p className="page-subtitle">Bedarf pro Tag planen, Summen prüfen und Engpässe direkt sehen.</p>
          </div>
          {canEdit ? (
            <button type="button" data-testid="planning-create" className="btn-primary" onClick={() => setCreateOpen(true)}>
              <CalendarPlus className="h-4 w-4" />
              Neue Planung
            </button>
          ) : (
            <span className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Leseansicht
            </span>
          )}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <div className="surface-muted px-3 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Gesamt Planungen</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{planningStats.total}</p>
          </div>
          <div className="surface-muted px-3 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Aktiv</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{planningStats.openCount}</p>
          </div>
          <div className="surface-muted px-3 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Abgeschlossen</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{planningStats.doneCount}</p>
          </div>
          <div className="surface-muted px-3 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Offene Konflikte</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{planningStats.redCount}</p>
          </div>
        </div>
      </div>

      {error ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

      <div className="grid gap-4 xl:grid-cols-12">
        <article className="surface-card xl:col-span-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-slate-900">Planungsliste</h3>
            <button
              type="button"
              className="btn-secondary px-2.5 py-1.5 text-xs"
              onClick={() => {
                void loadPlannings();
              }}
            >
              Aktualisieren
            </button>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className="field-input"
              placeholder="Kunde oder Projekt suchen"
              value={listSearch}
              onChange={(event) => setListSearch(event.target.value)}
            />
            <select
              className="field-input"
              value={listStatus}
              onChange={(event) => setListStatus(event.target.value as 'Alle' | PlanningStatus)}
            >
              <option value="Alle">Alle Status</option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>

          <div className="soft-scrollbar mt-3 max-h-[720px] space-y-2 overflow-y-auto pr-1">
            {!visiblePlannings.length && !listLoading ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-8 text-center text-sm text-slate-500">
                Noch keine passende Planung gefunden.
              </div>
            ) : null}

            {visiblePlannings.map((item) => {
              const isActive = selectedId === item.id;
              return (
                <div
                  key={item.id}
                  data-testid={`planning-row-${item.id}`}
                  className={`rounded-xl border p-3 ${
                    isActive ? 'border-brand-200 bg-brand-50/60' : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{item.customerName}</p>
                      <p className="text-xs text-slate-600">{item.projectName}</p>
                      {item.eventName ? <p className="text-xs text-slate-500">{item.eventName}</p> : null}
                    </div>
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-500">
                      KW {item.calendarWeek ?? '-'}
                    </span>
                  </div>

                  <p className="mt-2 text-xs text-slate-500">{formatPeriod(item.startDate, item.endDate)}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    PM:{' '}
                    {item.projectManagerUserId
                      ? managerLabelById.get(item.projectManagerUserId) ?? '-'
                      : '-'}
                  </p>

                  <div className="mt-2 grid gap-2">
                    <select
                      value={item.status}
                      className="field-input h-9 text-xs"
                      disabled={!canEdit}
                      onChange={(event) => {
                        void changeStatus(item.id, event.target.value as PlanningStatus);
                      }}
                    >
                      {STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        className="btn-secondary px-2 py-1 text-xs"
                        onClick={() => {
                          void openPlanning(item.id);
                        }}
                      >
                        Öffnen
                      </button>
                      {canEdit ? (
                        <button
                        type="button"
                        className="btn-secondary px-2 py-1 text-xs"
                        onClick={() => {
                          void duplicate(item.id);
                        }}
                      >
                        <Copy className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                      {canEdit ? (
                        <button
                        type="button"
                        className="btn-danger px-2 py-1 text-xs"
                        onClick={() => {
                          void deleteCurrent(item.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </article>

        <article className="surface-card xl:col-span-8">
          {editor ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    Planung {editor.customerName} · {editor.projectName}
                  </h3>
                  <p className="text-xs text-slate-500">ID {editor.id}</p>
                </div>
                {canEdit ? (
                  <button
                  type="button"
                  data-testid="planning-save"
                  className="btn-primary"
                  onClick={() => {
                    void saveCurrent();
                  }}
                  disabled={saving}
                >
                  <Save className="h-4 w-4" />
                  Speichern
                  </button>
                ) : null}
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <h4 className="text-sm font-semibold text-slate-900">Projektkontext</h4>
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  <label className="field">
                    Kunde
                    <input
                      className="field-input"
                      value={editor.customerName}
                      onChange={(event) => patchEditor((current) => ({ ...current, customerName: event.target.value }))}
                    />
                  </label>
                  <label className="field">
                    Projekt
                    <input
                      className="field-input"
                      value={editor.projectName}
                      onChange={(event) => patchEditor((current) => ({ ...current, projectName: event.target.value }))}
                    />
                  </label>
                  <label className="field">
                    Veranstaltung
                    <input
                      className="field-input"
                      value={editor.eventName}
                      onChange={(event) => patchEditor((current) => ({ ...current, eventName: event.target.value }))}
                    />
                  </label>
                  <label className="field">
                    Projektmanager
                    <select
                      className="field-input"
                      value={editor.projectManagerUserId}
                      onChange={(event) =>
                        patchEditor((current) => ({ ...current, projectManagerUserId: event.target.value }))
                      }
                    >
                      <option value="">Nicht gesetzt</option>
                      {selectableProjectManagers.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <h4 className="text-sm font-semibold text-slate-900">Zeitraum und Status</h4>
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  <label className="field">
                    Startdatum
                    <input
                      type="date"
                      className="field-input"
                      value={editor.startDate}
                      onChange={(event) => patchEditor((current) => ({ ...current, startDate: event.target.value }))}
                    />
                  </label>
                  <label className="field">
                    Enddatum
                    <input
                      type="date"
                      className="field-input"
                      value={editor.endDate}
                      onChange={(event) => patchEditor((current) => ({ ...current, endDate: event.target.value }))}
                    />
                  </label>
                  <label className="field">
                    Kalenderwoche
                    <input
                      className="field-input"
                      type="number"
                      min={1}
                      max={53}
                      value={editor.calendarWeek ?? ''}
                      onChange={(event) =>
                        patchEditor((current) => ({
                          ...current,
                          calendarWeek: event.target.value ? Number(event.target.value) : null,
                        }))
                      }
                    />
                  </label>
                  <label className="field">
                    Status
                    <select
                      className="field-input"
                      value={editor.status}
                      onChange={(event) =>
                        patchEditor((current) => ({ ...current, status: event.target.value as PlanningStatus }))
                      }
                    >
                      {STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="field mt-3">
                  Notizen
                  <textarea
                    className="field-input min-h-[80px]"
                    value={editor.notes}
                    onChange={(event) => patchEditor((current) => ({ ...current, notes: event.target.value }))}
                  />
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="surface-muted px-3 py-2.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Zeitraumtage</p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">{editorStats.dayCount}</p>
                </div>
                <div className="surface-muted px-3 py-2.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Gesamtbedarf</p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">{editorStats.requestedQty}</p>
                </div>
                <div className="surface-muted px-3 py-2.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Kategorien</p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">{editorStats.categoryCount}</p>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-semibold text-slate-900">Tagesplanung</h4>
                  <div className="inline-flex gap-2">
                    <button
                      type="button"
                      className="btn-secondary px-2.5 py-1.5 text-xs"
                      onClick={() =>
                        patchEditor((current) => ({
                          ...current,
                          days: buildDaysInRange(current.startDate, current.endDate),
                        }))
                      }
                    >
                      Tage aus Zeitraum
                    </button>
                    <button type="button" className="btn-secondary px-2.5 py-1.5 text-xs" onClick={addDay}>
                      <Plus className="h-3.5 w-3.5" />
                      Tag hinzufügen
                    </button>
                  </div>
                </div>

                <div className="soft-scrollbar max-h-[560px] space-y-3 overflow-y-auto pr-1">
                  {editor.days.map((day, dayIndex) => {
                    const dayTotal = day.items.reduce((sum, item) => sum + Math.max(0, Number(item.qty || 0)), 0);
                    return (
                      <div
                        key={`${day.planningDate}-${dayIndex}`}
                        data-testid={`planning-day-${dayIndex}`}
                        className="rounded-xl border border-slate-200 bg-white p-3"
                      >
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <div className="inline-flex items-center gap-2">
                            <input
                              type="date"
                              className="field-input h-9"
                              value={day.planningDate}
                              onChange={(event) =>
                                patchEditor((current) => {
                                  const nextDays = [...current.days];
                                  nextDays[dayIndex] = {
                                    ...nextDays[dayIndex],
                                    planningDate: event.target.value,
                                    weekday: getGermanWeekday(event.target.value),
                                  };
                                  return { ...current, days: nextDays };
                                })
                              }
                            />
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
                              {day.weekday}
                            </span>
                          </div>
                          <div className="inline-flex items-center gap-2">
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
                              Bedarf {dayTotal}
                            </span>
                            <button
                              type="button"
                              className="btn-danger px-2.5 py-1.5 text-xs"
                              onClick={() =>
                                patchEditor((current) => ({
                                  ...current,
                                  days: current.days.filter((_, index) => index !== dayIndex),
                                }))
                              }
                            >
                              Tag entfernen
                            </button>
                          </div>
                        </div>

                        <div className="space-y-2">
                          {day.items.map((item, itemIndex) => {
                            const availabilityKey = `${day.planningDate}|${normalizeCategory(item.categoryKey)}`;
                            const availabilityItem = availabilityByDayCategory.get(availabilityKey);
                            const visual = availabilityVisualMap.get(availabilityKey);
                            const editorKey = handoverKey(dayIndex, itemIndex);
                            const editorOpen = handoverEditorKey === editorKey;
                            return (
                              <div key={`${item.categoryKey}-${itemIndex}`} className="space-y-2">
                                <div className="grid gap-2 lg:grid-cols-12">
                                <select
                                  data-testid={`planning-item-category-${dayIndex}-${itemIndex}`}
                                  className="field-input lg:col-span-4"
                                  value={item.categoryKey}
                                  onChange={(event) =>
                                    patchEditor((current) => {
                                      const nextDays = [...current.days];
                                      const nextItems = [...nextDays[dayIndex].items];
                                      nextItems[itemIndex] = { ...nextItems[itemIndex], categoryKey: event.target.value };
                                      nextDays[dayIndex] = { ...nextDays[dayIndex], items: nextItems };
                                      return { ...current, days: nextDays };
                                    })
                                  }
                                >
                                  <option value="">Kategorie wählen</option>
                                  {categoryOptions.map((category) => (
                                    <option key={category} value={category}>
                                      {category}
                                    </option>
                                  ))}
                                </select>

                                <input
                                  data-testid={`planning-item-qty-${dayIndex}-${itemIndex}`}
                                  type="number"
                                  min={0}
                                  className="field-input lg:col-span-2"
                                  value={item.qty}
                                  onChange={(event) =>
                                    patchEditor((current) => {
                                      const nextDays = [...current.days];
                                      const nextItems = [...nextDays[dayIndex].items];
                                      nextItems[itemIndex] = {
                                        ...nextItems[itemIndex],
                                        qty: Math.max(0, Number(event.target.value || '0')),
                                      };
                                      nextDays[dayIndex] = { ...nextDays[dayIndex], items: nextItems };
                                      return { ...current, days: nextDays };
                                    })
                                  }
                                />

                                <input
                                  className="field-input lg:col-span-3"
                                  value={item.notes}
                                  placeholder="Notiz optional"
                                  onChange={(event) =>
                                    patchEditor((current) => {
                                      const nextDays = [...current.days];
                                      const nextItems = [...nextDays[dayIndex].items];
                                      nextItems[itemIndex] = { ...nextItems[itemIndex], notes: event.target.value };
                                      nextDays[dayIndex] = { ...nextDays[dayIndex], items: nextItems };
                                      return { ...current, days: nextDays };
                                    })
                                  }
                                />

                                <div className="lg:col-span-2">
                                  {availabilityItem && visual ? (
                                    <div
                                      className={`rounded-2xl border px-2.5 py-2 text-[11px] ${
                                        visual.status === 'handover'
                                          ? 'border-sky-200 bg-gradient-to-br from-sky-50 via-white to-cyan-50 text-slate-700 dark:border-sky-700 dark:from-sky-950/30 dark:via-slate-950 dark:to-cyan-950/20 dark:text-slate-100'
                                          : visual.status === 'review'
                                            ? 'border-orange-200 bg-orange-50/85 text-orange-900 dark:border-orange-700 dark:bg-orange-950/30 dark:text-orange-100'
                                            : visual.status === 'open'
                                              ? 'border-rose-200 bg-rose-50/90 text-rose-900 dark:border-rose-700 dark:bg-rose-950/35 dark:text-rose-100'
                                              : 'border-emerald-200 bg-emerald-50/90 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/25 dark:text-emerald-100'
                                      }`}
                                    >
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        <span
                                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                            visual.status === 'handover'
                                              ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-100'
                                              : visual.status === 'review'
                                                ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-100'
                                                : visual.status === 'open'
                                                  ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-100'
                                                  : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-100'
                                          }`}
                                        >
                                          {visual.status === 'handover'
                                            ? 'Übergabe-Verbund'
                                            : visual.status === 'review'
                                              ? 'Prüfung nötig'
                                              : visual.status === 'open'
                                                ? 'Offen'
                                                : 'Verfügbar'}
                                        </span>
                                        <span className="text-[10px] font-medium text-slate-500 dark:text-slate-300">
                                          {visual.categoryKey}
                                        </span>
                                      </div>
                                      <p className="mt-1 leading-relaxed">
                                        {visual.status === 'handover'
                                          ? `${visual.categoryKey} · ${visual.shortageQty} Stück abgestimmt`
                                          : visual.status === 'review'
                                            ? `${visual.categoryKey} · Projektverknüpfung prüfen`
                                            : visual.status === 'open'
                                              ? `${visual.categoryKey} · ${visual.shortageQty} Stück offen`
                                              : 'Kein offener Handlungsbedarf'}
                                      </p>
                                    </div>
                                  ) : (
                                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-500">
                                      Nach Speichern sichtbar
                                    </div>
                                  )}
                                </div>

                                <button
                                  type="button"
                                  className="btn-danger px-2 py-1 text-xs lg:col-span-1"
                                  onClick={() =>
                                    patchEditor((current) => {
                                      const nextDays = [...current.days];
                                      nextDays[dayIndex] = {
                                        ...nextDays[dayIndex],
                                        items: nextDays[dayIndex].items.filter((_, index) => index !== itemIndex),
                                      };
                                      return { ...current, days: nextDays };
                                    })
                                  }
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                                </div>

                                {visual?.status === 'open' ? (
                                  <div className="rounded-2xl border border-rose-200 bg-gradient-to-br from-rose-50 via-white to-orange-50 px-3 py-3 text-xs text-rose-900 shadow-sm dark:border-rose-700 dark:from-rose-950/40 dark:via-slate-950 dark:to-orange-950/20 dark:text-rose-100">
                                    <div className="flex items-start gap-3">
                                      <span className="rounded-2xl bg-rose-100 p-2 text-rose-700 dark:bg-rose-900/50 dark:text-rose-100">
                                        <AlertTriangle className="h-4 w-4" />
                                      </span>
                                      <div className="flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <p className="text-sm font-semibold">Offener Engpass</p>
                                          <span className="rounded-full border border-rose-200 bg-white/75 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700 dark:border-rose-700 dark:bg-slate-950/40 dark:text-rose-100">
                                            {visual.categoryKey}
                                          </span>
                                        </div>
                                        <p className="mt-1 text-[13px] leading-relaxed text-rose-800 dark:text-rose-100">
                                          {visual.categoryKey} · {visual.shortageQty} Stück fehlen am {formatGermanDate(day.planningDate)}.
                                        </p>
                                        <p className="mt-2 leading-relaxed text-rose-800 dark:text-rose-100">
                                          Für diese Position gibt es aktuell keinen erklärten Übergabe-Verbund. Hier besteht Handlungsbedarf.
                                        </p>
                                        <details className="mt-3">
                                          <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-200">
                                            Details anzeigen
                                          </summary>
                                          <div className="mt-2 space-y-0.5 text-[10px]">
                                            <p>Nutzbar: {visual.usableStock}</p>
                                            <p>Diese Planung: {visual.currentPlanningQty}</p>
                                            <p>Andere Planungen: {visual.otherPlannedQty}</p>
                                            <p>Gesamt geplant: {visual.totalPlannedQtyForDateCategory}</p>
                                            <p>Rest nach Gesamtplanung: {visual.remainingAfterAllPlanning}</p>
                                          </div>
                                        </details>
                                        <div className="mt-3 flex flex-wrap gap-2">
                                          <button
                                            type="button"
                                            className="btn-danger px-2.5 py-1.5 text-xs"
                                            onClick={() => openHandoverEditor(dayIndex, itemIndex)}
                                          >
                                            Übergabe planen
                                          </button>
                                          <button
                                            type="button"
                                            className="btn-secondary px-2.5 py-1.5 text-xs"
                                            onClick={() => onOpenInventoryWithQuery(visual.categoryKey)}
                                          >
                                            Bestand öffnen
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                ) : null}

                                {visual?.status === 'handover' ? (
                                  <div className="rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-cyan-50 px-3 py-3 text-xs text-slate-800 shadow-sm dark:border-sky-700 dark:from-sky-950/35 dark:via-slate-950 dark:to-cyan-950/25 dark:text-slate-100">
                                    <div className="flex items-start gap-3">
                                      <span className="rounded-2xl bg-sky-100 p-2 text-sky-700 dark:bg-sky-900/50 dark:text-sky-100">
                                        <Link2 className="h-4 w-4" />
                                      </span>
                                      <div className="flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <p className="text-sm font-semibold">Übergabe-Verbund aktiv</p>
                                          <span className="rounded-full border border-sky-200 bg-white/75 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:border-sky-700 dark:bg-slate-950/40 dark:text-sky-100">
                                            Kein offener Handlungsbedarf
                                          </span>
                                        </div>
                                        <p className="mt-1 text-[13px] font-medium text-slate-800 dark:text-slate-100">
                                          {visual.categoryKey} · {visual.shortageQty} Stück abgestimmt
                                        </p>
                                        <p className="mt-2 leading-relaxed text-slate-600 dark:text-slate-300">
                                          {visual.source === 'incoming'
                                            ? `Dieses Projekt ist bereits über ${visual.partnerLabel || 'ein Partnerprojekt'} Teil desselben Übergabe-Verbunds. Du musst hier nichts doppelt verknüpfen.`
                                            : `Diese Planung ist mit ${visual.partnerLabel || 'einem Partnerprojekt'} abgestimmt. Die Übergabe wird bereits berücksichtigt.`}
                                        </p>
                                        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                                          <span className="rounded-full border border-slate-200 bg-white/80 px-2.5 py-1 text-slate-700 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100">
                                            {currentPlanningLabel || 'Aktuelles Projekt'}
                                          </span>
                                          <span className="text-slate-400 dark:text-slate-500">↔</span>
                                          <span className="rounded-full border border-sky-200 bg-sky-100/70 px-2.5 py-1 text-sky-800 dark:border-sky-700 dark:bg-sky-900/40 dark:text-sky-100">
                                            {visual.partnerLabel || 'Partnerprojekt'}
                                          </span>
                                        </div>
                                        {visual.note ? (
                                          <p className="mt-2 rounded-xl border border-white/70 bg-white/65 px-2.5 py-2 text-[11px] text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-200">
                                            Hinweis: {visual.note}
                                          </p>
                                        ) : null}
                                        <details className="mt-3">
                                          <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
                                            Details anzeigen
                                          </summary>
                                          <div className="mt-2 space-y-0.5 text-[10px] text-slate-600 dark:text-slate-300">
                                            <p>Nutzbar: {visual.usableStock}</p>
                                            <p>Diese Planung: {visual.currentPlanningQty}</p>
                                            <p>Andere Planungen: {visual.otherPlannedQty}</p>
                                            <p>Gesamt geplant: {visual.totalPlannedQtyForDateCategory}</p>
                                            <p>Rest nach Gesamtplanung: {visual.remainingAfterAllPlanning}</p>
                                          </div>
                                        </details>
                                        <div className="mt-3 flex flex-wrap gap-2">
                                          {visual.partnerPlanningId ? (
                                            <button
                                              type="button"
                                              className="btn-secondary px-2.5 py-1.5 text-xs"
                                              onClick={() => {
                                                void openPlanning(visual.partnerPlanningId);
                                              }}
                                            >
                                              Partner öffnen
                                            </button>
                                          ) : null}
                                          {visual.source === 'incoming' ? (
                                            <>
                                              <span className="inline-flex items-center rounded-full border border-sky-200 bg-white/75 px-2.5 py-1 text-[11px] text-slate-600 dark:border-sky-700 dark:bg-slate-950/40 dark:text-slate-300">
                                                Partnerprojekt berücksichtigt
                                              </span>
                                            </>
                                          ) : (
                                            <>
                                              <button
                                                type="button"
                                                className="btn-secondary px-2.5 py-1.5 text-xs"
                                                onClick={() => openHandoverEditor(dayIndex, itemIndex)}
                                              >
                                                Übergabe bearbeiten
                                              </button>
                                              <button
                                                type="button"
                                                className="btn-secondary px-2.5 py-1.5 text-xs"
                                                onClick={() => {
                                                  void removeHandover(dayIndex, itemIndex);
                                                }}
                                              >
                                                Verknüpfung lösen
                                              </button>
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                ) : null}

                                {visual?.status === 'review' ? (
                                  <div className="rounded-2xl border border-orange-200 bg-gradient-to-br from-orange-50 via-white to-amber-50 px-3 py-3 text-xs text-orange-900 shadow-sm dark:border-orange-700 dark:from-orange-950/35 dark:via-slate-950 dark:to-amber-950/20 dark:text-orange-100">
                                    <div className="flex items-start gap-3">
                                      <span className="rounded-2xl bg-orange-100 p-2 text-orange-700 dark:bg-orange-900/50 dark:text-orange-100">
                                        <Clock3 className="h-4 w-4" />
                                      </span>
                                      <div className="flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <p className="text-sm font-semibold">Prüfung nötig</p>
                                          <span className="rounded-full border border-orange-200 bg-white/75 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-700 dark:border-orange-700 dark:bg-slate-950/40 dark:text-orange-100">
                                            Verknüpfung offen
                                          </span>
                                        </div>
                                        <p className="mt-1 text-[13px] leading-relaxed">
                                          Eine Übergabe ist vorgemerkt, aber das Partnerprojekt fehlt noch. Bitte kurz prüfen.
                                        </p>
                                        {visual.note ? <p className="mt-2 text-[11px]">Hinweis: {visual.note}</p> : null}
                                        <details className="mt-3">
                                          <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-orange-700 dark:text-orange-200">
                                            Details anzeigen
                                          </summary>
                                          <div className="mt-2 space-y-0.5 text-[10px]">
                                            <p>Nutzbar: {visual.usableStock}</p>
                                            <p>Diese Planung: {visual.currentPlanningQty}</p>
                                            <p>Andere Planungen: {visual.otherPlannedQty}</p>
                                            <p>Gesamt geplant: {visual.totalPlannedQtyForDateCategory}</p>
                                            <p>Rest nach Gesamtplanung: {visual.remainingAfterAllPlanning}</p>
                                          </div>
                                        </details>
                                        <div className="mt-3 flex flex-wrap gap-2">
                                          <button
                                            type="button"
                                            className="btn-secondary px-2.5 py-1.5 text-xs"
                                            onClick={() => openHandoverEditor(dayIndex, itemIndex)}
                                          >
                                            Projekt auswählen
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                ) : null}

                                {editorOpen ? (
                                  <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-2 dark:border-amber-800 dark:bg-amber-950/25">
                                    <div className="grid gap-2 lg:grid-cols-12">
                                      <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200 lg:col-span-3">
                                        <input
                                          type="checkbox"
                                          checked={item.handoverEnabled}
                                          onChange={(event) =>
                                            patchPlanningItem(dayIndex, itemIndex, (current) => ({
                                              ...current,
                                              handoverEnabled: event.target.checked,
                                            }))
                                          }
                                        />
                                        Übergabe geplant
                                      </label>
                                      <select
                                        className="field-input lg:col-span-4"
                                        value={item.linkedPlanningId}
                                        disabled={!item.handoverEnabled}
                                        onChange={(event) =>
                                          patchPlanningItem(dayIndex, itemIndex, (current) => ({
                                            ...current,
                                            linkedPlanningId: event.target.value,
                                          }))
                                        }
                                      >
                                        <option value="">Übergabe-Projekt auswählen</option>
                                        {(handoverOptionsByDay.get(day.planningDate) ?? []).map((option) => (
                                          <option key={option.id} value={option.id}>
                                            {option.label}
                                          </option>
                                        ))}
                                      </select>
                                      <input
                                        className="field-input lg:col-span-5"
                                        value={item.handoverNote}
                                        disabled={!item.handoverEnabled}
                                        placeholder="z. B. Projekt 1 übergibt 2 LTE-Router an Projekt 2 nach Aufbau"
                                        onChange={(event) =>
                                          patchPlanningItem(dayIndex, itemIndex, (current) => ({
                                            ...current,
                                            handoverNote: event.target.value,
                                          }))
                                        }
                                      />
                                    </div>
                                    {item.handoverEnabled && !item.linkedPlanningId ? (
                                      <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                                        Hinweis: Verknüpftes Projekt auswählen, damit die Übergabeplanung nachvollziehbar ist.
                                      </p>
                                    ) : null}
                                    <div className="mt-2 flex gap-1.5">
                                      <button
                                        type="button"
                                        className="btn-primary px-2.5 py-1.5 text-xs"
                                        onClick={() => {
                                          void saveHandoverEditor(dayIndex, itemIndex);
                                        }}
                                        disabled={saving}
                                      >
                                        Übernehmen
                                      </button>
                                      <button
                                        type="button"
                                        className="btn-secondary px-2.5 py-1.5 text-xs"
                                        onClick={() => cancelHandoverEditor(dayIndex, itemIndex)}
                                      >
                                        Abbrechen
                                      </button>
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}

                          <button
                            type="button"
                            data-testid={`planning-add-item-${dayIndex}`}
                            className="btn-secondary px-2.5 py-1.5 text-xs"
                            onClick={() =>
                              patchEditor((current) => {
                                const nextDays = [...current.days];
                                nextDays[dayIndex] = {
                                  ...nextDays[dayIndex],
                                  items: [
                                    ...nextDays[dayIndex].items,
                                    {
                                      categoryKey: categoryOptions[0] ?? '',
                                      qty: 0,
                                      notes: '',
                                      handoverEnabled: false,
                                      linkedPlanningId: '',
                                      handoverNote: '',
                                    },
                                  ],
                                };
                                return { ...current, days: nextDays };
                              })
                            }
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Position
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="font-semibold text-slate-900">Availability Übersicht</h4>
                    <p className="mt-1 text-xs text-slate-500">
                      Trennt klar zwischen geplanten Übergabe-Verbuenden und wirklich ungeklärten Engpaessen.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-800 dark:border-sky-700 dark:bg-sky-950/30 dark:text-sky-200">
                      Übergabe-Verbuende: {networkVisuals.length}
                    </span>
                    <span className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-medium text-orange-800 dark:border-orange-700 dark:bg-orange-950/30 dark:text-orange-200">
                      Unvollständig: {incompleteVisuals.length}
                    </span>
                    <span className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-medium text-rose-800 dark:border-rose-700 dark:bg-rose-950/30 dark:text-rose-200">
                      Ungeklärte Engpässe: {shortageVisuals.length}
                    </span>
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200">
                      Konfliktfrei: {healthyCategoryCount}
                    </span>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="status-chip border-emerald-200 bg-emerald-50 text-emerald-700">
                    <Clock3 className="h-3.5 w-3.5" />
                    Grün = Alles verfügbar
                  </span>
                  <span className="status-chip border-sky-200 bg-sky-50 text-sky-700">
                    <Link2 className="h-3.5 w-3.5" />
                    Blau = Übergabe geplant
                  </span>
                  <span className="status-chip border-orange-200 bg-orange-50 text-orange-700">
                    <Clock3 className="h-3.5 w-3.5" />
                    Gelb = Prüfung nötig
                  </span>
                  <span className="status-chip border-rose-200 bg-rose-50 text-rose-700">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Rot = Offener Handlungsbedarf
                  </span>
                </div>

                <div className="mt-4 grid gap-3 xl:grid-cols-2">
                  <div className="rounded-2xl border border-sky-200 bg-white p-3 shadow-sm dark:border-sky-800 dark:bg-slate-950">
                    <div className="flex items-start gap-3">
                      <span className="rounded-2xl bg-sky-100 p-2 text-sky-700 dark:bg-sky-900/40 dark:text-sky-100">
                        <Link2 className="h-4 w-4" />
                      </span>
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Geplante Übergaben</p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">
                          Diese Projekte sind bereits miteinander abgestimmt. Die abgestimmte Menge bleibt sichtbar, wirkt aber nicht wie ein offener Fehler.
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 space-y-2">
                      {[...networkVisuals, ...incompleteVisuals].map((visual) => (
                        <div
                          key={`network-${visual.key}`}
                          className={`rounded-2xl border px-3 py-3 text-xs shadow-sm ${
                            visual.status === 'review'
                              ? 'border-orange-200 bg-orange-50/80 text-orange-900 dark:border-orange-700 dark:bg-orange-950/25 dark:text-orange-100'
                              : 'border-sky-200 bg-gradient-to-br from-sky-50 via-white to-cyan-50 text-slate-800 dark:border-sky-700 dark:from-sky-950/30 dark:via-slate-950 dark:to-cyan-950/20 dark:text-slate-100'
                          }`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold">
                              {visual.status === 'review' ? 'Prüfung nötig' : 'Übergabe-Verbund aktiv'}
                            </p>
                            <span className="rounded-full border border-white/80 bg-white/75 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100">
                              {visual.categoryKey}
                            </span>
                          </div>
                          <p className="mt-1 text-[13px] font-medium">
                            {visual.categoryKey} · {visual.shortageQty} Stück · {formatGermanDate(visual.planningDate)}
                          </p>
                          <p className="mt-2 leading-relaxed text-slate-600 dark:text-slate-300">
                            {visual.status === 'review'
                              ? 'Die Übergabe ist vorgemerkt, aber das Partnerprojekt fehlt noch. Bitte kurz prüfen.'
                              : visual.source === 'incoming'
                                ? `Dieses Projekt ist über ${visual.partnerLabel || 'ein Partnerprojekt'} bereits eingebunden. Kein offener Handlungsbedarf.`
                                : `Diese Menge ist über eine geplante Übergabe mit ${visual.partnerLabel || 'einem Partnerprojekt'} berücksichtigt.`}
                          </p>
                          {visual.status !== 'review' ? (
                            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                              <span className="rounded-full border border-slate-200 bg-white/80 px-2.5 py-1 text-slate-700 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100">
                                {currentPlanningLabel || 'Aktuelles Projekt'}
                              </span>
                              <span className="text-slate-400 dark:text-slate-500">↔</span>
                              <span className="rounded-full border border-sky-200 bg-sky-100/70 px-2.5 py-1 text-sky-800 dark:border-sky-700 dark:bg-sky-900/40 dark:text-sky-100">
                                {visual.partnerLabel || 'Partnerprojekt'}
                              </span>
                            </div>
                          ) : null}
                          {visual.partnerLabel ? (
                            <p className="mt-2 text-[11px] text-slate-600 dark:text-slate-300">
                              Partnerprojekt: {visual.partnerLabel}
                            </p>
                          ) : null}
                          {visual.note ? (
                            <p className="mt-2 rounded-xl border border-white/80 bg-white/70 px-2.5 py-2 text-[11px] text-slate-700 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-200">
                              Hinweis: {visual.note}
                            </p>
                          ) : null}
                          <details className="mt-2">
                            <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
                              Details anzeigen
                            </summary>
                            <div className="mt-2 space-y-0.5 text-[10px] text-slate-600 dark:text-slate-300">
                              <p>Nutzbar: {visual.usableStock}</p>
                              <p>Diese Planung: {visual.currentPlanningQty}</p>
                              <p>Andere Planungen: {visual.otherPlannedQty}</p>
                              <p>Gesamt geplant: {visual.totalPlannedQtyForDateCategory}</p>
                              <p>Rest nach Gesamtplanung: {visual.remainingAfterAllPlanning}</p>
                              <p>affectedPlanningIds: {visual.affectedPlanningIds.join(', ') || '-'}</p>
                              <p>linkedPlanningId: {visual.linkedPlanningId || '-'}</p>
                            </div>
                          </details>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {visual.status === 'review' ? (
                              <button
                                type="button"
                                className="btn-secondary px-2.5 py-1.5 text-xs"
                                onClick={() => openHandoverEditorByKey(visual.planningDate, visual.categoryKey)}
                              >
                                Projekt auswählen
                              </button>
                            ) : visual.source === 'incoming' ? (
                              <>
                              <button
                                type="button"
                                className="btn-secondary px-2.5 py-1.5 text-xs"
                                onClick={() => {
                                  void openPlanning(visual.partnerPlanningId);
                                }}
                              >
                                Partner öffnen
                              </button>
                              <span className="inline-flex items-center rounded-full border border-sky-200 bg-white/75 px-2.5 py-1 text-[11px] text-slate-600 dark:border-sky-700 dark:bg-slate-950/40 dark:text-slate-300">
                                Partnerprojekt berücksichtigt
                              </span>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                  className="btn-secondary px-2.5 py-1.5 text-xs"
                                  onClick={() => openHandoverEditorByKey(visual.planningDate, visual.categoryKey)}
                              >
                                Übergabe bearbeiten
                              </button>
                                <button
                                  type="button"
                                  className="btn-secondary px-2.5 py-1.5 text-xs"
                                  onClick={() => {
                                    void removeHandoverByKey(visual.planningDate, visual.categoryKey);
                                  }}
                                >
                                  Verknüpfung lösen
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                      {!networkVisuals.length && !incompleteVisuals.length ? (
                        <p className="rounded-xl border border-dashed border-amber-200 px-3 py-4 text-center text-xs text-slate-500 dark:border-amber-800 dark:text-slate-400">
                          Noch keine geplante Übergabe hinterlegt.
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-rose-200 bg-white p-3 shadow-sm dark:border-rose-800 dark:bg-slate-950">
                    <div className="flex items-start gap-3">
                      <span className="rounded-2xl bg-rose-100 p-2 text-rose-700 dark:bg-rose-900/40 dark:text-rose-100">
                        <AlertTriangle className="h-4 w-4" />
                      </span>
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Ungeklärte Engpässe</p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">
                          Nur diese Konflikte brauchen noch eine aktive Entscheidung. Wenn hier nichts steht, ist kein roter Fehler mehr offen.
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 space-y-2">
                      {shortageVisuals.map((visual) => (
                        <div
                          key={`shortage-${visual.key}`}
                          className="rounded-2xl border border-rose-200 bg-rose-50/85 px-3 py-3 text-xs text-rose-900 shadow-sm dark:border-rose-700 dark:bg-rose-950/30 dark:text-rose-100"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold">Offener Engpass</p>
                            <span className="rounded-full border border-white/80 bg-white/75 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700 dark:border-rose-700 dark:bg-slate-950/40 dark:text-rose-100">
                              {visual.categoryKey}
                            </span>
                          </div>
                          <p className="mt-1 text-[13px]">
                            {visual.categoryKey} · {visual.shortageQty} Stück fehlen · {formatGermanDate(visual.planningDate)}
                          </p>
                          <p className="mt-2 leading-relaxed text-rose-800 dark:text-rose-100">
                            Für diese Kategorie reicht der Bestand trotz aktueller Planung nicht aus. Hier besteht offener Handlungsbedarf.
                          </p>
                          <details className="mt-2">
                            <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-200">
                              Details anzeigen
                            </summary>
                            <div className="mt-2 space-y-0.5 text-[10px]">
                              <p>Nutzbar: {visual.usableStock}</p>
                              <p>Diese Planung: {visual.currentPlanningQty}</p>
                              <p>Andere Planungen: {visual.otherPlannedQty}</p>
                              <p>Gesamt geplant: {visual.totalPlannedQtyForDateCategory}</p>
                              <p>Rest nach Gesamtplanung: {visual.remainingAfterAllPlanning}</p>
                              <p>affectedPlanningIds: {visual.affectedPlanningIds.join(', ') || '-'}</p>
                            </div>
                          </details>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="btn-danger px-2.5 py-1.5 text-xs"
                              onClick={() => openHandoverEditorByKey(visual.planningDate, visual.categoryKey)}
                            >
                              Übergabe planen
                            </button>
                            <button
                              type="button"
                              className="btn-secondary px-2.5 py-1.5 text-xs"
                              onClick={() => onOpenInventoryWithQuery(visual.categoryKey)}
                            >
                              Bestand öffnen
                            </button>
                          </div>
                        </div>
                      ))}
                      {!shortageVisuals.length ? (
                        <p className="rounded-xl border border-dashed border-rose-200 px-3 py-4 text-center text-xs text-slate-500 dark:border-rose-800 dark:text-slate-400">
                          Keine ungeklärten Engpässe.
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-[420px] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
              {detailLoading ? 'Planung wird geladen...' : 'Wähle links eine Planung aus oder lege eine neue an.'}
            </div>
          )}
        </article>
      </div>

      {createOpen && canEdit ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/55 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-panel">
            <h3 className="text-lg font-semibold text-slate-900">Neue Einsatzplanung</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="field">
                Kunde
                <input
                  className="field-input"
                  value={createForm.customerName}
                  onChange={(event) => setCreateForm((current) => ({ ...current, customerName: event.target.value }))}
                />
              </label>
              <label className="field">
                Projekt
                <input
                  className="field-input"
                  value={createForm.projectName}
                  onChange={(event) => setCreateForm((current) => ({ ...current, projectName: event.target.value }))}
                />
              </label>
              <label className="field">
                Veranstaltung
                <input
                  className="field-input"
                  value={createForm.eventName}
                  onChange={(event) => setCreateForm((current) => ({ ...current, eventName: event.target.value }))}
                />
              </label>
              <label className="field">
                Projektmanager
                <select
                  className="field-input"
                  value={createForm.projectManagerUserId}
                  onChange={(event) => setCreateForm((current) => ({ ...current, projectManagerUserId: event.target.value }))}
                >
                  <option value="">Nicht gesetzt</option>
                  {selectableProjectManagers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Startdatum
                <input
                  type="date"
                  className="field-input"
                  value={createForm.startDate}
                  onChange={(event) => setCreateForm((current) => ({ ...current, startDate: event.target.value }))}
                />
              </label>
              <label className="field">
                Enddatum
                <input
                  type="date"
                  className="field-input"
                  value={createForm.endDate}
                  onChange={(event) => setCreateForm((current) => ({ ...current, endDate: event.target.value }))}
                />
              </label>
              <label className="field">
                Kalenderwoche
                <input
                  className="field-input"
                  type="number"
                  min={1}
                  max={53}
                  value={createForm.calendarWeek}
                  onChange={(event) => setCreateForm((current) => ({ ...current, calendarWeek: event.target.value }))}
                />
              </label>
              <label className="field">
                Status
                <select
                  className="field-input"
                  value={createForm.status}
                  onChange={(event) => setCreateForm((current) => ({ ...current, status: event.target.value as PlanningStatus }))}
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field mt-3">
              Notizen
              <textarea
                className="field-input min-h-[90px]"
                value={createForm.notes}
                onChange={(event) => setCreateForm((current) => ({ ...current, notes: event.target.value }))}
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setCreateOpen(false)}>
                Abbrechen
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  void createNewPlanning();
                }}
              >
                Planung anlegen
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {listLoading ? <p className="text-xs text-slate-500">Lade Planungen...</p> : null}
    </section>
  );
}
