import { Injectable, Optional } from '@nestjs/common';
import {
  type HomeFeed,
  type HomeRow,
  LOCALES,
  type Locale,
} from '@vozzify/contracts';
import { AppException } from '../../common/errors/app-exception.js';
import { allHomeCompositionCandidates } from './home-composition-candidates.js';
import { HomeFeedService } from './home-feed.service.js';
import { HomePinOverlayService } from './home-pin-overlay.service.js';
import { HomeSocialService } from './home-social.service.js';
import { HomeVisitStore, type StoredHomeVisit } from './home-visit.store.js';

/** Owns the frozen composition and live eligibility checks for a visit. */
@Injectable()
export class HomeVisitService {
  constructor(
    private readonly store: HomeVisitStore,
    @Optional() private readonly pins?: HomePinOverlayService,
    @Optional() private readonly social?: HomeSocialService,
    @Optional() private readonly feeds?: HomeFeedService,
  ) {}

  create(
    feed: Omit<HomeFeed, 'nextCursor'>,
    rows: HomeRow[],
    locale: Locale,
    ownerId?: string,
  ): Promise<StoredHomeVisit | undefined> {
    return this.store.create({ ...feed, rows, locale }, ownerId);
  }

  async publicVersion(
    version: string,
    signedIn: boolean,
  ): Promise<StoredHomeVisit | undefined> {
    const visit =
      (await this.store.read(version)) ??
      (await this.recreatePublicVersion(version));
    if (visit?.ownerId !== null || visit.audience !== 'public')
      return undefined;
    return {
      ...visit,
      rows: await this.refreshPins(visit.rows, visit.locale, signedIn),
    };
  }

  async personalVersion(
    version: string,
    userId: string,
    locale: Locale,
  ): Promise<StoredHomeVisit | undefined> {
    const visit = await this.store.read(version);
    if (
      visit?.ownerId !== userId ||
      visit.audience !== 'personal' ||
      visit.locale !== locale
    ) {
      return undefined;
    }
    const rows = await this.refreshPins(visit.rows, locale, true);
    return {
      ...visit,
      rows: await this.refreshSocial(rows, userId),
    };
  }

  async rowItemsVersion(
    version: string,
    rowId: string,
    userId: string | undefined,
    locale: Locale,
  ): Promise<HomeRow | undefined> {
    const visit =
      (await this.store.read(version)) ??
      (await this.recreatePublicVersion(version));
    if (!visit) throw expiredVisit();
    if (visit.audience === 'public' && visit.ownerId === null) {
      if (visit.locale !== locale) return undefined;
      return this.currentItemRow(
        visit.rows,
        rowId,
        visit.locale,
        userId !== undefined,
      );
    }
    if (userId === undefined) return undefined;
    if (
      visit.ownerId !== userId ||
      visit.audience !== 'personal' ||
      visit.locale !== locale
    )
      return undefined;
    const row = await this.currentItemRow(visit.rows, rowId, locale, true);
    if (row?.layout !== 'people') return row;
    const socialRows = await this.refreshSocial([row], userId);
    return socialRows[0] ?? undefined;
  }

  private async currentItemRow(
    rows: (HomeRow | null)[],
    rowId: string,
    locale: Locale,
    signedIn: boolean,
  ): Promise<HomeRow | undefined> {
    const frozen = rows.find((row) => row?.id === rowId);
    if (!frozen) return undefined;
    if (!rowId.startsWith('pin-')) return frozen;
    // Pin placement depends on the complete frozen composition: earlier Pins
    // and the hero may already claim tracks that this row also references.
    const live = await this.refreshPins(rows, locale, signedIn);
    const refreshed = live.find((row) => row?.id === rowId);
    if (!refreshed || !sameTrackMembership(frozen, refreshed)) {
      throw expiredVisit();
    }
    return refreshed;
  }

  private async recreatePublicVersion(
    version: string,
  ): Promise<StoredHomeVisit | undefined> {
    if (!this.feeds) return undefined;
    for (const locale of LOCALES) {
      const { feed, cacheable } = await this.feeds.currentPublic(locale, {
        buildIfMissing: false,
      });
      if (!cacheable) continue;
      const rows = this.pins
        ? await this.pins.apply(
            feed.rows,
            {
              locale,
              signedIn: false,
              sourceVersion: feed.version,
              allowSourceRefill: false,
            },
            allHomeCompositionCandidates(feed),
          )
        : feed.rows;
      const visit = await this.store.create({ ...feed, rows, locale });
      if (visit?.version === version) return visit;
    }
    return undefined;
  }

  private async refreshPins(
    rows: (HomeRow | null)[],
    locale: Locale,
    signedIn: boolean,
  ): Promise<(HomeRow | null)[]> {
    if (!this.pins) return rows;
    const refreshed = await this.pins.refreshFrozen(
      rows.flatMap((row) => (row ? [row] : [])),
      { locale, signedIn },
    );
    const pinned = new Map(
      refreshed
        .filter((row) => row.id.startsWith('pin-'))
        .map((row) => [row.id, row]),
    );
    return rows.map((row) =>
      row?.id.startsWith('pin-')
        ? preserveFrozenPinLayout(row, pinned.get(row.id))
        : row,
    );
  }

  private async refreshSocial(
    rows: (HomeRow | null)[],
    userId: string,
  ): Promise<(HomeRow | null)[]> {
    if (!this.social) return rows;
    const liveRows = new Map(
      (await this.social.rowsFor(userId)).map((row) => [row.id, row]),
    );
    return rows.map((row) => {
      if (row?.layout !== 'people') return row;
      const live = liveRows.get(row.id);
      if (live?.layout !== 'people') return null;
      const liveItems = new Map(live.items.map((item) => [item.id, item]));
      const items = row.items.flatMap((item) => {
        const visible = liveItems.get(item.id);
        return visible ? [visible] : [];
      });
      return items.length >= 3 ? { ...row, items } : null;
    });
  }
}

const preserveFrozenPinLayout = (
  frozen: HomeRow | null,
  refreshed: HomeRow | undefined,
): HomeRow | null => {
  if (frozen === null || refreshed === undefined) return null;
  if (frozen.layout === refreshed.layout) return refreshed;
  if (frozen.layout === 'hero' && refreshed.layout === 'standard') {
    const track = refreshed.items[0];
    return track
      ? {
          id: frozen.id,
          layout: 'hero',
          sponsored: refreshed.sponsored,
          track,
        }
      : null;
  }
  if (frozen.layout === 'standard' && refreshed.layout === 'hero') {
    return {
      id: frozen.id,
      layout: 'standard',
      title: frozen.title,
      sponsored: refreshed.sponsored,
      items: [refreshed.track],
    };
  }
  return null;
};

const expiredVisit = () =>
  new AppException(
    'NOT_FOUND',
    'This home visit is no longer served; start again from the first page',
    { reason: 'FEED_VERSION_EXPIRED' },
  );

const sameTrackMembership = (
  frozen: HomeRow | null,
  current: HomeRow | null | undefined,
): boolean => {
  if (!current || frozen?.layout !== current.layout) return false;
  if (frozen.layout === 'standard' && current.layout === 'standard') {
    return (
      frozen.sponsored === current.sponsored &&
      JSON.stringify(frozen.title) === JSON.stringify(current.title) &&
      frozen.items.map(({ id }) => id).join(',') ===
        current.items.map(({ id }) => id).join(',')
    );
  }
  if (frozen.layout === 'vocal-range' && current.layout === 'vocal-range') {
    return (
      frozen.items.map(({ id }) => id).join(',') ===
      current.items.map(({ id }) => id).join(',')
    );
  }
  return frozen.layout === 'hero' && current.layout === 'hero';
};
