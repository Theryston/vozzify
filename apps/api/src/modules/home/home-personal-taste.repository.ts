import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, arrayOverlaps, desc, eq, gte, not, sql } from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import { practiceAttempts } from '../../database/schema/practice-attempts.js';
import { hasCompletedProcessing } from '../../database/schema/track-processings.js';
import type { StoredArtistCreditEntry } from '../../database/schema/tracks.js';
import { tracks } from '../../database/schema/tracks.js';
import type {
  PersonalTrackCandidate,
  UserTasteActivity,
} from './home-personal.repository.types.js';
import { HOME_STAGE2_PARAMETERS } from './home-stage2-scoring.js';

const artistKeyOf = (
  credit: StoredArtistCreditEntry[],
  trackId: string,
): string => credit[0]?.mbid ?? credit[0]?.name ?? trackId;

@Injectable()
export class PersonalHomeTasteRepository {
  constructor(private readonly txHost: TransactionHost<DatabaseAdapter>) {}

  /** Practice taste stays per run so signal decay happens before aggregation. */
  async findUserTasteActivities(userId: string): Promise<UserTasteActivity[]> {
    const rows = await this.txHost.tx
      .select({
        trackId: tracks.id,
        genres: tracks.genres,
        credit: tracks.artistCredit,
        createdAt: practiceAttempts.createdAt,
      })
      .from(practiceAttempts)
      .innerJoin(tracks, eq(tracks.id, practiceAttempts.trackId))
      .where(
        and(
          eq(practiceAttempts.userId, userId),
          eq(practiceAttempts.forwardSkip, false),
          eq(practiceAttempts.bleedSuspected, false),
          hasCompletedProcessing(practiceAttempts.trackId),
        ),
      );
    return rows.map((row) => ({
      trackId: row.trackId,
      genres: row.genres,
      artistKey: artistKeyOf(row.credit, row.trackId),
      createdAt: row.createdAt,
    }));
  }

  async findTracksForGenres(
    genres: string[],
    limit: number,
  ): Promise<PersonalTrackCandidate[]> {
    if (genres.length === 0) return [];
    return this.trackCandidates(arrayOverlaps(tracks.genres, genres), limit);
  }

  /** Bounded global fallback candidates for personalized discovery. */
  findPopularTracks(limit: number): Promise<PersonalTrackCandidate[]> {
    return this.txHost.tx
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
      .where(hasCompletedProcessing(tracks.id))
      .orderBy(desc(tracks.trendingScore), desc(tracks.id))
      .limit(limit);
  }

  findNewestTracks(limit: number): Promise<PersonalTrackCandidate[]> {
    return this.txHost.tx
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
      .where(hasCompletedProcessing(tracks.id))
      .orderBy(desc(tracks.createdAt), desc(tracks.id))
      .limit(limit);
  }

  findMostSungTracks(
    limit: number,
    since: Date,
  ): Promise<PersonalTrackCandidate[]> {
    const perUser = this.txHost.tx
      .select({
        trackId: practiceAttempts.trackId,
        userId: practiceAttempts.userId,
        attempts: sql<number>`count(*)::int`.mapWith(Number).as('attempts'),
      })
      .from(practiceAttempts)
      .innerJoin(tracks, eq(tracks.id, practiceAttempts.trackId))
      .where(
        and(
          hasCompletedProcessing(tracks.id),
          eq(practiceAttempts.forwardSkip, false),
          eq(practiceAttempts.bleedSuspected, false),
          gte(practiceAttempts.createdAt, since),
        ),
      )
      .groupBy(practiceAttempts.trackId, practiceAttempts.userId)
      .as('personal_home_singer_attempts');
    const contribution = sql`sum(1 + ${HOME_STAGE2_PARAMETERS.repeatWeight}::numeric * least(${perUser.attempts} - 1, ${HOME_STAGE2_PARAMETERS.repeatCap}))`;
    const volume = sql`sum(${perUser.attempts})`;
    return this.txHost.tx
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
      .from(perUser)
      .innerJoin(tracks, eq(tracks.id, perUser.trackId))
      .groupBy(
        tracks.id,
        tracks.title,
        tracks.coverUrl,
        tracks.artistCredit,
        tracks.lengthMs,
        tracks.vocalRangeLowest,
        tracks.vocalRangeHighest,
        tracks.genres,
        tracks.trendingScore,
      )
      .orderBy(desc(contribution), desc(volume), desc(tracks.id))
      .limit(limit);
  }

  async findTracksOutsideGenres(
    genres: string[],
    limit: number,
  ): Promise<PersonalTrackCandidate[]> {
    if (genres.length === 0) return [];
    return this.trackCandidates(
      not(arrayOverlaps(tracks.genres, genres)),
      limit,
    );
  }

  private trackCandidates(
    genreFilter: ReturnType<typeof arrayOverlaps>,
    limit: number,
  ): Promise<PersonalTrackCandidate[]> {
    return this.txHost.tx
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
      .where(and(hasCompletedProcessing(tracks.id), genreFilter))
      .orderBy(desc(tracks.trendingScore), desc(tracks.id))
      .limit(limit);
  }
}
