// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchKeys } from '../query-keys';
import { SEARCH_DEBOUNCE_MS } from '../search-params';
import { searchInfiniteQueryOptions } from './use-search-results';
import {
  searchSuggestionsQueryOptions,
  useSearchSuggestions,
} from './use-search-suggestions';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/lib/env/client', () => ({
  getClientEnv: () => ({ NEXT_PUBLIC_API_URL: 'https://api.test' }),
}));

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

describe('searchSuggestionsQueryOptions', () => {
  it('asks the public endpoint for a limit of 20', async () => {
    fetchMock.mockResolvedValue(Response.json({ results: [] }));
    const queryClient = new QueryClient();

    await queryClient.fetchQuery(
      searchSuggestionsQueryOptions({ query: 'queen' }),
    );

    const [input] = fetchMock.mock.lastCall ?? [];
    const url = new URL(String(input));
    expect(url.pathname).toBe('/v1/search');
    expect(url.searchParams.get('query')).toBe('queen');
    expect(url.searchParams.has('scope')).toBe(false);
    expect(url.searchParams.get('limit')).toBe('20');
    expect(url.searchParams.get('offset')).toBe('0');
  });

  it('keys suggestions apart from the infinite results', async () => {
    const options = searchSuggestionsQueryOptions({ query: 'queen' });

    expect(options.queryKey).toEqual([
      'search',
      'suggestions',
      { query: 'queen', limit: 20 },
    ]);
    expect(options.queryKey).toEqual(searchKeys.suggestions('queen'));
    expect(options.queryKey).not.toEqual(
      searchInfiniteQueryOptions({
        query: 'queen',
        limit: 20,
      }).queryKey,
    );
  });

  it('stays disabled while the query is not searchable', async () => {
    expect(searchSuggestionsQueryOptions({ query: ' ' })).toMatchObject({
      enabled: false,
    });
    expect(searchSuggestionsQueryOptions({ query: '' })).toMatchObject({
      enabled: false,
    });
    expect(searchSuggestionsQueryOptions({ query: 'queen' })).toMatchObject({
      enabled: true,
    });
  });

  it('keys every blank the same while disabled', async () => {
    const blank = searchSuggestionsQueryOptions({ query: ' ' }).queryKey;
    const blanker = searchSuggestionsQueryOptions({ query: '   ' }).queryKey;

    expect(blank).toEqual(blanker);
    expect(blank).toEqual(['search', 'suggestions', { query: '', limit: 20 }]);
  });

  it('fetches on the shared debounce with the latest query', async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockResolvedValue(Response.json({ results: [] }));
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });

      function Harness({ query }: { query: string }) {
        useSearchSuggestions(query);
        return null;
      }

      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);
      try {
        const renderQuery = (query: string) =>
          act(async () => {
            root.render(
              createElement(
                QueryClientProvider,
                { client },
                createElement(Harness, { query }),
              ),
            );
          });

        await renderQuery('');
        await renderQuery('q');
        await renderQuery('qu');
        await renderQuery('queen');

        // Rapid typing stays inside the shared debounce: nothing fetched.
        await act(async () => {
          await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 1);
        });
        expect(fetchMock).not.toHaveBeenCalled();

        // The debounce elapses: a single fetch with the latest query.
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1);
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [input] = fetchMock.mock.lastCall ?? [];
        expect(new URL(String(input)).searchParams.get('query')).toBe('queen');
      } finally {
        await act(async () => {
          root.unmount();
        });
        container.remove();
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
