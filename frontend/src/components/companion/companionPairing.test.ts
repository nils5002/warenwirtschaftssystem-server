import { describe, expect, it } from 'vitest';

import {
  buildPairingUrl,
  deviceLabel,
  extractPairingCode,
  formatCountdown,
  isCompanionPairPath,
  isFinalPairingStatus,
  relativeTime,
} from './companionPairing';

const CODE = 'Abc_def-0123456789ABCDEFGHIJ_klmnopqrstuvw';

describe('buildPairingUrl', () => {
  it('legt den Code ins #-Fragment, nie in die Query', () => {
    const url = buildPairingUrl('https://wws.example.de/', CODE);
    expect(url).toBe(`https://wws.example.de/verbinden#${CODE}`);
    expect(new URL(url).search).toBe('');
  });
});

describe('extractPairingCode', () => {
  it('liest den Code aus dem kompletten Link', () => {
    expect(extractPairingCode(buildPairingUrl('https://wws.example.de', CODE))).toBe(CODE);
  });

  it('akzeptiert Fragment oder nackten Code', () => {
    expect(extractPairingCode(`#${CODE}`)).toBe(CODE);
    expect(extractPairingCode(CODE)).toBe(CODE);
  });

  it('lehnt fremde Adressen ab, wenn die eigene bekannt ist', () => {
    const foreign = buildPairingUrl('https://evil.example.com', CODE);
    expect(extractPairingCode(foreign, 'https://wws.example.de')).toBeNull();
    expect(extractPairingCode(buildPairingUrl('https://wws.example.de', CODE), 'https://wws.example.de')).toBe(CODE);
  });

  it('lehnt andere Pfade, Query-Codes und Unsinn ab', () => {
    expect(extractPairingCode(`https://wws.example.de/inventar#${CODE}`)).toBeNull();
    expect(extractPairingCode(`https://wws.example.de/verbinden?c=${CODE}`)).toBeNull();
    expect(extractPairingCode('ASSET-123')).toBeNull();
    expect(extractPairingCode('')).toBeNull();
  });
});

describe('Hilfen', () => {
  it('erkennt die öffentliche Kopplungsseite', () => {
    expect(isCompanionPairPath('/verbinden')).toBe(true);
    expect(isCompanionPairPath('/verbinden/')).toBe(true);
    expect(isCompanionPairPath('/inventar')).toBe(false);
  });

  it('formatiert den Countdown', () => {
    expect(formatCountdown(120)).toBe('2:00');
    expect(formatCountdown(65)).toBe('1:05');
    expect(formatCountdown(-3)).toBe('0:00');
  });

  it('kennt Endzustände', () => {
    expect(isFinalPairingStatus('consumed')).toBe(true);
    expect(isFinalPairingStatus('claimed')).toBe(false);
  });

  it('beschreibt Geräte ohne Dopplung', () => {
    expect(deviceLabel('iPhone', 'iPhone · Safari')).toBe('iPhone · Safari');
    expect(deviceLabel('Smartphone', null)).toBe('Smartphone');
  });

  it('zeigt relative Zeiten', () => {
    const now = new Date('2026-10-21T12:00:00Z');
    expect(relativeTime('2026-10-21T11:59:30Z', now)).toBe('gerade eben');
    expect(relativeTime('2026-10-21T11:50:00Z', now)).toBe('vor 10 Min.');
    expect(relativeTime(null, now)).toBe('–');
  });
});
