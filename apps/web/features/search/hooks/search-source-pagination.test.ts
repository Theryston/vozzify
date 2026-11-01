import { InfiniteQueryObserver, QueryClient } from '@tanstack/react-query';
import type { SearchResult } from '@vozzify/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { searchInfiniteQueryOptions } from './use-search-results';

vi.mock('@/lib/env/client', () => ({
  getClientEnv: () => ({ NEXT_PUBLIC_API_URL: 'https://api.test' }),
}));

const fetchMock = vi.fn<typeof fetch>();
const clients: QueryClient[] = [];

beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => {
  for (const client of clients) client.clear();
  clients.length = 0;
});

function response(source: string | undefined, ...titles: string[]) {
  return Response.json({
    source,
    results: titles.map((title, index) => ({
      mbid: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      title,
      artistCredit: 'Artist',
      trackId: null,
      coverUrl: null,
    })),
  });
}

function observer(query = 'song') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  return new InfiniteQueryObserver(
    client,
    searchInfiniteQueryOptions({ query, limit: 2 }),
  );
}

function titles(pages: SearchResult[] | undefined) {
  return pages?.flatMap((page) => page.results.map((item) => item.title));
}

function offsets() {
  return fetchMock.mock.calls.map(([url]) =>
    Number(new URL(String(url)).searchParams.get('offset')),
  );
}

describe('search source pagination', () => {
  it.each([
    ['music-catalog', 'sonic'],
    ['sonic', 'music-catalog'],
  ])('replaces %s with the first ranked page of %s', async (from, to) => {
    fetchMock
      .mockResolvedValueOnce(response(from, 'Old A', 'Old B'))
      .mockResolvedValueOnce(response(to, 'Wrong continuation', 'Wrong rank'))
      .mockResolvedValueOnce(response(to, 'New B', 'New A'))
      .mockResolvedValueOnce(response(to, 'New C'));
    const query = observer();
    const seen: (string[] | undefined)[] = [];
    const unsubscribe = query.subscribe((state) =>
      seen.push(titles(state.data?.pages)),
    );
    await query.refetch();
    const replacement = await query.fetchNextPage();

    expect(titles(replacement.data?.pages)).toEqual(['New B', 'New A']);
    expect(offsets()).toEqual([0, 2, 0]);
    expect(seen.flat()).not.toContain('Wrong continuation');
    const next = await query.fetchNextPage();
    expect(titles(next.data?.pages)).toEqual(['New B', 'New A', 'New C']);
    expect(offsets()).toEqual([0, 2, 0, 2]);
    expect(next.hasNextPage).toBe(false);
    unsubscribe();
  });

  it('compares a refetched sequence with its newly fetched first page', async () => {
    fetchMock
      .mockResolvedValueOnce(response('music-catalog', 'Old A', 'Old B'))
      .mockResolvedValueOnce(response('music-catalog', 'Old C', 'Old D'))
      .mockResolvedValueOnce(response('sonic', 'Sonic B', 'Sonic A'))
      .mockResolvedValueOnce(response('music-catalog', 'Wrong C', 'Wrong D'))
      .mockResolvedValueOnce(
        response('music-catalog', 'Recovered B', 'Recovered A'),
      );
    const query = observer();
    await query.refetch();
    await query.fetchNextPage();
    const refreshed = await query.refetch();

    expect(titles(refreshed.data?.pages)).toEqual([
      'Recovered B',
      'Recovered A',
    ]);
    expect(offsets()).toEqual([0, 2, 0, 2, 0]);
  });

  it('handles a second source flip while restarting without reusing the old offset', async () => {
    fetchMock
      .mockResolvedValueOnce(response('music-catalog', 'Old A', 'Old B'))
      .mockResolvedValueOnce(response('sonic', 'Wrong B', 'Wrong A'))
      .mockResolvedValueOnce(
        response('music-catalog', 'Recovered B', 'Recovered A'),
      )
      .mockResolvedValueOnce(response('music-catalog', 'Recovered C'));
    const query = observer();
    await query.refetch();
    const restarted = await query.fetchNextPage();
    expect(titles(restarted.data?.pages)).toEqual([
      'Recovered B',
      'Recovered A',
    ]);
    const continued = await query.fetchNextPage();
    expect(titles(continued.data?.pages)).toEqual([
      'Recovered B',
      'Recovered A',
      'Recovered C',
    ]);
    expect(offsets()).toEqual([0, 2, 0, 2]);
  });

  it('keeps restarted offsets when refetching more than two cached pages', async () => {
    fetchMock
      .mockResolvedValueOnce(response('music-catalog', 'A', 'B'))
      .mockResolvedValueOnce(response('music-catalog', 'C', 'D'))
      .mockResolvedValueOnce(response('music-catalog', 'E', 'F'))
      .mockResolvedValueOnce(response('music-catalog', 'A', 'B'))
      .mockResolvedValueOnce(response('sonic', 'Wrong E', 'Wrong F'))
      .mockResolvedValueOnce(response('sonic', 'New F', 'New E'))
      .mockResolvedValueOnce(response('sonic', 'New D'));
    const query = observer();
    await query.refetch();
    await query.fetchNextPage();
    await query.fetchNextPage();

    const refreshed = await query.refetch();

    expect(titles(refreshed.data?.pages)).toEqual(['New F', 'New E', 'New D']);
    expect(offsets()).toEqual([0, 2, 4, 0, 2, 0, 2]);
    expect(query.getCurrentResult().hasNextPage).toBe(false);
  });

  it('remembers the known source across a page without metadata', async () => {
    fetchMock
      .mockResolvedValueOnce(response('music-catalog', 'A', 'B'))
      .mockResolvedValueOnce(response(undefined, 'C', 'D'))
      .mockResolvedValueOnce(response('sonic', 'Wrong continuation'))
      .mockResolvedValueOnce(response('sonic', 'Fresh D', 'Fresh C'));
    const query = observer();
    await query.refetch();
    await query.fetchNextPage();

    const restarted = await query.fetchNextPage();

    expect(titles(restarted.data?.pages)).toEqual(['Fresh D', 'Fresh C']);
    expect(offsets()).toEqual([0, 2, 4, 0]);
  });

  it.each([
    [undefined, undefined],
    ['music-catalog', undefined],
    [undefined, 'sonic'],
    ['sonic', 'sonic'],
  ])(
    'continues compatible pages (%s, %s) and stops on a short page',
    async (first, second) => {
      fetchMock
        .mockResolvedValueOnce(response(first, 'A', 'B'))
        .mockResolvedValueOnce(response(second, 'C'));
      const query = observer();
      await query.refetch();
      const result = await query.fetchNextPage();
      expect(titles(result.data?.pages)).toEqual(['A', 'B', 'C']);
      expect(result.hasNextPage).toBe(false);
      expect(offsets()).toEqual([0, 2]);
    },
  );

  it('does not restore an aborted restart after navigating away and back', async () => {
    let finishRestart = (_response: Response) => {};
    const pendingRestart = new Promise<Response>((resolve) => {
      finishRestart = resolve;
    });
    fetchMock
      .mockResolvedValueOnce(response('music-catalog', 'Old A', 'Old B'))
      .mockResolvedValueOnce(response('sonic', 'Wrong continuation'))
      .mockReturnValueOnce(pendingRestart)
      .mockResolvedValueOnce(response('sonic', 'Other query'))
      .mockResolvedValueOnce(response('sonic', 'Fresh result'));
    const query = observer();
    const unsubscribe = query.subscribe(() => {});
    await query.refetch();
    const pending = query.fetchNextPage();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    query.setOptions(searchInfiniteQueryOptions({ query: 'other', limit: 2 }));
    await query.refetch();
    query.setOptions(searchInfiniteQueryOptions({ query: 'song', limit: 2 }));
    await query.refetch();
    finishRestart(response('sonic', 'Discarded stale result'));
    await pending;
    await Promise.resolve();

    expect(titles(query.getCurrentResult().data?.pages)).toEqual([
      'Fresh result',
    ]);
    expect(offsets()).toEqual([0, 2, 0, 0, 0]);
    unsubscribe();
  });

  it('does not restore a discarded sequence after refreshing the same query', async () => {
    let finishRestart = (_response: Response) => {};
    const pendingRestart = new Promise<Response>((resolve) => {
      finishRestart = resolve;
    });
    fetchMock
      .mockResolvedValueOnce(response('music-catalog', 'Old A', 'Old B'))
      .mockResolvedValueOnce(response('sonic', 'Wrong continuation'))
      .mockReturnValueOnce(pendingRestart)
      .mockResolvedValueOnce(response('music-catalog', 'Fresh B', 'Fresh A'));
    const query = observer();
    await query.refetch();
    const pending = query.fetchNextPage();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    await query.refetch({ cancelRefetch: true });
    finishRestart(response('sonic', 'Discarded stale result'));
    await pending;

    expect(titles(query.getCurrentResult().data?.pages)).toEqual([
      'Fresh B',
      'Fresh A',
    ]);
    expect(offsets()).toEqual([0, 2, 0, 0]);
  });
});
