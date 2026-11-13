import type { HomeFeedPage, HomeRow, Locale } from '@vozzify/contracts';
import { Fragment } from 'react';
import { HomeInFeedAd } from '@/features/advertising/components/home-in-feed-ad';
import type { AdsenseConfig } from '@/lib/env/adsense-config';

import {
  homeLayoutRegistry,
  isRegisteredLayout,
} from '../layouts/layout-registry';
import { visibleRows } from '../visible-rows';

/** Renders known feed rows without pagination or engagement tracking. */
export function HomeFeedRows({
  rows,
  locale = 'en',
  onVisitExpired,
  advertising,
}: {
  rows: HomeRow[];
  locale?: Locale;
  onVisitExpired?: (page: HomeFeedPage) => void;
  advertising?: AdsenseConfig;
}) {
  const visible = visibleRows(rows, isRegisteredLayout);
  return (
    <div className="relative flex flex-col gap-8 py-2">
      {visible.map((row, index) => (
        <Fragment
          key={`${row.id}-${'nextItemsCursor' in row ? (row.nextItemsCursor ?? '') : ''}`}
        >
          <div data-home-row-id={row.id}>
            {homeLayoutRegistry[row.layout].render(
              row,
              index === 0,
              locale,
              onVisitExpired,
            )}
          </div>
          {(index + 1) % 3 === 0 ? <HomeInFeedAd config={advertising} /> : null}
        </Fragment>
      ))}
    </div>
  );
}
