/*
 * Service Worker der Warehouse Companion App (PWA).
 *
 * Bewusst minimal — Sicherheit und Aktualität vor Offline-Komfort:
 *  - Es wird KEINE App-Hülle (index.html, JS-Bundles) zwischengespeichert:
 *    Nach jedem Deploy lädt die App garantiert die neue Version (keine
 *    "eingefrorenen" Altstände, vgl. main.tsx).
 *  - Es werden KEINE API-Antworten, Tokens oder Geschäftsdaten gecacht:
 *    /api und /media laufen unverändert direkt zum Server.
 *  - Einzige Aufgabe: Fällt bei einem Seitenaufruf das Netz aus, erscheint
 *    eine ehrliche Offline-Seite statt einer Browser-Fehlerseite.
 *
 * Versionierung: Bei jeder Änderung an dieser Datei CACHE_VERSION erhöhen.
 * Alte Caches dieser App werden beim Aktivieren entfernt.
 */
const CACHE_PREFIX = 'wms-companion-';
const CACHE_VERSION = `${CACHE_PREFIX}v1`;
const OFFLINE_ASSETS = ['/offline.html', '/pwa-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(OFFLINE_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_VERSION)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  // Nur Seitenaufrufe (Navigation) behandeln; alles andere unangetastet.
  if (request.mode !== 'navigate' || request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) return;
  event.respondWith(
    fetch(request).catch(() =>
      caches.match('/offline.html').then((cached) => cached || Response.error()),
    ),
  );
});
