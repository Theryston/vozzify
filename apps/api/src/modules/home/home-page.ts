import type {
  HomeFeed,
  HomePinPreviewResponse,
  HomeRow,
  Locale,
} from '@vozzify/contracts';
import { encodeHomeCursor } from './home-cursor.js';
import { pageHomeRowItems } from './home-row-page.js';
import {
  DEFAULT_HOME_LOCALE,
  HOME_PAGE_SIZE,
  PRIVATE_HOME_CACHE_CONTROL,
  PUBLIC_HOME_CACHE_CONTROL,
  UNCACHED_HOME_CACHE_CONTROL,
} from './home-rules.js';

export type HomePage = {
  page: HomeFeed;
  cacheable: boolean;
  cacheControl: string;
};

export type ServedFeed = {
  audience: HomeFeed['audience'];
  version: string;
  algorithmVersion: number;
  locale?: Locale;
  rows: (HomeRow | null)[];
};

const pageOf = (feed: ServedFeed, position: number): HomeFeed => {
  const end = position + HOME_PAGE_SIZE;
  return {
    audience: feed.audience,
    version: feed.version,
    algorithmVersion: feed.algorithmVersion,
    rows: feed.rows.slice(position, end).flatMap((row) => (row ? [row] : [])),
    nextCursor:
      end < feed.rows.length
        ? encodeHomeCursor({ version: feed.version, position: end })
        : null,
  };
};

const cacheControlOf = (cacheable: boolean, signedIn: boolean): string => {
  if (!cacheable) return UNCACHED_HOME_CACHE_CONTROL;
  return signedIn ? PRIVATE_HOME_CACHE_CONTROL : PUBLIC_HOME_CACHE_CONTROL;
};

export const answerHomePage = async ({
  feed,
  position,
  cacheable,
  signedIn,
  linkRows,
}: {
  feed: ServedFeed;
  position: number;
  cacheable: boolean;
  signedIn: boolean;
  linkRows: (rows: HomeRow[]) => Promise<HomeRow[]>;
}): Promise<HomePage> => {
  const page = pageOf(feed, position);
  const rows = await linkRows(
    page.rows.map((row) =>
      pageHomeRowItems(row, feed.version, feed.locale ?? DEFAULT_HOME_LOCALE),
    ),
  );
  return {
    page: { ...page, rows },
    cacheable,
    cacheControl: cacheControlOf(cacheable, signedIn),
  };
};

export type HomePreviewPage = {
  page: HomePinPreviewResponse;
  cacheable: false;
  cacheControl: string;
};

export const answerHomePreview = (
  feed: Pick<ServedFeed, 'version' | 'algorithmVersion'>,
  rows: HomeRow[],
  signedIn: boolean,
): HomePreviewPage => ({
  page: {
    audience: signedIn ? 'personal' : 'public',
    version: feed.version,
    algorithmVersion: feed.algorithmVersion,
    rows,
    nextCursor: null,
  },
  cacheable: false,
  cacheControl: UNCACHED_HOME_CACHE_CONTROL,
});
