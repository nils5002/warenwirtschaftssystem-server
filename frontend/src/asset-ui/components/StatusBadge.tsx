import type {
  AssetStatus,
  MaintenancePriority,
  MaintenanceStatus,
  ReservationStatus,
} from '../types';

type BadgeValue = AssetStatus | ReservationStatus | MaintenancePriority | MaintenanceStatus | string;

const colorMap: Record<string, string> = {
  Verfügbar: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
  Verliehen: 'bg-sky-100 text-sky-700 ring-sky-200',
  'In Wartung': 'bg-orange-100 text-orange-700 ring-orange-200',
  Defekt: 'bg-rose-100 text-rose-700 ring-rose-200',
  Angefragt: 'bg-slate-100 text-slate-700 ring-slate-200',
  Bestätigt: 'bg-cyan-100 text-cyan-700 ring-cyan-200',
  Aktiv: 'bg-indigo-100 text-indigo-700 ring-indigo-200',
  Abgeschlossen: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
  Storniert: 'bg-zinc-200 text-zinc-700 ring-zinc-300',
  Inaktiv: 'bg-zinc-200 text-zinc-700 ring-zinc-300',
  Niedrig: 'bg-lime-100 text-lime-700 ring-lime-200',
  Mittel: 'bg-amber-100 text-amber-700 ring-amber-200',
  Hoch: 'bg-orange-100 text-orange-700 ring-orange-200',
  Kritisch: 'bg-rose-100 text-rose-700 ring-rose-200',
  Offen: 'bg-rose-100 text-rose-700 ring-rose-200',
  'In Bearbeitung': 'bg-blue-100 text-blue-700 ring-blue-200',
  Erledigt: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
};

export function StatusBadge({ value }: { value: BadgeValue }) {
  const style = colorMap[value] ?? 'bg-zinc-100 text-zinc-700 ring-zinc-200';
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${style}`}>
      {value}
    </span>
  );
}

