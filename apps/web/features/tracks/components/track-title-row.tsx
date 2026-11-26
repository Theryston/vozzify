import type { TrackContributor, TrackDetail } from '@vozzify/contracts';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { Fragment, type ReactNode, useState } from 'react';

import { Link } from '@/lib/i18n/navigation';

import { ContributorAvatar } from './contributor-avatar';
import { TrackBestScore } from './track-best-score';
import { TrackCoverArt } from './track-cover-art';
import { TrackDuration } from './track-duration';
import { TrackFavoriteButton } from './track-favorite-button';
import { TrackShareButton } from './track-share-button';

// Loaded on the first click, on the client only: Base UI's dialog stays out
// of the page's first-load JS, and nothing of it is needed until then.
const ContributorsDialog = dynamic(
  () =>
    import('./contributors-dialog').then((module) => module.ContributorsDialog),
  { ssr: false },
);

const LINK_CLASS =
  'rounded-sm outline-none hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50';

const AVATAR_CLASS = 'size-8 bg-background ring-2 ring-background';

/** The credit, each name linked to its Artist page when it has one. */
function ArtistCredit({ credit }: { credit: TrackDetail['artistCredit'] }) {
  return (
    <>
      {credit.map((entry, index) => (
        // A credit is a fixed ordered list, and one name can appear twice.
        // biome-ignore lint/suspicious/noArrayIndexKey: position is the identity.
        <Fragment key={index}>
          {entry.artistId === null ? (
            entry.name
          ) : (
            <Link href={`/artists/${entry.artistId}`} className={LINK_CLASS}>
              {entry.name}
            </Link>
          )}
          {entry.joinPhrase}
        </Fragment>
      ))}
    </>
  );
}

function Contributors({
  contributors,
  total,
  trackId,
}: {
  contributors: readonly TrackContributor[];
  total: number;
  trackId: string;
}) {
  const t = useTranslations('tracks.practice');
  const [opening, setOpening] = useState(0);
  const [open, setOpen] = useState(false);
  const shown = contributors.slice(0, 3);
  const extra = total - shown.length;
  if (shown.length === 0) return null;
  return (
    <>
      <button
        type="button"
        aria-label={t('contributorsOpen', { count: total })}
        aria-haspopup="dialog"
        onClick={() => {
          setOpening((value) => value + 1);
          setOpen(true);
        }}
        className="flex shrink-0 items-center rounded-full outline-none transition-transform duration-200 ease-spring focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]"
      >
        <span aria-hidden="true" className="flex shrink-0 -space-x-2">
          {shown.map((contributor) => (
            <span key={contributor.id}>
              <ContributorAvatar
                contributor={contributor}
                className={AVATAR_CLASS}
              />
            </span>
          ))}
        </span>
        {extra > 0 ? (
          <span
            aria-hidden="true"
            className="-ml-1 rounded-full bg-secondary px-2 py-1 font-mono font-semibold text-muted-foreground text-xs tabular-nums"
          >
            {t('contributorsMore', { count: extra })}
          </span>
        ) : null}
      </button>
      {opening > 0 ? (
        <ContributorsDialog
          key={opening}
          trackId={trackId}
          open={open}
          onOpenChange={setOpen}
        />
      ) : null}
    </>
  );
}

/** How many times the Track was viewed, with the locale's number format. */
function ViewCount({ count }: { count: number }) {
  const t = useTranslations('tracks.practice');
  return <span className="shrink-0 tabular-nums">{t('views', { count })}</span>;
}

/** The line under the title: artists, then the duration, each after a dot. */
function TrackFacts({
  header,
  showViews,
}: {
  header: TrackDetail;
  showViews: boolean;
}) {
  const hasCredit = header.artistCredit.length > 0;
  return (
    <p className="flex min-w-0 items-center gap-2 text-muted-foreground text-sm">
      {hasCredit ? (
        <span className="truncate">
          <ArtistCredit credit={header.artistCredit} />
        </span>
      ) : null}
      {header.durationMs === null ? null : (
        <>
          {hasCredit ? <span aria-hidden="true">·</span> : null}
          <TrackDuration ms={header.durationMs} />
        </>
      )}
      {showViews ? (
        <>
          {hasCredit || header.durationMs !== null ? (
            <span aria-hidden="true">·</span>
          ) : null}
          <ViewCount count={header.viewCount ?? 0} />
        </>
      ) : null}
    </p>
  );
}

/**
 * The practice page's one-line title row: cover, title, artists (linked),
 * duration and the Contributors' avatars (linked to their Profiles), plus
 * the signed-in User's best score at the current difficulty. It wraps
 * on a phone, the avatars dropping under the title, and stays a single row
 * from `sm`.
 */
export function TrackTitleRow({
  header,
  privateActions,
}: {
  header: TrackDetail;
  privateActions?: ReactNode;
}) {
  return (
    <section
      aria-labelledby="track-title"
      className="flex flex-wrap items-center gap-x-4 gap-y-3"
    >
      <span className="relative block size-14 shrink-0 overflow-hidden rounded-xl bg-muted shadow-xs sm:size-16">
        <TrackCoverArt
          coverArtUrl={header.coverUrl}
          placeholderSeed={header.id}
          sizes="64px"
          unoptimized
        />
      </span>
      <div className="flex min-w-0 flex-1 basis-48 flex-col">
        <h1
          id="track-title"
          className="truncate font-bold text-xl tracking-tight sm:text-2xl"
        >
          {header.title}
        </h1>
        <TrackFacts header={header} showViews={!privateActions} />
      </div>
      {header.contributors.length > 0 ? (
        <Contributors
          contributors={header.contributors}
          total={header.contributorCount}
          trackId={header.id}
        />
      ) : null}
      {privateActions ?? (
        <>
          <TrackBestScore trackId={header.id} />
          <TrackFavoriteButton trackId={header.id} />
          <TrackShareButton header={header} />
        </>
      )}
    </section>
  );
}
