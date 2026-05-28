import type { LucideIcon } from 'lucide-react';

type KpiCardProps = {
  title: string;
  value: string;
  trend: string;
  tone: 'neutral' | 'positive' | 'warning' | 'critical';
  icon: LucideIcon;
  // Optionaler Schnellzugriff: ist onClick gesetzt, wird die Karte zu einem
  // echten Button (Hover/Focus/Enter/Space). disabled hält die Karte sichtbar,
  // aber nicht klickbar (fehlende Berechtigung) — ohne Fehlermeldung.
  onClick?: () => void;
  disabled?: boolean;
};

// Icon-Tone: im Light Mode klar lesbar (Tone-700 auf Tone-50/100 Hintergrund),
// im Dark Mode wieder leichte Tone-Tönung mit hellem Icon. Vorher waren die
// Icons im Light Mode mit text-{tone}-100 nahezu unsichtbar auf weißem
// Surface-Card.
const toneMap: Record<KpiCardProps['tone'], string> = {
  neutral:
    'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-700/40 dark:bg-sky-500/10 dark:text-sky-200',
  positive:
    'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-700/40 dark:bg-emerald-500/10 dark:text-emerald-200',
  warning:
    'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-700/40 dark:bg-amber-500/10 dark:text-amber-200',
  critical:
    'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-700/40 dark:bg-rose-500/10 dark:text-rose-200',
};

export function KpiCard({ title, value, trend, tone, icon: Icon, onClick, disabled = false }: KpiCardProps) {
  const inner = (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">{title}</p>
        <div className={`rounded-xl border p-2.5 ${toneMap[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className="mt-4 text-4xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">{value}</p>
      <p className="mt-2 text-sm font-medium text-slate-500 dark:text-slate-400">{trend}</p>
    </>
  );

  // Klickbar: echtes Button-Element (Tastatur/Enter/Space gratis), Hover-Lift
  // und sichtbarer Fokusring. Layout bleibt durch text-left/w-full identisch.
  if (onClick && !disabled) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="surface-card group animate-fade-up w-full cursor-pointer p-5 text-left transition duration-200 hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 dark:focus-visible:ring-sky-500"
      >
        {inner}
      </button>
    );
  }

  // Schnellzugriff vorgesehen, aber keine Berechtigung: sichtbar, leicht
  // gedimmt, kein Pointer, kein Hover-Lift, Tooltip statt Fehlermeldung.
  if (onClick && disabled) {
    return (
      <div
        aria-disabled="true"
        title="Keine Berechtigung"
        className="surface-card group animate-fade-up cursor-not-allowed p-5 opacity-60 transition duration-200"
      >
        {inner}
      </div>
    );
  }

  return (
    <article className="surface-card group animate-fade-up p-5 transition duration-200 hover:-translate-y-0.5 hover:shadow-lg">
      {inner}
    </article>
  );
}
