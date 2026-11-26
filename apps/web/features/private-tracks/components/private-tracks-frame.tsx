import { LockKeyholeIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { AccountPageFrame } from '@/components/account-page-frame';
import { Skeleton } from '@/components/ui/skeleton';

export function PrivateTracksFrame({
  action,
  children,
}: {
  action?: ReactNode;
  children?: ReactNode;
}) {
  const t = useTranslations('privateTracks');
  return (
    <AccountPageFrame
      title={t('title')}
      description={
        <span className="inline-flex items-center gap-2">
          <LockKeyholeIcon aria-hidden="true" className="size-4 shrink-0" />
          {t('description')}
        </span>
      }
      action={action}
    >
      {children}
    </AccountPageFrame>
  );
}

export function PrivateTracksLoading() {
  return (
    <PrivateTracksFrame action={<Skeleton className="h-10 w-full sm:w-44" />}>
      <PrivateTrackRowsSkeleton />
    </PrivateTracksFrame>
  );
}

export function PrivateTrackRowsSkeleton() {
  const t = useTranslations('privateTracks');
  return (
    <div
      role="status"
      className="flex items-center gap-4 rounded-2xl bg-card p-4 shadow-sm"
    >
      <span className="sr-only">{t('loading')}</span>
      <Skeleton className="size-12 shrink-0 rounded-md" />
      <div className="flex w-1/2 max-w-60 flex-col gap-2">
        <Skeleton className="h-4" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  );
}
