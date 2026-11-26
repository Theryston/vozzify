'use client';

import { useQueryClient } from '@tanstack/react-query';
import type {
  PrivateTrackDetail as PrivateTrackDetailData,
  TrackAudio,
  TrackDetail,
  TrackProcessingStep,
} from '@vozzify/contracts';
import { LockKeyhole } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SessionUserBoundary } from '@/features/auth/components/session-user';
import { PracticeBody } from '@/features/tracks/components/practice-body';
import { TrackProcessingPanel } from '@/features/tracks/components/track-processing-panel';
import { TrackTitleRow } from '@/features/tracks/components/track-title-row';
import { isApiError } from '@/lib/api/api-error';
import { Link, useRouter } from '@/lib/i18n/navigation';
import { cn } from '@/lib/utils';
import { usePrivateTrackDetail } from '../hooks/use-private-tracks';
import { privateTrackKeys } from '../query-keys';
import { PrivateTrackDeleteButton } from './private-track-delete-button';
import { PrivateTrackRetryButton } from './private-track-retry-button';

const PrivateTrackMetadataDialog = dynamic(
  () =>
    import('./private-track-metadata-dialog').then(
      (module) => module.PrivateTrackMetadataDialog,
    ),
  { ssr: false },
);

function usePrivateTrackAccess(
  initial: PrivateTrackDetailData,
  userId: string,
) {
  const seeded = initial.ownerId === userId ? initial : undefined;
  const query = usePrivateTrackDetail(userId, initial.id, seeded);
  const queryClient = useQueryClient();
  const [unavailable, setUnavailable] = useState(false);
  const revoked =
    isApiError(query.error) && [401, 403, 404].includes(query.error.statusCode);
  useEffect(() => {
    if (!revoked) return;
    setUnavailable(true);
    queryClient.removeQueries({
      queryKey: privateTrackKeys.detail(userId, initial.id),
      exact: true,
    });
  }, [initial.id, queryClient, revoked, userId]);
  return {
    track:
      !revoked && !unavailable && query.data?.ownerId === userId
        ? query.data
        : undefined,
    failed: query.isError || unavailable,
  };
}

function PrivateTrackDetailContent({
  initial,
  fakePlayer,
  userId,
}: {
  initial: PrivateTrackDetailData;
  fakePlayer: boolean;
  userId: string;
}) {
  const { track, failed } = usePrivateTrackAccess(initial, userId);
  const t = useTranslations('privateTracks.detail');

  if (!track) {
    return failed ? (
      <p role="alert" className="text-destructive text-sm">
        {t('loadError')}
      </p>
    ) : (
      <Skeleton className="h-56 rounded-2xl" />
    );
  }

  return (
    <PrivateTrackView track={track} userId={userId} fakePlayer={fakePlayer} />
  );
}

const PRIVATE_STEPS: readonly TrackProcessingStep[] = [
  'EXTRACTING_VOCALS',
  'DETECTING_NOTES',
];

function privateTrackHeader(track: PrivateTrackDetailData): TrackDetail {
  return {
    id: track.id,
    title: track.title,
    coverUrl: track.recording?.coverUrl ?? null,
    artistCredit: track.artist
      ? [{ name: track.artist, joinPhrase: '', artistId: null }]
      : [],
    durationMs: track.durationMs,
    youtubeVideoId: track.youtubeVideoId ?? null,
    contributors: [],
    contributorCount: 0,
    hasNotes: track.notes.length > 0,
  };
}

function PrivateTrackView({
  track,
  userId,
  fakePlayer,
}: {
  track: PrivateTrackDetailData;
  userId: string;
  fakePlayer: boolean;
}) {
  const t = useTranslations('privateTracks.detail');
  const header = privateTrackHeader(track);
  const { status, progress } = track.processing;
  if (!track.locked && status !== 'COMPLETED') {
    return (
      <TrackProcessingPanel
        track={header}
        processing={{ status, resumeFrom: null }}
        percent={progress}
        stages={PRIVATE_STEPS}
        actions={<PrivateTrackActions track={track} userId={userId} featured />}
        statusOptions={{
          failure: {
            code: null,
            action:
              status === 'FAILED' ? (
                <PrivateTrackRetryButton
                  privateTrackId={track.id}
                  userId={userId}
                />
              ) : undefined,
          },
          copy: {
            activeTitle: t(`processing.${status}`),
            closeNote: t('closeNote'),
          },
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-6 md:pb-8">
      <TrackTitleRow
        header={header}
        privateActions={<PrivateTrackActions track={track} userId={userId} />}
      />
      {track.locked ? (
        <LockedPrivateTrack failed={status === 'FAILED'} />
      ) : (
        <PrivateTrackPractice
          header={header}
          notes={track.notes}
          fakePlayer={fakePlayer}
        />
      )}
    </div>
  );
}

function PrivateTrackPractice({
  header,
  notes,
  fakePlayer,
}: {
  header: TrackDetail;
  notes: PrivateTrackDetailData['notes'];
  fakePlayer: boolean;
}) {
  const audio = useMemo<TrackAudio>(() => {
    const media = `/api/private-tracks/${encodeURIComponent(header.id)}`;
    return { musicMp3Url: `${media}/music`, vocalsMp3Url: `${media}/vocals` };
  }, [header.id]);
  return (
    <PracticeBody
      header={header}
      notes={{ notes }}
      lyrics={undefined}
      lyricsLoading={false}
      failed={false}
      fakePlayer={fakePlayer}
      directAudio={audio}
      privateTrack
    />
  );
}

function PrivateTrackActions({
  track,
  userId,
  featured = false,
}: {
  track: PrivateTrackDetailData;
  userId: string;
  featured?: boolean;
}) {
  const t = useTranslations('privateTracks.detail');
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border border-transparent px-3 py-1 font-semibold text-sm',
          featured ? 'border-primary-foreground/50' : 'bg-secondary',
        )}
      >
        <LockKeyhole aria-hidden="true" className="size-4" />
        {t('privateBadge')}
      </span>
      {track.locked ? null : (
        <PrivateTrackMetadataDialog track={track} featured={featured} />
      )}
      <PrivateTrackDeleteButton
        privateTrackId={track.id}
        userId={userId}
        featured={featured}
        onDeleted={() => router.replace('/me/tracks')}
      />
    </div>
  );
}

function LockedPrivateTrack({ failed }: { failed: boolean }) {
  const t = useTranslations('privateTracks.detail');
  return (
    <section className="flex flex-col items-start gap-3">
      <h2 className="font-bold text-2xl tracking-tight">{t('lockedTitle')}</h2>
      <p className="max-w-prose text-muted-foreground text-sm">
        {t('lockedDescription')}
      </p>
      {failed ? (
        <p role="status" className="text-destructive text-sm">
          {t('processing.FAILED')}
        </p>
      ) : null}
      <Link href="/plans" className={buttonVariants()}>
        {t('reactivate')}
      </Link>
    </section>
  );
}

export function PrivateTrackDetailSection({
  initial,
  fakePlayer,
}: {
  initial: PrivateTrackDetailData;
  fakePlayer: boolean;
}) {
  const t = useTranslations('privateTracks.detail');
  return (
    <SessionUserBoundary
      render={(user, loading) => {
        if (loading) {
          return <Skeleton className="h-56 rounded-2xl" />;
        }
        if (!user) {
          return (
            <p role="alert" className="text-muted-foreground text-sm">
              {t('loadError')}
            </p>
          );
        }
        if (!user.id) {
          return (
            <p role="alert" className="text-muted-foreground text-sm">
              {t('loadError')}
            </p>
          );
        }
        return (
          <PrivateTrackDetailContent
            initial={initial}
            fakePlayer={fakePlayer}
            userId={user.id}
          />
        );
      }}
    />
  );
}
