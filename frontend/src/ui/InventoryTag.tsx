// Signatur-Detail der App: die Inventarnummer erscheint überall als kleines
// Etikett in Mono-Schrift, wie vom Labeldrucker. Nur für Inventarnummern
// verwenden, nicht für andere Kennungen.
type InventoryTagProps = {
  value?: string | null;
  className?: string;
};

export function InventoryTag({ value, className = '' }: InventoryTagProps) {
  if (!value) return null;
  return (
    <span
      className={`inline-flex max-w-full items-center truncate rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-xs leading-4 text-ink-muted tabular-nums ${className}`}
      title={`Inventarnummer ${value}`}
    >
      {value}
    </span>
  );
}
