import { Signal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { LoadingButton } from '../../components/loading';
import { getTelecomPassSettings, updateTelecomPassSettings } from '../../services/wmsApi';
import { PageHeader } from '../../ui';

type Feedback = { kind: 'success' | 'error'; text: string } | null;

function formatPrice(value: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);
}

export function TelecomPassSettingsPage() {
  const [priceInput, setPriceInput] = useState('');
  const [savedPrice, setSavedPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const settings = await getTelecomPassSettings();
        setSavedPrice(settings.unitPrice);
        setPriceInput(settings.unitPrice ? String(settings.unitPrice).replace('.', ',') : '');
      } catch {
        setFeedback({ kind: 'error', text: 'Telekompass-Einstellung konnte nicht geladen werden.' });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const save = async () => {
    const normalized = priceInput.trim().replace(',', '.');
    const parsed = normalized === '' ? 0 : Number(normalized);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setFeedback({ kind: 'error', text: 'Bitte einen gültigen Preis (≥ 0) eingeben.' });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const result = await updateTelecomPassSettings(parsed);
      setSavedPrice(result.unitPrice);
      setPriceInput(result.unitPrice ? String(result.unitPrice).replace('.', ',') : '');
      setFeedback({ kind: 'success', text: 'Preis gespeichert.' });
    } catch {
      setFeedback({ kind: 'error', text: 'Preis konnte nicht gespeichert werden.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-5">
      <PageHeader
        kicker="Stammdaten und Integrationen"
        title="Telekompass"
        subtitle="Globaler Preis pro Telekompass-Buchung. Wird bei der Rückgabe von LTE-Routern zur Kostenanzeige verwendet."
      />

      <article className="surface-card max-w-xl space-y-4 animate-fade-up">
        <div className="inline-flex items-center gap-2 text-base font-semibold text-slate-900">
          <Signal className="h-4 w-4 text-brand-700" />
          Preis pro Telekompass-Buchung
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">Wird geladen ...</p>
        ) : (
          <>
            {savedPrice !== null ? (
              <p className="text-sm text-slate-600">
                Aktuell gespeichert:{' '}
                <span className="font-semibold text-slate-900">{formatPrice(savedPrice)}</span>
              </p>
            ) : null}

            <label className="field max-w-xs">
              Preis (€)
              <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                className="field-input h-12 text-base"
                placeholder="z. B. 4,90"
                value={priceInput}
                onChange={(event) => setPriceInput(event.target.value)}
              />
              <span className="text-xs text-slate-500">
                Leeres Feld wird als 0,00 € gespeichert.
              </span>
            </label>

            {feedback ? (
              <p
                className={`rounded-xl border px-3 py-2 text-sm ${
                  feedback.kind === 'success'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-rose-200 bg-rose-50 text-rose-800'
                }`}
              >
                {feedback.text}
              </p>
            ) : null}

            <div>
              <LoadingButton className="btn-primary h-11" onClick={() => void save()} isLoading={saving}>
                Speichern
              </LoadingButton>
            </div>
          </>
        )}
      </article>
    </section>
  );
}
