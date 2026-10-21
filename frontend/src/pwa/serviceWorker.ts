// Registrierung des Companion-Service-Workers.
//
// Hintergrund: Früher hat diese App bewusst JEDEN Service Worker entfernt, weil
// ein fremder/alter Worker eine veraltete index.html ausliefern könnte. Diese
// Schutzwirkung bleibt erhalten:
//  - Registrierungen, die nicht unser eigenes /sw.js sind, werden entfernt.
//  - Caches, die nicht zu unserem Worker gehören, werden gelöscht.
//  - Unser Worker cacht selbst nur die Offline-Seite (siehe public/sw.js) —
//    die App-Hülle kommt immer frisch vom Server.

export const COMPANION_SW_URL = '/sw.js';
export const COMPANION_CACHE_PREFIX = 'wms-companion-';

/** Ist diese Registrierung unser eigener Worker? */
export function isCompanionWorker(scriptUrl: string | undefined | null, origin: string): boolean {
  if (!scriptUrl) return false;
  try {
    const url = new URL(scriptUrl, origin);
    return url.origin === origin && url.pathname === COMPANION_SW_URL;
  } catch {
    return false;
  }
}

/** Fremde Caches (nicht von unserem Worker) dürfen weg. */
export function isForeignCache(name: string): boolean {
  return !name.startsWith(COMPANION_CACHE_PREFIX);
}

export function registerCompanionServiceWorker(): void {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
  const origin = window.location.origin;

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => {
        registrations.forEach((registration) => {
          const worker = registration.active ?? registration.waiting ?? registration.installing;
          if (!isCompanionWorker(worker?.scriptURL, origin)) {
            void registration.unregister();
          }
        });
      })
      .catch(() => {
        /* ignore */
      });

    // Nur im Produktions-Build registrieren: Im Vite-Dev-Server würde der
    // Worker Hot-Reload und Entwicklungsabläufe stören.
    if (import.meta.env.PROD) {
      navigator.serviceWorker.register(COMPANION_SW_URL, { scope: '/' }).catch(() => {
        /* Kein Worker (z. B. HTTP ohne localhost) — App funktioniert trotzdem. */
      });
    }
  }

  if ('caches' in window) {
    caches
      .keys()
      .then((keys) => keys.filter(isForeignCache).forEach((key) => void caches.delete(key)))
      .catch(() => {
        /* ignore */
      });
  }
}
