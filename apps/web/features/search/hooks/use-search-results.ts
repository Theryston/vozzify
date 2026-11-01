'use client';

import {
  type InfiniteData,
  infiniteQueryOptions,
  keepPreviousData,
  type QueryFunctionContext,
  replaceEqualDeep,
  useInfiniteQuery,
} from '@tanstack/react-query';
import {
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_OFFSET,
  type SearchResult,
  searchResultSchema,
} from '@vozzify/contracts';
import { browserApi } from '@/lib/api/browser';

import { searchKeys } from '../query-keys';
import { isSearchableQuery, normalizeSearchQuery } from '../search-params';

export type SearchPageParams = {
  query: string;
  limit: number;
  offset: number;
  signal?: AbortSignal;
};

/**
 * One page of the public search (`GET /v1/search`), in catalog rank order.
 * The signal aborts superseded fetches, so stale results never overwrite
 * fresh ones while the user keeps typing.
 */
export function fetchSearchPage({
  query,
  limit,
  offset,
  signal,
}: SearchPageParams): Promise<SearchResult> {
  return browserApi('/search', {
    schema: searchResultSchema,
    query: { query, limit, offset },
    signal,
  });
}

type SearchPage = SearchResult & { offset?: number };
type SearchPages = InfiniteData<SearchPage, number>;

/** Commit only pages following the most recent restart, in one cache update. */
function shareSearchPages(previous: unknown, next: unknown) {
  // TanStack's structural-sharing callback erases the query data type.
  const data = next as SearchPages;
  const start = data.pages.findLastIndex((page) => page.offset === 0);
  const pages = data.pages.slice(Math.max(0, start));
  return replaceEqualDeep(previous, {
    pages,
    pageParams: pages.map(
      (page, index) => page.offset ?? data.pageParams[index],
    ),
  });
}

export type SearchInfiniteInput = {
  query: string;
  limit?: number;
};

// A refetch can visit several pages before committing. Its signal identifies
// that in-flight sequence, whose first source can differ from cached data.
const sequenceSources = new WeakMap<AbortSignal, SearchResult['source']>();

async function fetchSequencePage(
  { query, limit = SEARCH_DEFAULT_LIMIT }: SearchInfiniteInput,
  {
    pageParam,
    signal,
    client,
    queryKey,
  }: QueryFunctionContext<readonly unknown[], number>,
): Promise<SearchPage> {
  const page = await fetchSearchPage({
    query,
    limit,
    offset: pageParam,
    signal,
  });
  signal.throwIfAborted();
  const previous = client.getQueryData<SearchPages>(queryKey);
  const source = sequenceSources.has(signal)
    ? sequenceSources.get(signal)
    : previous?.pages.find((entry) => entry.source)?.source;
  if (pageParam > 0 && source && page.source && source !== page.source) {
    const first = await fetchSearchPage({ query, limit, offset: 0, signal });
    signal.throwIfAborted();
    sequenceSources.set(signal, first.source);
    return { ...first, offset: 0 };
  }
  if (pageParam === 0 || page.source) sequenceSources.set(signal, page.source);
  return { ...page, offset: pageParam };
}

/**
 * Infinite results keyed by query text (the offset travels as the page
 * param). Disabled while blank, so the API only sees queries worth
 * answering.
 */
export function searchInfiniteQueryOptions({
  query,
  limit = SEARCH_DEFAULT_LIMIT,
}: SearchInfiniteInput) {
  const enabled = isSearchableQuery(query);
  return infiniteQueryOptions({
    // While a new query loads, the previous page stays on screen (the grid
    // dims it), so typing never flashes a skeleton over known results.
    placeholderData: keepPreviousData,
    // A disabled query never fetches, but it still needs a stable key: the
    // normalized blank, so every blank spells the same key.
    queryKey: enabled
      ? searchKeys.infiniteResults({ query, limit })
      : ([
          ...searchKeys.all,
          'infinite',
          { query: normalizeSearchQuery(query), limit },
        ] as const),
    queryFn: (context: QueryFunctionContext<readonly unknown[], number>) =>
      fetchSequencePage({ query, limit }, context),
    structuralSharing: shareSearchPages,
    initialPageParam: 0,
    getNextPageParam: (
      lastPage: SearchPage,
      _allPages: SearchPage[],
      lastPageParam: number,
    ) => {
      if (lastPage.results.length < limit) return undefined;
      const nextOffset =
        (lastPage.offset ?? lastPageParam) + lastPage.results.length;
      return nextOffset > SEARCH_MAX_OFFSET ? undefined : nextOffset;
    },
    enabled,
    staleTime: 60 * 1000,
  });
}

/** Realtime results for the search page (infinite scroll over limit/offset). */
export function useSearchResults(input: SearchInfiniteInput) {
  return useInfiniteQuery(searchInfiniteQueryOptions(input));
}
