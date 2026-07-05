import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

type EmptyStateProps = {
  icon?: LucideIcon;
  title: string;
  message?: string;
  // Optionaler Aktions-Slot (z. B. "Filter zurücksetzen", "Neues Gerät").
  action?: ReactNode;
  className?: string;
};

// Einheitlicher Leerzustand: ruhig, zentriert, ohne dramatische Grafik.
export function EmptyState({ icon: Icon, title, message, action, className = '' }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-surface-2 px-6 py-10 text-center ${className}`}>
      {Icon ? (
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface text-ink-faint">
          <Icon className="h-5 w-5" />
        </div>
      ) : null}
      <p className="text-sm font-semibold text-ink">{title}</p>
      {message ? <p className="max-w-sm text-sm text-ink-muted">{message}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
