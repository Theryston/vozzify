import type {
  TrackHeader,
  TrackProcessing,
  TrackProcessingStep,
} from '@vozzify/contracts';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import {
  entityBannerRowClass,
  entityBannerSurfaceClass,
  entityInfoClass,
} from '@/components/entity-header';
import { creditText } from '@/lib/track-credit';
import { stepPosition } from '../processing-steps';
import { TrackProcessingRing } from './track-processing-ring';
import { TrackProcessingSteps } from './track-processing-steps';

/**
 * A step down from the artist and album display titles: the ring and the
 * step pills share the block, so the title gives them room.
 */
const TITLE_CLASS =
  'min-w-0 break-words font-extrabold text-4xl leading-none tracking-tighter md:text-5xl';

/**
 * The line above the title: the step it is on (or stopped at) out of all of
 * them, else "queued" or "failed" when there is no step to name.
 */
type Stage = Pick<TrackProcessing, 'status' | 'resumeFrom'>;

function StageLine({
  processing,
  stages,
}: {
  processing: Stage;
  stages?: readonly TrackProcessingStep[];
}) {
  const t = useTranslations('tracks.processing');
  const position = stepPosition(
    processing.status,
    processing.resumeFrom,
    stages,
  );
  const failed = processing.status === 'FAILED';
  let text: string;
  if (position === null) {
    text = failed ? t('status.FAILED') : t('status.QUEUED');
  } else {
    const values = { current: position.number, total: position.total };
    text = failed ? t('stage.stopped', values) : t('stage.running', values);
  }
  return (
    <p
      aria-live="polite"
      className="font-bold text-sm uppercase tracking-wider"
    >
      {text}
    </p>
  );
}

/**
 * The Processing page's featured block: the stage, the title, the artist
 * credit and the steps as pills on the left; the cover inside the progress
 * ring on the right. Without a Processing it is the title and the cover only.
 */
export function TrackProcessingBanner({
  track,
  processing,
  percent,
  stages,
  actions,
}: {
  track: TrackHeader;
  processing: Stage | null;
  percent: number | null;
  stages?: readonly TrackProcessingStep[];
  actions?: ReactNode;
}) {
  return (
    <section
      aria-labelledby="track-title"
      data-surface="featured"
      className={entityBannerSurfaceClass}
    >
      <div className={entityBannerRowClass}>
        <TrackProcessingRing track={track} percent={percent} />
        <div className="flex min-w-0 flex-col gap-3 sm:flex-1">
          {processing === null ? null : (
            <StageLine processing={processing} stages={stages} />
          )}
          <h1 id="track-title" className={TITLE_CLASS}>
            {track.title}
          </h1>
          {track.artistCredit.length > 0 ? (
            <p className={entityInfoClass}>{creditText(track.artistCredit)}</p>
          ) : null}
          {actions}
          {processing === null ? null : (
            <div className="pt-2">
              <TrackProcessingSteps processing={processing} stages={stages} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
