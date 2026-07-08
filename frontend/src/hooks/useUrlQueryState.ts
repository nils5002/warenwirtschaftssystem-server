import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppLocation, navigate } from '../routing/router';

// Drop-in-Ersatz für useState bei Filter-/Such-Zuständen, die in der URL
// leben sollen: liest den Wert aus dem Query-Parameter und schreibt
// Änderungen zurück in die URL. Browser-Zurück/Vor und Deep-Links stellen
// die Filter dadurch automatisch wieder her.
//
// Verhalten:
// - Default replace (keine History-Flut durch Filterklicks); history: 'push'
//   nur setzen, wenn ein Wechsel bewusst einen eigenen History-Eintrag
//   verdient.
// - debounceMs > 0 für Texteingaben: Das lokale Echo aktualisiert das Input
//   sofort, die URL folgt gebündelt.
// - value === defaultValue ⇒ Parameter wird aus der URL entfernt
//   (/inventar statt /inventar?status=Alle+Status).
// - Externe URL-Änderungen (popstate, navigate von außen) gewinnen und
//   überschreiben das lokale Echo.

type UseUrlQueryStateOptions = {
  history?: 'push' | 'replace';
  debounceMs?: number;
};

function readParam(search: string, key: string, defaultValue: string): string {
  const params = new URLSearchParams(search);
  const value = params.get(key);
  return value === null ? defaultValue : value;
}

function writeParam(search: string, key: string, value: string, defaultValue: string): string {
  const params = new URLSearchParams(search);
  if (value === defaultValue || value === '') {
    params.delete(key);
  } else {
    params.set(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function useUrlQueryState(
  key: string,
  defaultValue: string,
  options?: UseUrlQueryStateOptions,
): [string, (next: string) => void] {
  const historyMode = options?.history ?? 'replace';
  const debounceMs = options?.debounceMs ?? 0;

  const location = useAppLocation();
  const urlValue = readParam(location.search, key, defaultValue);

  // Lokales Echo für debounced Eingaben: Das Input zeigt sofort den
  // getippten Wert, während die URL erst nach der Debounce-Frist folgt.
  const [pendingValue, setPendingValue] = useState<string | null>(null);
  const debounceTimerRef = useRef<number | null>(null);

  // Sobald die URL den Zielwert trägt (oder von außen geändert wurde),
  // hat sie wieder die Hoheit — das Echo wird verworfen.
  useEffect(() => {
    setPendingValue(null);
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, [urlValue]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const setValue = useCallback(
    (next: string) => {
      const applyToUrl = (value: string) => {
        const current = getCurrentLocationParts();
        const nextSearch = writeParam(current.search, key, value, defaultValue);
        if (nextSearch === current.search) return;
        navigate(`${current.pathname}${nextSearch}${current.hash}`, {
          replace: historyMode === 'replace',
        });
      };

      if (debounceMs > 0) {
        setPendingValue(next);
        if (debounceTimerRef.current !== null) {
          window.clearTimeout(debounceTimerRef.current);
        }
        debounceTimerRef.current = window.setTimeout(() => {
          debounceTimerRef.current = null;
          applyToUrl(next);
        }, debounceMs);
        return;
      }

      applyToUrl(next);
    },
    [key, defaultValue, historyMode, debounceMs],
  );

  return [pendingValue ?? urlValue, setValue];
}

// '1'-Flag-Kurzform für boolesche Toggles (?konflikte=1).
export function useUrlFlag(
  key: string,
  options?: UseUrlQueryStateOptions,
): [boolean, (on: boolean) => void] {
  const [value, setValue] = useUrlQueryState(key, '', options);
  const setFlag = useCallback(
    (on: boolean) => {
      setValue(on ? '1' : '');
    },
    [setValue],
  );
  return [value === '1', setFlag];
}

// Immer die echte, aktuelle Location lesen (nicht den Render-Snapshot) —
// wichtig, wenn mehrere Setter im selben Tick schreiben oder ein debounced
// Write erst nach weiteren Navigationen feuert.
function getCurrentLocationParts(): { pathname: string; search: string; hash: string } {
  if (typeof window === 'undefined') {
    return { pathname: '/', search: '', hash: '' };
  }
  return {
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
  };
}
