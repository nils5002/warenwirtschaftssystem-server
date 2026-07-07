import { Download, Lock, RefreshCw, ShieldAlert, ShieldCheck, UserRoundCheck, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { InlineLoadingState, LoadingButton } from '../../components/loading';
import { PageHeader } from '../../ui';
import { KpiCard } from '../components/KpiCard';
import { StatusBadge } from '../components/StatusBadge';
import {
  downloadSecurityEventsCsv,
  fetchSecuritySummary,
  listSecurityEvents,
  type SecurityEventFilters,
} from '../../services/wmsApi';
import type { SecurityEventItem, SecuritySummary } from '../types';

// Deutsche Labels für die Event-Typen (unbekannte Typen zeigen den Rohwert).
const EVENT_LABELS: Record<string, string> = {
  register_attempt: 'Registrierungsversuch',
  register_success_pending: 'Registrierung (wartet auf Freigabe)',
  register_duplicate: 'Registrierung (E-Mail bereits vergeben)',
  register_rejected: 'Benutzer abgelehnt',
  register_blocked_domain: 'Registrierung geblockt (Domain)',
  register_external_domain: 'Registrierung mit fremder Domain',
  register_blocked_disabled: 'Registrierung geblockt (deaktiviert)',
  register_blocked_rate_limit: 'Registrierung geblockt (zu viele Versuche)',
  register_honeypot: 'Bot-Registrierung abgefangen',
  register_invalid_email: 'Registrierung mit ungültiger E-Mail',
  login_success: 'Anmeldung erfolgreich',
  login_failed: 'Anmeldung fehlgeschlagen',
  login_blocked_inactive: 'Anmeldung geblockt (nicht freigegeben)',
  login_blocked_locked: 'Anmeldung geblockt (Konto gesperrt)',
  login_rate_limited: 'Anmeldung geblockt (zu viele Versuche)',
  logout: 'Abmeldung',
  password_changed: 'Passwort geändert',
  password_reset_requested: 'Passwort-Reset angefragt',
  password_reset_completed: 'Passwort zurückgesetzt',
  user_activated: 'Benutzer freigegeben',
  user_deactivated: 'Benutzer deaktiviert',
  user_locked: 'Benutzer gesperrt',
  user_unlocked: 'Benutzer entsperrt',
  user_deleted: 'Benutzer gelöscht',
  role_changed: 'Rolle geändert',
  permission_changed: 'Rechte geändert',
  admin_action_denied: 'Admin-Zugriff verweigert',
  suspicious_activity_detected: 'Verdächtige Aktivität',
  session_revoked: 'Sitzungen widerrufen',
  security_export_created: 'Sicherheitsprotokoll exportiert',
  backup_exported: 'Backup exportiert',
  backup_imported: 'Backup importiert',
};

const SEVERITY_LABELS: Record<string, string> = {
  info: 'Info',
  warning: 'Warnung',
  critical: 'Kritisch',
};

const TIME_RANGES: Array<{ key: string; label: string; hours?: number }> = [
  { key: '24h', label: 'Letzte 24 Stunden', hours: 24 },
  { key: '7d', label: 'Letzte 7 Tage', hours: 24 * 7 },
  { key: '30d', label: 'Letzte 30 Tage', hours: 24 * 30 },
  { key: 'all', label: 'Alles' },
];

const PAGE_SIZE = 50;

// Merker für den Sidebar-Badge: Zeitpunkt des letzten Seitenbesuchs.
const LAST_SEEN_STORAGE_KEY = 'wms.securityLogs.lastSeen';

function eventLabel(type: string): string {
  return EVENT_LABELS[type] ?? type;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Unbekannter Fehler.';
}

function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3600 * 1000).toISOString();
}

export function SecurityLogsPage() {
  const [summary, setSummary] = useState<SecuritySummary | null>(null);
  const [events, setEvents] = useState<SecurityEventItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SecurityEventItem | null>(null);

  // Filterzustand — bewusst einfache Controls, keine überladene Leiste.
  const [range, setRange] = useState('7d');
  const [typeFilter, setTypeFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [ipFilter, setIpFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [successFilter, setSuccessFilter] = useState('');

  const filters = useMemo<SecurityEventFilters>(() => {
    const rangeDef = TIME_RANGES.find((item) => item.key === range);
    return {
      type: typeFilter || undefined,
      user: userFilter.trim() || undefined,
      ip: ipFilter.trim() || undefined,
      severity: severityFilter || undefined,
      success: successFilter || undefined,
      from: rangeDef?.hours ? isoHoursAgo(rangeDef.hours) : undefined,
      limit: PAGE_SIZE,
    };
  }, [range, typeFilter, userFilter, ipFilter, severityFilter, successFilter]);

  const load = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) setLoading(true);
      setLoadError(null);
      try {
        const [listResponse, summaryResponse] = await Promise.all([
          listSecurityEvents({ ...filters, offset: 0 }),
          fetchSecuritySummary(),
        ]);
        setEvents(listResponse.items);
        setTotal(listResponse.total);
        setSummary(summaryResponse);
      } catch (error) {
        setLoadError(errorMessage(error));
      } finally {
        setLoading(false);
      }
    },
    [filters],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Besuch der Seite merken — Grundlage für den "neue Ereignisse"-Badge.
  useEffect(() => {
    try {
      localStorage.setItem(LAST_SEEN_STORAGE_KEY, new Date().toISOString());
    } catch {
      // localStorage kann fehlen (Private Mode) — Badge ist nur Komfort.
    }
  }, []);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const response = await listSecurityEvents({ ...filters, offset: events.length });
      setEvents((current) => [...current, ...response.items]);
      setTotal(response.total);
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoadingMore(false);
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const { blob, fileName } = await downloadSecurityEventsCsv(filters);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setExporting(false);
    }
  };

  const knownTypes = useMemo(() => Object.keys(EVENT_LABELS), []);

  return (
    <section className="space-y-4 sm:space-y-5">
      <PageHeader
        kicker="Admin"
        title="Sicherheit & Protokolle"
        subtitle="Anmeldungen, Registrierungen und sicherheitsrelevante Admin-Aktionen — nachvollziehbar an einem Ort."
        actions={
          <div className="flex items-center gap-2">
            <LoadingButton
              type="button"
              className="btn-secondary min-h-9 px-3 py-1.5 text-xs"
              isLoading={exporting}
              loadingText="Exportiert ..."
              onClick={() => void exportCsv()}
            >
              <Download className="mr-1 h-3.5 w-3.5" /> CSV-Export
            </LoadingButton>
            <button
              type="button"
              className="btn-secondary min-h-9 px-3 py-1.5 text-xs"
              onClick={() => void load()}
              title="Aktualisieren"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        }
      />

      {summary ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            title="Ereignisse (24 h)"
            value={String(summary.totalEvents24h)}
            trend="alle Ereignistypen"
            tone="neutral"
            icon={ShieldCheck}
          />
          <KpiCard
            title="Fehl-Logins (24 h)"
            value={String(summary.failedLogins24h)}
            trend={`${summary.failedLogins7d} in 7 Tagen`}
            tone={summary.failedLogins24h > 0 ? 'warning' : 'positive'}
            icon={ShieldAlert}
          />
          <KpiCard
            title="Wartet auf Freigabe"
            value={String(summary.pendingUsers)}
            trend="offene Registrierungen"
            tone={summary.pendingUsers > 0 ? 'warning' : 'neutral'}
            icon={UserRoundCheck}
          />
          <KpiCard
            title="Gesperrte Konten"
            value={String(summary.lockedUsers)}
            trend="administrativ gesperrt"
            tone={summary.lockedUsers > 0 ? 'critical' : 'neutral'}
            icon={Lock}
          />
        </div>
      ) : null}

      <article className="surface-card animate-fade-up space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <select className="input-field text-sm" value={range} onChange={(e) => setRange(e.target.value)}>
            {TIME_RANGES.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
          <select className="input-field text-sm" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">Alle Ereignisse</option>
            {knownTypes.map((type) => (
              <option key={type} value={type}>
                {eventLabel(type)}
              </option>
            ))}
          </select>
          <input
            className="input-field text-sm"
            placeholder="Benutzer / E-Mail"
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
          />
          <input
            className="input-field text-sm"
            placeholder="IP-Adresse"
            value={ipFilter}
            onChange={(e) => setIpFilter(e.target.value)}
          />
          <select
            className="input-field text-sm"
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
          >
            <option value="">Jede Wichtigkeit</option>
            <option value="info">Info</option>
            <option value="warning">Warnung</option>
            <option value="critical">Kritisch</option>
          </select>
          <select
            className="input-field text-sm"
            value={successFilter}
            onChange={(e) => setSuccessFilter(e.target.value)}
          >
            <option value="">Erfolg & Fehler</option>
            <option value="true">Nur erfolgreich</option>
            <option value="false">Nur fehlgeschlagen</option>
          </select>
        </div>

        {loadError ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {loadError}
          </div>
        ) : null}

        {loading ? (
          <InlineLoadingState message="Sicherheitsereignisse werden geladen ..." />
        ) : events.length === 0 ? (
          <p className="px-1 py-6 text-center text-sm text-slate-500">
            Keine Ereignisse für die gewählten Filter.
          </p>
        ) : (
          <>
            {/* Desktop-Tabelle */}
            <div className="soft-scrollbar hidden overflow-x-auto md:block">
              <table className="w-full min-w-[46rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-3 font-semibold">Zeitpunkt</th>
                    <th className="py-2 pr-3 font-semibold">Ereignis</th>
                    <th className="py-2 pr-3 font-semibold">Benutzer / Eingabe</th>
                    <th className="py-2 pr-3 font-semibold">IP</th>
                    <th className="py-2 pr-3 font-semibold">Wichtigkeit</th>
                    <th className="py-2 pr-3 font-semibold">Ergebnis</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr
                      key={event.id}
                      className="cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40"
                      onClick={() => setDetail(event)}
                      title="Details anzeigen"
                    >
                      <td className="py-2 pr-3 whitespace-nowrap text-slate-600">{event.createdAt}</td>
                      <td className="py-2 pr-3 font-medium text-slate-800 dark:text-slate-200">
                        {eventLabel(event.eventType)}
                      </td>
                      <td className="py-2 pr-3 text-slate-600">
                        {event.enteredIdentifier || event.userId || '—'}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap text-slate-500">{event.ip || '—'}</td>
                      <td className="py-2 pr-3">
                        <StatusBadge value={SEVERITY_LABELS[event.severity] ?? event.severity} />
                      </td>
                      <td className="py-2 pr-3">
                        <StatusBadge value={event.success ? 'Erfolgreich' : 'Fehlgeschlagen'} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Kartenliste */}
            <div className="space-y-2 md:hidden">
              {events.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900"
                  onClick={() => setDetail(event)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                      {eventLabel(event.eventType)}
                    </span>
                    <StatusBadge value={event.success ? 'Erfolgreich' : 'Fehlgeschlagen'} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                    <span>{event.createdAt}</span>
                    <span>{event.enteredIdentifier || event.userId || '—'}</span>
                    {event.ip ? <span>IP {event.ip}</span> : null}
                    <StatusBadge value={SEVERITY_LABELS[event.severity] ?? event.severity} />
                  </div>
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between pt-1">
              <p className="text-xs text-slate-500">
                {events.length} von {total} Ereignissen
              </p>
              {events.length < total ? (
                <LoadingButton
                  type="button"
                  className="btn-secondary min-h-9 px-3 py-1.5 text-xs"
                  isLoading={loadingMore}
                  loadingText="Lädt ..."
                  onClick={() => void loadMore()}
                >
                  Mehr laden
                </LoadingButton>
              ) : null}
            </div>
          </>
        )}
      </article>

      {detail ? <EventDetailModal event={detail} onClose={() => setDetail(null)} /> : null}
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-2 py-1 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="break-all text-slate-800 dark:text-slate-200">{value}</span>
    </div>
  );
}

function EventDetailModal({ event, onClose }: { event: SecurityEventItem; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {eventLabel(event.eventType)}
            </h3>
            <p className="text-xs text-slate-500">{event.createdAt}</p>
          </div>
          <button
            type="button"
            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
            onClick={onClose}
            aria-label="Schließen"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mb-3 flex flex-wrap gap-2">
          <StatusBadge value={SEVERITY_LABELS[event.severity] ?? event.severity} />
          <StatusBadge value={event.success ? 'Erfolgreich' : 'Fehlgeschlagen'} />
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          <DetailRow label="Benutzer-ID" value={event.userId} />
          <DetailRow label="Eingabe" value={event.enteredIdentifier} />
          <DetailRow label="Ausgeführt von" value={event.actorId} />
          <DetailRow label="IP (gekürzt)" value={event.ip} />
          <DetailRow label="Browser" value={event.userAgent} />
          <DetailRow label="Anfrage" value={event.method && event.path ? `${event.method} ${event.path}` : event.path} />
          <DetailRow label="Grund" value={event.reasonCode} />
          <DetailRow label="Request-ID" value={event.requestId} />
          <DetailRow label="Details" value={event.meta} />
        </div>
      </div>
    </div>
  );
}
