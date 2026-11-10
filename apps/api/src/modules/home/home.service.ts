import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type {
  HomePinPreviewRequest,
  HomePinPreviewResponse,
  HomeRow,
  Locale,
} from '@vozzify/contracts';
import { AppException } from '../../common/errors/app-exception.js';
import { decodeHomeCursor } from './home-cursor.js';
import { HomeFeedService } from './home-feed.service.js';
import { answerHomePage, type HomePage, type ServedFeed } from './home-page.js';
import { personalSnapshotStale } from './home-personal.js';
import { PersonalHomeStore } from './home-personal.store.js';
import { PersonalHomeQueueService } from './home-personal-queue.service.js';
import { queuePersonalHomeRefresh } from './home-personal-refresh.js';
import { findPersonalSnapshotVersion } from './home-personal-snapshot-lookup.js';
import { personalHomeVersion } from './home-personal-version.js';
import {
  type HomePinOverlayOptions,
  HomePinOverlayService,
} from './home-pin-overlay.service.js';
import { needsFrozenVisit } from './home-row-page.js';
import {
  DEFAULT_HOME_LOCALE,
  HOME_ALGORITHM_VERSION,
  HOME_PAGE_SIZE,
  PERSONAL_SNAPSHOT_STALE_AFTER_SECONDS,
  PRIVATE_HOME_CACHE_CONTROL,
  UNCACHED_HOME_CACHE_CONTROL,
} from './home-rules.js';
import { HomeSocialService } from './home-social.service.js';
import { HomeVisitService } from './home-visit.service.js';

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

  @Optional()
  @Inject(HomeSocialService)
  private readonly social?: HomeSocialService;

  @Optional()
  @Inject(HomeVisitService)
  private readonly visits?: HomeVisitService;

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

  async preview(request: HomePinPreviewRequest): Promise<{
    page: HomePinPreviewResponse;
    cacheable: false;
    cacheControl: string;
  }> {
    const feed = await this.feeds.storedPublicForPreview(request.locale);
    const signedIn = request.audience === 'signed-in';
    const previewRows = feed.rows;
    const rows = this.pinOverlay
      ? await this.pinOverlay.applyPreview(
          previewRows,
          { locale: request.locale, signedIn },
          request.pin,
          request.pinId,
        )
      : previewRows;
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
      ? await this.withPins(feed.rows, {
          locale,
          signedIn: false,
          candidates: feed.compositionCandidates,
          sourceVersion: feed.version,
        })
      : feed.rows;
    const visit = needsFrozenVisit(shown)
      ? await this.visits?.create(feed, shown, locale)
      : undefined;
    const canCache =
      this.visits === undefined
        ? cacheable
        : cacheable && (!needsFrozenVisit(shown) || visit !== undefined);
    return this.answer(
      {
        ...feed,
        version: visit?.version ?? feed.version,
        rows: visit?.rows ?? shown,
      },
      0,
      canCache,
      false,
    );
  }

  private async personalFirstPage(
    userId: string,
    locale: Locale,
  ): Promise<HomePage> {
    const snapshot = await this.snapshots?.readCurrent(userId, locale);
    if (!snapshot) {
      return this.personalFallbackFirstPage(userId, locale);
    }
    if (
      snapshot.algorithmVersion !== HOME_ALGORITHM_VERSION ||
      personalSnapshotStale(
        snapshot.generatedAt,
        PERSONAL_SNAPSHOT_STALE_AFTER_SECONDS,
      )
    ) {
      await queuePersonalHomeRefresh(this.refresh, this.logger, userId, locale);
    }
    const currentRows = await this.withSocialRows(snapshot.rows, userId);
    const shown = await this.withPins(currentRows, {
      locale,
      signedIn: true,
      audience: 'personal',
      candidates: snapshot.compositionCandidates,
    });
    const visit = needsFrozenVisit(shown)
      ? await this.visits?.create(snapshot, shown, locale, userId)
      : undefined;
    return this.answer(
      {
        ...snapshot,
        version: visit?.version ?? snapshot.version,
        rows: visit?.rows ?? shown,
      },
      0,
      true,
      true,
    );
  }

  private async personalFallbackFirstPage(
    userId: string,
    locale: Locale,
  ): Promise<HomePage> {
    await queuePersonalHomeRefresh(this.refresh, this.logger, userId, locale);
    const { feed, cacheable } = await this.feeds.currentPublic(locale);
    const currentRows = await this.withSocialRows(feed.rows, userId);
    const shown = cacheable
      ? await this.withPins(currentRows, {
          locale,
          signedIn: true,
          audience: 'personal',
        })
      : currentRows;
    const personalFeed = { ...feed, audience: 'personal' as const };
    const visit =
      cacheable && needsFrozenVisit(shown)
        ? await this.visits?.create(personalFeed, shown, locale, userId)
        : undefined;
    const version =
      visit?.version ??
      (this.social
        ? personalHomeVersion(userId, locale, feed.algorithmVersion, shown)
        : feed.version);
    const rows =
      visit?.rows ??
      (shown.length > HOME_PAGE_SIZE ? shown.slice(0, HOME_PAGE_SIZE) : shown);
    return this.answer({ ...personalFeed, version, rows }, 0, cacheable, true);
  }

  private async versionPage(
    cursor: string,
    signedIn: boolean,
  ): Promise<HomePage> {
    const { version, position } = decodeHomeCursor(cursor);
    const visit = await this.visits?.publicVersion(version, signedIn);
    if (visit) {
      return this.answer(visit, position, true, signedIn);
    }
    const feed = await this.feeds.publicVersion(version);
    if (!feed) {
      throw new AppException(
        'NOT_FOUND',
        'This home feed version is no longer served; start again from the first page',
        { reason: 'FEED_VERSION_EXPIRED' },
      );
    }
    const feedLocale = feed.locale ?? DEFAULT_HOME_LOCALE;
    const shown = await this.withPins(feed.rows, {
      locale: feedLocale,
      signedIn,
      ...(signedIn ? { audience: 'personal' as const } : {}),
      ...(signedIn ? {} : { candidates: feed.compositionCandidates }),
      sourceVersion: feed.version,
    });
    return this.answer({ ...feed, rows: shown }, position, true, signedIn);
  }

  private async personalVersionPage(
    userId: string,
    cursor: string,
    locale: Locale,
  ): Promise<HomePage> {
    const { version, position } = decodeHomeCursor(cursor);
    const snapshot = await findPersonalSnapshotVersion(
      this.snapshots,
      userId,
      locale,
      version,
    );
    if (snapshot) {
      const visit = await this.visits?.personalVersion(
        version,
        userId,
        snapshot.locale,
      );
      if (visit) {
        return this.answer(visit, position, true, true);
      }
      const currentRows = await this.withSocialRows(snapshot.rows, userId);
      const shown = await this.withPins(currentRows, {
        locale: snapshot.locale,
        signedIn: true,
        audience: 'personal',
        candidates: snapshot.compositionCandidates,
      });
      return this.answer({ ...snapshot, rows: shown }, position, true, true);
    }
    const visit = await this.visits?.personalVersion(version, userId, locale);
    if (visit) {
      return this.answer(visit, position, true, true);
    }
    const page = await this.versionPage(cursor, true);
    return {
      ...page,
      page: { ...page.page, audience: 'personal' as const },
      cacheControl: PRIVATE_HOME_CACHE_CONTROL,
    };
  }

  private async withPins(
    rows: HomeRow[],
    options: HomePinOverlayOptions,
  ): Promise<HomeRow[]> {
    const audience = options.audience ?? 'public';
    const visibleRows = rows;
    if (!this.pinOverlay) {
      return visibleRows;
    }
    return this.pinOverlay.apply(
      visibleRows,
      {
        locale: options.locale,
        signedIn: options.signedIn,
        audience,
        sourceVersion: options.sourceVersion,
      },
      options.candidates,
    );
  }

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
    return answerHomePage({
      feed,
      position,
      cacheable,
      signedIn,
      linkRows: (rows) => this.linkRows(rows),
    });
  }

  private async linkRows(rows: HomeRow[]): Promise<HomeRow[]> {
    const linker = this.feeds.withArtistLinks;
    return linker === undefined ? rows : linker.call(this.feeds, rows);
  }
}
