import { describe, expect, it } from 'vitest';

import {
  allowsResend,
  emailVerificationBadge,
  extractVerificationToken,
  isLikelyEmail,
  isVerifyEmailPath,
  phaseForStatus,
  verificationMessage,
} from './emailVerification';

describe('isVerifyEmailPath', () => {
  it('erkennt den kanonischen Pfad und seine Aliase', () => {
    expect(isVerifyEmailPath('/registrierung-bestaetigen')).toBe(true);
    expect(isVerifyEmailPath('/Registrierung-Bestaetigen/')).toBe(true);
    expect(isVerifyEmailPath('/verify-email')).toBe(true);
  });

  it('greift nicht bei anderen Seiten', () => {
    expect(isVerifyEmailPath('/dashboard')).toBe(false);
    expect(isVerifyEmailPath('/login')).toBe(false);
    expect(isVerifyEmailPath('/')).toBe(false);
  });
});

describe('extractVerificationToken', () => {
  it('liest den Token aus dem Query-String', () => {
    expect(extractVerificationToken('?token=abc123')).toBe('abc123');
  });

  it('dekodiert URL-kodierte Tokens', () => {
    expect(extractVerificationToken('?token=a%2Db%5Fc')).toBe('a-b_c');
  });

  it('faellt auf das Fragment zurueck, falls der Query-Teil fehlt', () => {
    expect(extractVerificationToken('', '#token=fragment-token')).toBe('fragment-token');
  });

  it('liefert null ohne Token', () => {
    expect(extractVerificationToken('')).toBeNull();
    expect(extractVerificationToken('?other=1')).toBeNull();
    expect(extractVerificationToken('?token=')).toBeNull();
    expect(extractVerificationToken('?token=%20%20')).toBeNull();
  });
});

describe('phaseForStatus', () => {
  it('unterscheidet abgelaufen, ungueltig und technischen Fehler', () => {
    expect(phaseForStatus(410)).toBe('expired');
    expect(phaseForStatus(400)).toBe('invalid');
    expect(phaseForStatus(422)).toBe('invalid');
    expect(phaseForStatus(429)).toBe('error');
    expect(phaseForStatus(500)).toBe('error');
    expect(phaseForStatus(undefined)).toBe('error');
  });
});

describe('verificationMessage', () => {
  it('bevorzugt die Servermeldung', () => {
    expect(verificationMessage('expired', 'Link ist weg.')).toBe('Link ist weg.');
  });

  it('faellt auf verstaendliche Standardtexte zurueck', () => {
    expect(verificationMessage('expired')).toMatch(/abgelaufen/i);
    expect(verificationMessage('invalid')).toMatch(/ungültig|bereits verwendet/i);
    expect(verificationMessage('missing')).toMatch(/Bestätigungscode/i);
    expect(verificationMessage('error', '   ')).toMatch(/noch einmal/i);
  });
});

describe('allowsResend', () => {
  it('bietet den Neuversand nur dort an, wo er hilft', () => {
    expect(allowsResend('expired')).toBe(true);
    expect(allowsResend('invalid')).toBe(true);
    expect(allowsResend('missing')).toBe(true);
    expect(allowsResend('success')).toBe(false);
    expect(allowsResend('pending')).toBe(false);
  });
});

describe('isLikelyEmail', () => {
  it('blockt Eingaben ohne Domain', () => {
    expect(isLikelyEmail('supman')).toBe(false);
    expect(isLikelyEmail('a@b')).toBe(false);
    expect(isLikelyEmail('max@example.com')).toBe(true);
  });
});

describe('emailVerificationBadge', () => {
  it('weist Konten ohne Pflicht ausdruecklich als "nicht erforderlich" aus', () => {
    // Klassische Registrierung, Bestands- und Adminkonten: Die Frage
    // "bestaetigt?" wurde fuer sie nie gestellt — das muss sichtbar sein und
    // darf nicht wie "unbestaetigt" aussehen.
    expect(emailVerificationBadge({ emailVerificationRequired: false })).toEqual({
      label: 'E-Mail-Bestätigung: nicht erforderlich',
      tone: 'neutral',
    });
    expect(emailVerificationBadge({}).tone).toBe('neutral');
  });

  it('unterscheidet wartend und bestaetigt', () => {
    expect(
      emailVerificationBadge({ emailVerificationRequired: true, emailVerificationPending: true }),
    ).toEqual({ label: 'E-Mail nicht bestätigt', tone: 'pending' });
    expect(
      emailVerificationBadge({
        emailVerificationRequired: true,
        emailVerificationPending: false,
        emailVerifiedAt: '20.10.2026 10:00',
      }),
    ).toEqual({ label: 'E-Mail bestätigt', tone: 'verified' });
  });
});
