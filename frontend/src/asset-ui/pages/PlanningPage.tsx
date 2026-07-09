import { AlertTriangle, CalendarPlus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAppDialog } from '../../components/dialogs/AppDialogProvider';
import { InlineLoadingState, LoadingButton } from '../../components/loading';
import { useScrollRestoration } from '../../hooks/useScrollRestoration';
import { useUrlFlag, useUrlQueryState } from '../../hooks/useUrlQueryState';
import { planningDetailPath } from '../../routing/appRoutes';
import { navigate } from '../../routing/router';
import { PageHeader, SegmentedControl } from '../../ui';
import { PlanningCreateModal } from '../components/planning/detail/PlanningCreateModal';
import { PlanningKpiBar } from '../components/planning/PlanningKpiBar';
import { PlanningListCompact } from '../components/planning/PlanningListCompact';
import { PlanningCalendarAddOn } from './PlanningCalendarAddOn';
import {
  deletePlanning,
  duplicatePlanning,
  getPlanningAvailability,
  listPlannings,
  type PlanningAvailabilityResponse,
  type PlanningResponse,
  type PlanningStatus,
  type RecommendationPriority,
  type WmsOverview,
} from '../../services/wmsApi';
import { formatEinsatz, formatRueckgabe, getStockFreeAgainIso, isDateBooked } from './planningPeriod';
import type { Asset, CategoryItem, UserItem } from '../types';

type PlanningPageProps = {
  assets: Asset[];
  categories: CategoryItem[];
  users: UserItem[];
  planningSummary: WmsOverview['planningSummary'];
  onRefreshOverview?: () => Promise<void>;
  onOpenInventoryWithQuery: (query: string) => void;
  canEdit?: boolean;
  isMobile?: boolean;
};

type PlanningListHandoverSummary = NonNullable<
  Awaited<ReturnType<typeof listPlannings>>[number]['handoverSummary']
>;

const STATUS_OPTIONS: PlanningStatus[] = ['Entwurf', 'Geplant', 'Bestätigt', 'Abgeschlossen', 'Storniert'];

function toIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatGermanDate(isoDate: string): string {
  if (!isoDate) return '';
  const [year, month, day] = isoDate.split('-');
  if (!year || !month || !day) return isoDate;
  return `${day}.${month}.${year}`;
}

// Deutsche Plural-Formen der bekannten Hardware-Kategorien. Für unbekannte
// (z. B. selbst angelegte) Kategorien greift ein Fallback (siehe categoryCountLabel).
const CATEGORY_PLURALS: Record<string, string> = {
  Laptop: 'Laptops',
  iPad: 'iPads',
  Handheld: 'Handhelds',
  Smartphone: 'Smartphones',
  'QR-Code-Scanner': 'QR-Code-Scanner',
  Drucker: 'Drucker',
  Kartendrucker: 'Kartendrucker',
  Switch: 'Switches',
  Router: 'Router',
  'LTE-Router': 'LTE-Router',
  Zubehör: 'Zubehör',
  Zubehoer: 'Zubehoer',
  Sonstiges: 'Sonstiges',
};

// "1 Laptop", "8 Laptops", "7 QR-Code-Scanner". Für unbekannte Kategorien im
// Plural der gut lesbare "8× Kategorie"-Fallback.
function categoryCountLabel(category: string, count: number): string {
  if (count === 1) return `1 ${category}`;
  const plural = CATEGORY_PLURALS[category];
  if (plural) return `${count} ${plural}`;
  return `${count}× ${category}`;
}

// Verb-Form passend zur Menge: "1 ... fehlt", "8 ... fehlen".
function shortageVerb(count: number): string {
  return count === 1 ? 'fehlt' : 'fehlen';
}

// Farbpunkt je Empfehlungs-Priorität.
function recoPriorityDot(priority: RecommendationPriority): string {
  if (priority === 'high') return 'bg-rose-500';
  if (priority === 'medium') return 'bg-amber-500';
  return 'bg-slate-400';
}

// Einsatzplanungs-Cockpit (Liste | Woche | Konflikte). Das Öffnen einer
// Planung navigiert auf die Detailseite /einsatzplanung/:planningId —
// bearbeitet wird ausschließlich dort (kein Editor-Modal mehr).
export function PlanningPage({
  planningSummary,
  onRefreshOverview,
  canEdit = true,
  isMobile = false,
}: PlanningPageProps) {
  const { confirm } = useAppDialog();
  const [plannings, setPlannings] = useState<Awaited<ReturnType<typeof listPlannings>>>([]);
  const [listLoading, setListLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [planningListDetails] = useState<Record<string, PlanningResponse>>({});
  const [calendarAvailabilitiesByPlanningId, setCalendarAvailabilitiesByPlanningId] = useState<
    Record<string, PlanningAvailabilityResponse>
  >({});

  // Listen-Filter + Ansicht leben in der URL — Browser-Zurück aus dem Detail
  // und Refresh stellen die gefilterte Sicht wieder her.
  const [listSearch, setListSearch] = useUrlQueryState('q', '', { debounceMs: 350 });
  const [viewParam, setView] = useUrlQueryState('view', 'liste');
  const view: 'liste' | 'woche' | 'konflikte' =
    viewParam === 'woche' || viewParam === 'konflikte' ? viewParam : 'liste';
  const [listStatusParam, setListStatus] = useUrlQueryState('status', 'Alle');
  const listStatus: 'Alle' | PlanningStatus = (STATUS_OPTIONS as string[]).includes(listStatusParam)
    ? (listStatusParam as PlanningStatus)
    : 'Alle';
  const [conflictFilterActive, setConflictFilterActive] = useUrlFlag('konflikte');
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  useScrollRestoration(listScrollRef, { ready: plannings.length > 0 });

  const loadPlannings = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setListLoading(true);
    setError(null);
    try {
      const data = await listPlannings();
      setPlannings(data);
      const visibleIds = new Set(data.map((item) => item.id));
      setCalendarAvailabilitiesByPlanningId((current) => {
        const next: Record<string, PlanningAvailabilityResponse> = {};
        for (const [planningId, availability] of Object.entries(current)) {
          if (visibleIds.has(planningId)) next[planningId] = availability;
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Planungen konnten nicht geladen werden.');
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPlannings();
  }, [loadPlannings]);

  const refreshOverview = async () => {
    try {
      await onRefreshOverview?.();
    } catch {
      // Planungs-Flows bleiben stabil, auch wenn der Overview-Refresh scheitert.
    }
  };

  // Detail-Auswahl über die URL — die Route rendert die Detailseite.
  const navigateToPlanning = (planningId: string) => {
    navigate(planningDetailPath(planningId), { state: { plPanel: true } });
  };

  const duplicate = async (planningId: string) => {
    setBusy(true);
    setError(null);
    try {
      const duplicated = await duplicatePlanning(planningId);
      await refreshOverview();
      navigateToPlanning(duplicated.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Planung konnte nicht dupliziert werden.');
    } finally {
      setBusy(false);
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
    setBusy(true);
    setError(null);
    try {
      await deletePlanning(planningId);
      await loadPlannings({ silent: true });
      await refreshOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Planung konnte nicht gelöscht werden.');
    } finally {
      setBusy(false);
    }
  };

  // --- Ableitungen ------------------------------------------------------------
  const planningStats = useMemo(() => {
    const openStatuses: PlanningStatus[] = ['Entwurf', 'Geplant', 'Bestätigt'];
    return {
      total: plannings.length,
      openCount: plannings.filter((item) => openStatuses.includes(item.status)).length,
      doneCount: plannings.filter((item) => item.status === 'Abgeschlossen').length,
      redCount: planningSummary?.openConflictCount ?? 0,
    };
  }, [planningSummary, plannings]);

  // Konfliktursachen-Gruppierung — vom Backend berechnet, hier nur dargestellt.
  const conflictGroups = planningSummary?.conflictGroups ?? [];
  const conflictCauseCount = planningSummary?.conflictCauseCount ?? conflictGroups.length;

  const visiblePlannings = useMemo(() => {
    const filtered = plannings.filter((item) => {
      const matchesStatus = listStatus === 'Alle' || item.status === listStatus;
      const needle = listSearch.trim().toLowerCase();
      const haystack = `${item.customerName} ${item.projectName} ${item.eventName ?? ''}`.toLowerCase();
      const matchesSearch = !needle || haystack.includes(needle);
      const matchesConflict = !conflictFilterActive || (item.openConflictCount ?? 0) > 0;
      return matchesStatus && matchesSearch && matchesConflict;
    });
    if (!conflictFilterActive) return filtered;
    return [...filtered].sort((a, b) => {
      if (a.startDate !== b.startDate) return a.startDate.localeCompare(b.startDate);
      const customer = a.customerName.localeCompare(b.customerName, 'de', { sensitivity: 'base' });
      if (customer !== 0) return customer;
      return a.projectName.localeCompare(b.projectName, 'de', { sensitivity: 'base' });
    });
  }, [conflictFilterActive, listSearch, listStatus, plannings]);

  const planningListHandoverSummaryById = useMemo(() => {
    const map = new Map<string, PlanningListHandoverSummary>();
    for (const item of visiblePlannings) {
      if (item.handoverSummary) map.set(item.id, item.handoverSummary);
    }
    return map;
  }, [visiblePlannings]);

  // Planungen mit Übergabe-Verbund → blauer Marker in der kompakten Liste.
  const handoverIdSet = useMemo(
    () => new Set(planningListHandoverSummaryById.keys()),
    [planningListHandoverSummaryById],
  );

  const activateConflictFilter = () => {
    if ((planningSummary?.openConflictCount ?? 0) <= 0) return;
    setListSearch('');
    setListStatus('Alle');
    setConflictFilterActive(true);
  };

  const clearConflictFilter = () => {
    setConflictFilterActive(false);
  };

  // Kalender lädt Availability lazy pro sichtbarer Woche nach.
  const requestCalendarPlanningData = useCallback(
    (planningIds: string[]) => {
      const missingIds = planningIds.filter(
        (planningId) => !calendarAvailabilitiesByPlanningId[planningId],
      );
      if (!missingIds.length) return;
      void Promise.all(
        missingIds.map(async (planningId) => {
          try {
            return { planningId, availability: await getPlanningAvailability(planningId) };
          } catch {
            return null;
          }
        }),
      ).then((results) => {
        setCalendarAvailabilitiesByPlanningId((current) => {
          const next = { ...current };
          for (const result of results) {
            if (!result) continue;
            next[result.availability.planningId || result.planningId] = result.availability;
          }
          return next;
        });
      });
    },
    [calendarAvailabilitiesByPlanningId],
  );

  const todayIso = toIsoDate(new Date());
  const tomorrowIso = toIsoDate(new Date(Date.now() + 86400000));
  const weekEndIso = toIsoDate(new Date(Date.now() + 6 * 86400000));
  // Enddatum ist exklusiv (= Rückgabetag, kein Einsatztag).
  const mobileToday = visiblePlannings.filter((item) => isDateBooked(todayIso, item.startDate, item.endDate));
  const mobileTomorrow = visiblePlannings.filter((item) =>
    isDateBooked(tomorrowIso, item.startDate, item.endDate),
  );
  const mobileWeek = visiblePlannings.filter(
    (item) => item.startDate <= weekEndIso && todayIso <= item.endDate,
  );

  return (
    <section className="space-y-4">
      <div className="surface-card animate-fade-up">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PageHeader dense kicker="Einsatzplanung" title="Projektbezogene Hardwareplanung" />
          <div className="flex flex-wrap items-center gap-2">
            {!isMobile ? (
              <>
                <input
                  className="field-input h-9 w-52 text-sm"
                  placeholder="Kunde oder Projekt suchen"
                  value={listSearch}
                  onChange={(event) => setListSearch(event.target.value)}
                />
                <select
                  className="field-input h-9 w-40 text-sm"
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
                <SegmentedControl
                  options={[
                    { value: 'liste', label: 'Liste' },
                    { value: 'woche', label: 'Woche' },
                    { value: 'konflikte', label: 'Konflikte' },
                  ]}
                  value={view}
                  onChange={setView}
                />
              </>
            ) : null}
            {canEdit ? (
              <button
                type="button"
                data-testid="planning-create"
                className="btn-primary"
                onClick={() => setCreateOpen(true)}
              >
                <CalendarPlus className="h-4 w-4" />
                Neue Planung
              </button>
            ) : (
              <span className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Leseansicht
              </span>
            )}
          </div>
        </div>

        <PlanningKpiBar
          className="mt-3"
          stats={planningStats}
          conflictCauseCount={conflictCauseCount}
          conflictsViewActive={view === 'konflikte'}
          onConflictsClick={() => setView(view === 'konflikte' ? 'liste' : 'konflikte')}
        />
      </div>

      {!isMobile && view === 'konflikte' ? (
        conflictGroups.length > 0 ? (
          <article
            className="surface-card rounded-xl border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-700/50 dark:bg-amber-950/25"
            data-testid="conflict-causes-panel"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-100">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                Konfliktursachen: {conflictCauseCount}
              </h3>
              <button
                type="button"
                className="btn-secondary px-2.5 py-1.5 text-xs"
                onClick={() => {
                  activateConflictFilter();
                  setView('liste');
                }}
              >
                Betroffene Planungen in der Liste zeigen
              </button>
            </div>
            <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">
              {planningStats.redCount} technische Konflikte hängen mit diesen Engpässen zusammen.
            </p>
            <div className="mt-3 grid gap-2">
              {conflictGroups.map((group) => {
                const rangeLabel =
                  group.dateFrom === group.dateTo
                    ? formatGermanDate(group.dateFrom)
                    : `${formatGermanDate(group.dateFrom)} – ${formatGermanDate(group.dateTo)}`;
                return (
                  <div
                    key={group.id}
                    data-testid={`conflict-cause-${group.id}`}
                    className="rounded-lg border border-amber-200 bg-white p-3 text-xs shadow-sm dark:border-amber-700/50 dark:bg-slate-950"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {group.categoryKey} · {rangeLabel}
                      </span>
                      <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:border-amber-600 dark:bg-amber-900/50 dark:text-amber-100">
                        Gemeinsamer Pool-Engpass
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Es {shortageVerb(group.maxMissingQty)} maximal{' '}
                      {categoryCountLabel(group.categoryKey, group.maxMissingQty)}
                    </p>
                    <p className="mt-0.5 text-slate-600 dark:text-slate-300">
                      {group.affectedPlanningCount}{' '}
                      {group.affectedPlanningCount === 1 ? 'Planung' : 'Planungen'} betroffen
                    </p>
                    {group.affectedPlanningLabels.length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {group.affectedPlanningLabels.map((label, index) => (
                          <span
                            key={`${group.id}-pl-${index}`}
                            className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                        Tagesdetails
                      </summary>
                      <ul className="mt-1.5 space-y-1">
                        {group.days.map((day) => (
                          <li
                            key={`${group.id}-${day.date}`}
                            className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                          >
                            {formatGermanDate(day.date)}:{' '}
                            {categoryCountLabel(group.categoryKey, day.requiredQty)} benötigt ·{' '}
                            {day.usableStock} nutzbar ·{' '}
                            {categoryCountLabel(group.categoryKey, day.missingQty)}{' '}
                            {shortageVerb(day.missingQty)}
                          </li>
                        ))}
                      </ul>
                    </details>
                    {(group.recommendations ?? []).length > 0 ? (
                      <details className="mt-2" data-testid={`conflict-cause-recommendations-${group.id}`}>
                        <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                          Lösungsvorschläge ({(group.recommendations ?? []).length})
                        </summary>
                        <ul className="mt-1.5 space-y-1.5">
                          {(group.recommendations ?? []).map((reco, index) => (
                            <li
                              key={`${group.id}-reco-${index}`}
                              className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900"
                            >
                              <div className="flex items-start gap-1.5">
                                <span
                                  className={`mt-1 h-2 w-2 shrink-0 rounded-full ${recoPriorityDot(reco.priority)}`}
                                  aria-hidden="true"
                                />
                                <div>
                                  <p className="text-[11px] font-semibold text-slate-800 dark:text-slate-100">
                                    {reco.title}
                                  </p>
                                  <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                                    {reco.description}
                                  </p>
                                </div>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </article>
        ) : (
          <article className="surface-card" data-testid="conflict-causes-panel">
            <h3 className="text-sm font-semibold text-ink">Konfliktursachen</h3>
            <p className="mt-2 rounded-xl border border-dashed border-line bg-surface-2 px-3 py-6 text-center text-sm text-ink-muted">
              Aktuell gibt es keine offenen Engpässe — alle Planungen sind gedeckt.
            </p>
          </article>
        )
      ) : null}

      {!isMobile && view === 'woche' ? (
        <article className="surface-card">
          <PlanningCalendarAddOn
            plannings={visiblePlannings}
            selectedId=""
            handoverSummaryById={planningListHandoverSummaryById}
            planningDetailsById={planningListDetails}
            availabilityByPlanningId={calendarAvailabilitiesByPlanningId}
            onSelectPlanning={navigateToPlanning}
            requestPlanningData={requestCalendarPlanningData}
          />
        </article>
      ) : null}

      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}
      {listLoading ? <InlineLoadingState message="Planungen werden geladen ..." /> : null}

      {isMobile ? (
        <article className="surface-card">
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Mobile Planung</h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Heute, Morgen und diese Woche im Überblick.
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <div className="surface-muted px-2 py-2">
              <p className="font-semibold text-slate-600 dark:text-slate-300">Heute</p>
              <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">{mobileToday.length}</p>
            </div>
            <div className="surface-muted px-2 py-2">
              <p className="font-semibold text-slate-600 dark:text-slate-300">Morgen</p>
              <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">{mobileTomorrow.length}</p>
            </div>
            <div className="surface-muted px-2 py-2">
              <p className="font-semibold text-slate-600 dark:text-slate-300">Woche</p>
              <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">{mobileWeek.length}</p>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {mobileWeek.slice(0, 12).map((item) => {
              const handoverSummary = planningListHandoverSummaryById.get(item.id);
              const hasShortage = (item.openConflictCount ?? 0) > 0;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="surface-muted block min-h-[52px] w-full px-3 py-2 text-left"
                  onClick={() => navigateToPlanning(item.id)}
                >
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{item.projectName}</p>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    Einsatz: {formatEinsatz(item.startDate, item.endDate)} · {item.status}
                  </p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    Rückgabe: {formatRueckgabe(item.startDate, item.endDate)}
                    {Number(item.returnBufferDays ?? 0) > 0
                      ? ` · Puffer +${Math.min(3, Number(item.returnBufferDays))} · frei ab ${formatGermanDate(getStockFreeAgainIso(item.startDate, item.endDate, item.returnBufferDays))}`
                      : ''}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {handoverSummary ? 'Übergabe/Verbund aktiv' : 'Kein Verbund'}
                    {hasShortage ? ' · Engpass offen' : ''}
                  </p>
                </button>
              );
            })}
            {!mobileWeek.length ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-400">
                Keine Planungen in dieser Woche.
              </div>
            ) : null}
          </div>
        </article>
      ) : null}

      {!isMobile && view === 'liste' ? (
        <article className="surface-card">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-slate-900">Planungsliste</h3>
            <LoadingButton
              type="button"
              className="btn-secondary px-2.5 py-1.5 text-xs"
              onClick={() => {
                void loadPlannings();
              }}
              isLoading={listLoading}
              loadingText="Wird geladen ..."
              disabled={busy}
            >
              Aktualisieren
            </LoadingButton>
          </div>

          {conflictFilterActive ? (
            <div
              className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"
              data-testid="planning-conflict-filter-banner"
            >
              <span>Es werden nur Planungen mit offenen Konflikten angezeigt.</span>
              <button
                type="button"
                data-testid="planning-conflict-filter-reset"
                className="rounded-full border border-rose-300 bg-white px-2.5 py-0.5 text-[11px] font-medium text-rose-700 hover:bg-rose-100"
                onClick={clearConflictFilter}
              >
                Filter zurücksetzen
              </button>
            </div>
          ) : null}

          <PlanningListCompact
            items={visiblePlannings}
            selectedId=""
            canEdit={canEdit}
            busy={busy}
            onSelect={navigateToPlanning}
            onDuplicate={(id) => {
              void duplicate(id);
            }}
            onDelete={(id) => {
              void deleteCurrent(id);
            }}
            handoverIds={handoverIdSet}
            scrollRef={listScrollRef}
            maxHeightClass="mt-3 max-h-[calc(100vh-330px)]"
            emptyHint={listLoading ? 'Planungen werden geladen ...' : 'Noch keine passende Planung gefunden.'}
          />
        </article>
      ) : null}

      <PlanningCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(created) => {
          setCreateOpen(false);
          void loadPlannings({ silent: true });
          void refreshOverview();
          // Direkt zur Detailseite (Tab Hardware) — dort werden die
          // Positionen gepflegt.
          navigate(`${planningDetailPath(created.id)}?tab=hardware`, { state: { plPanel: true } });
        }}
      />
    </section>
  );
}
