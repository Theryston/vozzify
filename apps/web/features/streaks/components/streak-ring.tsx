'use client';

import { useQuery } from '@tanstack/react-query';
import type { StreakStatus } from '@vozzify/contracts';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { buttonVariants } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { SessionUserBoundary } from '@/features/auth/components/session-user';
import { Link, usePathname } from '@/lib/i18n/navigation';
import { cn } from '@/lib/utils';

import { useStreakHeartbeat } from '../hooks/use-streak-heartbeat';
import { remainingParts, ringProgress } from '../ring-math';
import { streakStatusQueryOptions } from '../streak-queries';
import { StreakCelebration } from './streak-celebration';
import { StreakCelebrationToast } from './streak-celebration-toast';
import { StreakRingGraphic } from './streak-ring-graphic';
import { StreakRingSkeleton } from './streak-ring-skeleton';

const TRIGGER_CLASS = cn(
  buttonVariants({ variant: 'ghost', size: 'icon' }),
  'shrink-0 rounded-full p-0 md:w-auto md:gap-2 md:pr-3',
);

/** What a visitor sees on the ring: an invite to create an account. */
function VisitorRing() {
  const t = useTranslations('streaks');
  const pathname = usePathname();

  return (
    <Popover>
      <PopoverTrigger
        aria-label={t('inviteRing')}
        title={t('inviteRing')}
        className={TRIGGER_CLASS}
      >
        <StreakRingGraphic progress={0} completed={false} muted />
        <span className="hidden md:inline">{t('practiceLabel')}</span>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" sideOffset={12}>
        <PopoverTitle className="font-semibold">
          {t('inviteTitle')}
        </PopoverTitle>
        <PopoverDescription>{t('inviteDescription')}</PopoverDescription>
        <div className="flex flex-wrap gap-2">
          <Link
            href={{ pathname: '/sign-up', query: { redirectTo: pathname } }}
            className={buttonVariants()}
          >
            {t('inviteCreate')}
          </Link>
          <Link
            href={{ pathname: '/sign-in', query: { redirectTo: pathname } }}
            className={buttonVariants({ variant: 'ghost' })}
          >
            {t('inviteSignIn')}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function StreakDetails({ status }: { status: StreakStatus }) {
  const t = useTranslations('streaks');
  const left = remainingParts(status.listenedSeconds, status.targetSeconds);

  return (
    <>
      <PopoverTitle className="font-extrabold text-xl tracking-tight">
        {t('days', { days: status.currentStreakDays })}
      </PopoverTitle>
      <PopoverDescription className="font-medium text-foreground">
        {status.completedToday
          ? t('reached')
          : t('remaining', { minutes: left.minutes, seconds: left.seconds })}
      </PopoverDescription>
      <p className="text-muted-foreground text-xs">
        {t('goal', { minutes: Math.round(status.targetSeconds / 60) })}
      </p>
      <p className="text-muted-foreground text-xs">{t('countsWhilePlaying')}</p>
    </>
  );
}

/** The signed-in User's ring: today's practice, counted while `singing`. */
function UserRing({
  singing,
  account,
  viewId,
  privateTrackId,
}: {
  singing: boolean;
  account: string;
  viewId?: () => string | undefined;
  privateTrackId?: string;
}) {
  const t = useTranslations('streaks');
  const status = useQuery(streakStatusQueryOptions(account));
  const [burst, setBurst] = useState(0);
  const celebrate = useCallback(
    (reached: StreakStatus) => {
      setBurst((count) => count + 1);
      toast.custom(
        () => (
          <StreakCelebrationToast
            title={t('celebrationTitle')}
            description={t('celebrationDescription', {
              days: reached.currentStreakDays,
            })}
          />
        ),
        // The block is the toast. The Toaster gives every toast the glass
        // card (`unstyled` does not remove it), so it is undone here, per toast.
        {
          duration: 6_000,
          className:
            'border-0! bg-transparent! p-0! shadow-none! backdrop-blur-none!',
        },
      );
    },
    [t],
  );
  useStreakHeartbeat(singing, celebrate, account, {
    viewId,
    privateTrackId,
  });

  if (status.data === undefined) {
    return <StreakRingSkeleton />;
  }
  const progress = ringProgress(
    status.data.listenedSeconds,
    status.data.targetSeconds,
  );

  return (
    <>
      <Popover>
        <PopoverTrigger
          aria-label={t('ring', { progress })}
          title={t('ring', { progress })}
          data-progress={progress}
          className={TRIGGER_CLASS}
        >
          <StreakRingGraphic
            progress={progress}
            completed={status.data.completedToday}
          />
          <span className="hidden md:inline">{t('practiceLabel')}</span>
        </PopoverTrigger>
        <PopoverContent side="top" align="end" sideOffset={12}>
          <StreakDetails status={status.data} />
        </PopoverContent>
      </Popover>
      <StreakCelebration burst={burst} />
    </>
  );
}

/**
 * The daily streak ring of the dock. A signed-in User sees today's practice
 * against their daily target, which counts while they are `singing` with the
 * mic on; a visitor sees the ring empty, with an invite to create an account.
 */
export function StreakRing({
  singing,
  viewId,
  privateTrackId,
}: {
  singing: boolean;
  viewId?: () => string | undefined;
  privateTrackId?: string;
}) {
  return (
    <SessionUserBoundary
      render={(user, loading) => {
        if (user)
          return (
            <UserRing
              key={user.email}
              singing={singing}
              account={user.email}
              viewId={viewId}
              privateTrackId={privateTrackId}
            />
          );
        if (loading) return <StreakRingSkeleton />;
        return <VisitorRing />;
      }}
    />
  );
}
