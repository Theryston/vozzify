'use client';

import {
  keepPreviousData,
  queryOptions,
  useQuery,
} from '@tanstack/react-query';
import { searchKeys } from '../query-keys';
import {
  isSearchableQuery,
  normalizeSearchQuery,
  SEARCH_SUGGESTIONS_LIMIT,
} from '../search-params';
import { useDebouncedQuery } from './use-debounced-query';
import { fetchSearchPage } from './use-search-results';

/**
 * Header autocomplete options: the public search with its own limit, in
 * the order the search engine ranked them. Its own key keeps the suggestions
 * cache apart from the search page's infinite one. Disabled while the query is not
 * searchable, so a blank field never hits the API; while a new query loads,
 * the previous suggestions stay on screen (no flicker).
 */
export function searchSuggestionsQueryOptions({ query }: { query: string }) {
  const enabled = isSearchableQuery(query);
  return queryOptions({
    // A disabled query never fetches, but it still needs a stable key: the
    // normalized blank, so every blank spells the same key.
    queryKey: enabled
      ? searchKeys.suggestions(query)
      : ([
          ...searchKeys.all,
          'suggestions',
          {
            query: normalizeSearchQuery(query),
            limit: SEARCH_SUGGESTIONS_LIMIT,
          },
        ] as const),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchSearchPage({
        query,
        limit: SEARCH_SUGGESTIONS_LIMIT,
        offset: 0,
        signal,
      }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  });
}

/**
 * Live suggestions for the header field. The raw input is debounced with the
 * shared search debounce, so suggestions feel live without hitting the API
 * on every keystroke.
 */
export function useSearchSuggestions(query: string) {
  const debouncedQuery = useDebouncedQuery(query);
  return useQuery(searchSuggestionsQueryOptions({ query: debouncedQuery }));
}
