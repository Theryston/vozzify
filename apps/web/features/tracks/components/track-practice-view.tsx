'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';

import { Skeleton } from '@/components/ui/skeleton';

import { useRememberedTranspose } from '../hooks/use-remembered-transpose';
import type { InitialPractice } from '../practice-queries';
import {
  trackLyricsQueryOptions,
  trackNotesQueryOptions,
  trackPracticeQueryOptions,
} from '../track-practice-query';
import { PracticeBody } from './practice-body';
import { TIMELINE_BOX_CLASS } from './timeline-box-class';
import { TrackTitleRow } from './track-title-row';
import { TrackViewRecorder } from './track-view-recorder';

/** Same-dimension stand-in for the practice view while it loads. */
export function TrackPracticeSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Skeleton className="size-14 shrink-0 rounded-xl sm:size-16" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-6 w-48 rounded-md" />
          <Skeleton className="h-4 w-32 rounded-md" />
        </div>
      </div>
      <Skeleton className={TIMELINE_BOX_CLASS} />
      <div aria-hidden="true" className="min-h-8" />
    </div>
  );
}

/**
 * The practice view of a completed Track: the title row, then the note
 * timeline (or the "no voice" message for a Track without notes). The server
 * hands in what it rendered, so the page paints complete; when the Processing
 * completes while the page is open there is nothing yet and the browser reads
 * both, which is the in-place switch from the Processing view.
 */
export function TrackPracticeView({
  trackId,
  initial,
  fakePlayer,
}: {
  trackId: string;
  initial: InitialPractice | undefined;
  /** The e2e build's flag: play with a clock instead of YouTube. */
  fakePlayer: boolean;
}) {
  const t = useTranslations('tracks.practice');
  useRememberedTranspose(trackId);
  const header = useQuery(trackPracticeQueryOptions(trackId, initial?.header));
  const notes = useQuery(
    trackNotesQueryOptions(
      trackId,
      header.data?.hasNotes === true,
      initial?.notes,
    ),
  );

  // Lyrics are a bonus: while they load, or if they fail, the page goes on.
  const lyrics = useQuery(trackLyricsQueryOptions(trackId, initial?.lyrics));

  if (header.data === undefined) {
    return header.isError ? (
      <p role="alert" className="text-muted-foreground text-sm">
        {t('loadError')}
      </p>
    ) : (
      <TrackPracticeSkeleton />
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-6 md:pb-8">
      <TrackViewRecorder trackId={trackId} />
      <TrackTitleRow header={header.data} />
      <PracticeBody
        header={header.data}
        notes={notes.data}
        lyrics={lyrics.data}
        lyricsLoading={lyrics.isPending}
        failed={notes.isError}
        fakePlayer={fakePlayer}
      />
    </div>
  );
}
