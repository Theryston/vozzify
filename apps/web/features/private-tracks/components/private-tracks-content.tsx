'use client';

import type { PrivateTrack } from '@vozzify/contracts';
import { LockKeyholeIcon, PlusIcon } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { AccountPageFrame } from '@/components/account-page-frame';
import { Button } from '@/components/ui/button';
import { SessionUserBoundary } from '@/features/auth/components/session-user';
import { useRouter } from '@/lib/i18n/navigation';

import { usePrivateTracks } from '../hooks/use-private-tracks';
import { PrivateAudioDialog } from './private-audio-dialog';
import { PrivateTrackRows } from './private-track-rows';

type AccountUser = {
  id?: string;
  username: string | null;
  emailVerified: boolean;
};

export function PrivateTracksContent() {
  return (
    <SessionUserBoundary
      render={(user, loading) => (
        <PrivateTracksLibrary user={user} loading={loading} />
      )}
    />
  );
}

function PrivateTracksLibrary({
  user,
  loading,
}: {
  user: AccountUser | null;
  loading: boolean;
}) {
  const t = useTranslations('privateTracks');
  const canView = Boolean(user?.username && user.emailVerified);
  const userId = canView ? (user?.id ?? '') : '';
  const [paywallOpen, setPaywallOpen] = useState(false);
  const tracks = usePrivateTracks(userId);
  const canSubmit = tracks.data?.pages[0]?.canSubmit;

  usePrivateTracksPageEffects({
    loading,
    user,
    tracks: tracks.data?.pages,
    setPaywallOpen,
  });

  return (
    <AccountPageFrame
      title={t('title')}
      description={
        <span className="inline-flex items-center gap-2">
          <LockKeyholeIcon aria-hidden="true" className="size-4 shrink-0" />
          {t('description')}
        </span>
      }
      action={
        canView ? (
          <PrivateTracksAction
            userId={userId}
            canSubmit={canSubmit}
            onPaywallOpen={() => setPaywallOpen(true)}
          />
        ) : null
      }
    >
      {canView ? (
        <PrivateTracksList
          tracks={tracks.data?.pages.flatMap((page) => page.items) ?? []}
          loading={tracks.isPending}
          loadError={tracks.isError}
          hasMore={tracks.hasNextPage}
          loadingMore={tracks.isFetchingNextPage}
          onLoadMore={() => void tracks.fetchNextPage()}
        />
      ) : null}
      <ProDialog open={paywallOpen} onPaywallOpenChange={setPaywallOpen} />
    </AccountPageFrame>
  );
}

function usePrivateTracksPageEffects({
  loading,
  user,
  tracks,
  setPaywallOpen,
}: {
  loading: boolean;
  user: AccountUser | null;
  tracks: { canSubmit: boolean; items: unknown[] }[] | undefined;
  setPaywallOpen: (open: boolean) => void;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!loading && user === null) {
      router.replace({
        pathname: '/sign-in',
        query: { redirectTo: '/me/tracks' },
      });
    }
  }, [loading, router, user]);

  useEffect(() => {
    const firstPage = tracks?.[0];
    if (firstPage && !firstPage.canSubmit && firstPage.items.length === 0) {
      setPaywallOpen(true);
    }
  }, [setPaywallOpen, tracks]);
}

function PrivateTracksAction({
  userId,
  canSubmit,
  onPaywallOpen,
}: {
  userId: string;
  canSubmit: boolean | undefined;
  onPaywallOpen: () => void;
}) {
  const t = useTranslations('privateTracks');
  if (canSubmit) return <PrivateAudioDialog userId={userId} />;

  return (
    <Button
      className="w-full sm:w-auto"
      disabled={canSubmit === undefined}
      onClick={onPaywallOpen}
    >
      <PlusIcon data-icon="inline-start" />
      {t('newTrack')}
    </Button>
  );
}

type ListProps = {
  tracks: PrivateTrack[];
  loading: boolean;
  loadError: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
};

function PrivateTracksList(props: ListProps) {
  const t = useTranslations('privateTracks');
  return (
    <div className="flex flex-col gap-4">
      <PrivateTrackRows
        tracks={props.tracks}
        loading={props.loading}
        loadError={props.loadError}
      />
      {props.hasMore ? (
        <Button
          className="self-center"
          variant="secondary"
          disabled={props.loadingMore}
          onClick={props.onLoadMore}
        >
          {props.loadingMore ? t('loadingMore') : t('loadMore')}
        </Button>
      ) : null}
    </div>
  );
}

const ProDialog = dynamic(
  () =>
    import('./private-tracks-pro-dialog').then((module) => module.ProDialog),
  { ssr: false },
);
