// Reine Ableitungen für die Adminseite „E-Mail-Einstellungen" — bewusst ohne
// React/DOM, damit sie in Vitest ohne Browser-Umgebung prüfbar sind.

import type {
  MailConfigSource,
  MailSettings,
  MailSecurity,
  MailSettingsInput,
  MailStatus,
  MailStatusState,
  RegistrationMode,
} from '../../services/wmsApi';

export const PASSWORD_PLACEHOLDER = '********';

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export type StatusView = {
  title: string;
  description: string;
  tone: StatusTone;
};

/**
 * Überschrift + Erklärtext der Statuskarte.
 *
 * Wichtig für die Aussage der Seite: Ein fehlender oder kaputter SMTP-Zustand
 * ist KEIN Ausfall der Registrierung — solange der klassische Modus aktiv ist,
 * wird das ausdrücklich beruhigend formuliert. Nur wenn die E-Mail-Bestätigung
 * aktiviert ist, ist ein SMTP-Problem wirklich kritisch.
 */
export function statusView(status: MailStatus): StatusView {
  const classic = status.registrationMode === 'classic_admin_approval';
  const fallbackNote = classic
    ? 'Die klassische Registrierung mit Admin-Freigabe ist aktiv. Benutzer können sich weiterhin registrieren.'
    : 'Achtung: Die E-Mail-Bestätigung ist aktiviert — neue Registrierungen können ihre Adresse derzeit nicht bestätigen.';

  switch (status.state) {
    case 'not_configured':
      return {
        title: 'SMTP nicht eingerichtet',
        description: fallbackNote,
        tone: classic ? 'neutral' : 'danger',
      };
    case 'disabled':
      return {
        title: 'SMTP deaktiviert',
        description: `Eine Konfiguration ist hinterlegt, aber nicht aktiviert. ${fallbackNote}`,
        tone: classic ? 'neutral' : 'danger',
      };
    case 'connection_failed':
      return {
        title: 'SMTP-Verbindung fehlgeschlagen',
        description: status.lastTestError
          ? `${status.lastTestError} ${fallbackNote}`
          : fallbackNote,
        tone: classic ? 'warning' : 'danger',
      };
    case 'send_failed':
      return {
        title: 'Letzter Versand fehlgeschlagen',
        description: status.lastSendError
          ? `${status.lastSendError} ${fallbackNote}`
          : fallbackNote,
        tone: classic ? 'warning' : 'danger',
      };
    case 'test_succeeded':
      return {
        title: 'SMTP-Test erfolgreich',
        description:
          'Der SMTP-Server ist erreichbar und hat eine Test-E-Mail angenommen. Das Registrierungsverfahren lässt sich jetzt umstellen.',
        tone: 'success',
      };
    case 'configured':
    default:
      return {
        title: 'SMTP konfiguriert',
        description:
          'Die Konfiguration ist aktiv. Bitte einmal die Verbindung testen und eine Test-E-Mail senden.',
        tone: 'info',
      };
  }
}

/** Woher stammt die aktive Konfiguration? (Für den Herkunfts-Hinweis.) */
export function sourceLabel(source: MailConfigSource): string {
  switch (source) {
    case 'admin':
      return 'WWS-Administration';
    case 'env':
      return 'Server-Umgebungsvariablen (Portainer)';
    default:
      return 'keine aktive Konfiguration';
  }
}

/** Herkunft der öffentlichen WWS-Adresse für Bestätigungslinks. */
export function publicUrlSourceLabel(source: MailConfigSource): string {
  switch (source) {
    case 'admin':
      return 'WWS-Administration';
    case 'env':
      return 'FRONTEND_URL (Server-Umgebung)';
    default:
      return 'nicht hinterlegt';
  }
}

/** Woher stammt der Schlüssel, mit dem das SMTP-Passwort verschlüsselt wird? */
export function keySourceLabel(source: MailStatus['secretKeySource']): string {
  switch (source) {
    case 'derived':
      return 'Automatisch (aus dem Server-Secret abgeleitet)';
    case 'explicit':
      return 'Eigener Schlüssel (MAIL_CONFIG_ENCRYPTION_KEY)';
    default:
      return 'nicht verfügbar';
  }
}

export type SecurityOption = {
  value: MailSecurity;
  label: string;
  disabled: boolean;
};

/**
 * Auswahl für „Verschlüsselung".
 *
 * „Unverschlüsselt" wird nur angeboten, wenn der Server es zulässt
 * (Entwicklung) ODER genau dieser Wert gespeichert ist — sonst würde das
 * Dropdown optisch eine andere Option zeigen als tatsächlich gilt. Ist er in
 * Produktion gespeichert, bleibt er sichtbar, aber nicht neu wählbar.
 */
export function securityOptions(
  current: MailSecurity,
  plainSmtpAllowed: boolean,
): SecurityOption[] {
  const options: SecurityOption[] = [
    { value: 'starttls', label: 'STARTTLS', disabled: false },
    { value: 'ssl', label: 'SSL/TLS', disabled: false },
  ];
  if (plainSmtpAllowed || current === 'none') {
    options.push({
      value: 'none',
      label: plainSmtpAllowed
        ? 'Unverschlüsselt (nur Entwicklung)'
        : 'Unverschlüsselt — im Produktivbetrieb nicht zulässig',
      disabled: !plainSmtpAllowed,
    });
  }
  return options;
}

export function registrationModeLabel(mode: RegistrationMode): string {
  return mode === 'email_verification'
    ? 'E-Mail-Bestätigung + Admin-Freigabe'
    : 'Klassisch – Admin-Freigabe';
}

export type MailFormState = {
  enabled: boolean;
  host: string;
  port: string;
  security: MailSettings['security'];
  username: string;
  password: string;
  fromEmail: string;
  fromName: string;
  timeoutSeconds: string;
  verificationExpiryHours: string;
  publicBaseUrl: string;
  // true, sobald der Benutzer das Passwortfeld selbst angefasst hat. Nur dann
  // wird überhaupt ein Passwort mitgesendet.
  passwordTouched: boolean;
};

export function formFromSettings(settings: MailSettings): MailFormState {
  return {
    enabled: settings.enabled,
    host: settings.host ?? '',
    port: String(settings.port ?? 587),
    security: settings.security ?? 'starttls',
    username: settings.username ?? '',
    // Nie das echte Passwort — es verlässt den Server gar nicht erst.
    password: settings.passwordSet ? PASSWORD_PLACEHOLDER : '',
    fromEmail: settings.fromEmail ?? '',
    fromName: settings.fromName ?? 'Warehouse-System',
    timeoutSeconds: String(settings.timeoutSeconds ?? 15),
    verificationExpiryHours: String(settings.verificationExpiryHours ?? 24),
    publicBaseUrl: settings.publicBaseUrl ?? '',
    passwordTouched: false,
  };
}

export type FormValidation = { ok: boolean; error?: string };

export function validateForm(form: MailFormState): FormValidation {
  const port = Number(form.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: 'Bitte einen gültigen Port zwischen 1 und 65535 angeben.' };
  }
  const timeout = Number(form.timeoutSeconds);
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 120) {
    return { ok: false, error: 'Das Timeout muss zwischen 1 und 120 Sekunden liegen.' };
  }
  const hours = Number(form.verificationExpiryHours);
  if (!Number.isInteger(hours) || hours < 1 || hours > 336) {
    return { ok: false, error: 'Die Gültigkeitsdauer muss zwischen 1 und 336 Stunden liegen.' };
  }
  if (form.enabled && !form.host.trim()) {
    return { ok: false, error: 'Zum Aktivieren wird ein SMTP-Hostname benötigt.' };
  }
  if (form.enabled && !form.fromEmail.trim()) {
    return { ok: false, error: 'Zum Aktivieren wird eine Absender-E-Mail benötigt.' };
  }
  const publicUrl = form.publicBaseUrl.trim();
  if (publicUrl && !/^https?:\/\/[^\s/?#]+/i.test(publicUrl)) {
    return {
      ok: false,
      error: 'Die öffentliche WWS-Adresse muss mit https:// beginnen (z. B. https://warehouse.example.de).',
    };
  }
  return { ok: true };
}

/**
 * Baut die Speicher-Payload.
 *
 * Das Passwort wird nur mitgesendet, wenn der Benutzer das Feld angefasst und
 * den Platzhalter ersetzt hat. Ein geleertes Feld bedeutet NICHT „Passwort
 * löschen" — dafür gibt es `clearPassword`, sonst würde ein unbedachter
 * Formular-Roundtrip den Mailversand abschalten.
 */
export function payloadFromForm(
  form: MailFormState,
  options?: { clearPassword?: boolean },
): MailSettingsInput {
  const payload: MailSettingsInput = {
    enabled: form.enabled,
    host: form.host.trim(),
    port: Number(form.port),
    security: form.security,
    username: form.username.trim(),
    fromEmail: form.fromEmail.trim(),
    fromName: form.fromName.trim(),
    timeoutSeconds: Number(form.timeoutSeconds),
    verificationExpiryHours: Number(form.verificationExpiryHours),
    // Immer mitsenden: '' entfernt den Admin-Wert bewusst (FRONTEND_URL gilt).
    publicBaseUrl: form.publicBaseUrl.trim(),
  };
  if (options?.clearPassword) {
    payload.clearPassword = true;
    return payload;
  }
  const password = form.password.trim();
  if (form.passwordTouched && password && password !== PASSWORD_PLACEHOLDER) {
    payload.password = form.password;
  }
  return payload;
}

/** Darf der Umschalter auf „E-Mail-Bestätigung" angeboten werden? */
export function canSelectVerificationMode(status: MailStatus | null): boolean {
  return Boolean(status?.canEnableVerification);
}

/** Offene Punkte, die einer Aktivierung von Modus B im Weg stehen. */
export function verificationBlockers(status: MailStatus | null): string[] {
  if (!status) return [];
  const blockers = [...status.verificationBlockers];
  if (!status.frontendUrlReady && status.frontendUrlHint) {
    blockers.push(status.frontendUrlHint);
  }
  return blockers;
}

export const STATE_LABELS: Record<MailStatusState, string> = {
  not_configured: 'SMTP nicht eingerichtet',
  disabled: 'SMTP deaktiviert',
  configured: 'SMTP konfiguriert',
  test_succeeded: 'SMTP-Test erfolgreich',
  connection_failed: 'SMTP-Verbindung fehlgeschlagen',
  send_failed: 'Letzter Versand fehlgeschlagen',
};
