import type { LucideIcon } from 'lucide-react';

type SegmentedControlOption<T extends string> = {
  value: T;
  label: string;
  icon?: LucideIcon;
};

type SegmentedControlProps<T extends string> = {
  options: SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  // 'lg' für Touch-Flows (Ein-/Auslagerung): höhere Segmente, größere Schrift.
  size?: 'md' | 'lg';
  className?: string;
};

// Segment-Umschalter nach Mockup (z. B. "Ausgabe | Rücknahme"): aktives
// Segment als gefüllte Primary-Fläche, Rest ruhig auf Surface-2.
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  className = '',
}: SegmentedControlProps<T>) {
  const height = size === 'lg' ? 'min-h-[48px] text-base' : 'min-h-[38px] text-sm';
  return (
    <div className={`grid gap-1 rounded-xl border border-line bg-surface-2 p-1 ${className}`} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }} role="tablist">
      {options.map((option) => {
        const active = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 font-semibold transition ${height} ${
              active ? 'bg-primary text-white shadow-sm' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {Icon ? <Icon className={size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'} /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
