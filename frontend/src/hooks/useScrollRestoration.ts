import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

// Scrollposition eines eigenen Scroll-Containers (div mit overflow-y-auto)
// über Navigationen hinweg erhalten: Beim Zurückkehren auf dieselbe Ansicht
// (gleicher Pfad + gleiche Query) steht die Liste wieder an derselben Stelle.
//
// - Key = pathname + search in sessionStorage: Ein Filterwechsel ist eine
//   andere Ansicht (neues Resultset) und startet bewusst oben; die
//   Scrollposition gehört NICHT in die URL.
// - Restore einmalig pro Key via useLayoutEffect, erst wenn `ready` true ist
//   (Daten geladen) — kein sichtbares Springen, kein erneutes Springen durch
//   Polling-Updates.
// - Speichern throttled beim Scrollen und final beim Unmount/Keywechsel.

const STORAGE_PREFIX = 'scroll:';
const SAVE_THROTTLE_MS = 150;

function storageKeyForCurrentLocation(): string {
  if (typeof window === 'undefined') return `${STORAGE_PREFIX}/`;
  return `${STORAGE_PREFIX}${window.location.pathname}${window.location.search}`;
}

function readStoredScroll(key: string): number | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

function writeStoredScroll(key: string, value: number): void {
  try {
    if (value <= 0) {
      sessionStorage.removeItem(key);
    } else {
      sessionStorage.setItem(key, String(Math.round(value)));
    }
  } catch {
    // Storage voll/blockiert — Scroll-Restaurierung ist reiner Komfort.
  }
}

export function useScrollRestoration(
  ref: RefObject<HTMLElement | null>,
  options: { ready: boolean },
): void {
  const { ready } = options;
  // Key beim Mount/Render einfrieren — Speichern und Restaurieren beziehen
  // sich immer auf die Ansicht, unter der der Container gerendert wurde.
  const key = storageKeyForCurrentLocation();
  const restoredKeyRef = useRef<string | null>(null);
  const throttleTimerRef = useRef<number | null>(null);
  const lastKnownScrollRef = useRef(0);

  // Einmalig pro Key restaurieren, sobald die Daten da sind. useLayoutEffect,
  // damit die Position vor dem Paint gesetzt wird (kein Flackern).
  useLayoutEffect(() => {
    if (!ready || restoredKeyRef.current === key) return;
    const element = ref.current;
    if (!element) return;
    restoredKeyRef.current = key;
    // Ohne gespeicherte Position (z. B. Filterwechsel ⇒ neuer Key ⇒ neues
    // Resultset) deterministisch oben starten.
    element.scrollTop = readStoredScroll(key) ?? 0;
  }, [ready, key, ref]);

  // Scroll-Änderungen throttled in sessionStorage spiegeln.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const handleScroll = () => {
      lastKnownScrollRef.current = element.scrollTop;
      if (throttleTimerRef.current !== null) return;
      throttleTimerRef.current = window.setTimeout(() => {
        throttleTimerRef.current = null;
        writeStoredScroll(key, lastKnownScrollRef.current);
      }, SAVE_THROTTLE_MS);
    };

    element.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      element.removeEventListener('scroll', handleScroll);
      if (throttleTimerRef.current !== null) {
        window.clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
      // Finalen Stand sichern — deckt Unmount durch Navigation ab.
      writeStoredScroll(key, element.scrollTop);
    };
  }, [key, ref]);
}
