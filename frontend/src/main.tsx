import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';
import { AppDialogProvider } from './components/dialogs/AppDialogProvider';
import { captureInstallPrompt } from './pwa/installHints';
import { registerCompanionServiceWorker } from './pwa/serviceWorker';
import './index.css';

// Warehouse Companion (PWA): genau EIN eigener Service Worker (/sw.js), der
// keine App-Hülle und keine API-Daten cacht. Fremde/alte Registrierungen und
// Caches werden weiterhin entfernt, damit nie ein veralteter Stand ausgeliefert
// wird — siehe pwa/serviceWorker.ts.
registerCompanionServiceWorker();
captureInstallPrompt();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppDialogProvider>
      <App />
    </AppDialogProvider>
  </React.StrictMode>,
);
