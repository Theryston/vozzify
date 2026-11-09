import type { HomeFeedPage, HomeRow, Locale } from '@vozzify/contracts';
import type { ReactNode } from 'react';

import type { SponsoredPlacement } from '../components/sponsored-notice';
import { AlbumsLayout } from './albums-layout';
import { ArtistsLayout } from './artists-layout';
import { CarouselLayout } from './carousel-layout';
import { DailyTargetLayout } from './daily-target-layout';
import { GenresLayout } from './genres-layout';
import { HeroLayout } from './hero-layout';
import { PeopleLayout } from './people-layout';
import { RankedLayout } from './ranked-layout';
import { VocalRangeLayout } from './vocal-range-layout';

type LayoutOf<TLayout extends HomeRow['layout']> = Extract<
  HomeRow,
  { layout: TLayout }
>;

/** One registered layout: where its sponsored notice goes, and how it renders. */
export type HomeLayoutEntry = {
  placement: SponsoredPlacement;
  render: (
    row: HomeRow,
    priority: boolean,
    locale?: Locale,
    onVisitExpired?: (page: HomeFeedPage) => void,
  ) => ReactNode;
};

function isLayoutOf<TLayout extends HomeRow['layout']>(
  row: HomeRow,
  layout: TLayout,
): row is LayoutOf<TLayout> {
  return row.layout === layout;
}

/**
 * Binds a layout component to its name in the feed. The row is narrowed by
 * `layout` before the component sees it, so a component only ever gets its own
 * row shape.
 */
function registerLayout<TLayout extends HomeRow['layout']>(
  layout: TLayout,
  placement: SponsoredPlacement,
  Component: (props: {
    row: LayoutOf<TLayout>;
    priority: boolean;
    locale?: Locale;
    onVisitExpired?: (page: HomeFeedPage) => void;
  }) => ReactNode,
): HomeLayoutEntry {
  return {
    placement,
    render: (row, priority, locale, onVisitExpired) =>
      isLayoutOf(row, layout) ? (
        <Component
          row={row}
          priority={priority}
          locale={locale}
          onVisitExpired={onVisitExpired}
        />
      ) : null,
  };
}

/**
 * Every layout the web can render, keyed by the feed's `layout` field. A new
 * layout is registered here and nowhere else; `layout-registry.test.ts`
 * renders each entry with `sponsored` on, so none can forget the notice.
 */
export const homeLayoutRegistry = {
  hero: registerLayout('hero', 'caption', HeroLayout),
  standard: registerLayout('standard', 'line', CarouselLayout),
  'vocal-range': registerLayout('vocal-range', 'line', VocalRangeLayout),
  'daily-target': registerLayout('daily-target', 'line', DailyTargetLayout),
  ranked: registerLayout('ranked', 'line', RankedLayout),
  genres: registerLayout('genres', 'line', GenresLayout),
  artists: registerLayout('artists', 'line', ArtistsLayout),
  albums: registerLayout('albums', 'line', AlbumsLayout),
  people: registerLayout('people', 'line', PeopleLayout),
} satisfies Record<HomeRow['layout'], HomeLayoutEntry>;

/** Whether the web renders this layout; any other one is skipped. */
export const isRegisteredLayout = (
  layout: string,
): layout is HomeRow['layout'] => Object.hasOwn(homeLayoutRegistry, layout);
