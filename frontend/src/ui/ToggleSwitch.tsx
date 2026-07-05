type ToggleSwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
};

// Schalter im Mockup-Stil (Filterleiste "Nur verfügbare" etc.). Echte
// Button-Semantik mit role="switch"; Touch-Ziel über das Label hinaus.
export function ToggleSwitch({ checked, onChange, label, disabled = false }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`inline-flex min-h-[36px] items-center gap-2 rounded-full py-1 pr-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'text-ink' : 'text-ink-muted'
      }`}
    >
      <span
        aria-hidden
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-primary' : 'bg-line'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-[18px]' : 'translate-x-0.5'
          }`}
        />
      </span>
      {label ? <span>{label}</span> : null}
    </button>
  );
}
