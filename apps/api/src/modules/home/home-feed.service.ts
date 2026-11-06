import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  cacheTags,
  type HomeRow,
  type HomeTrack,
  LOCALES,
  type Locale,
} from '@vozzify/contracts';
import { WebRevalidationService } from '../../integrations/web-revalidation/web-revalidation.service.js';
import type { HomeTrackRecord } from './home.repository.js';
import { HomeRepository } from './home.repository.js';
import { minimalHomeFeed, type StoredHomeFeed } from './home-feed.js';
import { HomeFeedStore } from './home-feed.store.js';
import { HomeFeedBuilder } from './home-feed-builder.service.js';
import { DEFAULT_HOME_LOCALE } from './home-rules.js';

export type CurrentPublicFeed = {
  feed: StoredHomeFeed;
  /** False for the fallback home, which no cache may keep. */
  cacheable: boolean;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Every Track a row shows, whatever its layout. */
const homeTrackIds = (rows: HomeRow[]): string[] => [
  ...new Set(
    rows.flatMap((row) => {
      if (row.layout === 'hero') return [row.track.id];
      if (
        row.layout === 'standard' ||
        row.layout === 'vocal-range' ||
        row.layout === 'ranked'
      ) {
        return row.items.map((item) => item.id);
      }
      return [];
    }),
  ),
];

/** The MBIDs the records credit, for the artist lookup. */
const creditedMbids = (records: HomeTrackRecord[]): string[] => [
  ...new Set(
    records.flatMap((record) =>
      record.artistCredit.flatMap((entry) =>
        entry.mbid === undefined ? [] : [entry.mbid],
      ),
    ),
  ),
];

/** One row with every credited name linked to its Artist page when known. */
const linkRow =
  (
    creditById: ReadonlyMap<string, HomeTrackRecord['artistCredit']>,
    idByMbid: ReadonlyMap<string, string>,
  ) =>
  <T extends HomeTrack>(track: T): T => {
    const credit = creditById.get(track.id);
    if (credit === undefined) {
      return {
        ...track,
        artistCredit: track.artistCredit.map((entry) => ({
          ...entry,
          artistId: null,
        })),
      };
    }
    return {
      ...track,
      artistCredit: credit.map((entry) => ({
        name: entry.name,
        joinPhrase: entry.joinPhrase,
        artistId:
          entry.mbid === undefined ? null : (idByMbid.get(entry.mbid) ?? null),
      })),
    };
  };

const linkRows = (
  rows: HomeRow[],
  link: <T extends HomeTrack>(track: T) => T,
): HomeRow[] =>
  rows.map((row): HomeRow => {
    if (row.layout === 'hero') return { ...row, track: link(row.track) };
    if (row.layout === 'vocal-range') {
      return { ...row, items: row.items.map(link) };
    }
    if (row.layout === 'standard' || row.layout === 'ranked') {
      return { ...row, items: row.items.map(link) };
    }
    return row;
  });

/**
 * Owns the public feeds' lifecycle, one per locale. The request path only
 * reads them: a missing feed is built by one request under a lock, and the
 * others get the minimal home. The hourly job and the boot warm-up call
 * `refreshPublic`, which revalidates a locale's web tag only when its content
 * changed.
 */
@Injectable()
export class HomeFeedService {
  private readonly logger = new Logger(HomeFeedService.name);

  constructor(
    private readonly store: HomeFeedStore,
    private readonly builder: HomeFeedBuilder,
    private readonly revalidation: WebRevalidationService,
    // Optional so the feed specs keep providing the service alone (only
    // HomeModule wires the repository). Without it rows keep their credit.
    @Optional() private readonly homeRepository?: HomeRepository,
  ) {}

  /**
   * Links every name a row credits to its Artist page. A name links by the
   * MBID the Track stored for it; credits stored without one, or whose
   * Artist is not in the catalog yet, keep a null ID and render unlinked.
   * Rows are enriched at serve time, so stored feeds need no migration.
   */
  async withArtistLinks(rows: HomeRow[]): Promise<HomeRow[]> {
    if (!this.homeRepository) {
      return rows;
    }
    const trackIds = homeTrackIds(rows);
    if (trackIds.length === 0) {
      return rows;
    }
    const records =
      await this.homeRepository.findCompletedTracksByIds(trackIds);
    const creditById = new Map(
      records.map((record) => [record.id, record.artistCredit]),
    );
    const artists = await this.homeRepository.findArtistIdsByMbids(
      creditedMbids(records),
    );
    return linkRows(
      rows,
      linkRow(
        creditById,
        new Map(artists.map((artist) => [artist.mbid, artist.id])),
      ),
    );
  }

  /**
   * Builds one locale's public feed and commits it. A changed feed is
   * revalidated before it is stored: if the revalidation cannot be queued the
   * call fails with nothing stored, so the retry still sees a change and
   * revalidates. Storing first would make the retry see an unchanged feed, and
   * the web would never be revalidated. The revalidation is only queued here;
   * the web fetches the feed when the job runs, a moment after the commit.
   */
  async refreshPublic(
    locale: Locale = DEFAULT_HOME_LOCALE,
  ): Promise<StoredHomeFeed> {
    const next = await this.builder.build(locale);
    const current = await this.store.readCurrent(locale);
    if (current?.version === next.version) {
      await this.store.writeCurrent(locale, next);
      return next;
    }
    await this.revalidation.revalidate([cacheTags.home(locale)]);
    await this.commit(locale, current, next);
    return next;
  }

  /** The feed a request serves: the stored one, or one built under the lock. */
  async currentPublic(
    locale: Locale,
    options: { buildIfMissing?: boolean } = {},
  ): Promise<CurrentPublicFeed> {
    const current = await this.store.readCurrent(locale);
    if (current) {
      return { feed: current, cacheable: true };
    }
    if (options.buildIfMissing === false) {
      return { feed: minimalHomeFeed(), cacheable: false };
    }
    if (!(await this.store.acquireLock(locale))) {
      return { feed: minimalHomeFeed(), cacheable: false };
    }
    try {
      return { feed: await this.buildUnderLock(locale), cacheable: true };
    } finally {
      await this.store.releaseLock(locale);
    }
  }

  /** Reads a stored feed without building, committing, or revalidating it. */
  async storedPublicForPreview(locale: Locale): Promise<StoredHomeFeed> {
    return (await this.store.readCurrent(locale)) ?? minimalHomeFeed();
  }

  /**
   * The feed a cursor names: the current feed of any locale, or a version
   * retained for about 30 minutes after it was replaced. Undefined when the
   * version is gone. Versions are hashes that include the locale, so the
   * version alone names the feed.
   */
  async publicVersion(version: string): Promise<StoredHomeFeed | undefined> {
    const current = await this.findCurrentByVersion(version);
    if (current) {
      return current;
    }
    return this.store.readRetired(version);
  }

  private async findCurrentByVersion(
    version: string,
  ): Promise<StoredHomeFeed | undefined> {
    for (const locale of LOCALES) {
      const feed = await this.store.readCurrent(locale);
      if (feed?.version === version) {
        return feed;
      }
    }
    return undefined;
  }

  /**
   * Best effort on purpose: a request that builds the missing feed still
   * answers when the web can't be revalidated right now. The feed is stored
   * and the error is logged; the web catches up on the next content change or
   * when its own cache entry expires. Only the hourly job retries, and it
   * revalidates only on change, so this path does not feed that retry.
   */
  private async buildUnderLock(locale: Locale): Promise<StoredHomeFeed> {
    const next = await this.builder.build(locale);
    const current = await this.store.readCurrent(locale);
    await this.commit(locale, current, next);
    if (current?.version !== next.version) {
      await this.revalidation
        .revalidate([cacheTags.home(locale)])
        .catch((error: unknown) =>
          this.logger.error(`Home revalidation failed: ${errorMessage(error)}`),
        );
    }
    return next;
  }

  /**
   * Stores `next` as the locale's current feed. A replaced feed stays reachable
   * for the cursors still in flight.
   */
  private async commit(
    locale: Locale,
    current: StoredHomeFeed | undefined,
    next: StoredHomeFeed,
  ): Promise<void> {
    if (current && current.version !== next.version) {
      await this.store.retire(current);
    }
    await this.store.writeCurrent(locale, next);
  }
}
