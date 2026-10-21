import { Fingerprint, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { fetchCompanionSession } from '../../services/wmsApi';
import { passkeysSupported } from './passkeys';

const DISMISS_KEY = 'wms.companion.passkeyReminderDismissed';

/**
 * Hinweis auf gekoppelten Geräten ohne Passkey: Ohne Passkey kann die App
 * beim Öffnen nicht per Face ID / Fingerabdruck gesperrt werden — das soll
 * nicht still passieren, sondern sichtbar und mit einem Weg zur Einrichtung.
 */
export function PasskeyReminder({ onOpenAccount }: { onOpenAccount: () => void }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = sessionStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      dismissed = false;
    }
    if (dismissed || !passkeysSupported()) return;
    let cancelled = false;
    fetchCompanionSession()
      .then((session) => {
        if (!cancelled) setShow(!session.passkeyRegistered);
      })
      .catch(() => {
        /* kein Hinweis, wenn die Abfrage scheitert */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!show) return null;

  const dismiss = () => {
    setShow(false);
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // ignorieren
    }
  };

  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200" role="status">
      <Fingerprint className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Face ID / Fingerabdruck noch nicht eingerichtet</p>
        <p className="mt-0.5">Ohne Passkey wird die App beim Öffnen nicht gesperrt.</p>
        <button type="button" className="mt-2 min-h-[44px] font-semibold underline-offset-2 hover:underline" onClick={onOpenAccount}>
          Jetzt einrichten
        </button>
      </div>
      <button type="button" className="-m-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg" onClick={dismiss} aria-label="Hinweis ausblenden">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
