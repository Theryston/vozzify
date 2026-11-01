import { z } from 'zod';
import {
  recordingSummarySchema,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_LIMIT,
  SEARCH_MAX_OFFSET,
  SEARCH_MAX_QUERY_LENGTH,
} from './music-catalog-search.js';

// The public track search: what the web sends the API and what the API
// answers. The query mirrors the Music catalog payload semantics (same
// defaults and bounds), so the API forwards it as-is. The Music catalog owns
// the Track ID association in each compact result. Never redeclare these
// shapes in an app: import them from here.

// Limits arrive as HTTP query params (strings), so they coerce; the catalog
// payload takes real numbers over the WebSocket.
export const searchQuerySchema = z.object({
  query: z.string().trim().min(1).max(SEARCH_MAX_QUERY_LENGTH),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(SEARCH_MAX_LIMIT)
    .default(SEARCH_DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).max(SEARCH_MAX_OFFSET).default(0),
});

/** What a client sends: the fields with a default may be left out. */
export type SearchQuery = z.input<typeof searchQuerySchema>;

/** The query as the API reads it, with every default applied. */
export type SearchQueryParams = z.output<typeof searchQuerySchema>;

/**
 * One compact search hit. `trackId` is
 * the catalog's optional Track link; the web renders a static card when it
 * is null.
 */
export const searchResultItemSchema = recordingSummarySchema;

export type SearchResultItem = z.infer<typeof searchResultItemSchema>;

/** The matches, best first: the order the search engine ranked them in. */
export const searchResultSchema = z.object({
  results: z.array(searchResultItemSchema),
  source: z.enum(['music-catalog', 'sonic']).optional(),
});

export type SearchResult = z.infer<typeof searchResultSchema>;
