import type { TrackProcessingState } from '@vozzify/contracts';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { Suspense } from 'react';

import type { InitialPractice } from '../practice-queries';
import { TrackProcessingView } from './track-processing-view';
import { TrackRecommendations } from './track-recommendations';
import { TrackRecommendationsSkeleton } from './track-recommendations-skeleton';

/**
 * The client part of the Track page, given the state the route read (and, for
 * a completed Track, what the practice view renders from). Only
 * the `tracks`, `practice` and `streaks` messages go to the client,
 * plus the `errors` a failed action (the heart) toasts, so the RSC payload
 * stays small.
 */
export async function TrackProcessingSection({
  initialState,
  initialPractice,
  fakePlayer,
}: {
  initialState: TrackProcessingState;
  initialPractice: InitialPractice | undefined;
  /** The e2e build's flag: the practice view plays with a fake clock. */
  fakePlayer: boolean;
}) {
  const { avatarIdentity, errors, practice, streaks, tracks } =
    await getMessages();

  return (
    <NextIntlClientProvider
      messages={{ avatarIdentity, errors, practice, streaks, tracks }}
    >
      <TrackProcessingView
        initialState={initialState}
        initialPractice={initialPractice}
        fakePlayer={fakePlayer}
        recommendations={
          initialState.processing?.status === 'COMPLETED' ? (
            <Suspense
              key="track-recommendations"
              fallback={<TrackRecommendationsSkeleton />}
            >
              <TrackRecommendations trackId={initialState.track.id} />
            </Suspense>
          ) : null
        }
      />
    </NextIntlClientProvider>
  );
}
