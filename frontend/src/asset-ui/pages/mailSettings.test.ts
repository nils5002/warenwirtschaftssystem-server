import { describe, expect, it } from 'vitest';

import type { MailSettings, MailStatus } from '../../services/wmsApi';
import {
  PASSWORD_PLACEHOLDER,
  formFromSettings,
  keySourceLabel,
  payloadFromForm,
  publicUrlSourceLabel,
  registrationModeLabel,
  securityOptions,
  sourceLabel,
  statusView,
  validateForm,
  verificationBlockers,
  type MailFormState,
} from './mailSettings';

const SETTINGS: MailSettings = {
  enabled: true,
  host: 'smtp.example.de',
  port: 587,
  security: 'starttls',
  username: 'noreply@example.de',
  passwordSet: true,
  fromEmail: 'noreply@example.de',
  fromName: 'Warehouse-System',
  timeoutSeconds: 15,
  verificationExpiryHours: 24,
};

function status(overrides: Partial<MailStatus> = {}): MailStatus {
  return {
    state: 'not_configured',
    source: 'none',
    canSend: false,
    registrationMode: 'classic_admin_approval',
    registrationEnabled: true,
    canEnableVerification: false,
    verificationBlockers: [],
    secretStorageAvailable: true,
    frontendUrlReady: true,
    publicBaseUrlSource: 'env',
    verificationExpiryHours: 24,
    plainSmtpAllowed: false,
    ...overrides,
  };
}

function form(overrides: Partial<MailFormState> = {}): MailFormState {
  return { ...formFromSettings(SETTINGS), ...overrides };
}

describe('formFromSettings', () => {
  it('zeigt nur einen Platzhalter statt des Passworts', () => {
    const state = formFromSettings(SETTINGS);
    expect(state.password).toBe(PASSWORD_PLACEHOLDER);
    expect(state.passwordTouched).toBe(false);
  });

  it('laesst das Passwortfeld leer, wenn keines hinterlegt ist', () => {
    expect(formFromSettings({ ...SETTINGS, passwordSet: false }).password).toBe('');
  });
});

describe('payloadFromForm', () => {
  it('sendet kein Passwort, solange das Feld unberuehrt ist', () => {
    // Zentral: Ein Formular-Roundtrip darf das gespeicherte Secret nicht
    // anfassen und erst recht nicht loeschen.
    expect(payloadFromForm(form())).not.toHaveProperty('password');
  });

  it('sendet den Platzhalter niemals als echtes Passwort', () => {
    const state = form({ passwordTouched: true, password: PASSWORD_PLACEHOLDER });
    expect(payloadFromForm(state)).not.toHaveProperty('password');
  });

  it('sendet ein neu eingegebenes Passwort', () => {
    const state = form({ passwordTouched: true, password: 'neues-geheimnis' });
    expect(payloadFromForm(state).password).toBe('neues-geheimnis');
  });

  it('loescht nur auf ausdruecklichen Wunsch', () => {
    const payload = payloadFromForm(form(), { clearPassword: true });
    expect(payload.clearPassword).toBe(true);
    expect(payload).not.toHaveProperty('password');
  });

  it('trimmt Eingaben und wandelt Zahlenfelder', () => {
    const payload = payloadFromForm(form({ host: '  smtp.test.de  ', port: '465' }));
    expect(payload.host).toBe('smtp.test.de');
    expect(payload.port).toBe(465);
  });
});

describe('validateForm', () => {
  it('akzeptiert eine vollstaendige Konfiguration', () => {
    expect(validateForm(form()).ok).toBe(true);
  });

  it('weist unsinnige Ports und Zeiten ab', () => {
    expect(validateForm(form({ port: '0' })).ok).toBe(false);
    expect(validateForm(form({ port: 'abc' })).ok).toBe(false);
    expect(validateForm(form({ timeoutSeconds: '999' })).ok).toBe(false);
    expect(validateForm(form({ verificationExpiryHours: '0' })).ok).toBe(false);
  });

  it('verlangt Host und Absender nur beim Aktivieren', () => {
    expect(validateForm(form({ enabled: true, host: '' })).ok).toBe(false);
    expect(validateForm(form({ enabled: true, fromEmail: '' })).ok).toBe(false);
    expect(validateForm(form({ enabled: false, host: '', fromEmail: '' })).ok).toBe(true);
  });
});

describe('statusView', () => {
  it('beruhigt bei fehlendem SMTP, solange der klassische Modus laeuft', () => {
    const view = statusView(status());
    expect(view.title).toBe('SMTP nicht eingerichtet');
    expect(view.description).toMatch(/klassische Registrierung/i);
    expect(view.tone).toBe('neutral');
  });

  it('warnt deutlich, wenn die E-Mail-Bestaetigung aktiv und SMTP kaputt ist', () => {
    const view = statusView(
      status({ state: 'connection_failed', registrationMode: 'email_verification' }),
    );
    expect(view.tone).toBe('danger');
    expect(view.description).toMatch(/nicht bestätigen/i);
  });

  it('meldet einen erfolgreichen Test als Erfolg', () => {
    expect(statusView(status({ state: 'test_succeeded' })).tone).toBe('success');
  });

  it('unterscheidet deaktiviert von nicht eingerichtet', () => {
    expect(statusView(status({ state: 'disabled' })).title).toBe('SMTP deaktiviert');
  });
});

describe('sourceLabel', () => {
  it('macht die Herkunft der aktiven Konfiguration sichtbar', () => {
    expect(sourceLabel('admin')).toMatch(/Administration/);
    expect(sourceLabel('env')).toMatch(/Portainer/);
    expect(sourceLabel('none')).toMatch(/keine/);
  });
});

describe('registrationModeLabel', () => {
  it('benennt beide Verfahren', () => {
    expect(registrationModeLabel('classic_admin_approval')).toMatch(/Klassisch/);
    expect(registrationModeLabel('email_verification')).toMatch(/E-Mail-Bestätigung/);
  });
});

describe('verificationBlockers', () => {
  it('ergaenzt einen fehlenden FRONTEND_URL-Hinweis', () => {
    const blockers = verificationBlockers(
      status({
        verificationBlockers: ['Es liegt kein erfolgreicher SMTP-Verbindungstest vor.'],
        frontendUrlReady: false,
        frontendUrlHint: 'FRONTEND_URL ist nicht gesetzt.',
      }),
    );
    expect(blockers).toHaveLength(2);
    expect(blockers[1]).toMatch(/FRONTEND_URL/);
  });

  it('liefert nichts, wenn alles passt', () => {
    expect(verificationBlockers(status({ canEnableVerification: true }))).toEqual([]);
    expect(verificationBlockers(null)).toEqual([]);
  });
});

describe('securityOptions', () => {
  it('bietet in Produktion nur STARTTLS und SSL/TLS an', () => {
    expect(securityOptions('starttls', false).map((o) => o.value)).toEqual(['starttls', 'ssl']);
  });

  it('zeigt einen gespeicherten unverschluesselten Wert korrekt an statt STARTTLS', () => {
    const options = securityOptions('none', false);
    const none = options.find((o) => o.value === 'none');
    expect(none).toBeDefined();
    // Sichtbar (das Dropdown zeigt den echten Zustand), aber nicht neu waehlbar.
    expect(none?.disabled).toBe(true);
    expect(none?.label).toMatch(/nicht zulässig/);
  });

  it('erlaubt unverschluesselt nur in der Entwicklung', () => {
    const none = securityOptions('starttls', true).find((o) => o.value === 'none');
    expect(none?.disabled).toBe(false);
  });
});

describe('oeffentliche WWS-Adresse', () => {
  it('wird aus den Einstellungen uebernommen und immer mitgesendet', () => {
    const state = formFromSettings({ ...SETTINGS, publicBaseUrl: 'https://wws.example.de' });
    expect(state.publicBaseUrl).toBe('https://wws.example.de');
    expect(payloadFromForm(state).publicBaseUrl).toBe('https://wws.example.de');
    // Leer = Admin-Wert entfernen (FRONTEND_URL gilt wieder).
    expect(payloadFromForm({ ...state, publicBaseUrl: '  ' }).publicBaseUrl).toBe('');
  });

  it('lehnt offensichtlich ungueltige Adressen schon im Formular ab', () => {
    expect(validateForm(form({ publicBaseUrl: 'warehouse.example.de' })).ok).toBe(false);
    expect(validateForm(form({ publicBaseUrl: 'https://warehouse.example.de' })).ok).toBe(true);
    expect(validateForm(form({ publicBaseUrl: '' })).ok).toBe(true);
  });

  it('benennt die Herkunft verstaendlich', () => {
    expect(publicUrlSourceLabel('admin')).toBe('WWS-Administration');
    expect(publicUrlSourceLabel('env')).toMatch(/FRONTEND_URL/);
    expect(publicUrlSourceLabel('none')).toBe('nicht hinterlegt');
  });
});

describe('keySourceLabel', () => {
  it('nennt nur die Herkunft, nie einen Schluessel', () => {
    expect(keySourceLabel('derived')).toMatch(/Automatisch/);
    expect(keySourceLabel('explicit')).toMatch(/MAIL_CONFIG_ENCRYPTION_KEY/);
    expect(keySourceLabel(null)).toBe('nicht verfügbar');
  });
});
