import { CheckCircle2, Fingerprint } from 'lucide-react';
import { useEffect, useState } from 'react';

import { LoadingButton } from '../loading';
import { fetchCompanionSession } from '../../services/wmsApi';
import { passkeyErrorMessage, passkeysSupported, registerPasskey } from './passkeys';

/**
 * Passkey für das schnelle Entsperren der Companion App einrichten.
 *
 * Welche Bestätigung erscheint (Face ID, Fingerabdruck, Geräte-PIN …),
 * bestimmt das Betriebssystem — die Oberfläche verspricht daher nichts
 * Bestimmtes.
 */
export function PasskeySetupCard() {
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const supported = passkeysSupported();

  useEffect(() => {
    let cancelled = false;
    fetchCompanionSession()
      .then((session) => !cancelled && setRegistered(session.passkeyRegistered))
      .catch(() => !cancelled && setRegistered(false));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!supported) {
    return (
      <p className="text-sm text-ink-muted">
        Dieser Browser unterstützt keine Passkeys. Die App bleibt trotzdem nutzbar und lässt sich am PC
        jederzeit abmelden. Für die Entsperrung per Gesicht, Fingerabdruck oder Geräte-PIN bitte einen
        aktuellen Browser (iOS Safari, Android Chrome) verwenden.
      </p>
    );
  }

  if (registered) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-muted">
        <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Schnelle Entsperrung ist eingerichtet.
      </p>
    );
  }

  const setup = async () => {
    setBusy(true);
    setError('');
    try {
      const session = await registerPasskey();
      setRegistered(session.passkeyRegistered);
    } catch (err) {
      setError(passkeyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">
        Nach einer Pause wird die App gesperrt. Mit einem Passkey entsperrst du sie mit der
        Bestätigung deines Geräts — je nach Gerät z. B. per Gesicht, Fingerabdruck oder Geräte-PIN.
        Dein Passwort wird dafür nicht gebraucht.
      </p>
      {error ? <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" role="alert">{error}</p> : null}
      <LoadingButton type="button" className="btn-secondary min-h-[44px] w-full" isLoading={busy} onClick={() => void setup()}>
        <span className="inline-flex items-center justify-center gap-2"><Fingerprint className="h-4 w-4" /> Passkey einrichten</span>
      </LoadingButton>
    </div>
  );
}
