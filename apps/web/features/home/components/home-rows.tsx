'use client';

import { useQueryClient } from '@tanstack/react-query';
import type { HomeFeedPage, Locale } from '@vozzify/contracts';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { AdvertisingProvider } from '@/features/advertising/components/advertising-provider';
import type { AdsenseConfig } from '@/lib/env/adsense-config';
import {
  fetchHomeRowsPage,
  restartHomeRowsAfterExpiredVisit,
} from '../home-rows-query';
import { isHomeVisitRestartError } from '../home-visit-restart';
import { useHomeRows } from '../hooks/use-home-rows';
import { HomeFeedRows } from './home-feed-rows';
import { CarouselRowSkeleton } from './home-feed-skeleton';

const SENTINEL_MARGIN = '600px';

// The tracker only observes row visibility and posts event batches: it
// renders nothing and runs on the client only, so it loads after the page
// to keep the home inside the bundle budget. Accepted gap: rows seen (or
// cards clicked) before the chunk loads are never reported — the first
// impression timer only starts once the tracker runs.
const HomeEventsTracker = dynamic(
  () =>
    import('../events/home-events-tracker').then(
      (module) => module.HomeEventsTracker,
    ),
  { ssr: false },
);

/**
 * The rows of the home, in feed order, with the next pages loaded as the
 * visitor scrolls. Each row renders through the layout registry inside a
 * wrapper carrying the row id, so the tracker reads it from one place
 * whatever the layout is; the layouts only mark their cards. The first
 * visible row is the only one whose images load eagerly.
 */
export function HomeRows({
  locale,
  initialPage,
  advertising,
}: {
  locale: Locale;
  initialPage: HomeFeedPage;
  advertising?: AdsenseConfig;
}) {
  const {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = useHomeRows(locale, initialPage);
  const queryClient = useQueryClient();
  const rows = data.pages.flatMap((page) => page.rows);
  const stableAdvertising = useStableAdvertisingConfig(advertising);

  useEffect(() => {
    if (!isHomeVisitRestartError(error)) return;
    void restartHomeRowsAfterExpiredVisit(
      queryClient,
      locale,
      initialPage,
      error.firstPage,
    );
  }, [error, initialPage, locale, queryClient]);
  const loadMore = useCallback(() => {
    void fetchNextPage();
  }, [fetchNextPage]);
  const restartVisit = useCallback(
    async (expiredPage?: HomeFeedPage) => {
      const firstPage =
        expiredPage ??
        (await fetchHomeRowsPage({
          locale,
          cursor: undefined,
          signal: new AbortController().signal,
        }));
      await restartHomeRowsAfterExpiredVisit(
        queryClient,
        locale,
        initialPage,
        firstPage,
      );
    },
    [initialPage, locale, queryClient],
  );
  const onVisitExpired = useCallback(
    (expiredPage: HomeFeedPage) => void restartVisit(expiredPage),
    [restartVisit],
  );

  return (
    <AdvertisingProvider config={stableAdvertising}>
      <div className="flex flex-col gap-8">
        <HomeEventsTracker pages={data.pages} locale={locale} />
        <HomeFeedRows
          rows={rows}
          locale={locale}
          onVisitExpired={onVisitExpired}
          advertising={stableAdvertising}
        />
        {isFetchingNextPage ? <CarouselRowSkeleton /> : null}
        {isFetchNextPageError ? <LoadMoreError onRetry={loadMore} /> : null}
        {hasNextPage && !isFetchNextPageError ? (
          <LoadMoreSentinel active={!isFetchingNextPage} onVisible={loadMore} />
        ) : null}
      </div>
    </AdvertisingProvider>
  );
}

function useStableAdvertisingConfig(config?: AdsenseConfig) {
  const client = config?.client;
  const slot = config?.slot;
  const layoutKey = config?.layoutKey;
  const cmpUrl = config?.cmpUrl;
  return useMemo(() => {
    if (!client || !slot || !layoutKey || !cmpUrl) return undefined;
    return { client, slot, layoutKey, cmpUrl };
  }, [client, cmpUrl, layoutKey, slot]);
}

/** Fires once the marker nears the viewport, so the next rows load ahead of the scroll. */
function LoadMoreSentinel({
  active,
  onVisible,
}: {
  active: boolean;
  onVisible: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const marker = ref.current;
    if (!marker || !active) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onVisible();
      },
      { rootMargin: SENTINEL_MARGIN },
    );
    observer.observe(marker);
    return () => observer.disconnect();
  }, [active, onVisible]);

  return <div ref={ref} aria-hidden="true" className="h-px" />;
}

function LoadMoreError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('home.feed');
  return (
    <div role="alert" className="flex flex-col items-start gap-3">
      <p className="text-muted-foreground text-sm">{t('loadMoreError')}</p>
      <Button type="button" variant="outline" onClick={onRetry}>
        {t('retry')}
      </Button>
    </div>
  );
}
