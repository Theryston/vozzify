import type { HomeRowTitle, HomeTrack } from '@vozzify/contracts';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { TrackCard } from '@/features/tracks/components/track-card';
import { creditText } from '@/lib/track-credit';
import { CarouselScroller } from '../components/carousel-scroller';
import { SponsoredNotice } from '../components/sponsored-notice';
import {
  CAROUSEL_COVER_SIZES,
  CAROUSEL_HEADER_CLASS,
  CAROUSEL_ITEM_CLASS,
  CAROUSEL_TITLE_CLASS,
} from '../layout-dimensions';
import { rowHeadingId } from '../row-heading-id';
import { isHomeRowTitleKey } from '../row-titles';

/** Covers of the first row that load eagerly: the ones on the first screen. */
const EAGER_COVERS = 4;

/**
 * The shell every Track-carousel row shares: the translated title, the
 * sponsored line under it, and the snap track. A title key this web doesn't
 * know hides the row instead of showing a raw key.
 */
export function RowCarouselShell({
  rowId,
  title,
  sponsored,
  children,
  onNearEnd,
  loadFailed,
  onRetry,
}: {
  rowId: string;
  title: HomeRowTitle;
  sponsored: boolean | undefined;
  children: ReactNode;
  onNearEnd?: () => void;
  loadFailed?: boolean;
  onRetry?: () => void;
}) {
  const t = useTranslations();
  const carouselText = useTranslations('home.carousel');
  if (!isHomeRowTitleKey(title.key)) return null;
  const headingId = rowHeadingId(rowId);
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <CarouselScroller
        onNearEnd={onNearEnd}
        header={
          <div className={CAROUSEL_HEADER_CLASS}>
            <h2 id={headingId} className={CAROUSEL_TITLE_CLASS}>
              {t(title.key, title.params)}
            </h2>
            {sponsored ? <SponsoredNotice placement="line" /> : null}
          </div>
        }
      >
        {children}
      </CarouselScroller>
      {loadFailed ? (
        <div role="alert" className="flex items-center gap-3 text-sm">
          <p className="text-muted-foreground">
            {carouselText('loadMoreItemsError')}
          </p>
          <button
            type="button"
            className="text-primary underline underline-offset-4"
            onClick={onRetry}
          >
            {carouselText('retryItems')}
          </button>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The cards of a carousel row: each a real link, with its Vocal-range chip
 * when the feed carries one, and the range bar on the by-voice rows. Every
 * card shares the carousel's fixed widths, so one skeleton fits all rows.
 * Each item also carries the tracking attributes the home events tracker
 * reads.
 */
export function RowTrackCards({
  items,
  priority,
  rangeBar,
}: {
  items: readonly HomeTrack[];
  priority: boolean;
  rangeBar?: boolean;
}) {
  return (
    <>
      {items.map((track, index) => (
        <li
          key={track.id}
          className={CAROUSEL_ITEM_CLASS}
          data-home-item-id={track.id}
          data-home-item-position={index}
        >
          <TrackCard
            trackId={track.id}
            title={track.title}
            subtitle={creditText(track.artistCredit)}
            coverArtUrl={track.coverUrl}
            placeholderSeed={track.id}
            coverSizes={CAROUSEL_COVER_SIZES}
            coverPriority={priority && index < EAGER_COVERS}
            vocalRange={track.vocalRange}
            rangeBar={rangeBar}
            nativeTrackLink
            fitsVoice={track.fitsVoice}
          />
        </li>
      ))}
    </>
  );
}
