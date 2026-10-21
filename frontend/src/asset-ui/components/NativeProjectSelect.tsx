import { useState } from 'react';

const MANUAL = '__manual__';

type NativeProjectSelectProps = {
  value: string;
  options: string[];
  placeholder: string;
  onSelect: (value: string) => void;
  disabled?: boolean;
  /** Leere Auswahl erlauben (z. B. optionales Projekt bei der Rücknahme). */
  allowEmpty?: boolean;
  label: string;
};

/**
 * Projektauswahl mit dem nativen Auswahlelement des Geräts.
 *
 * Ein echtes <select> öffnet auf dem iPhone das gewohnte Auswahlrad und auf
 * Android den System-Auswahldialog — bedienbar wie jede andere App. Projekte,
 * die (noch) nicht in der Liste stehen, lassen sich über „Anderes Projekt
 * eingeben …" weiterhin frei erfassen.
 */
export function NativeProjectSelect({
  value,
  options,
  placeholder,
  onSelect,
  disabled,
  allowEmpty = false,
  label,
}: NativeProjectSelectProps) {
  const [manual, setManual] = useState(false);
  const [manualText, setManualText] = useState('');
  const current = value.trim();
  // Ein gesetzter Wert, der nicht in der Liste steht (z. B. aus einem
  // QR-Code übernommen), muss trotzdem korrekt angezeigt werden.
  const allOptions = current && !options.includes(current) ? [current, ...options] : options;

  if (manual) {
    const apply = () => {
      const text = manualText.trim();
      if (!text) return;
      onSelect(text);
      setManual(false);
      setManualText('');
    };
    return (
      <div className="flex flex-col gap-2">
        <input
          className="field-input h-12"
          aria-label={`${label} (freie Eingabe)`}
          placeholder="Projektname eingeben"
          value={manualText}
          onChange={(event) => setManualText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              apply();
            }
          }}
          autoFocus
          enterKeyHint="done"
        />
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn-secondary min-h-[44px]" onClick={() => setManual(false)}>
            Abbrechen
          </button>
          <button type="button" className="btn-primary min-h-[44px]" onClick={apply} disabled={!manualText.trim()}>
            Übernehmen
          </button>
        </div>
      </div>
    );
  }

  return (
    <select
      className="field-input h-12 w-full text-sm"
      aria-label={label}
      value={current}
      disabled={disabled}
      onChange={(event) => {
        const next = event.target.value;
        if (next === MANUAL) {
          setManual(true);
          return;
        }
        onSelect(next);
      }}
    >
      <option value="" disabled={!allowEmpty}>
        {placeholder}
      </option>
      {allOptions.map((project) => (
        <option key={project} value={project}>
          {project}
        </option>
      ))}
      <option value={MANUAL}>Anderes Projekt eingeben …</option>
    </select>
  );
}
