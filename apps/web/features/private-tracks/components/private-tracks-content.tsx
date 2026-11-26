'use client';

import type { PrivateTrack } from '@vozzify/contracts';
import { PlusIcon } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { SessionUserBoundary } from '@/features/auth/components/session-user';
import { useRouter } from '@/lib/i18n/navigation';

import { usePrivateTracks } from '../hooks/use-private-tracks';
import { PrivateAudioDialog } from './private-audio-dialog';
import { PrivateTrackRows } from './private-track-rows';
import {
  PrivateTracksFrame,
  PrivateTracksLoading,
} from './private-tracks-frame';

type ProOffer = { trackId?: string };

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
  const canView = Boolean(user?.username && user.emailVerified);
  const userId = canView ? (user?.id ?? '') : '';
  const [offer, setOffer] = useState<ProOffer | null>(null);
  const tracks = usePrivateTracks(userId);
  const canSubmit = tracks.data?.pages[0]?.canSubmit;
  const items = tracks.data?.pages.flatMap((page) => page.items) ?? [];
  const emptyFreeLibrary = canSubmit === false && items.length === 0;
  usePrivateTracksPageEffects({ loading, user, emptyFreeLibrary, setOffer });

  if (loading) return <PrivateTracksLoading />;

  return (
    <PrivateTracksFrame
      action={
        canView ? (
          <PrivateTracksAction
            userId={userId}
            canSubmit={canSubmit}
            onPaywallOpen={() => setOffer({})}
          />
        ) : null
      }
    >
      {canView ? (
        <PrivateTracksList
          tracks={items}
          onLockedTrack={
            canSubmit === false ? (trackId) => setOffer({ trackId }) : undefined
          }
          loading={tracks.isPending}
          loadError={tracks.isError}
          hasMore={tracks.hasNextPage}
          loadingMore={tracks.isFetchingNextPage}
          onLoadMore={() => void tracks.fetchNextPage()}
        />
      ) : null}
      <ProDialog
        open={canSubmit === false && offer !== null}
        trackId={offer?.trackId}
        onClose={() => setOffer(null)}
      />
    </PrivateTracksFrame>
  );
}

function usePrivateTracksPageEffects({
  loading,
  user,
  emptyFreeLibrary,
  setOffer,
}: {
  loading: boolean;
  user: AccountUser | null;
  emptyFreeLibrary: boolean;
  setOffer: (offer: ProOffer) => void;
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
    if (emptyFreeLibrary) setOffer({});
  }, [emptyFreeLibrary, setOffer]);
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
      aria-haspopup="dialog"
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
  onLockedTrack?: (id: string) => void;
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
        onLockedTrack={props.onLockedTrack}
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
