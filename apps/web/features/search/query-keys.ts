import { type SearchQuery, searchQuerySchema } from '@vozzify/contracts';

import { SEARCH_SUGGESTIONS_LIMIT } from './search-params';

/**
 * TanStack Query keys for track search. The results key carries the parsed
 * public query, so defaults are applied once and each query text caches
 * separately; the infinite key pages on top of it without the offset (every
 * page shares it, the offset travels as the page param); the suggestions key
 * is the header autocomplete's own key, so its cache never
 * mixes with the search page's.
 */
export const searchKeys = {
  all: ['search'] as const,
  results: (query: SearchQuery) =>
    [...searchKeys.all, searchQuerySchema.parse(query)] as const,
  infiniteResults: (query: SearchQuery) => {
    const parsed = searchQuerySchema.parse(query);
    return [
      ...searchKeys.all,
      'infinite',
      { query: parsed.query, limit: parsed.limit },
    ] as const;
  },
  suggestions: (query: string) => {
    const parsed = searchQuerySchema.parse({
      query,
      limit: SEARCH_SUGGESTIONS_LIMIT,
    });
    return [
      ...searchKeys.all,
      'suggestions',
      { query: parsed.query, limit: parsed.limit },
    ] as const;
  },
};
