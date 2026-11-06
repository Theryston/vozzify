import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, count, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import { artists, trackArtists } from '../../database/schema/artists.js';
import {
  practiceAttempts,
  type practiceDifficulty,
} from '../../database/schema/practice-attempts.js';
import { tracks } from '../../database/schema/tracks.js';
import type { OwnAttemptCursor } from './own-attempt-cursor.js';

type Difficulty = (typeof practiceDifficulty.enumValues)[number];

/** A saved practice run, as the database keeps it. */
export type PracticeAttemptRow = typeof practiceAttempts.$inferSelect;

/** A saved run with the header of the Track it was sung on. */
export type PracticeAttemptHistoryRow = {
  attempt: PracticeAttemptRow;
  track: Pick<
    typeof tracks.$inferSelect,
    'id' | 'title' | 'coverUrl' | 'artistCredit'
  >;
};

/**
 * The runs of a User that share a Track, a transposition and their flags, with
 * the best accuracy among them. Enough for the Vocal range: a group holds an
 * accurate run exactly when its best accuracy reaches the threshold.
 */
export type VocalRangeGroupRow = {
  trackId?: string;
  // Null for a Track without notes.
  trackVocalRangeLowest: number | null;
  trackVocalRangeHighest: number | null;
  transposeSemitones: number;
  forwardSkip: boolean;
  bleedSuspected: boolean;
  bestAccuracy: number;
};

export type VocalRangeEvidenceGroupRow = VocalRangeGroupRow & {
  trackId: string;
};

export type UserVocalRangeGroupRow = VocalRangeGroupRow & { userId: string };

/**
 * The runs of a User on the Tracks of one artist, split by the bleed flag,
 * with how many there are and when the latest one was saved.
 */
export type ArtistGroupRow = {
  artistId: string;
  artistName: string;
  bleedSuspected: boolean;
  attempts: number;
  lastAttemptAt: Date;
};

/** One valid or bleed-suspected run on one credited Artist. */
export type ArtistActivityRow = {
  artistId: string;
  artistName: string;
  bleedSuspected: boolean;
  createdAt: Date;
};

/** The fields of a run the page scored, with its owner and Track. */
export type NewPracticeAttempt = {
  userId: string;
  trackId: string;
  difficulty: Difficulty;
  octaveMode: 'ANY' | 'EXACT';
  transposeSemitones: number;
  speed: number;
  accuracy: number;
  coverage: number;
  forwardSkip: boolean;
  bleedSuspected: boolean;
  startedAt: Date;
  endedAt: Date;
  viewId?: string;
};

@Injectable()
export class AttemptsRepository {
  constructor(private readonly txHost: TransactionHost<DatabaseAdapter>) {}

  /** Saves a run the service already judged valid. */
  async insert(attempt: NewPracticeAttempt): Promise<PracticeAttemptRow> {
    const [row] = await this.txHost.tx
      .insert(practiceAttempts)
      .values(attempt)
      .returning();
    if (!row) {
      throw new Error('Saving the practice attempt returned no row');
    }
    return row;
  }

  /**
   * How many runs the User saved that were not flagged as bleed: the runs
   * that count as sung.
   */
  async countSung(userId: string): Promise<number> {
    const [row] = await this.txHost.tx
      .select({ value: count() })
      .from(practiceAttempts)
      .where(
        and(
          eq(practiceAttempts.userId, userId),
          eq(practiceAttempts.bleedSuspected, false),
        ),
      );
    return row?.value ?? 0;
  }

  /** The best accuracy per difficulty of a User on a Track, if any. */
  async bestAccuracies(
    userId: string,
    trackId: string,
  ): Promise<{ difficulty: Difficulty; accuracy: number }[]> {
    return this.txHost.tx
      .select({
        difficulty: practiceAttempts.difficulty,
        accuracy: sql<number>`max(${practiceAttempts.accuracy})`,
      })
      .from(practiceAttempts)
      .where(
        and(
          eq(practiceAttempts.userId, userId),
          eq(practiceAttempts.trackId, trackId),
        ),
      )
      .groupBy(practiceAttempts.difficulty);
  }

  /**
   * The User's runs on Tracks with a vocal range, grouped by Track,
   * transposition and flags, so the read grows with the distinct combinations
   * rather than with the number of runs.
   */
  listVocalRangeGroups(userId: string): Promise<VocalRangeGroupRow[]> {
    return this.txHost.tx
      .select({
        trackId: practiceAttempts.trackId,
        trackVocalRangeLowest: tracks.vocalRangeLowest,
        trackVocalRangeHighest: tracks.vocalRangeHighest,
        transposeSemitones: practiceAttempts.transposeSemitones,
        forwardSkip: practiceAttempts.forwardSkip,
        bleedSuspected: practiceAttempts.bleedSuspected,
        bestAccuracy: sql<number>`max(${practiceAttempts.accuracy})`,
      })
      .from(practiceAttempts)
      .innerJoin(tracks, eq(tracks.id, practiceAttempts.trackId))
      .where(eq(practiceAttempts.userId, userId))
      .groupBy(
        practiceAttempts.trackId,
        tracks.id,
        tracks.vocalRangeLowest,
        tracks.vocalRangeHighest,
        practiceAttempts.transposeSemitones,
        practiceAttempts.forwardSkip,
        practiceAttempts.bleedSuspected,
      );
  }

  async listVocalRangeEvidenceGroups(
    userId: string,
  ): Promise<VocalRangeEvidenceGroupRow[]> {
    const rows = await this.listVocalRangeGroups(userId);
    return rows.flatMap((row) =>
      row.trackId === undefined ? [] : [{ ...row, trackId: row.trackId }],
    );
  }

  /** The same Profile range inputs for a batch of Users. */
  listVocalRangeGroupsByUserIds(
    userIds: string[],
  ): Promise<UserVocalRangeGroupRow[]> {
    if (userIds.length === 0) return Promise.resolve([]);
    return this.txHost.tx
      .select({
        userId: practiceAttempts.userId,
        trackVocalRangeLowest: tracks.vocalRangeLowest,
        trackVocalRangeHighest: tracks.vocalRangeHighest,
        transposeSemitones: practiceAttempts.transposeSemitones,
        forwardSkip: practiceAttempts.forwardSkip,
        bleedSuspected: practiceAttempts.bleedSuspected,
        bestAccuracy: sql<number>`max(${practiceAttempts.accuracy})`,
      })
      .from(practiceAttempts)
      .innerJoin(tracks, eq(tracks.id, practiceAttempts.trackId))
      .where(inArray(practiceAttempts.userId, userIds))
      .groupBy(
        practiceAttempts.userId,
        tracks.id,
        tracks.vocalRangeLowest,
        tracks.vocalRangeHighest,
        practiceAttempts.transposeSemitones,
        practiceAttempts.forwardSkip,
        practiceAttempts.bleedSuspected,
      );
  }

  /**
   * The User's runs per credited artist, split by the bleed flag: one row per
   * artist and flag, counting the runs on that artist's Tracks.
   */
  listArtistGroups(userId: string): Promise<ArtistGroupRow[]> {
    return this.txHost.tx
      .select({
        artistId: artists.id,
        artistName: artists.name,
        bleedSuspected: practiceAttempts.bleedSuspected,
        attempts: sql<number>`count(*)::int`,
        // Mapped through the column, so the driver's timestamp becomes a Date.
        lastAttemptAt: sql<Date>`max(${practiceAttempts.createdAt})`.mapWith(
          practiceAttempts.createdAt,
        ),
      })
      .from(practiceAttempts)
      .innerJoin(
        trackArtists,
        eq(trackArtists.trackId, practiceAttempts.trackId),
      )
      .innerJoin(artists, eq(artists.id, trackArtists.artistId))
      .where(eq(practiceAttempts.userId, userId))
      .groupBy(artists.id, artists.name, practiceAttempts.bleedSuspected);
  }

  /** Each run stays separate so downstream taste decay applies before summing. */
  listArtistActivities(userId: string): Promise<ArtistActivityRow[]> {
    return this.txHost.tx
      .select({
        artistId: artists.id,
        artistName: artists.name,
        bleedSuspected: practiceAttempts.bleedSuspected,
        createdAt: practiceAttempts.createdAt,
      })
      .from(practiceAttempts)
      .innerJoin(
        trackArtists,
        eq(trackArtists.trackId, practiceAttempts.trackId),
      )
      .innerJoin(artists, eq(artists.id, trackArtists.artistId))
      .where(eq(practiceAttempts.userId, userId));
  }

  /** Up to `limit` attempts of the User after the cursor, newest first. */
  listOwn(options: {
    userId: string;
    after: OwnAttemptCursor | undefined;
    limit: number;
  }): Promise<PracticeAttemptRow[]> {
    const { userId, after, limit } = options;
    return this.txHost.tx
      .select()
      .from(practiceAttempts)
      .where(ownedAfter(userId, after))
      .orderBy(...NEWEST_FIRST)
      .limit(limit);
  }

  /**
   * Up to `limit` attempts of the User after the cursor, newest first, each
   * with the header of the Track it was sung on. The Track is joined in the
   * same query so a page costs one round trip; artists.repository reads the
   * tracks table the same way. The join is inner: a run always has its Track
   * (the foreign key cascades).
   */
  listHistory(options: {
    userId: string;
    after: OwnAttemptCursor | undefined;
    limit: number;
  }): Promise<PracticeAttemptHistoryRow[]> {
    const { userId, after, limit } = options;
    return this.txHost.tx
      .select({
        attempt: practiceAttempts,
        track: {
          id: tracks.id,
          title: tracks.title,
          coverUrl: tracks.coverUrl,
          artistCredit: tracks.artistCredit,
        },
      })
      .from(practiceAttempts)
      .innerJoin(tracks, eq(practiceAttempts.trackId, tracks.id))
      .where(historyAfter(userId, after))
      .orderBy(...HISTORY_NEWEST_FIRST)
      .limit(limit);
  }
}

/**
 * The save time cut to the millisecond, which is what a cursor carries. The
 * column keeps microseconds, so comparing the raw column would skip or repeat
 * runs saved in the same millisecond: the cursor cannot tell them apart.
 */
const savedAtMs = sql<Date>`date_trunc('milliseconds', ${practiceAttempts.createdAt})`;

/** Newest first by the millisecond; the ID breaks ties within one. */
const HISTORY_NEWEST_FIRST = [
  desc(savedAtMs),
  desc(practiceAttempts.id),
] as const;

/** The User's runs strictly after the cursor in the history order. */
const historyAfter = (userId: string, after: OwnAttemptCursor | undefined) => {
  const owned = eq(practiceAttempts.userId, userId);
  if (!after) {
    return owned;
  }
  const createdAt = new Date(after.createdAt);
  return and(
    owned,
    or(
      lt(savedAtMs, createdAt),
      and(
        sql`${savedAtMs} = ${createdAt}`,
        lt(practiceAttempts.id, after.attemptId),
      ),
    ),
  );
};

/** Newest first; the ID breaks ties between attempts saved in the same instant. */
const NEWEST_FIRST = [
  desc(practiceAttempts.createdAt),
  desc(practiceAttempts.id),
] as const;

/** The User's attempts strictly after the cursor in the newest-first order. */
const ownedAfter = (userId: string, after: OwnAttemptCursor | undefined) => {
  const owned = eq(practiceAttempts.userId, userId);
  if (!after) {
    return owned;
  }
  const createdAt = new Date(after.createdAt);
  return and(
    owned,
    or(
      lt(practiceAttempts.createdAt, createdAt),
      and(
        eq(practiceAttempts.createdAt, createdAt),
        lt(practiceAttempts.id, after.attemptId),
      ),
    ),
  );
};
