import { Fingerprint, Lock } from 'lucide-react';
import { useState } from 'react';

import { LoadingButton } from '../loading';
import { logoutCompanionDevice, type AuthUser } from '../../services/wmsApi';
import { COMPANION_PAIR_PATH } from './companionPairing';
import { passkeyErrorMessage, passkeysSupported, unlockWithPasskey } from './passkeys';

/**
 * Sperrbildschirm der Companion App.
 *
 * Er ist kein reines Overlay: Solange das Gerät gesperrt ist, lehnt das
 * Backend jede Anfrage dieses Geräts ab. Erst eine serverseitig geprüfte
 * Passkey-Bestätigung gibt die Sitzung wieder frei.
 */
export function CompanionLockScreen({ onUnlocked }: { onUnlocked: (user: AuthUser) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const supported = passkeysSupported();

  const unlock = async () => {
    setBusy(true);
    setError('');
    try {
      const session = await unlockWithPasskey();
      onUnlocked(session.user);
    } catch (err) {
      setError(passkeyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const reconnect = async () => {
    await logoutCompanionDevice();
    window.location.replace(COMPANION_PAIR_PATH);
  };

  const passwordLogin = async () => {
    await logoutCompanionDevice();
    window.location.replace('/login');
  };

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-canvas px-4 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-ink">
      <section className="w-full max-w-sm space-y-5 text-center" aria-labelledby="lock-title">
        <span className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
          <Lock className="h-6 w-6" />
        </span>
        <div>
          <h1 id="lock-title" className="text-lg font-semibold">Companion entsperren</h1>
          <p className="mt-1 text-sm text-ink-muted">Bestätige mit deinem Gerät, dass du es bist.</p>
        </div>
        {error ? <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-left text-sm text-amber-800" role="alert">{error}</p> : null}
        {supported ? (
          <LoadingButton type="button" className="btn-primary min-h-[52px] w-full" isLoading={busy} onClick={() => void unlock()} autoFocus>
            <span className="inline-flex items-center justify-center gap-2"><Fingerprint className="h-5 w-5" /> Entsperren</span>
          </LoadingButton>
        ) : (
          <p className="text-sm text-ink-muted">Dieser Browser unterstützt keine Passkeys. Bitte das Gerät neu verbinden oder normal anmelden.</p>
        )}
        <div className="space-y-2 border-t border-line pt-4 text-sm">
          <p className="text-ink-muted">Passkey verloren oder funktioniert nicht?</p>
          <button type="button" className="min-h-[44px] w-full font-medium text-primary hover:underline" onClick={() => void reconnect()}>
            Gerät neu mit dem PC verbinden
          </button>
          <button type="button" className="min-h-[44px] w-full font-medium text-primary hover:underline" onClick={() => void passwordLogin()}>
            Mit E-Mail und Passwort anmelden
          </button>
        </div>
      </section>
    </main>
  );
}
