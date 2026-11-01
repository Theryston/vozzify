import { QueryClient } from '@tanstack/react-query';
import { SEARCH_DEFAULT_LIMIT, SEARCH_MAX_OFFSET } from '@vozzify/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env/client', () => ({
  getClientEnv: () => ({ NEXT_PUBLIC_API_URL: 'https://api.test' }),
}));

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

function searchBody(results: unknown[]) {
  return Response.json({ results });
}

const mbid = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function resultItem(n: number, title: string, trackId: string | null = null) {
  return {
    mbid: mbid(n),
    title,
    artistCredit: 'Artist',
    coverUrl: null,
    trackId,
  };
}

describe('fetchSearchPage', () => {
  it('asks the public endpoint with query and paging, never a scope', async () => {
    fetchMock.mockResolvedValue(searchBody([resultItem(1, 'Song')]));
    const { fetchSearchPage } = await import('./use-search-results');

    const page = await fetchSearchPage({
      query: 'queen',
      limit: 20,
      offset: 20,
    });

    const [input] = fetchMock.mock.lastCall ?? [];
    const url = new URL(String(input));
    expect(url.pathname).toBe('/v1/search');
    expect(url.searchParams.get('query')).toBe('queen');
    expect(url.searchParams.has('scope')).toBe(false);
    expect(url.searchParams.get('limit')).toBe('20');
    expect(url.searchParams.get('offset')).toBe('20');
    expect(page.results).toHaveLength(1);
  });

  it('aborts superseded fetches', async () => {
    fetchMock.mockImplementation(
      (...args: Parameters<typeof fetch>) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = (args[1] as RequestInit | undefined)?.signal;
          if (signal instanceof AbortSignal) {
            signal.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }
        }),
    );
    const { fetchSearchPage } = await import('./use-search-results');
    const controller = new AbortController();

    const pending = fetchSearchPage({
      query: 'queen',
      limit: 20,
      offset: 0,
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('searchInfiniteQueryOptions', () => {
  it('fetches the first page through the query client', async () => {
    fetchMock.mockResolvedValue(searchBody([resultItem(1, 'Song')]));
    const { searchInfiniteQueryOptions } = await import('./use-search-results');
    const queryClient = new QueryClient();

    const data = await queryClient.fetchInfiniteQuery(
      searchInfiniteQueryOptions({ query: 'queen' }),
    );

    expect(data.pages).toHaveLength(1);
    expect(data.pages[0]?.results.map((item) => item.title)).toEqual(['Song']);
  });

  it('stays disabled below 2 non-blank characters', async () => {
    const { searchInfiniteQueryOptions } = await import('./use-search-results');

    expect(searchInfiniteQueryOptions({ query: ' ' })).toMatchObject({
      enabled: false,
    });
    expect(searchInfiniteQueryOptions({ query: 'queen' })).toMatchObject({
      enabled: true,
    });
  });

  it('keys every blank the same while disabled', async () => {
    const { searchInfiniteQueryOptions } = await import('./use-search-results');

    expect(searchInfiniteQueryOptions({ query: ' ' }).queryKey).toEqual(
      searchInfiniteQueryOptions({ query: '   ' }).queryKey,
    );
  });

  it('pages while full pages arrive and stops on a short one', async () => {
    const { searchInfiniteQueryOptions } = await import('./use-search-results');
    const options = searchInfiniteQueryOptions({
      query: 'queen',
      limit: 2,
    });

    const full = { results: [resultItem(1, 'A'), resultItem(2, 'B')] };
    const short = { results: [resultItem(3, 'C')] };
    expect(options.getNextPageParam?.(full, [full], 0, [0])).toBe(2);
    expect(
      options.getNextPageParam?.(short, [full, short], 2, [0, 2]),
    ).toBeUndefined();
  });

  it('does not request an offset beyond the public bound', async () => {
    const { searchInfiniteQueryOptions } = await import('./use-search-results');
    const options = searchInfiniteQueryOptions({ query: 'queen', limit: 2 });
    const page = { results: [resultItem(1, 'A'), resultItem(2, 'B')] };

    expect(
      options.getNextPageParam?.(page, [page], SEARCH_MAX_OFFSET, [
        SEARCH_MAX_OFFSET,
      ]),
    ).toBeUndefined();
  });

  it('uses the default page size in the public request', async () => {
    fetchMock.mockResolvedValue(searchBody([]));
    const { searchInfiniteQueryOptions } = await import('./use-search-results');
    await new QueryClient().fetchInfiniteQuery(
      searchInfiniteQueryOptions({ query: 'queen' }),
    );

    const [input] = fetchMock.mock.lastCall ?? [];
    expect(new URL(String(input)).searchParams.get('limit')).toBe(
      String(SEARCH_DEFAULT_LIMIT),
    );
  });
});
