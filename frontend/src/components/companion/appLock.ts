// Sperren der Companion App beim Öffnen und nach längerer Zeit im Hintergrund.
//
// Das eigentliche Sperren passiert serverseitig (POST /api/companion/session/lock):
// Danach lehnt das Backend jede Anfrage dieses Geräts ab, bis eine Passkey-
// Bestätigung vorliegt. Der Client kann nur sperren, nie entsperren.

import { useEffect } from 'react';

import { detectInstallPlatform, isRunningStandalone } from '../../pwa/installHints';
import { lockCompanionSession } from '../../services/wmsApi';

/** Nach so langer Zeit im Hintergrund wird beim Zurückkehren gesperrt. */
export const BACKGROUND_LOCK_MS = 60_000;

/** Nur Smartphones/Tablets bzw. die installierte App kommen als Gerät in Frage. */
export function isCompanionCapableDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (isRunningStandalone()) return true;
  const platform = detectInstallPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0);
  return platform === 'ios' || platform === 'android';
}

/** Muss nach `hiddenAt` gesperrt werden? (reine Logik, testbar) */
export function shouldLockAfterBackground(hiddenAt: number | null, now: number): boolean {
  return hiddenAt !== null && now - hiddenAt >= BACKGROUND_LOCK_MS;
}

let startupLock: Promise<boolean> | null = null;

// Direkt nach Kopplung + Passkey-Einrichtung nicht sofort wieder sperren.
const SKIP_NEXT_START_LOCK_KEY = 'wms.companion.skipStartLock';

export function skipNextStartLock(): void {
  try {
    sessionStorage.setItem(SKIP_NEXT_START_LOCK_KEY, '1');
  } catch {
    // Storage blockiert — dann wird eben einmal mehr entsperrt.
  }
}

function consumeSkipStartLock(): boolean {
  try {
    const skip = sessionStorage.getItem(SKIP_NEXT_START_LOCK_KEY) === '1';
    sessionStorage.removeItem(SKIP_NEXT_START_LOCK_KEY);
    return skip;
  } catch {
    return false;
  }
}

/**
 * Sperrt beim Öffnen der App genau einmal pro Seitenaufruf (auch wenn React
 * den Effekt im StrictMode doppelt ausführt). Liefert true, wenn jetzt ein
 * Sperrbildschirm nötig ist.
 */
export function lockOnAppStart(): Promise<boolean> {
  if (!startupLock) {
    startupLock = isCompanionCapableDevice() && !consumeSkipStartLock()
      ? lockCompanionSession().then((result) => Boolean(result?.locked))
      : Promise.resolve(false);
  }
  return startupLock;
}

/** Sperrt, wenn die App länger als BACKGROUND_LOCK_MS im Hintergrund war. */
export function useBackgroundLock(active: boolean, onLocked: () => void): void {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return;
    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      if (shouldLockAfterBackground(hiddenAt, Date.now())) {
        hiddenAt = null;
        void lockCompanionSession().then((result) => {
          if (result?.locked) onLocked();
        });
      } else {
        hiddenAt = null;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [active, onLocked]);
}
