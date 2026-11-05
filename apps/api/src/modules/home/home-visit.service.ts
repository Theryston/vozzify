import { Injectable, Optional } from '@nestjs/common';
import type { HomeFeed, HomeRow, Locale } from '@vozzify/contracts';
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
    const visit = await this.store.read(version);
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
      row?.id.startsWith('pin-') ? (pinned.get(row.id) ?? null) : row,
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
