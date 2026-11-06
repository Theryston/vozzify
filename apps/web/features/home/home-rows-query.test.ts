import type { HomeFeedPage } from '@vozzify/contracts';
import { describe, expect, it, vi } from 'vitest';
import { fetchHomeRowsPage, homeRowsQueryOptions } from './home-rows-query';

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
