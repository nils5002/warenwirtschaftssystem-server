// Installierbarkeit der Companion App (PWA) — reine Logik + kleine Browser-
// Brücke für das Android-Installationsangebot ("beforeinstallprompt").

export type InstallPlatform = 'ios' | 'android' | 'desktop' | 'other';

/** Grobe Plattform aus dem User-Agent (nur für passende Anleitungen). */
export function detectInstallPlatform(userAgent: string, maxTouchPoints = 0): InstallPlatform {
  const ua = userAgent.toLowerCase();
  // iPadOS meldet sich als "Macintosh" — erkennbar an Touch-Unterstützung.
  if (/iphone|ipad|ipod/.test(ua) || (ua.includes('macintosh') && maxTouchPoints > 1)) return 'ios';
  if (ua.includes('android')) return 'android';
  if (/windows|macintosh|linux|cros/.test(ua)) return 'desktop';
  return 'other';
}

/** Läuft die App bereits installiert (ohne Browserleisten)? */
export function isStandaloneDisplay(
  matchMedia: ((query: string) => { matches: boolean }) | undefined,
  navigatorStandalone: boolean | undefined,
): boolean {
  if (navigatorStandalone) return true; // iOS Safari
  try {
    return Boolean(matchMedia?.('(display-mode: standalone)').matches);
  } catch {
    return false;
  }
}

export function isRunningStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return isStandaloneDisplay(
    window.matchMedia?.bind(window),
    (window.navigator as Navigator & { standalone?: boolean }).standalone,
  );
}

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferredPrompt: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

/** Früh beim Start aufrufen, damit das Android-Angebot nicht verloren geht. */
export function captureInstallPrompt(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as InstallPromptEvent;
    listeners.forEach((listener) => listener());
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    listeners.forEach((listener) => listener());
  });
}

export function canPromptInstall(): boolean {
  return deferredPrompt !== null;
}

export function onInstallPromptChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Zeigt das native Installationsangebot (nur nach Nutzeraktion aufrufen). */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferredPrompt) return 'unavailable';
  const prompt = deferredPrompt;
  deferredPrompt = null;
  await prompt.prompt();
  const choice = await prompt.userChoice;
  listeners.forEach((listener) => listener());
  return choice.outcome;
}
