'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import type { PracticeAttemptHistoryPage } from '@vozzify/contracts';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { SessionUserBoundary } from '@/features/auth/components/session-user';

import { practiceHistoryQueryOptions } from '../practice-history-query';
import { useBrowserTimeZone } from '../use-browser-time-zone';
import { PracticeHistoryDays } from './practice-history-days';
import { PracticeHistoryRowSkeletons } from './practice-history-row-skeletons';

type PracticeHistoryListProps = {
  username: string;
  initialPage?: PracticeAttemptHistoryPage;
  owner?: boolean;
};

/**
 * The Profile's practice history: runs grouped by day in the viewer's time
 * zone, newest first, with "Show more" for each next page. The server's first
 * page is known at once, but the grouping needs the viewer's time zone, which
 * only the browser has. Until then the list shows stand-in rows of the same
 * height, so the grouped list does not push the page around, and "Show more"
 * waits for the same moment, so a click is never lost before hydration.
 */
export function PracticeHistoryList({
  username,
  initialPage,
  owner,
}: PracticeHistoryListProps) {
  if (!owner)
    return (
      <PracticeHistoryPages username={username} initialPage={initialPage} />
    );
  return (
    <SessionUserBoundary
      render={(user, loading) => {
        if (loading)
          return (
            <PracticeHistoryRowSkeletons rows={initialPage?.items ?? []} />
          );
        if (user?.username !== username) return null;
        return (
          <PracticeHistoryPages
            username={username}
            initialPage={initialPage}
            owner
          />
        );
      }}
    />
  );
}

function PracticeHistoryPages({
  username,
  initialPage,
  owner,
}: PracticeHistoryListProps) {
  const t = useTranslations('profileHistory');
  const timeZone = useBrowserTimeZone();
  const query = useInfiniteQuery(
    practiceHistoryQueryOptions({ username, initialPage, owner }),
  );

  if (query.isPending) {
    return (
      <p role="status" className="text-muted-foreground text-sm">
        {t('loading')}
      </p>
    );
  }
  if (query.error) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3">
        <p className="text-sm">{t('error')}</p>
        <Button variant="outline" onClick={() => void query.refetch()}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  const attempts = query.data.pages.flatMap((page) => page.items);
  if (attempts.length === 0) {
    return <p className="text-muted-foreground text-sm">{t('empty')}</p>;
  }

  if (timeZone === undefined) {
    // The runs are known; only their grouping waits for the time zone.
    return <PracticeHistoryRowSkeletons rows={attempts} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <PracticeHistoryDays attempts={attempts} timeZone={timeZone} />
      {query.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {t('showMore')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
