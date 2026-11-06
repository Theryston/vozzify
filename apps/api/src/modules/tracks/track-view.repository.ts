import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { Locale } from '@vozzify/contracts';
import { and, eq, gte, inArray, isNull, type SQL, sql } from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import { trackViews } from '../../database/schema/track-views.js';
import type { LocaleTrackViews } from './track-locale-trending.js';
import {
  averageViewsPerTrack,
  type PlatformViewAverages,
  type TrackViewCounts,
} from './trending-score.js';
import type { ViewWindowStarts } from './view-windows.js';

/** The views at or after `start`, as a number. */
const viewsSince = (start: Date): SQL<number> =>
  sql<number>`count(*) filter (where ${trackViews.createdAt} >= ${start.toISOString()}::timestamptz)`.mapWith(
    Number,
  );

/** The Tracks with a view at or after `start`, as a number. */
const tracksViewedSince = (start: Date): SQL<number> =>
  sql<number>`count(distinct ${trackViews.trackId}) filter (where ${trackViews.createdAt} >= ${start.toISOString()}::timestamptz)`.mapWith(
    Number,
  );

/** The views per trending window, and over all time. */
const windowCounts = (starts: ViewWindowStarts) => ({
  hour: viewsSince(starts.hour),
  day: viewsSince(starts.day),
  week: viewsSince(starts.week),
  month: viewsSince(starts.month),
  allTime: sql<number>`count(*)`.mapWith(Number),
});

/** A recorded view, as far as attaching a User to it needs. */
export type StoredView = {
  id: string;
  userId: string | null;
  clickId: string | null;
  visitorId: string | null;
};

/** Track views, and the counts the trending score is made of. */
@Injectable()
export class TrackViewRepository {
  constructor(private readonly txHost: TransactionHost<DatabaseAdapter>) {}

  async create(
    trackId: string,
    userId: string | null,
    locale: Locale | undefined,
    attribution?: { clickId?: string; visitorId?: string },
  ): Promise<string> {
    const [row] = await this.txHost.tx
      .insert(trackViews)
      .values({ trackId, userId, locale, ...attribution })
      .returning({ id: trackViews.id });
    if (row === undefined) {
      throw new Error('Insert returned no row');
    }
    return row.id;
  }

  /** The view, only when it belongs to the Track. */
  async findView(
    viewId: string,
    trackId: string,
  ): Promise<StoredView | undefined> {
    const [row] = await this.txHost.tx
      .select({
        id: trackViews.id,
        userId: trackViews.userId,
        clickId: trackViews.clickId,
        visitorId: trackViews.visitorId,
      })
      .from(trackViews)
      .where(and(eq(trackViews.id, viewId), eq(trackViews.trackId, trackId)))
      .limit(1);
    return row;
  }

  /** Attaches the User to a view nobody owns; an owned view is left alone. */
  async attachUser(viewId: string, userId: string): Promise<void> {
    await this.txHost.tx
      .update(trackViews)
      .set({ userId })
      .where(and(eq(trackViews.id, viewId), isNull(trackViews.userId)));
  }

  /** Backfills an anonymous visitor id without replacing an existing one. */
  async attachVisitor(viewId: string, visitorId: string): Promise<void> {
    await this.txHost.tx
      .update(trackViews)
      .set({ visitorId })
      .where(and(eq(trackViews.id, viewId), isNull(trackViews.visitorId)));
  }

  /** The Track's views per window and over all time. */
  async countTrackViews(
    trackId: string,
    starts: ViewWindowStarts,
  ): Promise<TrackViewCounts> {
    const [row] = await this.txHost.tx
      .select(windowCounts(starts))
      .from(trackViews)
      .where(eq(trackViews.trackId, trackId));
    return row ?? { hour: 0, day: 0, week: 0, month: 0, allTime: 0 };
  }

  /**
   * Each Track's views in one locale, per window and over all time, for the
   * Tracks viewed this month (the others score 0 and are not needed).
   */
  localeViewCounts(
    locale: Locale,
    starts: ViewWindowStarts,
  ): Promise<LocaleTrackViews[]> {
    return this.txHost.tx
      .select({ trackId: trackViews.trackId, ...windowCounts(starts) })
      .from(trackViews)
      .where(eq(trackViews.locale, locale))
      .groupBy(trackViews.trackId)
      .having(sql`${viewsSince(starts.month)} > 0`);
  }

  localeViewCountsForTracks(
    locale: Locale,
    starts: ViewWindowStarts,
    trackIds: string[],
  ): Promise<LocaleTrackViews[]> {
    if (trackIds.length === 0) return Promise.resolve([]);
    return this.txHost.tx
      .select({ trackId: trackViews.trackId, ...windowCounts(starts) })
      .from(trackViews)
      .where(
        and(
          eq(trackViews.locale, locale),
          inArray(trackViews.trackId, trackIds),
        ),
      )
      .groupBy(trackViews.trackId)
      .having(sql`${viewsSince(starts.month)} > 0`);
  }

  async localePlatformAverages(
    locale: Locale,
    starts: ViewWindowStarts,
  ): Promise<{ averages: PlatformViewAverages; monthViews: number }> {
    const [row] = await this.txHost.tx
      .select({
        hourViews: viewsSince(starts.hour),
        hourTracks: tracksViewedSince(starts.hour),
        dayViews: viewsSince(starts.day),
        dayTracks: tracksViewedSince(starts.day),
        monthViews: viewsSince(starts.month),
      })
      .from(trackViews)
      .where(
        and(
          eq(trackViews.locale, locale),
          gte(trackViews.createdAt, starts.month),
        ),
      );
    return {
      averages: {
        hour: averageViewsPerTrack(row?.hourViews ?? 0, row?.hourTracks ?? 0),
        day: averageViewsPerTrack(row?.dayViews ?? 0, row?.dayTracks ?? 0),
      },
      monthViews: row?.monthViews ?? 0,
    };
  }

  /** Views per viewed Track on the platform, this hour and today. */
  async platformAverages(
    starts: ViewWindowStarts,
  ): Promise<PlatformViewAverages> {
    // The hour is inside the day, so nothing before the day matters.
    const [row] = await this.txHost.tx
      .select({
        hourViews: viewsSince(starts.hour),
        hourTracks: tracksViewedSince(starts.hour),
        dayViews: viewsSince(starts.day),
        dayTracks: tracksViewedSince(starts.day),
      })
      .from(trackViews)
      .where(gte(trackViews.createdAt, starts.day));
    return {
      hour: averageViewsPerTrack(row?.hourViews ?? 0, row?.hourTracks ?? 0),
      day: averageViewsPerTrack(row?.dayViews ?? 0, row?.dayTracks ?? 0),
    };
  }
}
