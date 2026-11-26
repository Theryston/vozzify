import type { TrackHeader } from '@vozzify/contracts';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

import { TrackCoverArt } from './track-cover-art';

/**
 * The Track's cover, tilted like the album header's: the stored one once a
 * Processing has found it, else the geometric placeholder keyed by the Track,
 * so it never changes between renders.
 */
function TrackRingCover({ track }: { track: TrackHeader }) {
  return (
    <span className="relative block size-24 rotate-3 overflow-hidden rounded-xl shadow-md md:size-44">
      <TrackCoverArt
        coverArtUrl={track.coverUrl}
        placeholderSeed={track.id}
        sizes="(max-width: 768px) 96px, 176px"
        unoptimized
      />
    </span>
  );
}

/**
 * The ring around the cover, filled to `percent`. `pathLength` makes the
 * dash read in percent, and the dash eases between values like the bar did.
 */
function ProgressRing({ percent }: { percent: number }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 100"
      className="absolute inset-0 size-full -rotate-90"
    >
      <circle
        cx="50"
        cy="50"
        r="46"
        fill="none"
        strokeWidth="3"
        className="stroke-black/15"
      />
      <circle
        cx="50"
        cy="50"
        r="46"
        fill="none"
        strokeWidth="3"
        pathLength={100}
        strokeDasharray={`${percent} 100`}
        strokeLinecap={percent > 0 ? 'round' : 'butt'}
        className="stroke-primary-foreground transition-[stroke-dasharray] duration-700 ease-out"
      />
    </svg>
  );
}

/**
 * The visual of the Processing banner: the cover inside a progress ring with
 * the percentage in a badge. The ring takes the place of the banner's
 * decorative ring. Without a Processing (`percent` null) only the cover shows.
 */
export function TrackProcessingRing({
  track,
  percent,
}: {
  track: TrackHeader;
  percent: number | null;
}) {
  const t = useTranslations('tracks.processing');

  if (percent === null) {
    return (
      <div className="grid size-40 shrink-0 place-items-center md:size-72">
        <TrackRingCover track={track} />
      </div>
    );
  }
  return (
    <div
      role="progressbar"
      aria-label={t('progress.label')}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={t('progress.value', { percent })}
      className="relative grid size-40 shrink-0 place-items-center md:size-72"
    >
      <ProgressRing percent={percent} />
      <TrackRingCover track={track} />
      <span
        aria-hidden="true"
        className={cn(
          'absolute right-0 bottom-0 rounded-full bg-background px-3 py-1 font-mono font-semibold text-foreground text-sm tabular-nums',
          'md:right-2 md:bottom-2 md:text-base',
        )}
      >
        {t('progress.value', { percent })}
      </span>
    </div>
  );
}
