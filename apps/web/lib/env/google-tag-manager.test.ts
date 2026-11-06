import { describe, expect, it, vi } from 'vitest';

import { isGoogleTagManagerEnabled } from './google-tag-manager';

describe('isGoogleTagManagerEnabled', () => {
  it.each([undefined, 'false'])(
    'disables GTM in production when the flag is %s',
    (enabled) => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('NEXT_PUBLIC_GTM_ENABLED', enabled);

      expect(isGoogleTagManagerEnabled()).toBe(false);
    },
  );

  it('enables GTM for an explicitly enabled production deployment', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_GTM_ENABLED', 'true');

    expect(isGoogleTagManagerEnabled()).toBe(true);
  });

  it.each(['development', 'test'] as const)(
    'disables GTM in %s even when explicitly enabled',
    (nodeEnv) => {
      vi.stubEnv('NODE_ENV', nodeEnv);
      vi.stubEnv('NEXT_PUBLIC_GTM_ENABLED', 'true');

      expect(isGoogleTagManagerEnabled()).toBe(false);
    },
  );

  it('rejects a misspelled flag', () => {
    vi.stubEnv('NEXT_PUBLIC_GTM_ENABLED', 'treu');

    expect(isGoogleTagManagerEnabled).toThrow(/NEXT_PUBLIC_GTM_ENABLED/);
  });
});
