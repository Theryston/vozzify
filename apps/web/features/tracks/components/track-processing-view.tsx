'use client';

import type { TrackProcessingState } from '@vozzify/contracts';
import type { ReactNode } from 'react';

import { Toaster } from '@/components/ui/sonner';

import { useElapsedSince } from '../hooks/use-step-elapsed';
import { useTrackProcessing } from '../hooks/use-track-processing';
import type { InitialPractice } from '../practice-queries';
import { displayedPercent } from '../processing-steps';
import { isRetryOffered } from '../retry-offer';
import { RefreshPracticeOnCompletion } from './refresh-practice-on-completion';
import { TrackChosenVideo } from './track-chosen-video';
import { TrackContributors } from './track-contributors';
import { TrackPracticeView } from './track-practice-view';
import { TrackProcessingPanel } from './track-processing-panel';
import { TrackRetry } from './track-retry';

/** How far a toast sits from the bottom: the dock's height plus some room. */
const DOCK_CLEARANCE = { bottom: 'calc(var(--dock-height, 0px) + 1.5rem)' };

/**
 * The Track page: while the Processing runs, the banner with the progress
 * ring, then what happens now, the video it chose and its Contributors; once
 * it completes, the practice view. The state comes from the server and is
 * polled while the Processing runs, so the page follows it, and switches to
 * the practice view, without a reload.
 */
export function TrackProcessingView({
  initialState,
  initialPractice,
  fakePlayer,
  recommendations,
}: {
  initialState: TrackProcessingState;
  initialPractice: InitialPractice | undefined;
  fakePlayer: boolean;
  recommendations?: ReactNode;
}) {
  const { data: state } = useTrackProcessing(
    initialState.track.id,
    initialState,
  );
  const { processing } = state;
  // One clock for the ring and the estimate, so they never disagree.
  const elapsedMs = useElapsedSince(
    processing === null
      ? ''
      : `${processing.id}/${processing.status}/${processing.resumeFrom ?? ''}`,
  );

  if (processing?.status === 'COMPLETED') {
    return (
      <>
        {/* A toast still showing when the view switches (a retry refused) stays. */}
        {/* Above the dock, whatever its height: it publishes `--dock-height`.
            Sonner has its own offset under 600px, which needs setting too; only the
            bottom is given, since a single value would apply to every side. */}
        <RefreshPracticeOnCompletion
          enabled={initialState.processing?.status !== 'COMPLETED'}
        />
        <Toaster offset={DOCK_CLEARANCE} mobileOffset={DOCK_CLEARANCE} />
        <div className="flex flex-col gap-10 pb-[calc(var(--dock-height,0px)+1.5rem)] md:gap-12">
          <TrackPracticeView
            trackId={state.track.id}
            initial={initialPractice}
            fakePlayer={fakePlayer}
          />
          {recommendations}
        </div>
      </>
    );
  }

  const percent =
    processing === null
      ? null
      : displayedPercent(processing.status, processing.resumeFrom, elapsedMs);
  const hasAside = processing?.video != null || state.contributors.length > 0;

  return (
    <>
      {/* Outlives the retry button, which leaves the page once the retry starts. */}
      <Toaster />
      <TrackProcessingPanel
        track={state.track}
        processing={processing}
        percent={percent}
        statusOptions={{
          elapsedMs,
          failure: processing
            ? {
                code: processing.failureCode,
                action: isRetryOffered(processing) ? (
                  <TrackRetry trackId={state.track.id} />
                ) : null,
              }
            : undefined,
        }}
        aside={
          hasAside ? (
            <div className="flex flex-col gap-6">
              {processing?.video == null ? null : (
                <TrackChosenVideo video={processing.video} />
              )}
              {state.contributors.length > 0 ? (
                <TrackContributors contributors={state.contributors} />
              ) : null}
            </div>
          ) : null
        }
      />
    </>
  );
}
