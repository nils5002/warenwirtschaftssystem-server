import { describe, expect, it } from 'vitest';

import { canAccessPage } from './pageAccess';

describe('canAccessPage – E-Mail-Einstellungen', () => {
  it('zeigt die Seite Admins mit dem Recht mail.manage', () => {
    expect(canAccessPage('emailSettings', ['mail.manage'], 'Admin')).toBe(true);
  });

  it('blendet sie fuer Nicht-Admins aus, selbst wenn das Recht gewaehrt wurde', () => {
    expect(canAccessPage('emailSettings', ['mail.manage'], 'Projektmanager')).toBe(false);
    expect(canAccessPage('emailSettings', ['mail.manage'], 'Mitarbeiter')).toBe(false);
  });

  it('blendet sie ohne Rechteliste (aelteres Backend) fuer Nicht-Admins aus', () => {
    expect(canAccessPage('emailSettings', undefined, 'Admin')).toBe(true);
    expect(canAccessPage('emailSettings', undefined, 'Projektmanager')).toBe(false);
    expect(canAccessPage('emailSettings', undefined, 'Mitarbeiter')).toBe(false);
  });

  it('laesst andere Seiten unveraendert rechtegesteuert', () => {
    expect(canAccessPage('systemUpdate', ['system.update'], 'Projektmanager')).toBe(true);
  });
});
