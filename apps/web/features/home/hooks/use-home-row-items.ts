'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import type { HomeFeedPage } from '@vozzify/contracts';
import { useCallback, useEffect } from 'react';
import {
  type HomeRowItemsQueryInput,
  homeRowItemsQueryOptions,
} from '../home-rows-query';
import { isHomeVisitRestartError } from '../home-visit-restart';

export function useHomeRowItems(
  options: HomeRowItemsQueryInput & {
    onVisitExpired?: (page: HomeFeedPage) => void;
  },
) {
  const { onVisitExpired, ...queryOptions } = options;
  const query = useInfiniteQuery(homeRowItemsQueryOptions(queryOptions));
  useEffect(() => {
    if (isHomeVisitRestartError(query.error)) {
      onVisitExpired?.(query.error.firstPage);
    }
  }, [onVisitExpired, query.error]);
  const loadMore = useCallback(() => {
    if (
      !query.hasNextPage ||
      query.isFetchingNextPage ||
      query.isFetchNextPageError
    ) {
      return;
    }
    void query.fetchNextPage({ cancelRefetch: false });
  }, [
    query.fetchNextPage,
    query.hasNextPage,
    query.isFetchingNextPage,
    query.isFetchNextPageError,
  ]);
  const retry = useCallback(() => {
    if (!query.hasNextPage || query.isFetchingNextPage) return;
    void query.fetchNextPage({ cancelRefetch: false });
  }, [query.fetchNextPage, query.hasNextPage, query.isFetchingNextPage]);
  return {
    items:
      query.data?.pages.flatMap((page) => page.items) ?? options.initialItems,
    hasMore: query.hasNextPage,
    failed:
      query.isFetchNextPageError ||
      (query.error !== null && !isHomeVisitRestartError(query.error)),
    expired: isHomeVisitRestartError(query.error),
    loadMore,
    retry,
  };
}
