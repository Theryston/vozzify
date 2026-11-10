import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { Locale } from '@vozzify/contracts';
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import { albumTracks } from '../../database/schema/albums.js';
import { practiceAttempts } from '../../database/schema/practice-attempts.js';
import { trackFavorites } from '../../database/schema/track-favorites.js';
import { hasCompletedProcessing } from '../../database/schema/track-processings.js';
import { trackViews } from '../../database/schema/track-views.js';
import { tracks } from '../../database/schema/tracks.js';
import { albumSingerContributions } from './home-album-singer-contributions.repository.js';
import {
  POPULARITY_WEIGHTS,
  SINGING_SIGNAL_WINDOW_DAYS,
  type TrackSignalCount,
} from './home-popularity.js';
import { weightedRecentAttempts } from './home-recent-attempts.repository.js';

export type HomeAlbumTrackSignal = {
  albumId: string;
  trackId: string;
  popularity: number;
};

export type HomeTrackPopularityScore = { trackId: string; score: number };

@Injectable()
export class HomePopularityRepository {
  constructor(private readonly txHost: TransactionHost<DatabaseAdapter>) {}

  findMostSungTrackIds(
    limit: number,
    since: Date,
    locale?: Locale,
    offset = 0,
  ): Promise<TrackSignalCount[]> {
    return weightedRecentAttempts(this.txHost.tx, {
      trackIds: undefined,
      limit,
      since,
      locale,
      offset,
    });
  }

  async popularityScoresForTracks(
    trackIds: string[],
    since: Date,
    locale?: Locale,
    localeViewScores: ReadonlyMap<string, number> = new Map(),
  ): Promise<HomeTrackPopularityScore[]> {
    if (trackIds.length === 0) return [];
    const [tracksById, singers, favorites] = await Promise.all([
      this.txHost.tx
        .select({ id: tracks.id, trendingScore: tracks.trendingScore })
        .from(tracks)
        .where(inArray(tracks.id, trackIds)),
      weightedRecentAttempts(this.txHost.tx, {
        trackIds,
        limit: trackIds.length,
        since,
        locale,
      }),
      this.txHost.tx
        .select({
          trackId: trackFavorites.trackId,
          count: sql<number>`count(*)::int`.mapWith(Number),
        })
        .from(trackFavorites)
        .where(
          and(
            inArray(trackFavorites.trackId, trackIds),
            gte(trackFavorites.createdAt, since),
          ),
        )
        .groupBy(trackFavorites.trackId),
    ]);
    const singerCount = new Map(singers.map((row) => [row.trackId, row.count]));
    const favoriteCount = new Map(
      favorites.map((row) => [row.trackId, row.count]),
    );
    return tracksById.map((track) => ({
      trackId: track.id,
      score:
        POPULARITY_WEIGHTS.trending *
          (locale === undefined
            ? track.trendingScore
            : (localeViewScores.get(track.id) ?? 0)) +
        POPULARITY_WEIGHTS.attempt * (singerCount.get(track.id) ?? 0) +
        POPULARITY_WEIGHTS.favorite * (favoriteCount.get(track.id) ?? 0),
    }));
  }

  async localePracticeEvidence(
    locale: Locale,
    since: Date,
  ): Promise<{ distinctUsers: number; activeDays: number }> {
    const [evidence] = await this.txHost.tx
      .select({
        distinctUsers:
          sql<number>`count(distinct ${practiceAttempts.userId})::int`.mapWith(
            Number,
          ),
        activeDays:
          sql<number>`count(distinct (${practiceAttempts.createdAt} at time zone 'UTC')::date)::int`.mapWith(
            Number,
          ),
      })
      .from(practiceAttempts)
      .leftJoin(trackViews, eq(trackViews.id, practiceAttempts.viewId))
      .where(
        and(
          eq(trackViews.locale, locale),
          eq(practiceAttempts.forwardSkip, false),
          eq(practiceAttempts.bleedSuspected, false),
          gte(practiceAttempts.createdAt, since),
        ),
      );
    return {
      distinctUsers: evidence?.distinctUsers ?? 0,
      activeDays: evidence?.activeDays ?? 0,
    };
  }

  findMostFavoritedTrackIds(
    limit: number,
    since: Date,
    offset = 0,
  ): Promise<TrackSignalCount[]> {
    return this.txHost.tx
      .select({
        trackId: trackFavorites.trackId,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(trackFavorites)
      .innerJoin(tracks, eq(trackFavorites.trackId, tracks.id))
      .where(
        and(
          hasCompletedProcessing(tracks.id),
          gte(trackFavorites.createdAt, since),
        ),
      )
      .groupBy(trackFavorites.trackId)
      .orderBy(desc(sql`count(*)`), asc(trackFavorites.trackId))
      .limit(limit)
      .offset(offset);
  }

  countRecentAttempts(
    trackIds: string[],
    since: Date,
    locale?: Locale,
  ): Promise<TrackSignalCount[]> {
    if (trackIds.length === 0) return Promise.resolve([]);
    return weightedRecentAttempts(this.txHost.tx, {
      trackIds,
      limit: trackIds.length,
      since,
      locale,
    });
  }

  countRecentFavorites(
    trackIds: string[],
    since: Date,
  ): Promise<TrackSignalCount[]> {
    if (trackIds.length === 0) return Promise.resolve([]);
    return this.txHost.tx
      .select({
        trackId: trackFavorites.trackId,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(trackFavorites)
      .where(
        and(
          inArray(trackFavorites.trackId, trackIds),
          gte(trackFavorites.createdAt, since),
        ),
      )
      .groupBy(trackFavorites.trackId);
  }

  async findAlbumTrackSignals(
    albumIds: string[],
    locale?: Locale,
    localeViewScores: readonly { trackId: string; score: number }[] = [],
  ): Promise<HomeAlbumTrackSignal[]> {
    if (albumIds.length === 0) return [];
    const since = new Date(
      Date.now() - SINGING_SIGNAL_WINDOW_DAYS * 24 * 60 * 60 * 1_000,
    );
    const singers = this.albumSingerContributions(albumIds, since, locale);
    if (!locale) {
      return this.globalAlbumSignals(albumIds, since, singers);
    }
    return this.localeAlbumSignals(albumIds, since, singers, localeViewScores);
  }

  private globalAlbumSignals(
    albumIds: string[],
    since: Date,
    singers: ReturnType<HomePopularityRepository['albumSingerContributions']>,
  ): Promise<HomeAlbumTrackSignal[]> {
    const candidates = this.txHost.tx
      .selectDistinct({ trackId: albumTracks.trackId })
      .from(albumTracks)
      .where(inArray(albumTracks.albumId, albumIds))
      .as('global_album_candidate_tracks');
    const favorites = this.txHost.tx
      .select({
        trackId: trackFavorites.trackId,
        count: sql<number>`count(*)::int`.mapWith(Number).as('count'),
      })
      .from(trackFavorites)
      .innerJoin(candidates, eq(candidates.trackId, trackFavorites.trackId))
      .where(gte(trackFavorites.createdAt, since))
      .groupBy(trackFavorites.trackId)
      .as('global_album_favorites');
    return this.txHost.tx
      .select({
        albumId: albumTracks.albumId,
        trackId: tracks.id,
        popularity: sql<number>`
          ${POPULARITY_WEIGHTS.trending} * ${tracks.trendingScore} +
          ${POPULARITY_WEIGHTS.attempt} * coalesce(${singers.contribution}, 0) +
          ${POPULARITY_WEIGHTS.favorite} * coalesce(${favorites.count}, 0)
        `.mapWith(Number),
      })
      .from(albumTracks)
      .innerJoin(tracks, eq(tracks.id, albumTracks.trackId))
      .leftJoin(singers, eq(singers.trackId, tracks.id))
      .leftJoin(favorites, eq(favorites.trackId, tracks.id))
      .where(
        and(
          inArray(albumTracks.albumId, albumIds),
          hasCompletedProcessing(tracks.id),
        ),
      );
  }

  private async localeAlbumSignals(
    albumIds: string[],
    since: Date,
    singers: ReturnType<HomePopularityRepository['albumSingerContributions']>,
    localeViewScores: readonly { trackId: string; score: number }[],
  ): Promise<HomeAlbumTrackSignal[]> {
    const rows = await this.txHost.tx
      .select({
        albumId: albumTracks.albumId,
        trackId: tracks.id,
        attempts: sql<number>`coalesce(${singers.contribution}, 0)`.mapWith(
          Number,
        ),
      })
      .from(albumTracks)
      .innerJoin(tracks, eq(tracks.id, albumTracks.trackId))
      .leftJoin(singers, eq(singers.trackId, tracks.id))
      .where(
        and(
          inArray(albumTracks.albumId, albumIds),
          hasCompletedProcessing(tracks.id),
        ),
      );
    const viewsByTrack = new Map(
      localeViewScores.map(({ trackId, score }) => [trackId, score]),
    );
    const favoriteCounts = await this.countRecentFavorites(
      [...new Set(rows.map((row) => row.trackId))],
      since,
    );
    const favoritesByTrack = new Map(
      favoriteCounts.map(({ trackId, count }) => [trackId, count]),
    );
    return rows.map((row) => ({
      albumId: row.albumId,
      trackId: row.trackId,
      popularity:
        (viewsByTrack.get(row.trackId) ?? 0) +
        POPULARITY_WEIGHTS.attempt * row.attempts +
        POPULARITY_WEIGHTS.favorite * (favoritesByTrack.get(row.trackId) ?? 0),
    }));
  }

  private albumSingerContributions(
    albumIds: string[],
    since: Date,
    locale?: Locale,
  ) {
    return albumSingerContributions(this.txHost.tx, albumIds, since, locale);
  }
}
