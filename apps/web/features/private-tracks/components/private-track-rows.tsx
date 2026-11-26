import type {
  PrivateTrack,
  PrivateTrackProcessingState,
} from '@vozzify/contracts';
import { AudioLinesIcon, ChevronRightIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { TrackCoverArt } from '@/features/tracks/components/track-cover-art';
import { TrackDuration } from '@/features/tracks/components/track-duration';
import { Link } from '@/lib/i18n/navigation';
import { cn } from '@/lib/utils';
import { PrivateTrackRowsSkeleton } from './private-tracks-frame';

const LIST_SURFACE = 'rounded-2xl bg-card shadow-sm';

export function PrivateTrackRows({
  tracks,
  loading,
  loadError,
}: {
  tracks: PrivateTrack[];
  loading: boolean;
  loadError: boolean;
}) {
  const t = useTranslations('privateTracks');
  return (
    <>
      {loading ? <PrivateTrackRowsSkeleton /> : null}
      {loadError ? (
        <p role="alert" className="text-destructive text-sm">
          {t('loadError')}
        </p>
      ) : null}
      {!loading && !loadError && tracks.length === 0 ? (
        <div
          className={cn(
            LIST_SURFACE,
            'flex flex-col items-center gap-3 px-4 py-8 text-center',
          )}
        >
          <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
            <AudioLinesIcon aria-hidden="true" className="size-5" />
          </span>
          <p className="font-medium text-muted-foreground">{t('empty')}</p>
        </div>
      ) : null}
      {tracks.length > 0 ? (
        <ul className={cn(LIST_SURFACE, 'divide-y divide-border px-2')}>
          {tracks.map((track) => (
            <PrivateTrackRow key={track.id} track={track} />
          ))}
        </ul>
      ) : null}
    </>
  );
}

function PrivateTrackRow({ track }: { track: PrivateTrack }) {
  return (
    <li className="py-1">
      <Link
        href={`/tracks/${encodeURIComponent(track.id)}`}
        className="group flex min-h-18 min-w-0 items-center gap-3 rounded-xl px-2 py-3 outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 sm:gap-4 sm:px-3"
      >
        <span className="relative size-12 shrink-0 overflow-hidden rounded-md bg-muted">
          <TrackCoverArt placeholderSeed={track.id} sizes="48px" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="wrap-anywhere font-semibold text-base">
              {track.title}
            </span>
            <span className="flex items-center gap-2 text-muted-foreground text-xs">
              {track.artist ? (
                <>
                  <span className="truncate">{track.artist}</span>
                  <span aria-hidden="true">·</span>
                </>
              ) : null}
              <TrackDuration ms={track.durationMs} />
            </span>
          </span>
          {track.processing ? (
            <PrivateTrackStatus status={track.processing.status} />
          ) : null}
        </span>
        <ChevronRightIcon
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground"
        />
      </Link>
    </li>
  );
}

function PrivateTrackStatus({
  status,
}: {
  status: PrivateTrackProcessingState['status'];
}) {
  const t = useTranslations('privateTracks.detail.processing');
  return (
    <span
      className={cn(
        'inline-flex max-w-full shrink-0 items-center gap-1.5 self-start rounded-full px-2.5 py-1 font-semibold text-xs sm:self-center',
        {
          'bg-destructive/10 text-destructive': status === 'FAILED',
          'bg-success/10 text-success': status === 'COMPLETED',
          'bg-muted text-muted-foreground':
            status !== 'FAILED' && status !== 'COMPLETED',
        },
      )}
    >
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full bg-current"
      />
      {t(status)}
    </span>
  );
}
