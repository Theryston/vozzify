import { hasRemoteMatch } from 'next/dist/shared/lib/match-remote-pattern';
import { describe, expect, it } from 'vitest';
import nextConfig from './next.config';

describe('asset proxy cover images', () => {
  it('allows Cover Art Archive proxy URLs from the asset domain', () => {
    expect(
      hasRemoteMatch(
        [],
        nextConfig.images?.remotePatterns ?? [],
        new URL(
          'https://assets.vozzify.com/cover-art-archive/release/76df3287-6cda-33eb-8e9a-044b5e15ffdd/front-500',
        ),
      ),
    ).toBe(true);
  });
});
