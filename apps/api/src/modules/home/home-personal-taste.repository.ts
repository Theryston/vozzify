import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TrackVocalRange } from '@vozzify/contracts';
import {
  and,
  arrayOverlaps,
  desc,
  eq,
  gte,
  isNotNull,
  lte,
  not,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
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

type CandidateQuery = {
  filter?: SQL<unknown>;
  order: 'popular' | 'newest';
  limit: number;
  offset?: number;
  excludedTrackIds?: string[];
};

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
    offset = 0,
    excludedTrackIds: string[] = [],
  ): Promise<PersonalTrackCandidate[]> {
    if (genres.length === 0) return [];
    return this.trackCandidates({
      filter: arrayOverlaps(tracks.genres, genres),
      order: 'popular',
      limit,
      offset,
      excludedTrackIds,
    });
  }

  /** Bounded global fallback candidates for personalized discovery. */
  findPopularTracks(
    limit: number,
    offset = 0,
    excludedTrackIds: string[] = [],
  ): Promise<PersonalTrackCandidate[]> {
    return this.trackCandidates({
      order: 'popular',
      limit,
      offset,
      excludedTrackIds,
    });
  }

  findNewestTracks(
    limit: number,
    offset = 0,
    excludedTrackIds: string[] = [],
  ): Promise<PersonalTrackCandidate[]> {
    return this.trackCandidates({
      order: 'newest',
      limit,
      offset,
      excludedTrackIds,
    });
  }

  findMostSungTracks(
    limit: number,
    since: Date,
    offset = 0,
    excludedTrackIds: string[] = [],
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
          ...(excludedTrackIds.length > 0
            ? [notInArray(practiceAttempts.trackId, excludedTrackIds)]
            : []),
        ),
      )
      .groupBy(practiceAttempts.trackId, practiceAttempts.userId)
      .as('personal_home_singer_attempts');
    const contribution = sql`sum(1 + ${HOME_STAGE2_PARAMETERS.repeatWeight}::numeric * least(${perUser.attempts} - 1, ${HOME_STAGE2_PARAMETERS.repeatCap}))`;
    const volume = sql`sum(${perUser.attempts})`;
    return this.trackCandidateSelection()
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
      .limit(limit)
      .offset(offset);
  }

  findVoiceCandidates(
    userRange: TrackVocalRange,
    limit: number,
    offset = 0,
    excludedTrackIds: string[] = [],
  ): Promise<PersonalTrackCandidate[]> {
    const trackWidth = sql`${tracks.vocalRangeHighest} - ${tracks.vocalRangeLowest}`;
    const maximumOverrun = sql`greatest(
      greatest(${userRange.lowest} - ${tracks.vocalRangeLowest}, 0),
      greatest(${tracks.vocalRangeHighest} - ${userRange.highest}, 0)
    )`;
    const fitCandidate = and(
      lte(trackWidth, userRange.highest - userRange.lowest),
      gte(tracks.vocalRangeLowest, userRange.lowest - 3),
      lte(tracks.vocalRangeHighest, userRange.highest + 3),
    );
    const challengeCandidate = and(
      gte(maximumOverrun, 1),
      lte(maximumOverrun, 3),
    );
    return this.trackCandidates({
      filter: and(
        isNotNull(tracks.vocalRangeLowest),
        isNotNull(tracks.vocalRangeHighest),
        or(fitCandidate, challengeCandidate),
      ),
      order: 'popular',
      limit,
      offset,
      excludedTrackIds,
    });
  }

  async findTracksOutsideGenres(
    genres: string[],
    limit: number,
  ): Promise<PersonalTrackCandidate[]> {
    if (genres.length === 0) return [];
    return this.trackCandidates({
      filter: not(arrayOverlaps(tracks.genres, genres)),
      order: 'popular',
      limit,
    });
  }

  private trackCandidates({
    filter,
    order,
    limit,
    offset = 0,
    excludedTrackIds = [],
  }: CandidateQuery): Promise<PersonalTrackCandidate[]> {
    return this.trackCandidateSelection()
      .from(tracks)
      .where(
        and(
          hasCompletedProcessing(tracks.id),
          ...(filter ? [filter] : []),
          ...(excludedTrackIds.length > 0
            ? [notInArray(tracks.id, excludedTrackIds)]
            : []),
        ),
      )
      .orderBy(
        desc(order === 'popular' ? tracks.trendingScore : tracks.createdAt),
        desc(tracks.id),
      )
      .limit(limit)
      .offset(offset);
  }

  private trackCandidateSelection() {
    return this.txHost.tx.select({
      id: tracks.id,
      title: tracks.title,
      coverUrl: tracks.coverUrl,
      artistCredit: tracks.artistCredit,
      durationMs: tracks.lengthMs,
      vocalRangeLowest: tracks.vocalRangeLowest,
      vocalRangeHighest: tracks.vocalRangeHighest,
      genres: tracks.genres,
      trendingScore: tracks.trendingScore,
    });
  }
}
