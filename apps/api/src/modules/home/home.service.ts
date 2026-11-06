import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type {
  HomeFeed,
  HomePinPreviewRequest,
  HomePinPreviewResponse,
  HomeRow,
  Locale,
} from '@vozzify/contracts';
import { AppException } from '../../common/errors/app-exception.js';
import { decodeHomeCursor, encodeHomeCursor } from './home-cursor.js';
import type { StoredPersonalHomeFeed } from './home-feed.js';
import { HomeFeedService } from './home-feed.service.js';
import { personalSnapshotStale } from './home-personal.js';
import { PersonalHomeStore } from './home-personal.store.js';
import { PersonalHomeQueueService } from './home-personal-queue.service.js';
import { HomePinOverlayService } from './home-pin-overlay.service.js';
import {
  DEFAULT_HOME_LOCALE,
  HOME_PAGE_SIZE,
  PERSONAL_SNAPSHOT_STALE_AFTER_SECONDS,
  PRIVATE_HOME_CACHE_CONTROL,
  PUBLIC_HOME_CACHE_CONTROL,
  UNCACHED_HOME_CACHE_CONTROL,
} from './home-rules.js';
import { HomeSocialService } from './home-social.service.js';

export type HomePage = {
  page: HomeFeed;
  /** False when the response must not be stored by any cache. */
  cacheable: boolean;
  /** The `Cache-Control` header the response is sent with. */
  cacheControl: string;
};

type ServedFeed = {
  audience: HomeFeed['audience'];
  version: string;
  algorithmVersion: number;
  rows: HomeRow[];
};

/** One page of a feed: its rows from `position`, and where the next one starts. */
const pageOf = (feed: ServedFeed, position: number): HomeFeed => {
  const end = position + HOME_PAGE_SIZE;
  return {
    audience: feed.audience,
    version: feed.version,
    algorithmVersion: feed.algorithmVersion,
    rows: feed.rows.slice(position, end),
    nextCursor:
      end < feed.rows.length
        ? encodeHomeCursor({ version: feed.version, position: end })
        : null,
  };
};

const cacheControlOf = (cacheable: boolean, signedIn: boolean): string => {
  if (!cacheable) {
    return UNCACHED_HOME_CACHE_CONTROL;
  }
  return signedIn ? PRIVATE_HOME_CACHE_CONTROL : PUBLIC_HOME_CACHE_CONTROL;
};

/**
 * Serves the home feed a request asks for. The first page comes from the
 * locale's current feed; a cursor resumes the version it was issued for, so a
 * feed regenerated in between never shifts the rows of the visit. The live
 * editorial pins are overlaid on the stored rows per request.
 *
 * A signed-in visitor gets their personal feed: the stored snapshot when one
 * is served (fresh or stale), or the public rows meanwhile. A snapshot older
 * than the staleness limit, or a missing one, queues a rebuild, so the
 * request never computes it. The personal answer carries `audience:
 * personal` with private, non-storable headers, and never reaches a shared
 * cache.
 */
@Injectable()
export class HomeService {
  private readonly logger = new Logger(HomeService.name);

  constructor(
    private readonly feeds: HomeFeedService,
    // Optional only so the feed can be served without the pin overlay (the feed
    // specs provide the feed service alone). HomeModule always provides it.
    @Optional() private readonly pinOverlay?: HomePinOverlayService,
    // Optional for the same reason: only HomeModule wires the snapshots.
    @Optional() private readonly snapshots?: PersonalHomeStore,
    @Optional() private readonly refresh?: PersonalHomeQueueService,
  ) {}

  // Visibility changes must mask social snapshots on every signed-in read.
  @Optional()
  @Inject(HomeSocialService)
  private readonly social?: HomeSocialService;

  /**
   * The first page is the locale's current feed; a cursor resumes the version
   * it was issued for, and the locale is the one that feed was built for, so
   * the `locale` argument is ignored for it. The minimal home is never
   * overlaid. A signed-in visitor is named by `userId`.
   */
  async getPage(
    cursor: string | undefined,
    locale: Locale = DEFAULT_HOME_LOCALE,
    userId?: string,
  ): Promise<HomePage> {
    if (cursor === undefined) {
      return userId === undefined
        ? this.anonymousFirstPage(locale)
        : this.personalFirstPage(userId, locale);
    }
    return userId === undefined
      ? this.versionPage(cursor, false)
      : this.personalVersionPage(userId, cursor, locale);
  }

  /** A private admin preview from the neutral current feed, never a snapshot. */
  async preview(request: HomePinPreviewRequest): Promise<{
    page: HomePinPreviewResponse;
    cacheable: false;
    cacheControl: string;
  }> {
    const feed = await this.feeds.storedPublicForPreview(request.locale);
    const signedIn = request.audience === 'signed-in';
    const rows = this.pinOverlay
      ? await this.pinOverlay.applyPreview(
          feed.rows,
          { locale: request.locale, signedIn },
          request.pin,
          request.pinId,
        )
      : feed.rows;
    return {
      page: {
        audience: signedIn ? 'personal' : 'public',
        version: feed.version,
        algorithmVersion: feed.algorithmVersion,
        rows: await this.linkRows(rows),
        nextCursor: null,
      },
      cacheable: false,
      cacheControl: UNCACHED_HOME_CACHE_CONTROL,
    };
  }

  private async anonymousFirstPage(locale: Locale): Promise<HomePage> {
    const { feed, cacheable } = await this.feeds.currentPublic(locale);
    const shown = cacheable
      ? await this.withPins(feed.rows, locale, false)
      : feed.rows;
    return this.answer({ ...feed, rows: shown }, 0, cacheable, false);
  }

  private async personalFirstPage(
    userId: string,
    locale: Locale,
  ): Promise<HomePage> {
    const snapshot = await this.snapshots?.readCurrent(userId, locale);
    if (!snapshot) {
      await this.requestRefresh(userId, locale);
      const { feed, cacheable } = await this.feeds.currentPublic(locale);
      const currentRows = await this.withSocialRows(feed.rows, userId);
      const shown = cacheable
        ? await this.withPins(currentRows, locale, true)
        : currentRows;
      // No snapshot yet: the public rows go out at once, as the personal
      // answer, while the rebuild runs.
      return this.answer(
        { ...feed, audience: 'personal' as const, rows: shown },
        0,
        cacheable,
        true,
      );
    }
    if (
      personalSnapshotStale(
        snapshot.generatedAt,
        PERSONAL_SNAPSHOT_STALE_AFTER_SECONDS,
      )
    ) {
      await this.requestRefresh(userId, locale);
    }
    const currentRows = await this.withSocialRows(snapshot.rows, userId);
    const shown = await this.withPins(currentRows, locale, true, 'personal');
    return this.answer({ ...snapshot, rows: shown }, 0, true, true);
  }

  private async versionPage(
    cursor: string,
    signedIn: boolean,
  ): Promise<HomePage> {
    const { version, position } = decodeHomeCursor(cursor);
    const feed = await this.feeds.publicVersion(version);
    if (!feed) {
      // Not a 410 with its own code: that code would need a translation in
      // every client. The client restarts from the first page on this one.
      throw new AppException(
        'NOT_FOUND',
        'This home feed version is no longer served; start again from the first page',
        { reason: 'FEED_VERSION_EXPIRED' },
      );
    }
    const feedLocale = feed.locale ?? DEFAULT_HOME_LOCALE;
    const shown = await this.withPins(feed.rows, feedLocale, signedIn);
    return this.answer({ ...feed, rows: shown }, position, true, signedIn);
  }

  /**
   * A cursor page of a signed-in visitor: the snapshot version it names when
   * still served, else the public one. Either way the answer is personal with
   * private headers, so no shared cache can keep it.
   */
  private async personalVersionPage(
    userId: string,
    cursor: string,
    locale: Locale,
  ): Promise<HomePage> {
    const { version, position } = decodeHomeCursor(cursor);
    const snapshot = await this.snapshotVersion(userId, locale, version);
    if (snapshot) {
      const currentRows = await this.withSocialRows(snapshot.rows, userId);
      const shown = await this.withPins(
        currentRows,
        snapshot.locale,
        true,
        'personal',
      );
      return this.answer({ ...snapshot, rows: shown }, position, true, true);
    }
    const page = await this.versionPage(cursor, false);
    return {
      ...page,
      page: { ...page.page, audience: 'personal' as const },
      cacheControl: PRIVATE_HOME_CACHE_CONTROL,
    };
  }

  private async snapshotVersion(
    userId: string,
    locale: Locale,
    version: string,
  ): Promise<StoredPersonalHomeFeed | undefined> {
    const current = await this.snapshots?.readCurrent(userId, locale);
    if (current?.version === version) {
      return current;
    }
    return this.snapshots?.readRetired(version);
  }

  /** Queues a snapshot rebuild without failing the request when it cannot. */
  private async requestRefresh(userId: string, locale: Locale): Promise<void> {
    try {
      await this.refresh?.requestRefresh(userId, locale);
    } catch (error) {
      this.logger.warn(
        `Could not queue the personal home refresh: ${messageOf(error)}`,
      );
    }
  }

  private async withPins(
    rows: HomeRow[],
    locale: Locale,
    signedIn: boolean,
    audience: 'public' | 'personal' = 'public',
  ): Promise<HomeRow[]> {
    if (!this.pinOverlay) {
      return rows;
    }
    return this.pinOverlay.apply(rows, { locale, signedIn, audience });
  }

  /** Rebuilds social rows from current profile visibility before serving cache. */
  private async withSocialRows(
    rows: HomeRow[],
    userId: string,
  ): Promise<HomeRow[]> {
    if (!this.social) return rows;
    const retained = rows.filter((row) => row.layout !== 'people');
    return [...retained, ...(await this.social.rowsFor(userId))];
  }

  private async answer(
    feed: ServedFeed,
    position: number,
    cacheable: boolean,
    signedIn: boolean,
  ): Promise<HomePage> {
    const page = pageOf(feed, position);
    // Spec doubles of the feed service predate the artist linker; production
    // always wires the real one.
    const rows = await this.linkRows(page.rows);
    return {
      page: { ...page, rows },
      cacheable,
      cacheControl: cacheControlOf(cacheable, signedIn),
    };
  }

  private async linkRows(rows: HomeRow[]): Promise<HomeRow[]> {
    const linker = this.feeds.withArtistLinks;
    return linker === undefined ? rows : linker.call(this.feeds, rows);
  }
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
