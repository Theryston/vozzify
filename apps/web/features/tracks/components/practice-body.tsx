'use client';

import type {
  SubmitPracticeAttemptBody,
  TrackAudio,
  TrackDetail,
  TrackLyrics,
  TrackNotes,
} from '@vozzify/contracts';
import { useTranslations } from 'next-intl';
import { type RefObject, useRef } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { SessionUserBoundary } from '@/features/auth/components/session-user';
import { KaraokeLine } from '@/features/lyrics/components/karaoke-line';
import { LyricsBlock } from '@/features/lyrics/components/lyrics-block';
import { PracticePreferencesSync } from '@/features/practice/components/practice-preferences-sync';
import { ScoringPreferences } from '@/features/practice/components/scoring-preferences';
import { SingTimeline } from '@/features/practice/components/sing-timeline';
import { SingingAids } from '@/features/practice/components/singing-aids';
import { creditText } from '@/lib/track-credit';
import { usePracticeController } from '../hooks/use-practice-controller';
import { useTimelineFocus } from '../hooks/use-shared-link';
import { useSubmitAttempt } from '../hooks/use-submit-attempt';
import { loopRange } from '../listening/listening-math';
import { useLoop } from '../listening/loop-store';
import { noteRangeOf } from '../note-summary';
import { playbackClock } from '../playback/playback-clock';
import type { PlaybackController } from '../playback/playback-controller';
import { reportAttempt } from '../report-attempt';
import { playbackStore, usePlaybackState } from '../stores/playback-store';
import { useTranspose } from '../stores/transpose-store';
import {
  readStoredView,
  sessionStorageOrUndefined,
} from '../track-view-session';
import { ListeningActions } from './listening-actions';
import { PendingAttemptSubmitter } from './pending-attempt-submitter';
import { NoVoice, useTransposedNotes } from './practice-body-support';
import { PracticeDock } from './practice-dock';
import { SharedMomentSeek } from './shared-moment-seek';
import { TIMELINE_BOX_CLASS } from './timeline-box-class';
import { TrackAttemptStatus } from './track-attempt-status';

const currentViewId = (trackId: string) =>
  readStoredView(sessionStorageOrUndefined(), trackId)?.viewId;

function TrackTimeline({
  header,
  notes,
  failed,
  controller,
  signedIn,
  recordAttempts,
}: {
  header: TrackDetail;
  notes: TrackNotes | undefined;
  failed: boolean;
  controller: PlaybackController | null;
  signedIn: boolean;
  recordAttempts: boolean;
}) {
  const t = useTranslations('tracks.practice');
  const semitones = useTranspose();
  const rate = usePlaybackState((state) => state.rate);
  const submit = useSubmitAttempt(header.id);
  const shifted = useTransposedNotes(notes);
  if (notes === undefined) {
    return failed ? (
      <p role="alert" className="text-muted-foreground text-sm">
        {t('loadError')}
      </p>
    ) : (
      <Skeleton className={TIMELINE_BOX_CLASS} />
    );
  }
  const range = noteRangeOf(shifted);
  const label = range
    ? t('timeline.label', {
        title: header.title,
        count: notes.notes.length,
        low: range.low,
        high: range.high,
      })
    : t('timeline.labelEmpty', { title: header.title });

  const handleAttempt = (body: SubmitPracticeAttemptBody) => {
    if (!recordAttempts) return;
    reportAttempt({
      signedIn,
      trackId: header.id,
      body,
      submit: submit.mutate,
      storage: sessionStorageOrUndefined(),
    });
  };

  return (
    <SingTimeline
      key={header.id}
      notes={shifted}
      playback={playbackStore}
      controls={controller}
      loop={useLoop}
      transpose={semitones}
      rate={rate}
      onAttempt={handleAttempt}
      renderAttemptStatus={
        recordAttempts
          ? () => <TrackAttemptStatus trackId={header.id} />
          : undefined
      }
      label={label}
      clock={controller ? playbackClock : undefined}
      onScrub={controller?.seek}
      className={TIMELINE_BOX_CLASS}
    />
  );
}

function TrackLyricsBlock({
  lyrics,
  controller,
}: {
  lyrics: TrackLyrics | undefined;
  controller: PlaybackController | null;
}) {
  if (lyrics === undefined || lyrics.lines.length === 0) return null;
  return (
    <div className="practice-lyrics">
      <LyricsBlock
        lines={lyrics.lines}
        clock={playbackClock}
        onSeek={
          controller
            ? (seconds) => {
                const line = lyrics.lines.find(
                  (item) => item.start === seconds,
                );
                if (
                  line &&
                  useLoop.getState().range &&
                  matchMedia(
                    '(max-width: 767px), (max-height: 600px) and (orientation: landscape)',
                  ).matches
                ) {
                  useLoop.setState({
                    range: loopRange(
                      line.start,
                      line.end,
                      playbackStore.getState().duration,
                    ),
                  });
                }
                controller.seek(seconds);
              }
            : undefined
        }
      />
    </div>
  );
}

type PracticeBodyProps = {
  admin: boolean;
  header: TrackDetail;
  notes: TrackNotes | undefined;
  lyrics: TrackLyrics | undefined;
  /** The lyrics are still being read: their slot is held. */
  lyricsLoading: boolean;
  failed: boolean;
  directAudio?: TrackAudio;
  recordAttempts?: boolean;
  /** The e2e build's flag: play with a clock instead of YouTube. */
  fakePlayer: boolean;
};

function TrackPracticeDock({
  header,
  controller,
  directAudio,
  expectDirectAudio,
  audioFallback,
  hostRef,
}: {
  header: TrackDetail;
  controller: PlaybackController | null;
  directAudio: boolean;
  expectDirectAudio: boolean;
  audioFallback: boolean;
  hostRef: RefObject<HTMLDivElement | null>;
}) {
  if (header.youtubeVideoId === null && !directAudio) return null;
  return (
    <PracticeDock
      controller={controller}
      hostRef={hostRef}
      videoId={header.youtubeVideoId}
      directAudio={directAudio}
      expectDirectAudio={expectDirectAudio}
      audioFallback={audioFallback}
      trackKey={header.key}
      trackTitle={header.title}
      artistText={creditText(header.artistCredit)}
      viewId={() => currentViewId(header.id)}
    />
  );
}

function PracticeBodyContent(props: PracticeBodyProps & { signedIn: boolean }) {
  const { header, notes, lyrics, lyricsLoading, failed, signedIn } = props;
  const { controller, directAudio, expectDirectAudio, audioFallback, hostRef } =
    usePracticeController(props);
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const guideNotes = useTransposedNotes(notes);
  const timelineRef = useRef<HTMLDivElement>(null);
  useTimelineFocus(
    timelineRef,
    header.hasNotes && (notes !== undefined || failed),
  );
  const hasLyrics = lyrics !== undefined && lyrics.lines.length > 0;

  return (
    <div
      ref={fullscreenRef}
      className="practice-fullscreen flex flex-col gap-6 bg-background"
    >
      {header.hasNotes ? (
        <div ref={timelineRef} className="flex scroll-mt-20 flex-col gap-3">
          <ListeningActions
            notes={notes?.notes ?? []}
            controller={controller}
            container={fullscreenRef}
          />
          <TrackTimeline
            header={header}
            notes={notes}
            failed={failed}
            controller={controller}
            signedIn={signedIn}
            recordAttempts={props.recordAttempts ?? true}
          />
          {hasLyrics ? (
            <KaraokeLine lines={lyrics.lines} clock={playbackClock} />
          ) : (
            lyricsLoading && <div aria-hidden="true" className="min-h-8" />
          )}
        </div>
      ) : (
        <NoVoice />
      )}
      <ScoringPreferences />
      <SingingAids
        controller={controller}
        playback={playbackStore}
        notes={guideNotes}
      />
      <SharedMomentSeek controller={controller} />
      <TrackLyricsBlock lyrics={lyrics} controller={controller} />
      <TrackPracticeDock
        header={header}
        controller={controller}
        directAudio={directAudio}
        expectDirectAudio={expectDirectAudio}
        audioFallback={audioFallback}
        hostRef={hostRef}
      />
    </div>
  );
}

export function PracticeBody(
  props: Omit<PracticeBodyProps, 'admin' | 'signedIn'>,
) {
  return (
    <SessionUserBoundary
      render={(user) => (
        <>
          <PracticePreferencesSync
            signedIn={user !== null}
            userKey={user?.email ?? null}
          />
          <PendingAttemptSubmitter signedIn={user !== null} />
          <PracticeBodyContent
            {...props}
            admin={user?.role === 'ADMIN'}
            signedIn={user !== null}
          />
        </>
      )}
    />
  );
}
