import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';
import { AppDialogProvider } from './components/dialogs/AppDialogProvider';
import './index.css';

// Defensive cleanup: this app intentionally does NOT use a Service Worker.
// If one was ever registered on this origin (e.g. by a previous app version
// or another deployment that ran here), it could keep serving a stale
// index.html / JS bundle from its own cache and prevent users from ever
// seeing new builds. Unregister anything still present, then drop any
// lingering CacheStorage entries. Safe no-op when nothing is there.
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((regs) => regs.forEach((r) => r.unregister()))
    .catch(() => {
      /* ignore */
    });
}
if (typeof window !== 'undefined' && 'caches' in window) {
  caches
    .keys()
    .then((keys) => keys.forEach((k) => caches.delete(k)))
    .catch(() => {
      /* ignore */
    });
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppDialogProvider>
      <App />
    </AppDialogProvider>
  </React.StrictMode>,
);
