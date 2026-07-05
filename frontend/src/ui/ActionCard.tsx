import { ChevronRight, type LucideIcon } from 'lucide-react';

type ActionCardProps = {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  onClick: () => void;
  // Farbton des Icon-Quadrats. 'primary' = Hauptaktion (Neues Gerät),
  // 'warning' = Defekt melden, sonst neutral.
  tone?: 'primary' | 'neutral' | 'warning' | 'success';
  disabled?: boolean;
};

const toneBox: Record<NonNullable<ActionCardProps['tone']>, string> = {
  primary: 'bg-primary text-white',
  neutral: 'bg-sky-500/12 text-sky-600 dark:text-sky-300',
  warning: 'bg-amber-500/15 text-amber-600 dark:text-amber-300',
  success: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-300',
};

// Schnellaktions-Kachel nach Mockup: Icon-Quadrat links, Titel + Unterzeile,
// Chevron rechts. Ganze Fläche klickbar, Touch-freundlich (min-h).
export function ActionCard({ icon: Icon, title, subtitle, onClick, tone = 'neutral', disabled = false }: ActionCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? 'Keine Berechtigung' : undefined}
      className="group flex min-h-[60px] w-full items-center gap-3 rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-left transition hover:border-line-strong hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${toneBox[tone]}`}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">{title}</span>
        {subtitle ? <span className="block truncate text-xs text-ink-muted">{subtitle}</span> : null}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint transition group-hover:translate-x-0.5 group-hover:text-ink-muted" />
    </button>
  );
}
