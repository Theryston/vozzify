'use client';

import { useQueryClient } from '@tanstack/react-query';
import type {
  PrivateTrackDetail as PrivateTrackDetailData,
  TrackAudio,
  TrackDetail,
} from '@vozzify/contracts';
import { LockKeyhole } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { SessionUserBoundary } from '@/features/auth/components/session-user';
import { PracticeBody } from '@/features/tracks/components/practice-body';
import { isApiError } from '@/lib/api/api-error';
import { Link } from '@/lib/i18n/navigation';
import { usePrivateTrackDetail } from '../hooks/use-private-tracks';
import { privateTrackKeys } from '../query-keys';

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
    track: revoked || unavailable ? undefined : query.data,
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

  const canPractice = !track.locked && track.processing.status === 'COMPLETED';
  const header: TrackDetail = {
    id: track.id,
    title: track.title,
    coverUrl: null,
    artistCredit: track.artist
      ? [{ name: track.artist, joinPhrase: '', artistId: null }]
      : [],
    durationMs: track.durationMs,
    youtubeVideoId: `private-${track.id}`,
    contributors: [],
    contributorCount: 0,
    hasNotes: track.notes.length > 0,
  };
  const audio: TrackAudio = {
    musicMp3Url: `/api/private-tracks/${encodeURIComponent(track.id)}/music`,
    vocalsMp3Url: `/api/private-tracks/${encodeURIComponent(track.id)}/vocals`,
  };

  return (
    <section className="flex flex-col gap-6 pb-6 md:pb-8">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-bold text-2xl tracking-tight">
            {track.title}
          </h1>
          {track.artist ? (
            <p className="truncate text-muted-foreground text-sm">
              {track.artist}
            </p>
          ) : null}
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 font-semibold text-sm">
          <LockKeyhole aria-hidden="true" className="size-3.5" />
          {t('privateBadge')}
        </span>
      </header>
      {track.locked ? (
        <LockedPrivateTrack />
      ) : canPractice ? (
        <PracticeBody
          header={header}
          notes={{ notes: track.notes }}
          lyrics={undefined}
          lyricsLoading={false}
          failed={false}
          fakePlayer={fakePlayer}
          directAudio={audio}
          recordAttempts={false}
        />
      ) : (
        <ProcessingStatus track={track} />
      )}
    </section>
  );
}

function LockedPrivateTrack() {
  const t = useTranslations('privateTracks.detail');
  return (
    <div className="flex flex-col items-start gap-3 rounded-2xl border bg-card p-5">
      <h2 className="font-semibold text-lg">{t('lockedTitle')}</h2>
      <p className="text-muted-foreground text-sm">{t('lockedDescription')}</p>
      <Link
        href="/plans"
        className="inline-flex h-10 items-center justify-center rounded-full bg-primary px-5 font-semibold text-primary-foreground text-sm shadow-xs transition-transform duration-200 ease-spring hover:brightness-105 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]"
      >
        {t('reactivate')}
      </Link>
    </div>
  );
}

function ProcessingStatus({ track }: { track: PrivateTrackDetailData }) {
  const t = useTranslations('privateTracks.detail');
  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-2xl border bg-card p-5"
    >
      <p className="font-semibold">
        {t(`processing.${track.processing.status}`)}
      </p>
      <label className="sr-only" htmlFor="private-track-progress">
        {t('processingLabel')}
      </label>
      <progress
        id="private-track-progress"
        max={100}
        value={track.processing.progress}
        className="h-2 w-full accent-primary"
      />
    </div>
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
