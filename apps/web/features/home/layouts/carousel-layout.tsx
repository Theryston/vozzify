import type { HomeCarouselRow, HomeFeedPage, Locale } from '@vozzify/contracts';
import { useHomeRowItems } from '../hooks/use-home-row-items';
import { RowCarouselShell, RowTrackCards } from './row-carousel-shell';

/**
 * A row of Tracks as a horizontal carousel: CSS scroll snapping (no carousel
 * library), each card a real link with its Vocal-range chip when the feed
 * carries one. The sponsored notice, when set, sits under the title.
 */
export function CarouselLayout({
  row,
  priority,
  locale,
  onVisitExpired,
}: {
  row: HomeCarouselRow;
  priority: boolean;
  locale?: Locale;
  onVisitExpired?: (page: HomeFeedPage) => void;
}) {
  return row.nextItemsCursor ? (
    <PagedCarouselLayout
      row={row}
      priority={priority}
      locale={locale ?? 'en'}
      onVisitExpired={onVisitExpired}
    />
  ) : (
    <CarouselRowView row={row} priority={priority} items={row.items} />
  );
}

function PagedCarouselLayout({
  row,
  priority,
  locale,
  onVisitExpired,
}: {
  row: HomeCarouselRow;
  priority: boolean;
  locale: Locale;
  onVisitExpired?: (page: HomeFeedPage) => void;
}) {
  const loaded = useHomeRowItems({
    rowId: row.id,
    layout: 'standard',
    initialItems: row.items,
    cursor: row.nextItemsCursor,
    locale,
    onVisitExpired,
  });
  return (
    <CarouselRowView
      row={row}
      priority={priority}
      items={loaded.items}
      loadMore={loaded.loadMore}
      failed={loaded.failed}
      retry={loaded.retry}
    />
  );
}

function CarouselRowView({
  row,
  priority,
  items,
  loadMore,
  failed,
  retry,
}: {
  row: HomeCarouselRow;
  priority: boolean;
  items: HomeCarouselRow['items'];
  loadMore?: () => void;
  failed?: boolean;
  retry?: () => void;
}) {
  return (
    <RowCarouselShell
      rowId={row.id}
      title={row.title}
      sponsored={row.sponsored}
      onNearEnd={loadMore}
      loadFailed={failed}
      onRetry={retry}
    >
      <RowTrackCards items={items} priority={priority} />
    </RowCarouselShell>
  );
}
