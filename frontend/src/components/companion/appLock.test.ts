import { describe, expect, it } from 'vitest';

import { BACKGROUND_LOCK_MS, shouldLockAfterBackground } from './appLock';

describe('shouldLockAfterBackground', () => {
  it('sperrt erst nach der Mindestzeit im Hintergrund', () => {
    expect(shouldLockAfterBackground(1_000, 1_000 + BACKGROUND_LOCK_MS - 1)).toBe(false);
    expect(shouldLockAfterBackground(1_000, 1_000 + BACKGROUND_LOCK_MS)).toBe(true);
  });

  it('sperrt nicht ohne vorherigen Hintergrund', () => {
    expect(shouldLockAfterBackground(null, Date.now())).toBe(false);
  });
});
