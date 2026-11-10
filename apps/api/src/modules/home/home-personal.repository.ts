import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import { albumTracks } from '../../database/schema/albums.js';
import { dailyPracticeStreaks } from '../../database/schema/daily-practice-streaks.js';
import { practiceAttempts } from '../../database/schema/practice-attempts.js';
import { trackCooccurrences } from '../../database/schema/track-cooccurrences.js';
import { trackFavorites } from '../../database/schema/track-favorites.js';
import { hasCompletedProcessing } from '../../database/schema/track-processings.js';
import {
  type StoredArtistCreditEntry,
  tracks,
} from '../../database/schema/tracks.js';
import { homeArtistKeys } from './home-artist-keys.js';
import { refreshCommunityCooccurrence } from './home-community-cooccurrence.repository.js';
import type {
  PersonalAlbumTrack,
  PersonalTrackCandidate,
  UserFavoriteSignal,
  UserTrackSignal,
} from './home-personal.repository.types.js';
import { PersonalHomeTasteRepository } from './home-personal-taste.repository.js';

export type {
  PersonalAlbumTrack,
  PersonalTrackCandidate,
  UserFavoriteSignal,
  UserTrackSignal,
} from './home-personal.repository.types.js';

/** The artist key the composer's per-row cap and the taste count by. */
const signalArtistKey = (
  credit: StoredArtistCreditEntry[],
  trackId: string,
): string => credit[0]?.mbid ?? credit[0]?.name ?? trackId;

/**
 * The User signals the personal feed blends in. The attempt and favorite
 * tables belong to their own features; this repository reads the aggregates
 * the feed builder needs so the home module never imports those modules (both
 * of them schedule through the home's queue, which would be a module cycle).
 */
@Injectable()
export class PersonalHomeRepository {
  constructor(
    private readonly txHost: TransactionHost<DatabaseAdapter>,
    private readonly tasteRepository: PersonalHomeTasteRepository,
  ) {}

  async findUserTrackSignals(userId: string): Promise<UserTrackSignal[]> {
    const rows = await this.txHost.tx
      .select({
        trackId: practiceAttempts.trackId,
        attempts: count(),
        bestAccuracy: sql<number>`max(${practiceAttempts.accuracy})`,
        lastAttemptAt: sql<Date>`max(${practiceAttempts.createdAt})`.mapWith(
          practiceAttempts.createdAt,
        ),
        genres: tracks.genres,
        credit: tracks.artistCredit,
        title: tracks.title,
        coverUrl: tracks.coverUrl,
        artistCredit: tracks.artistCredit,
        durationMs: tracks.lengthMs,
        vocalRangeLowest: tracks.vocalRangeLowest,
        vocalRangeHighest: tracks.vocalRangeHighest,
      })
      .from(practiceAttempts)
      .innerJoin(tracks, eq(tracks.id, practiceAttempts.trackId))
      .where(
        and(
          eq(practiceAttempts.userId, userId),
          hasCompletedProcessing(practiceAttempts.trackId),
        ),
      )
      .groupBy(
        practiceAttempts.trackId,
        tracks.genres,
        tracks.artistCredit,
        tracks.title,
        tracks.coverUrl,
        tracks.lengthMs,
        tracks.vocalRangeLowest,
        tracks.vocalRangeHighest,
      )
      .orderBy(desc(sql`max(${practiceAttempts.createdAt})`));
    return rows.map((row) => ({
      trackId: row.trackId,
      attempts: row.attempts,
      bestAccuracy: row.bestAccuracy,
      lastAttemptAt: row.lastAttemptAt,
      genres: row.genres,
      artistKey: signalArtistKey(row.credit, row.trackId),
      title: row.title,
      coverUrl: row.coverUrl,
      artistCredit: row.artistCredit.map(({ name, joinPhrase }) => ({
        name,
        joinPhrase,
      })),
      durationMs: row.durationMs,
      vocalRangeLowest: row.vocalRangeLowest,
      vocalRangeHighest: row.vocalRangeHighest,
    }));
  }

  async findUserFavoriteSignals(userId: string): Promise<UserFavoriteSignal[]> {
    const rows = await this.txHost.tx
      .select({
        trackId: trackFavorites.trackId,
        genres: tracks.genres,
        credit: tracks.artistCredit,
        createdAt: trackFavorites.createdAt,
      })
      .from(trackFavorites)
      .innerJoin(tracks, eq(tracks.id, trackFavorites.trackId))
      .where(
        and(
          eq(trackFavorites.userId, userId),
          hasCompletedProcessing(trackFavorites.trackId),
        ),
      );
    return rows.map((row) => ({
      trackId: row.trackId,
      genres: row.genres,
      artistKey: signalArtistKey(row.credit, row.trackId),
      createdAt: row.createdAt,
    }));
  }

  async findAlbumTracks(albumIds: string[]): Promise<PersonalAlbumTrack[]> {
    if (albumIds.length === 0) return [];
    const rows = await this.txHost.tx
      .select({
        albumId: albumTracks.albumId,
        id: tracks.id,
        title: tracks.title,
        coverUrl: tracks.coverUrl,
        artistCredit: tracks.artistCredit,
        durationMs: tracks.lengthMs,
        vocalRangeLowest: tracks.vocalRangeLowest,
        vocalRangeHighest: tracks.vocalRangeHighest,
        genres: tracks.genres,
        trendingScore: tracks.trendingScore,
      })
      .from(albumTracks)
      .innerJoin(tracks, eq(tracks.id, albumTracks.trackId))
      .where(
        and(
          inArray(albumTracks.albumId, albumIds),
          hasCompletedProcessing(tracks.id),
        ),
      );
    return rows;
  }

  /** Rebuilds the bounded, global co-occurrence ranking consumed by personal feeds. */
  async refreshCommunityCooccurrence(): Promise<void> {
    await refreshCommunityCooccurrence(this.txHost.tx);
  }

  async findCommunityCooccurrence(sourceTrackIds: string[]): Promise<
    {
      sourceTrackId: string;
      targetTrackId: string;
      score: number;
      singers?: number;
    }[]
  > {
    if (sourceTrackIds.length === 0) {
      return [];
    }
    const rows = await this.txHost.tx
      .select({
        sourceTrackId: trackCooccurrences.sourceTrackId,
        targetTrackId: trackCooccurrences.targetTrackId,
        score: trackCooccurrences.score,
        singers: trackCooccurrences.singerCount,
      })
      .from(trackCooccurrences)
      .where(inArray(trackCooccurrences.sourceTrackId, sourceTrackIds))
      .orderBy(
        desc(trackCooccurrences.score),
        desc(trackCooccurrences.singerCount),
        trackCooccurrences.targetTrackId,
      );
    return rows;
  }

  findUserSungTrackSources(
    userId: string,
    limit: number,
  ): Promise<{ trackId: string; lastAttemptAt: Date }[]> {
    return this.txHost.tx
      .select({
        trackId: practiceAttempts.trackId,
        lastAttemptAt: sql<Date>`max(${practiceAttempts.createdAt})`.mapWith(
          practiceAttempts.createdAt,
        ),
      })
      .from(practiceAttempts)
      .innerJoin(tracks, eq(tracks.id, practiceAttempts.trackId))
      .where(
        and(
          eq(practiceAttempts.userId, userId),
          eq(practiceAttempts.forwardSkip, false),
          eq(practiceAttempts.bleedSuspected, false),
          hasCompletedProcessing(tracks.id),
        ),
      )
      .groupBy(practiceAttempts.trackId)
      .orderBy(desc(sql`max(${practiceAttempts.createdAt})`))
      .limit(limit);
  }

  async findCommunityTrackCards(
    ids: string[],
  ): Promise<PersonalTrackCandidate[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.txHost.tx
      .select({
        id: tracks.id,
        title: tracks.title,
        coverUrl: tracks.coverUrl,
        artistCredit: tracks.artistCredit,
        durationMs: tracks.lengthMs,
        vocalRangeLowest: tracks.vocalRangeLowest,
        vocalRangeHighest: tracks.vocalRangeHighest,
        genres: tracks.genres,
        trendingScore: tracks.trendingScore,
      })
      .from(tracks)
      .where(and(hasCompletedProcessing(tracks.id), inArray(tracks.id, ids)));
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    });
  }

  async findTracksOutsideGenres(
    genres: string[],
    limit: number,
    offset = 0,
    excludedTrackIds: string[] = [],
  ): Promise<PersonalTrackCandidate[]> {
    return this.tasteRepository.findTracksOutsideGenres(
      genres,
      limit,
      offset,
      excludedTrackIds,
    );
  }

  findPopularTasteCandidates(
    limit: number,
    offset = 0,
    excludedTrackIds: string[] = [],
  ): Promise<PersonalTrackCandidate[]> {
    return this.tasteRepository.findPopularTracks(
      limit,
      offset,
      excludedTrackIds,
    );
  }

  async findDiscoveryTracks(ids: string[]): Promise<
    Map<
      string,
      {
        trendingScore: number;
        genres: string[];
        artistKey: string;
        artistKeys: string[];
      }
    >
  > {
    if (ids.length === 0) {
      return new Map();
    }
    const rows = await this.txHost.tx
      .select({
        id: tracks.id,
        trendingScore: tracks.trendingScore,
        genres: tracks.genres,
        credit: tracks.artistCredit,
      })
      .from(tracks)
      .where(and(hasCompletedProcessing(tracks.id), inArray(tracks.id, ids)));
    return new Map(
      rows.map((row) => [
        row.id,
        {
          trendingScore: row.trendingScore,
          genres: row.genres,
          artistKey: signalArtistKey(row.credit, row.id),
          artistKeys: homeArtistKeys(row.credit, row.id),
        },
      ]),
    );
  }

  async findActiveUserIds(since: Date, limit: number): Promise<string[]> {
    const [attempted, heartbeated] = await Promise.all([
      this.txHost.tx
        .selectDistinct({ userId: practiceAttempts.userId })
        .from(practiceAttempts)
        .where(gte(practiceAttempts.createdAt, since)),
      this.txHost.tx
        .selectDistinct({ userId: dailyPracticeStreaks.userId })
        .from(dailyPracticeStreaks)
        .where(gte(dailyPracticeStreaks.lastHeartbeatAt, since)),
    ]);
    const union = new Set([
      ...attempted.map((row) => row.userId),
      ...heartbeated.map((row) => row.userId),
    ]);
    return [...union].slice(0, limit);
  }
}
