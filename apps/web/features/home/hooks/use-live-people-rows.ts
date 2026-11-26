'use client';

import { type InfiniteData, useQueries } from '@tanstack/react-query';
import {
  type HomeFeedPage,
  type Locale,
  refreshHomePeopleRow,
} from '@vozzify/contracts';
import { fetchHomeRowsPage } from '../home-rows-query';
import { isHomeVisitRestartError } from '../home-visit-restart';
import { homeQueryKeys } from '../query-keys';

/** Only pages containing people need fresh identities during an open visit. */
export function useLivePeopleRows(
  locale: Locale,
  feed: InfiniteData<HomeFeedPage>,
) {
  const latest = useQueries({
    queries: feed.pages.map((page, index) => {
      const pageParam = feed.pageParams[index];
      const cursor = typeof pageParam === 'string' ? pageParam : undefined;
      return {
        queryKey: [
          ...homeQueryKeys.rows(locale, page),
          'people',
          cursor ?? null,
        ],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          fetchHomeRowsPage({ locale, cursor, signal }),
        enabled: page.rows.some((row) => row.layout === 'people'),
        initialData: page,
        staleTime: 60_000,
        refetchInterval: 60_000,
        retry: false,
      };
    }),
  });
  return feed.pages.flatMap((page, index) => {
    const result = latest[index];
    const refreshed = isHomeVisitRestartError(result?.error)
      ? result.error.firstPage
      : (result?.data ?? page);
    // The visit owns ordering and pagination. Only replace matching People rows.
    return page.rows.flatMap((row) => {
      if (row.layout !== 'people' || refreshed === page) return [row];
      if (refreshed.audience !== page.audience) return [];
      const current = refreshed.rows.find(
        (candidate) => candidate.layout === 'people' && candidate.id === row.id,
      );
      const live = refreshHomePeopleRow(
        row,
        current?.layout === 'people' ? current : undefined,
      );
      return live ? [live] : [];
    });
  });
}
