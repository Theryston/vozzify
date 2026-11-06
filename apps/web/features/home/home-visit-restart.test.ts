import type { HomeFeedPage } from '@vozzify/contracts';
import { describe, expect, it, vi } from 'vitest';
import { fetchHomePageInBrowser } from './home-feed-client';
import { HomeVisitRestartError } from './home-visit-restart';

const browserApi = vi.fn();

vi.mock('@/lib/api/browser', () => ({
  browserApi: (...args: unknown[]) => browserApi(...args),
}));

const page = (version: string): HomeFeedPage => ({
  audience: 'public',
  version,
  algorithmVersion: 1,
  rows: [],
  nextCursor: null,
});

describe('expired Home visits', () => {
  it('fetches page one and raises a reset carrying the fresh first page', async () => {
    const fresh = page('fresh-version-123');
    browserApi
      .mockRejectedValueOnce({
        statusCode: 404,
        code: 'NOT_FOUND',
        details: { reason: 'FEED_VERSION_EXPIRED' },
      })
      .mockResolvedValueOnce(fresh);

    const error = await fetchHomePageInBrowser({
      locale: 'en',
      cursor: 'expired.6',
      signal: new AbortController().signal,
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(HomeVisitRestartError);
    expect(error).toMatchObject({ firstPage: fresh });
    expect(browserApi).toHaveBeenCalledTimes(2);
    expect(browserApi.mock.calls[1]?.[1]).toMatchObject({
      query: { locale: 'en', cursor: undefined },
    });
  });

  it('does not turn unrelated errors into a visit restart', async () => {
    const unavailable = {
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
      details: { reason: 'CATALOG_UNAVAILABLE' },
    };
    browserApi.mockRejectedValueOnce(unavailable);

    await expect(
      fetchHomePageInBrowser({
        locale: 'en',
        cursor: 'cursor.6',
        signal: new AbortController().signal,
      }),
    ).rejects.toBe(unavailable);
    expect(browserApi).toHaveBeenCalledTimes(1);
  });
});
