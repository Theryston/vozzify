/** A blank query never hits the API (fast feedback, no spam). */
export const SEARCH_MIN_QUERY_LENGTH = 1;

/** How long typing waits before the URL (and the fetch) updates. */
export const SEARCH_DEBOUNCE_MS = 230;

/** How many Recordings the header autocomplete asks for. */
export const SEARCH_SUGGESTIONS_LIMIT = 20;

/**
 * What the user typed, without leading/trailing blanks and with runs of
 * whitespace collapsed, so `q` in the URL and the API query stay canonical.
 */
export function normalizeSearchQuery(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

/** Whether the query is worth a request (at least 1 non-blank character). */
export function isSearchableQuery(value: string): boolean {
  return normalizeSearchQuery(value).length >= SEARCH_MIN_QUERY_LENGTH;
}
