import type {
  HomeFeedPage,
  HomeTrack,
  HomeVocalRangeRow,
  HomeVocalRangeTrack,
  Locale,
} from '@vozzify/contracts';
import { useHomeRowItems } from '../hooks/use-home-row-items';
import { RowCarouselShell, RowTrackCards } from './row-carousel-shell';

/**
 * A by-voice row: the carousel shell, with each card's Vocal range drawn as
 * a bar over its cover and named in its chip. The bar is decorative (hidden
 * from assistive tech); the chip carries the same range as text. The
 * sponsored notice, when set, sits under the title like on a standard row.
 */
export function VocalRangeLayout({
  row,
  priority,
  locale,
  onVisitExpired,
}: {
  row: HomeVocalRangeRow;
  priority: boolean;
  locale?: Locale;
  onVisitExpired?: (page: HomeFeedPage) => void;
}) {
  return row.nextItemsCursor ? (
    <PagedVocalRangeLayout
      row={row}
      priority={priority}
      locale={locale ?? 'en'}
      onVisitExpired={onVisitExpired}
    />
  ) : (
    <VocalRangeRowView
      row={row}
      priority={priority}
      items={row.items}
      exhausted
    />
  );
}

function PagedVocalRangeLayout({
  row,
  priority,
  locale,
  onVisitExpired,
}: {
  row: HomeVocalRangeRow;
  priority: boolean;
  locale: Locale;
  onVisitExpired?: (page: HomeFeedPage) => void;
}) {
  const loaded = useHomeRowItems({
    rowId: row.id,
    layout: 'vocal-range',
    initialItems: row.items,
    cursor: row.nextItemsCursor,
    locale,
    onVisitExpired,
  });
  const items = loaded.items.filter(isVocalRangeTrack);
  return (
    <VocalRangeRowView
      row={row}
      priority={priority}
      items={items}
      exhausted={!loaded.hasMore}
      loadMore={loaded.loadMore}
      failed={loaded.failed}
      retry={loaded.retry}
    />
  );
}

const isVocalRangeTrack = (track: HomeTrack): track is HomeVocalRangeTrack =>
  track.vocalRange !== null;

function VocalRangeRowView({
  row,
  priority,
  items,
  exhausted,
  loadMore,
  failed,
  retry,
}: {
  row: HomeVocalRangeRow;
  priority: boolean;
  items: HomeVocalRangeRow['items'];
  exhausted: boolean;
  loadMore?: () => void;
  failed?: boolean;
  retry?: () => void;
}) {
  return (
    <RowCarouselShell
      rowId={row.id}
      title={row.title}
      sponsored={row.sponsored}
      exhausted={exhausted}
      onNearEnd={loadMore}
      loadFailed={failed}
      onRetry={retry}
    >
      <RowTrackCards items={items} priority={priority} rangeBar />
    </RowCarouselShell>
  );
}
