import { hasRemoteMatch } from 'next/dist/shared/lib/match-remote-pattern';
import { describe, expect, it } from 'vitest';

import nextConfig from './next.config';

const patterns = nextConfig.images?.remotePatterns ?? [];

describe('public asset image origin', () => {
  it('admits stored image objects from the asset proxy', () => {
    expect(
      hasRemoteMatch(
        [],
        patterns,
        new URL('https://assets.vozzify.com/storage/avatars/user.webp'),
      ),
    ).toBe(true);
  });

  it('does not admit unrelated paths on the asset host', () => {
    expect(
      hasRemoteMatch(
        [],
        patterns,
        new URL('https://assets.vozzify.com/other/image.webp'),
      ),
    ).toBe(false);
  });
});
