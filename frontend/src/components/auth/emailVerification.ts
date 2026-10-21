// Reine Logik rund um die E-Mail-Bestätigung — bewusst ohne React/DOM, damit
// sie in Vitest ohne Browser-Umgebung geprüft werden kann.

/** Öffentlicher Pfad der Bestätigungsseite (muss zum Backend-Link passen). */
export const VERIFY_EMAIL_PATH = '/registrierung-bestaetigen';

/** Zusätzlich akzeptierte Schreibweisen des Pfades (Deep-Links/Altlinks). */
const VERIFY_EMAIL_ALIASES = [VERIFY_EMAIL_PATH, '/verify-email', '/email-bestaetigen'];

export type VerificationPhase =
  | 'pending' // Token wird gerade eingelöst
  | 'success' // bestätigt
  | 'expired' // Link abgelaufen -> neuen anfordern
  | 'invalid' // ungültig/bereits benutzt -> neuen anfordern
  | 'missing' // gar kein Token in der URL
  | 'error'; // Netz-/Serverfehler -> erneut versuchen

/** True, wenn dieser Pfad die öffentliche Bestätigungsseite meint. */
export function isVerifyEmailPath(pathname: string): boolean {
  const normalized = (pathname || '/').toLowerCase().replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  return VERIFY_EMAIL_ALIASES.includes(normalized || '/');
}

/**
 * Liest den Token aus einem Query-String.
 *
 * Akzeptiert sowohl `?token=` als auch den Fragment-Stil `#token=`: Manche
 * Mail-Clients/Link-Scanner schreiben Links um, und ein Bestätigungslink, der
 * nur an der Schreibweise scheitert, wäre für den Nutzer nicht erklärbar.
 */
export function extractVerificationToken(search: string, hash = ''): string | null {
  const fromSearch = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const token = fromSearch.get('token');
  if (token && token.trim()) return token.trim();

  const rawHash = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!rawHash) return null;
  const fromHash = new URLSearchParams(rawHash);
  const hashToken = fromHash.get('token');
  return hashToken && hashToken.trim() ? hashToken.trim() : null;
}

/**
 * Übersetzt den HTTP-Status der Token-Einlösung in eine UI-Phase.
 *
 * 410 = abgelaufen, 400/404 = ungültig oder bereits verwendet, 429 = zu viele
 * Versuche. Alles andere ist ein technischer Fehler, bei dem ein erneuter
 * Versuch sinnvoll ist.
 */
export function phaseForStatus(status: number | undefined): VerificationPhase {
  if (status === 410) return 'expired';
  if (status === 400 || status === 404 || status === 422) return 'invalid';
  return 'error';
}

/** Nutzerlesbare Meldung zu einer Phase (Server-Detail hat Vorrang). */
export function verificationMessage(phase: VerificationPhase, detail?: string | null): string {
  if (detail && detail.trim()) return detail.trim();
  switch (phase) {
    case 'expired':
      return 'Dieser Bestätigungslink ist abgelaufen. Bitte fordere einen neuen Link an.';
    case 'invalid':
      return 'Dieser Bestätigungslink ist ungültig oder wurde bereits verwendet.';
    case 'missing':
      return 'Dieser Link enthält keinen Bestätigungscode. Bitte öffne den Link aus der E-Mail erneut.';
    case 'error':
      return 'Die Bestätigung hat gerade nicht geklappt. Bitte versuche es in einem Moment noch einmal.';
    case 'success':
      return 'E-Mail-Adresse bestätigt.';
    default:
      return 'Bestätigung läuft...';
  }
}

/** Nach diesen Phasen ist ein erneuter Versand der sinnvolle nächste Schritt. */
export function allowsResend(phase: VerificationPhase): boolean {
  return phase === 'expired' || phase === 'invalid' || phase === 'missing';
}

/** Einfache Formatprüfung — identisch zur Login-/Registrierungsseite. */
export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

export function isLikelyEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim().toLowerCase());
}

export type VerificationBadge = {
  label: string;
  tone: 'pending' | 'verified' | 'neutral';
};

/**
 * Leitet den Anzeige-Chip für die E-Mail-Bestätigung in der Benutzerverwaltung
 * ab — unabhängig vom Freigabe-Status, damit sich beide Zustände nicht
 * gegenseitig überschreiben.
 *
 * Drei klar getrennte Fälle:
 * - keine Pflicht (klassische Registrierung, Bestands- und Adminkonten)
 *   → „Nicht erforderlich"
 * - Pflicht offen → „E-Mail nicht bestätigt"
 * - Pflicht erfüllt → „E-Mail bestätigt"
 */
export function emailVerificationBadge(user: {
  emailVerificationRequired?: boolean;
  emailVerificationPending?: boolean;
  emailVerifiedAt?: string | null;
}): VerificationBadge {
  if (!user.emailVerificationRequired) {
    return { label: 'E-Mail-Bestätigung: nicht erforderlich', tone: 'neutral' };
  }
  if (user.emailVerificationPending) {
    return { label: 'E-Mail nicht bestätigt', tone: 'pending' };
  }
  return { label: 'E-Mail bestätigt', tone: 'verified' };
}
