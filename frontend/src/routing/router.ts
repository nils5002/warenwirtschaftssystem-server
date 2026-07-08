import { useSyncExternalStore } from 'react';

// Zentraler Location-Store der App. Alle Navigationen laufen über navigate()
// (pushState/replaceState + Subscriber-Benachrichtigung); Browser-Zurück/Vor
// kommt über den popstate-Listener herein. Komponenten lesen die aktuelle
// Location reaktiv über useAppLocation() — damit erreichen auch reine
// Query-Änderungen (gleicher Pfad, anderer Filter) jede abonnierte Komponente.

export type AppLocation = {
  pathname: string;
  search: string;
  hash: string;
};

export type NavigateOptions = {
  replace?: boolean;
  // Wird als history.state hinterlegt, z. B. der Marker { fromApp: true },
  // an dem ein Detail erkennt, dass es aus der App heraus geöffnet wurde
  // (Zurück-Weg = history.back() statt Ersatz-Navigation zur Liste).
  state?: unknown;
};

const listeners = new Set<() => void>();

function readWindowLocation(): AppLocation {
  if (typeof window === 'undefined') {
    return { pathname: '/', search: '', hash: '' };
  }
  return {
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
  };
}

// useSyncExternalStore verlangt referenzstabile Snapshots: nur ersetzen,
// wenn sich tatsächlich etwas geändert hat, sonst würde jeder getSnapshot-
// Aufruf ein neues Objekt liefern und eine Render-Schleife auslösen.
let snapshot: AppLocation = readWindowLocation();

function refreshSnapshot(): void {
  const next = readWindowLocation();
  if (
    next.pathname === snapshot.pathname &&
    next.search === snapshot.search &&
    next.hash === snapshot.hash
  ) {
    return;
  }
  snapshot = next;
  for (const listener of listeners) {
    listener();
  }
}

function handlePopState(): void {
  refreshSnapshot();
}

export function getAppLocation(): AppLocation {
  return snapshot;
}

export function subscribeToLocation(listener: () => void): () => void {
  if (listeners.size === 0 && typeof window !== 'undefined') {
    window.addEventListener('popstate', handlePopState);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('popstate', handlePopState);
    }
  };
}

export function useAppLocation(): AppLocation {
  return useSyncExternalStore(subscribeToLocation, getAppLocation, getAppLocation);
}

export function navigate(to: string, options?: NavigateOptions): void {
  if (typeof window === 'undefined') return;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const state = options?.state ?? null;
  // Identisches Ziel nie pushen — sonst entstehen tote History-Einträge,
  // die der Nutzer per Zurück-Taste scheinbar wirkungslos abtragen muss.
  if (options?.replace || to === current) {
    window.history.replaceState(state, '', to);
  } else {
    window.history.pushState(state, '', to);
  }
  refreshSnapshot();
}

// Query-String aus einem Param-Objekt bauen. null/undefined/'' bedeutet
// "Param weglassen" — so bleiben Default-Zustände ohne Query-Ballast
// (/inventar statt /inventar?status=Alle+Status).
export function buildSearch(params: Record<string, string | null | undefined>): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    searchParams.set(key, value);
  }
  const query = searchParams.toString();
  return query ? `?${query}` : '';
}
