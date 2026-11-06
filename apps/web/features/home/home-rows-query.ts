import { infiniteQueryOptions, type QueryClient } from '@tanstack/react-query';
import type { HomeFeedPage, Locale } from '@vozzify/contracts';

import type { HomePageRequest } from './home-feed-client';
import { homeQueryKeys } from './query-keys';

/**
 * Fetches one page of rows in the browser. The client module is loaded on
 * the first request, so the schema's Zod stays out of the first-load JS.
 */
export async function fetchHomeRowsPage(
  request: HomePageRequest,
): Promise<HomeFeedPage> {
  const { fetchHomePageInBrowser } = await import('./home-feed-client');
  return fetchHomePageInBrowser(request);
}

/**
 * The home's rows as an infinite query. The server-rendered first page seeds
 * it, so only later pages hit the network. The feed never goes stale on the
 * client: its cursors name one version, and a refetch would replay them.
 */
export function homeRowsQueryOptions(
  locale: Locale,
  initialPage: HomeFeedPage,
) {
  return infiniteQueryOptions({
    queryKey: homeQueryKeys.rows(locale, initialPage),
    queryFn: ({ pageParam, signal }) =>
      fetchHomeRowsPage({ locale, cursor: pageParam, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: HomeFeedPage) =>
      lastPage.nextCursor ?? undefined,
    initialData: { pages: [initialPage], pageParams: [undefined] },
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** Drops expired pages atomically so the replacement first page is not appended. */
export function resetHomeRowsAfterExpiredVisit(
  queryClient: QueryClient,
  locale: Locale,
  initialPage: HomeFeedPage,
  firstPage: HomeFeedPage,
): void {
  queryClient.setQueryData(homeQueryKeys.rows(locale, initialPage), {
    pages: [firstPage],
    pageParams: [undefined],
  });
}
