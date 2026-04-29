import { CalendarDays, List, Plus } from 'lucide-react';
import { useState } from 'react';
import { StatusBadge } from '../components/StatusBadge';
import type { ReservationItem } from '../types';

type ReservationsPageProps = {
  reservations: ReservationItem[];
  onCreateReservation: () => void;
  onEditReservation: (id: string) => void;
  onCheckoutReservation: (id: string) => void;
  onCancelReservation: (id: string) => void;
};

export function ReservationsPage({
  reservations,
  onCreateReservation,
  onEditReservation,
  onCheckoutReservation,
  onCancelReservation,
}: ReservationsPageProps) {
  const [view, setView] = useState<'list' | 'calendar'>('list');

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-700">Reservierungen</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">Planung & Auslastung</h2>
          <p className="mt-1 text-sm text-slate-500">
            Verwalte Reservierungen und wandle sie in Check-outs um.
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <button
            className="w-full rounded-xl bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 sm:w-auto"
            onClick={onCreateReservation}
          >
            <span className="inline-flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Neue Reservierung
            </span>
          </button>
          <div className="inline-flex w-full rounded-xl border border-slate-200 bg-white p-1 sm:w-auto">
            <button
              onClick={() => setView('list')}
              className={`flex-1 rounded-lg px-3 py-1.5 text-sm sm:flex-none ${
                view === 'list' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <List className="h-4 w-4" />
                Liste
              </span>
            </button>
            <button
              onClick={() => setView('calendar')}
              className={`flex-1 rounded-lg px-3 py-1.5 text-sm sm:flex-none ${
                view === 'calendar' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-4 w-4" />
                Kalender
              </span>
            </button>
          </div>
        </div>
      </div>

      {view === 'list' ? (
        <article className="surface-card animate-fade-up">
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[820px] border-separate border-spacing-y-2 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">Reservierung</th>
                  <th className="px-3 py-2">Wer</th>
                  <th className="px-3 py-2">Zeitraum</th>
                  <th className="px-3 py-2">Assets</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {reservations.map((reservation) => (
                  <tr key={reservation.id} className="rounded-xl bg-slate-50 text-slate-700">
                    <td className="rounded-l-xl px-3 py-3">
                      <p className="font-medium text-slate-900">{reservation.id}</p>
                      <p className="text-xs text-slate-500">{reservation.location}</p>
                    </td>
                    <td className="px-3 py-3">
                      <p className="font-medium text-slate-900">{reservation.requestedBy}</p>
                      <p className="text-xs text-slate-500">{reservation.team}</p>
                    </td>
                    <td className="px-3 py-3">{reservation.period}</td>
                    <td className="px-3 py-3">
                      <p className="max-w-[240px] truncate">{reservation.assets.join(', ')}</p>
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge value={reservation.status} />
                    </td>
                    <td className="rounded-r-xl px-3 py-3 text-right">
                      <button
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        onClick={() => onEditReservation(reservation.id)}
                      >
                        Bearbeiten
                      </button>
                      <button
                        className="ml-2 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
                        onClick={() => onCheckoutReservation(reservation.id)}
                      >
                        Check-out
                      </button>
                      <button
                        className="ml-2 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100"
                        onClick={() => onCancelReservation(reservation.id)}
                      >
                        Stornieren
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 lg:hidden">
            {reservations.map((reservation) => (
              <article key={`mobile-${reservation.id}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">{reservation.id}</p>
                  <StatusBadge value={reservation.status} />
                </div>
                <p className="mt-1 text-sm text-slate-700">{reservation.team}</p>
                <p className="text-xs text-slate-500">{reservation.requestedBy} • {reservation.location}</p>
                <p className="mt-2 text-xs text-slate-600">{reservation.period}</p>
                <p className="mt-2 text-xs text-slate-600">{reservation.assets.join(', ')}</p>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <button
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
                    onClick={() => onEditReservation(reservation.id)}
                  >
                    Bearbeiten
                  </button>
                  <button
                    className="rounded-lg bg-brand-600 px-2.5 py-2 text-xs font-medium text-white hover:bg-brand-700"
                    onClick={() => onCheckoutReservation(reservation.id)}
                  >
                    Check-out
                  </button>
                  <button
                    className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs font-medium text-rose-700 hover:bg-rose-100"
                    onClick={() => onCancelReservation(reservation.id)}
                  >
                    Stornieren
                  </button>
                </div>
              </article>
            ))}
          </div>
        </article>
      ) : (
        <article className="surface-card animate-fade-up">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {['Mo', 'Di', 'Mi', 'Do', 'Fr'].map((day) => (
              <div key={day} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{day}</p>
                <div className="mt-3 space-y-2">
                  {reservations.slice(0, 2).map((reservation) => (
                    <div key={`${day}-${reservation.id}`} className="rounded-lg border border-brand-100 bg-brand-50 p-2">
                      <p className="text-xs font-semibold text-brand-800">{reservation.team}</p>
                      <p className="mt-0.5 text-[11px] text-brand-700">{reservation.assets[0]}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </article>
      )}
    </section>
  );
}
