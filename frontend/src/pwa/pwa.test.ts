import { describe, expect, it } from 'vitest';

import { detectInstallPlatform, isStandaloneDisplay } from './installHints';
import { isCompanionWorker, isForeignCache } from './serviceWorker';

const ORIGIN = 'https://wws.example.de';

describe('Service-Worker-Hygiene', () => {
  it('erkennt nur den eigenen Worker auf der eigenen Origin', () => {
    expect(isCompanionWorker(`${ORIGIN}/sw.js`, ORIGIN)).toBe(true);
    expect(isCompanionWorker(`${ORIGIN}/old-worker.js`, ORIGIN)).toBe(false);
    expect(isCompanionWorker('https://evil.example.com/sw.js', ORIGIN)).toBe(false);
    expect(isCompanionWorker(undefined, ORIGIN)).toBe(false);
  });

  it('löscht nur fremde Caches', () => {
    expect(isForeignCache('wms-companion-v1')).toBe(false);
    expect(isForeignCache('workbox-precache-v2')).toBe(true);
  });
});

describe('Installationshinweise', () => {
  it('erkennt iPhone, iPadOS und Android', () => {
    expect(detectInstallPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('ios');
    expect(detectInstallPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe('ios');
    expect(detectInstallPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe('desktop');
    expect(detectInstallPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe('android');
  });

  it('erkennt den installierten Standalone-Modus', () => {
    expect(isStandaloneDisplay(() => ({ matches: true }), undefined)).toBe(true);
    expect(isStandaloneDisplay(() => ({ matches: false }), true)).toBe(true);
    expect(isStandaloneDisplay(() => ({ matches: false }), false)).toBe(false);
    expect(isStandaloneDisplay(undefined, undefined)).toBe(false);
  });
});
