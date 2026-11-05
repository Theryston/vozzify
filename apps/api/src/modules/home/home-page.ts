import type { HomeFeed, HomeRow } from '@vozzify/contracts';
import { encodeHomeCursor } from './home-cursor.js';
import {
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
  rows: (HomeRow | null)[];
};

export const pageOf = (feed: ServedFeed, position: number): HomeFeed => {
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

export const cacheControlOf = (
  cacheable: boolean,
  signedIn: boolean,
): string => {
  if (!cacheable) return UNCACHED_HOME_CACHE_CONTROL;
  return signedIn ? PRIVATE_HOME_CACHE_CONTROL : PUBLIC_HOME_CACHE_CONTROL;
};
