'use client';

import type { Locale } from '@vozzify/contracts';
import { type HomeFeedPage, homeAudienceSchema } from '@vozzify/contracts';
import { useMemo } from 'react';
import type { TrackedHomePage, TrackedHomeRow } from './tracked-rows';
import { useHomeEvents } from './use-home-events';

const trackedPages = (
  pages: HomeFeedPage[],
  locale: Locale,
): TrackedHomePage[] =>
  pages.map((page) => {
    const audience = homeAudienceSchema.safeParse(page.audience);
    return {
      version: page.version,
      algorithmVersion: page.algorithmVersion,
      locale,
      ...(audience.success ? { audience: audience.data } : {}),
      rows: page.rows.map(
        (row): TrackedHomeRow => ({
          id: row.id,
          items:
            row.layout === 'hero'
              ? [{ id: row.track.id }]
              : // The daily-target strip and the entity rows (genres, artists,
                // albums) carry no Tracks, so there is nothing to track:
                // recordRowImpression returns early on an empty items list,
                // making this a no-op for those layouts.
                row.layout === 'daily-target' ||
                  row.layout === 'genres' ||
                  row.layout === 'artists' ||
                  row.layout === 'albums' ||
                  row.layout === 'people'
                ? []
                : row.items.map((item) => ({ id: item.id })),
        }),
      ),
    };
  });

/**
 * The home's engagement instrumentation: row impressions and card clicks,
 * sent to `POST /v1/events` in batches. Renders nothing; the row wrapper
 * carries the row id and the layouts the card attributes this reads.
 */
export function HomeEventsTracker({
  pages,
  locale,
}: {
  pages: HomeFeedPage[];
  locale: Locale;
}) {
  const tracked = useMemo(() => trackedPages(pages, locale), [locale, pages]);
  useHomeEvents(tracked);
  return null;
}
