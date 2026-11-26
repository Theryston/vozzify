import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, desc, eq, exists, lt, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { DatabaseAdapter } from '../../database/database.js';
import { userFollows } from '../../database/schema/user-follows.js';
import { users } from '../../database/schema/users.js';

/** Which list of a Profile's User is read. */
export type FollowListSide = 'followers' | 'following' | 'friends';

/** One row of a follow list: the listed User and the follow that lists them. */
export type FollowListPageRow = {
  id: string;
  username: string | null;
  name: string;
  image: string | null;
  followId: string;
  followedAt: Date;
};

/** The follow a list resumes after: its time (in ms) and its row ID. */
export type FollowListPosition = {
  followedAt: Date;
  id: string;
};

// The list orders and compares at milliseconds, the precision JS dates carry,
// so a cursor built from a row resumes exactly after that row. Decoded like the
// column itself, so the driver's string becomes a `Date`.
const followedAtMs =
  sql<Date>`date_trunc('milliseconds', ${userFollows.createdAt})`.mapWith(
    userFollows.createdAt,
  );

/** The follows that come after `position` in newest-first order. */
const olderThan = (position: FollowListPosition) =>
  or(
    lt(followedAtMs, position.followedAt),
    and(eq(followedAtMs, position.followedAt), lt(userFollows.id, position.id)),
  );

// The follow rows the second half of a friendship is stored in: a follow the
// listed User makes back at the owner. Its absence means a one-way follow.
const followBack = alias(userFollows, 'follow_back');

/**
 * For each list, the column of the listed User, the column of the owner, and
 * whether the list keeps only mutual follows. Followers list the User who
 * follows the owner; following and friends list the User the owner follows.
 */
const SIDES = {
  followers: {
    listed: userFollows.followerId,
    owner: userFollows.followingId,
    mutualOnly: false,
  },
  following: {
    listed: userFollows.followingId,
    owner: userFollows.followerId,
    mutualOnly: false,
  },
  friends: {
    listed: userFollows.followingId,
    owner: userFollows.followerId,
    mutualOnly: true,
  },
} as const;

@Injectable()
export class FollowListsRepository {
  constructor(private readonly txHost: TransactionHost<DatabaseAdapter>) {}

  /**
   * One page of a Profile's User's follow list, newest follow first. `limit + 1`
   * rows are read so the caller can tell whether more follow.
   */
  findPage(
    side: FollowListSide,
    ownerId: string,
    options: { after?: FollowListPosition; limit: number },
  ): Promise<FollowListPageRow[]> {
    const { after, limit } = options;
    const config = SIDES[side];
    return this.txHost.tx
      .select({
        id: users.id,
        username: users.username,
        name: users.name,
        image: users.image,
        followId: userFollows.id,
        followedAt: followedAtMs,
      })
      .from(userFollows)
      .innerJoin(users, eq(users.id, config.listed))
      .where(
        and(
          eq(config.owner, ownerId),
          config.mutualOnly ? this.mutualWith(ownerId) : undefined,
          after ? olderThan(after) : undefined,
        ),
      )
      .orderBy(desc(followedAtMs), desc(userFollows.id))
      .limit(limit + 1);
  }

  /** The owner's follows that the listed User answers with a follow back. */
  private mutualWith(ownerId: string) {
    return exists(
      this.txHost.tx
        .select({ id: followBack.id })
        .from(followBack)
        .where(
          and(
            eq(followBack.followerId, userFollows.followingId),
            eq(followBack.followingId, ownerId),
          ),
        ),
    );
  }
}
