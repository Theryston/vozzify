import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import {
  trackContributionKind,
  trackContributions,
  trackContributors,
} from '../../database/schema/track-contributors.js';
import { userFollows } from '../../database/schema/user-follows.js';
import { users } from '../../database/schema/users.js';
import type { TrackContributorCursor } from './track-contributor-cursor.js';

/** A Contribution's kind, as the schema stores it. */
export type TrackContributionKind =
  (typeof trackContributionKind.enumValues)[number];

/**
 * Contributors of Tracks and the Contributions they make. A Contributor is a
 * User on one Track; a Contribution is an action of one that started a
 * Processing. The Processing itself is in `TrackProcessingRepository`.
 */
@Injectable()
export class TrackContributorRepository {
  constructor(private readonly txHost: TransactionHost<DatabaseAdapter>) {}

  /**
   * The Contributor of a User on a Track, created by their first Contribution
   * to it; returns its ID. Concurrent first Contributions end in one row.
   */
  async findOrInsertContributor(
    trackId: string,
    userId: string,
    contributedAt?: Date,
  ): Promise<string> {
    const [inserted] = await this.txHost.tx
      .insert(trackContributors)
      .values({
        trackId,
        userId,
        createdAt: contributedAt,
        updatedAt: contributedAt,
      })
      .onConflictDoNothing({
        target: [trackContributors.trackId, trackContributors.userId],
      })
      .returning({ id: trackContributors.id });
    if (inserted !== undefined) {
      return inserted.id;
    }
    const [existing] = await this.txHost.tx
      .select({ id: trackContributors.id })
      .from(trackContributors)
      .where(
        and(
          eq(trackContributors.trackId, trackId),
          eq(trackContributors.userId, userId),
        ),
      )
      .limit(1);
    if (existing === undefined) {
      throw new Error('Contributor vanished after its insert conflicted');
    }
    return existing.id;
  }

  /** Records one Contribution: an action of a Contributor that started a Processing. */
  async insertContribution(row: {
    contributorId: string;
    kind: TrackContributionKind;
    processingId: string;
    createdAt?: Date;
    updatedAt?: Date;
  }): Promise<void> {
    await this.txHost.tx.insert(trackContributions).values(row);
  }

  /**
   * How many Contributions the User made, of every kind and on every Track:
   * each row joins through its Contributor, which names the User.
   */
  async countContributionsOf(userId: string): Promise<number> {
    const [row] = await this.txHost.tx
      .select({ value: count() })
      .from(trackContributions)
      .innerJoin(
        trackContributors,
        eq(trackContributors.id, trackContributions.contributorId),
      )
      .where(eq(trackContributors.userId, userId));
    return row?.value ?? 0;
  }

  /** The Contributors of a Track, in the order they first contributed. */
  findContributors(trackId: string): Promise<{ id: string; userId: string }[]> {
    return this.txHost.tx
      .select({ id: trackContributors.id, userId: trackContributors.userId })
      .from(trackContributors)
      .where(eq(trackContributors.trackId, trackId))
      .orderBy(asc(trackContributors.createdAt), asc(trackContributors.id));
  }

  /**
   * Whether the viewer follows each row's User, as a correlated subquery so
   * the page stays one query. Without a viewer nothing is followed.
   */
  private static followingColumn(viewerId: string | undefined) {
    if (viewerId === undefined) {
      return sql<boolean>`false`;
    }
    return sql<boolean>`exists (select 1 from ${userFollows} where ${userFollows.followerId} = ${viewerId} and ${userFollows.followingId} = ${trackContributors.userId})`;
  }

  /** Wildcards never reach the pattern: the match stays a plain substring. */
  private static searchPattern(query: string): string {
    return `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  }

  private contributorFilters(
    trackId: string,
    cursor: TrackContributorCursor | undefined,
    query: string | undefined,
  ) {
    const conditions = [eq(trackContributors.trackId, trackId)];
    if (cursor !== undefined) {
      // Preserve PostgreSQL's timestamp precision so contributors created
      // within one millisecond are not skipped at a page boundary.
      conditions.push(
        sql`(${trackContributors.createdAt}, ${trackContributors.id}) > (${cursor.contributedAt}::timestamptz, ${cursor.contributorId})`,
      );
    }
    if (query !== undefined) {
      const pattern = TrackContributorRepository.searchPattern(query);
      conditions.push(
        sql`(${users.username} ILIKE ${pattern} OR ${users.name} ILIKE ${pattern})`,
      );
    }
    return and(...conditions);
  }

  /**
   * One page of the Track's Contributors with their User's public fields, in
   * first-contribution order, plus how many match in total. `limit + 1` rows
   * decide whether a next page exists. `viewerId` adds whether the viewer
   * follows each row's User.
   */
  async findContributorsPage(
    trackId: string,
    options: {
      cursor?: TrackContributorCursor;
      limit: number;
      query?: string;
      viewerId?: string;
    },
  ): Promise<{
    rows: {
      id: string;
      userId: string;
      username: string | null;
      name: string;
      image: string | null;
      isFollowing: boolean;
      contributedAt: Date;
      cursorTimestamp?: string;
    }[];
    total: number;
  }> {
    const { cursor, limit, query, viewerId } = options;
    const where = this.contributorFilters(trackId, cursor, query);
    const [rows, [countRow]] = await Promise.all([
      this.txHost.tx
        .select({
          id: trackContributors.id,
          userId: trackContributors.userId,
          username: users.username,
          name: users.name,
          image: users.image,
          isFollowing: TrackContributorRepository.followingColumn(viewerId),
          contributedAt: trackContributors.createdAt,
          cursorTimestamp: sql<string>`to_char(${trackContributors.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        })
        .from(trackContributors)
        .innerJoin(users, eq(users.id, trackContributors.userId))
        .where(where)
        .orderBy(asc(trackContributors.createdAt), asc(trackContributors.id))
        .limit(limit + 1),
      this.txHost.tx
        .select({ total: count() })
        .from(trackContributors)
        .innerJoin(users, eq(users.id, trackContributors.userId))
        .where(this.contributorFilters(trackId, undefined, query)),
    ]);
    return { rows, total: countRow?.total ?? 0 };
  }
}
