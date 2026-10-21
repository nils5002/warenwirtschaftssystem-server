// Reine Ableitungen für die Companion-Kopplung — ohne React/DOM, damit sie in
// Vitest ohne Browser-Umgebung prüfbar sind.

import type { CompanionPairingStatus } from '../../services/wmsApi';

// Öffentliche Kopplungsseite. Sie muss ohne Sitzung erreichbar sein.
export const COMPANION_PAIR_PATH = '/verbinden';
const PAIR_PATHS = new Set([COMPANION_PAIR_PATH, '/companion/verbinden', '/companion']);

export function isCompanionPairPath(pathname: string): boolean {
  const normalized = (pathname || '/').replace(/\/+$/, '') || '/';
  return PAIR_PATHS.has(normalized.toLowerCase());
}

// Format des Kopplungscodes (token_urlsafe(32) im Backend).
const CODE_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;

/**
 * Baut den Link für den QR-Code.
 *
 * Der Code steht im #-Fragment: Fragmente werden vom Browser nie an den
 * Server, an Proxys oder als Referrer übertragen — der Kopplungsnachweis
 * landet so in keinem Zugriffsprotokoll. Die Adresse ist die, unter der der
 * PC das WWS gerade nutzt (nie ein Host-Header).
 */
export function buildPairingUrl(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}${COMPANION_PAIR_PATH}#${code}`;
}

/**
 * Liest einen Kopplungscode aus einem eingescannten Wert: kompletter Link
 * (mit #-Fragment), nur das Fragment oder der nackte Code. Ein Link auf eine
 * fremde Adresse wird abgelehnt — es darf nur mit dem eigenen WWS gekoppelt
 * werden.
 */
export function extractPairingCode(value: string, expectedOrigin?: string): string | null {
  const raw = (value || '').trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    if (expectedOrigin && url.origin !== new URL(expectedOrigin).origin) return null;
    if (!isCompanionPairPath(url.pathname)) return null;
    const fragment = url.hash.replace(/^#/, '');
    return CODE_PATTERN.test(fragment) ? fragment : null;
  }
  const candidate = raw.replace(/^#/, '');
  return CODE_PATTERN.test(candidate) ? candidate : null;
}

export function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/** Ist dieser Status endgültig (keine weitere Abfrage nötig)? */
export function isFinalPairingStatus(status: CompanionPairingStatus): boolean {
  return ['rejected', 'consumed', 'cancelled', 'expired'].includes(status);
}

/** Klartext für die Handy-Seite, wenn die Kopplung nicht klappt. */
export function phoneStatusMessage(status: CompanionPairingStatus): string {
  switch (status) {
    case 'rejected':
      return 'Die Verbindung wurde am PC abgelehnt. Bei Bedarf am PC einen neuen QR-Code erzeugen.';
    case 'expired':
      return 'Die Zeit für die Bestätigung ist abgelaufen. Bitte am PC einen neuen QR-Code erzeugen.';
    case 'cancelled':
      return 'Die Kopplung wurde abgebrochen. Bitte am PC einen neuen QR-Code erzeugen.';
    case 'consumed':
      return 'Diese Kopplung wurde bereits abgeschlossen.';
    default:
      return 'Bitte bestätige die Verbindung jetzt am PC.';
  }
}

/** Grobe Gerätebeschreibung aus dem Backend für die Geräteliste. */
export function deviceLabel(name: string, platform?: string | null): string {
  if (platform && platform !== name) return `${name} · ${platform.replace(`${name} · `, '')}`;
  return name;
}

/** Relative, verständliche Zeitangabe ("vor 5 Min."). */
export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '–';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '–';
  const diff = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (diff < 60) return 'gerade eben';
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min.`;
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std.`;
  return date.toLocaleDateString('de-DE');
}
