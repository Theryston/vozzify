import type { Page, Request, Route } from '@playwright/test';
import type { SearchResult } from '@vozzify/contracts';

// Any host: like the auth routes, the API URL is inlined at build time.
const SEARCH_ROUTE = '**/v1/search**';

type SearchMockItem = {
  title: string;
  artist: string;
  trackId: string | null;
};

const mbidOf = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** One hit in the shape of the public search contract (art omitted). */
function resultBody(item: SearchMockItem, index: number) {
  return {
    mbid: mbidOf(index + 1),
    title: item.title,
    artistCredit: item.artist,
    coverUrl: null,
    trackId: item.trackId,
  };
}

export type SearchMockState = {
  source?: SearchResult['source'];
  sourceOnNextPage?: SearchResult['source'];
  reverseResults: boolean;
  /** Every search request the page made, in order. */
  calls: Request[];
  /** Added latency per reply, so the loading skeleton can be seen. */
  delayMs: number;
  /** When true, every reply is a retryable 503 like a catalog outage. */
  shouldFail: boolean;
  /** When true, every query answers no matches. */
  emptyResults: boolean;
  /** How many hits exist in total (paged over limit plus offset). */
  totalCount: number;
  /** The first hit: processed, so its card links to the Track page. */
  linked: SearchMockItem;
  /** The second hit: not processed, so its card stays static. */
  unlinked: SearchMockItem;
};

/** Every hit the mock knows, with the linked and unlinked cards first. */
function allHits(state: SearchMockState): SearchMockItem[] {
  if (state.emptyResults) return [];
  const hits = Array.from({ length: state.totalCount }, (_, index) => {
    if (index === 0) return state.linked;
    if (index === 1) return state.unlinked;
    return {
      title: `Song ${index + 1}`,
      artist: `Artist ${index + 1}`,
      trackId: null,
    };
  });
  return state.reverseResults ? hits.reverse() : hits;
}

type MockReply = { status: number; body: unknown };

/** The reply for a search request: a retryable outage or one page of hits. */
function searchReply(state: SearchMockState, request: Request): MockReply {
  if (state.shouldFail) {
    return {
      status: 503,
      body: {
        statusCode: 503,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Catalog not ready',
      },
    };
  }
  const url = new URL(request.url());
  const offset = Number(url.searchParams.get('offset') ?? 0);
  const limit = Number(url.searchParams.get('limit') ?? 20);
  if (offset > 0 && state.sourceOnNextPage) {
    state.source = state.sourceOnNextPage;
    state.sourceOnNextPage = undefined;
    state.reverseResults = true;
  }
  const results = allHits(state)
    .slice(offset, offset + limit)
    .map((item, position) => resultBody(item, offset + position));
  return { status: 200, body: { results, source: state.source } };
}

/** The CORS headers the real API sends, so the browser accepts the reply. */
export function corsHeaders(request: Request): Record<string, string> {
  return {
    'access-control-allow-origin': request.headers().origin ?? '*',
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers':
      request.headers()['access-control-request-headers'] ?? '',
    'access-control-allow-methods': 'GET, OPTIONS',
    'content-type': 'application/json',
  };
}

/**
 * Serves the public search (`GET /v1/search`) with contract-shaped payloads,
 * paged over limit plus offset like the real API. Tests flip `shouldFail`,
 * `emptyResults`, `delayMs` or `totalCount` on the returned state; the route
 * reads it live, so error-then-retry needs no re-registration.
 */
export async function mockSearchApi(
  page: Page,
  overrides: Partial<SearchMockState> = {},
): Promise<SearchMockState> {
  const state: SearchMockState = {
    calls: [],
    reverseResults: false,
    delayMs: 0,
    shouldFail: false,
    emptyResults: false,
    totalCount: 2,
    linked: {
      title: 'Bohemian Rhapsody',
      artist: 'Queen',
      trackId: 'clxlinkedtrack01',
    },
    unlinked: {
      title: 'Unreleased Demo',
      artist: 'Unknown Artist',
      trackId: null,
    },
    ...overrides,
  };

  await page.route(SEARCH_ROUTE, async (route: Route) => {
    const request = route.request();
    const headers = corsHeaders(request);
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }
    state.calls.push(request);
    const reply = searchReply(state, request);
    if (state.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, state.delayMs));
    }
    try {
      await route.fulfill({
        status: reply.status,
        headers,
        body: JSON.stringify(reply.body),
      });
    } catch {
      // The fetch was superseded while delaying (the user kept typing): its
      // abort already settled the request, so there is nothing to fulfill.
    }
  });
  return state;
}

/** The `query`, `scope`, `limit` and `offset` a search request carried. */
export function searchParamsOf(request: Request): Record<string, string> {
  const url = new URL(request.url());
  return {
    query: url.searchParams.get('query') ?? '',
    scope: url.searchParams.get('scope') ?? '',
    limit: url.searchParams.get('limit') ?? '',
    offset: url.searchParams.get('offset') ?? '',
  };
}
