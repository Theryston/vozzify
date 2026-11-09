import { InfiniteQueryObserver, QueryClient } from '@tanstack/react-query';
import type { HomeFeedPage } from '@vozzify/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  fetchHomeRowsPage,
  homeRowItemsQueryOptions,
  homeRowsQueryOptions,
  resetHomeRowsAfterExpiredVisit,
  restartHomeRowsAfterExpiredVisit,
} from './home-rows-query';

const { browserApiMock } = vi.hoisted(() => ({ browserApiMock: vi.fn() }));

vi.mock('@/lib/api/browser', () => ({
  browserApi: (...args: unknown[]) => browserApiMock(...args),
}));

const fetchHomePageInBrowser = vi.fn();

vi.mock('./home-feed-client', () => ({
  fetchHomePageInBrowser: (...args: unknown[]) =>
    fetchHomePageInBrowser(...args),
}));

const page = (nextCursor: string | null): HomeFeedPage => ({
  audience: 'public',
  version: 'a1b2c3d4e5f60718',
  algorithmVersion: 1,
  rows: [],
  nextCursor,
});

const personalFallbackPage = (
  version: string,
  userId: string,
): HomeFeedPage => ({
  ...page(null),
  audience: 'personal',
  version,
  rows: [
    {
      id: 'social-friends',
      layout: 'people',
      title: { key: 'home.rows.newTracks', params: {} },
      items: [
        {
          id: `profile-${userId}`,
          username: userId,
          name: userId,
          image: null,
          commonTracks: 1,
        },
      ],
    },
  ],
});

describe('fetchHomeRowsPage', () => {
  it('fetches the page of its locale with the cursor it was given', async () => {
    const next = page(null);
    const signal = new AbortController().signal;
    fetchHomePageInBrowser.mockResolvedValue(next);

    const result = await fetchHomeRowsPage({
      locale: 'pt-BR',
      cursor: 'cursor-2',
      signal,
    });

    expect(result).toBe(next);
    expect(fetchHomePageInBrowser).toHaveBeenCalledWith({
      locale: 'pt-BR',
      cursor: 'cursor-2',
      signal,
    });
  });
});

describe('homeRowsQueryOptions', () => {
  it('keys the rows by locale, so each feed has its own cache entry', () => {
    expect(homeRowsQueryOptions('en', page(null)).queryKey).toEqual([
      'home',
      'rows',
      'en',
      'public',
      'a1b2c3d4e5f60718',
    ]);
    expect(homeRowsQueryOptions('pt-BR', page(null)).queryKey).toEqual([
      'home',
      'rows',
      'pt-BR',
      'public',
      'a1b2c3d4e5f60718',
    ]);
  });

  it('seeds the query with the server-rendered first page', () => {
    const first = page('cursor-2');

    expect(homeRowsQueryOptions('en', first).initialData).toEqual({
      pages: [first],
      pageParams: [undefined],
    });
  });

  it('keeps personal fallback pages separate in a QueryClient reused after sign-out', () => {
    const client = new QueryClient();
    const pageA = personalFallbackPage('0a0a0a0a0a0a0a0a', 'alice');
    const pageB = personalFallbackPage('0b0b0b0b0b0b0b0b', 'bob');
    const keyA = homeRowsQueryOptions('en', pageA).queryKey;
    const keyB = homeRowsQueryOptions('en', pageB).queryKey;
    client.setQueryData(keyA, { pages: [pageA], pageParams: [undefined] });

    expect(client.getQueryData(keyB)).toBeUndefined();
    expect(client.getQueryData(keyA)).toMatchObject({ pages: [pageA] });
  });

  it('never goes stale on the client, so a refetch cannot replay old cursors', () => {
    expect(homeRowsQueryOptions('en', page(null)).staleTime).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it('fetches each page with the cursor the query passes it', async () => {
    const next = page(null);
    const signal = new AbortController().signal;
    fetchHomePageInBrowser.mockResolvedValue(next);
    const { queryFn } = homeRowsQueryOptions('en', page('cursor-2'));
    const fetchPage = queryFn as (context: {
      pageParam: string | undefined;
      signal: AbortSignal;
    }) => Promise<HomeFeedPage>;

    await expect(fetchPage({ pageParam: 'cursor-2', signal })).resolves.toBe(
      next,
    );
    expect(fetchHomePageInBrowser).toHaveBeenCalledWith({
      locale: 'en',
      cursor: 'cursor-2',
      signal,
    });
  });

  it('pages on with the cursor of the last page, and stops at the last one', () => {
    const { getNextPageParam } = homeRowsQueryOptions('en', page(null));

    expect(getNextPageParam(page('cursor-2'), [], undefined, [])).toBe(
      'cursor-2',
    );
    expect(getNextPageParam(page(null), [], undefined, [])).toBeUndefined();
  });
});

describe('homeRowItemsQueryOptions', () => {
  it('leaves transient page failures for the explicit Retry action', () => {
    expect(
      homeRowItemsQueryOptions({
        rowId: 'row-1',
        layout: 'standard',
        initialItems: [],
        cursor: 'opaque-cursor',
        locale: 'en',
      }).retry,
    ).toBe(false);
  });

  it('seeds the first horizontal page and resumes from its opaque cursor', () => {
    const items = [
      {
        id: 'track-1',
        title: 'Track 1',
        coverUrl: null,
        artistCredit: [],
        durationMs: null,
        vocalRange: null,
      },
    ];
    const options = homeRowItemsQueryOptions({
      rowId: 'row-1',
      layout: 'standard',
      initialItems: items,
      cursor: 'opaque-cursor',
      locale: 'pt-BR',
    });

    expect(options.initialData).toMatchObject({
      pages: [
        {
          rowId: 'row-1',
          layout: 'standard',
          items,
          nextCursor: 'opaque-cursor',
        },
      ],
    });
  });

  it('fetches a bounded page through the row URL', async () => {
    const page = {
      rowId: 'row-1',
      layout: 'standard' as const,
      items: [
        {
          id: 'track-1',
          title: 'Track 1',
          coverUrl: null,
          artistCredit: [],
          durationMs: null,
          vocalRange: null,
        },
      ],
      nextCursor: null,
    };
    browserApiMock.mockResolvedValue(page);
    const { queryFn } = homeRowItemsQueryOptions({
      rowId: 'row-1',
      layout: 'standard',
      initialItems: [],
      cursor: 'cursor-12',
      locale: 'en',
    });

    await expect(
      (
        queryFn as (context: {
          pageParam: string;
          signal: AbortSignal;
        }) => Promise<unknown>
      )({
        pageParam: 'cursor-12',
        signal: new AbortController().signal,
      }),
    ).resolves.toBe(page);
    expect(browserApiMock).toHaveBeenCalledWith(
      '/home/rows/row-1/items',
      expect.objectContaining({ query: { cursor: 'cursor-12' } }),
    );
  });
});

describe('resetHomeRowsAfterExpiredVisit', () => {
  it('replaces the vertical pages with the fresh first page', () => {
    const client = new QueryClient();
    const oldPage = page('vertical-2');
    const freshPage = { ...page(null), version: 'b1b2b3b4b5b6b7b8' };
    const key = homeRowsQueryOptions('en', oldPage).queryKey;
    client.setQueryData(key, {
      pages: [oldPage, page('vertical-3')],
      pageParams: [undefined, 'vertical-2'],
    });

    resetHomeRowsAfterExpiredVisit(client, 'en', oldPage, freshPage);

    expect(client.getQueryData(key)).toEqual({
      pages: [freshPage],
      pageParams: [undefined],
    });
  });

  it('cancels an in-flight vertical page before clearing horizontal pages', async () => {
    const client = new QueryClient();
    const oldPage = page('vertical-2');
    const freshPage = { ...page(null), version: 'b1b2b3b4b5b6b7b8' };
    const options = homeRowsQueryOptions('en', oldPage);
    let resolveOld: ((value: HomeFeedPage) => void) | undefined;
    const pendingOldPage = new Promise<HomeFeedPage>((resolve) => {
      resolveOld = resolve;
    });
    const observer = new InfiniteQueryObserver(client, {
      ...options,
      queryFn: () => pendingOldPage,
    });
    client.setQueryData(['home', 'row-items', 'row-1', 'items-12'], {
      pages: [],
      pageParams: [],
    });
    const pendingFetch = observer.getCurrentResult().fetchNextPage();
    await vi.waitFor(() => expect(resolveOld).toBeTypeOf('function'));

    await restartHomeRowsAfterExpiredVisit(client, 'en', oldPage, freshPage);
    resolveOld?.(page('vertical-3'));
    await pendingFetch;

    expect(client.getQueryData(options.queryKey)).toEqual({
      pages: [freshPage],
      pageParams: [undefined],
    });
    expect(
      client.getQueryData(['home', 'row-items', 'row-1', 'items-12']),
    ).toBeUndefined();
    observer.destroy();
  });
});
