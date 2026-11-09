import { infiniteQueryOptions, type QueryClient } from '@tanstack/react-query';
import type {
  HomeFeedPage,
  HomeTrack,
  HomeVocalRangeTrack,
  Locale,
} from '@vozzify/contracts';
import type { HomePageRequest } from './home-feed-client';
import { homeQueryKeys } from './query-keys';

export type HomeRowItemsQueryInput = {
  rowId: string;
  cursor: string | null | undefined;
  locale: Locale;
} & (
  | { layout: 'standard'; initialItems: readonly HomeTrack[] }
  | {
      layout: 'vocal-range';
      initialItems: readonly HomeVocalRangeTrack[];
    }
);

export function homeRowItemsQueryOptions(options: HomeRowItemsQueryInput) {
  const { rowId, layout, initialItems, cursor, locale } = options;
  const initialPage =
    layout === 'standard'
      ? { rowId, layout, items: [...initialItems], nextCursor: cursor }
      : { rowId, layout, items: [...initialItems], nextCursor: cursor };
  return infiniteQueryOptions({
    queryKey: homeQueryKeys.rowItems(rowId, cursor),
    queryFn: async ({ pageParam, signal }) => {
      const { fetchHomeRowItemsPage } = await import('./home-row-items-client');
      return fetchHomeRowItemsPage({
        rowId,
        cursor: pageParam,
        locale,
        signal,
      });
    },
    initialPageParam: cursor ?? '',
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    initialData: cursor
      ? {
          pages: [initialPage],
          pageParams: [cursor],
        }
      : undefined,
    enabled: Boolean(cursor),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

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

export async function restartHomeRowsAfterExpiredVisit(
  queryClient: QueryClient,
  locale: Locale,
  initialPage: HomeFeedPage,
  firstPage: HomeFeedPage,
): Promise<void> {
  const verticalKey = homeQueryKeys.rows(locale, initialPage);
  await Promise.all([
    queryClient.cancelQueries({ queryKey: verticalKey, exact: true }),
    queryClient.cancelQueries({ queryKey: homeQueryKeys.rowItemsPrefix() }),
  ]);
  queryClient.removeQueries({ queryKey: homeQueryKeys.rowItemsPrefix() });
  resetHomeRowsAfterExpiredVisit(queryClient, locale, initialPage, firstPage);
}
