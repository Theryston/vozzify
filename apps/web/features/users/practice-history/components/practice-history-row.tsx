'use client';

import type { PracticeAttemptHistoryItem } from '@vozzify/contracts';
import { LockKeyhole } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { TrackCoverArt } from '@/features/tracks/components/track-cover-art';
import { Link } from '@/lib/i18n/navigation';
import { creditText } from '@/lib/track-credit';

import { AccuracyChip } from './accuracy-chip';

/**
 * One practice run: the Track's cover, its title and artist, the setup it was
 * sung with, the time of day in the viewer's zone, and the accuracy chip. A
 * run flagged as bleed-suspected says so.
 *
 * Nothing is truncated. The text column keeps at least `min-w-48` (12rem); when
 * the row has no room for the chip beside it, the chip wraps below the text,
 * so on a phone the title and the setup wrap instead of losing their end.
 */
export function PracticeHistoryRow({
  attempt,
  time,
}: {
  attempt: PracticeAttemptHistoryItem;
  time: string;
}) {
  const t = useTranslations('profileHistory');
  const { track } = attempt;
  const setup = [
    t(`difficulty.${attempt.difficulty}`),
    t(`octave.${attempt.octaveMode}`),
    t('speed', { speed: attempt.speed }),
    t('transpose', { semitones: attempt.transposeSemitones }),
  ];
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl p-2">
      <div className="relative size-14 shrink-0 overflow-hidden rounded-md bg-muted">
        <TrackCoverArt
          coverArtUrl={track.coverUrl}
          placeholderSeed={track.id}
          sizes="56px"
        />
      </div>
      <div className="flex min-w-48 flex-1 flex-col gap-0.5">
        <Link
          href={`/tracks/${track.id}`}
          data-testid="run-title"
          className="break-words rounded-sm font-semibold outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {track.title}
        </Link>
        {attempt.isPrivate && (
          <span className="flex items-center gap-1 text-muted-foreground text-xs">
            <LockKeyhole aria-hidden="true" className="size-3" />
            {t('privateTrack')}
          </span>
        )}
        <p className="break-words text-muted-foreground text-sm">
          {creditText(track.artistCredit)}
        </p>
        <p
          data-testid="run-setup"
          className="break-words text-muted-foreground text-xs"
        >
          {`${setup.join(' · ')} · ${time}`}
        </p>
        {attempt.bleedSuspected ? (
          <p className="font-semibold text-muted-foreground text-xs">
            {t('suspected')}
          </p>
        ) : null}
      </div>
      <AccuracyChip accuracy={attempt.accuracy} />
    </li>
  );
}
