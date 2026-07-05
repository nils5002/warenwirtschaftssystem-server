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

// MetricCard-Look nach Mockup: Icon in weich getöntem Quadrat, Uppercase-
// Label, große Zahl, Sub-Text. Töne funktionieren in Light und Dark über
// soft-Transparenzen statt voller Pastellflächen.
const toneMap: Record<KpiCardProps['tone'], { box: string; label: string }> = {
  neutral: {
    box: 'bg-sky-500/10 text-sky-600 dark:text-sky-300',
    label: 'text-ink-muted',
  },
  positive: {
    box: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
    label: 'text-ink-muted',
  },
  warning: {
    box: 'bg-amber-500/10 text-amber-600 dark:text-amber-300',
    label: 'text-amber-600 dark:text-amber-300',
  },
  critical: {
    box: 'bg-rose-500/10 text-rose-600 dark:text-rose-300',
    label: 'text-rose-600 dark:text-rose-300',
  },
};

export function KpiCard({ title, value, trend, tone, icon: Icon, onClick, disabled = false }: KpiCardProps) {
  const tones = toneMap[tone];
  const inner = (
    <div className="flex items-start gap-3.5">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tones.box}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className={`truncate text-[11px] font-bold uppercase tracking-[0.12em] ${tones.label}`}>{title}</p>
        <p className="mt-1 text-3xl font-semibold tracking-tight text-ink">{value}</p>
        <p className="mt-1 truncate text-xs font-medium text-ink-faint">{trend}</p>
      </div>
    </div>
  );

  // Klickbar: echtes Button-Element (Tastatur/Enter/Space gratis), Hover-Lift
  // und sichtbarer Fokusring. Layout bleibt durch text-left/w-full identisch.
  if (onClick && !disabled) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="surface-card group w-full cursor-pointer p-4 text-left transition duration-200 hover:-translate-y-0.5 hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:p-4"
      >
        {inner}
      </button>
    );
  }

  // Schnellzugriff vorgesehen, aber keine Berechtigung: sichtbar, leicht
  // gedimmt, kein Pointer, kein Hover-Lift, Tooltip statt Fehlermeldung.
  if (onClick && disabled) {
    return (
      <div aria-disabled="true" title="Keine Berechtigung" className="surface-card cursor-not-allowed p-4 opacity-60 md:p-4">
        {inner}
      </div>
    );
  }

  return <article className="surface-card p-4 md:p-4">{inner}</article>;
}
