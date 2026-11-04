import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TRACK_PROCESSING_TERMINAL_STATUSES } from '@vozzify/contracts';
import {
  and,
  count,
  countDistinct,
  eq,
  gte,
  lt,
  notInArray,
  sql,
} from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import {
  trackContributions,
  trackContributors,
} from '../../database/schema/track-contributors.js';
import { trackProcessings } from '../../database/schema/track-processings.js';

import { ordinaryProcessing } from './track-processing-origin.repository.js';

/** The namespace of the Track request locks, so they don't collide with other advisory locks. */
const TRACK_REQUEST_LOCK_SCOPE = 'tracks.requests';

/**
 * What a User's Track requests are checked against: their lock, the Processings
 * they have active, and the Tracks they asked for in a window (see
 * `TrackRequesterService`).
 */
@Injectable()
export class TrackRequestLimitRepository {
  constructor(private readonly txHost: TransactionHost<DatabaseAdapter>) {}

  /**
   * Serializes the User's Track requests until the transaction ends, so their
   * limits are checked one request at a time. A transaction-scoped advisory lock
   * keyed by the User's ID: it never touches `users`, which Better Auth owns.
   * Two Users with colliding hashes share a lock for a moment, which only
   * serializes them, never breaks a limit.
   */
  async lockRequester(userId: string): Promise<void> {
    await this.txHost.tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${TRACK_REQUEST_LOCK_SCOPE}), hashtext(${userId}))`,
    );
  }

  /** The non-terminal Processings that the User's Contributions started. */
  async countActiveProcessings(userId: string): Promise<number> {
    const [row] = await this.txHost.tx
      .select({ value: countDistinct(trackProcessings.id) })
      .from(trackProcessings)
      .innerJoin(
        trackContributions,
        eq(trackContributions.processingId, trackProcessings.id),
      )
      .innerJoin(
        trackContributors,
        eq(trackContributors.id, trackContributions.contributorId),
      )
      .where(
        and(
          eq(trackContributors.userId, userId),
          ordinaryProcessing(trackProcessings.id),
          notInArray(trackProcessings.status, [
            ...TRACK_PROCESSING_TERMINAL_STATUSES,
          ]),
        ),
      );
    return row?.value ?? 0;
  }

  /** The User's CREATE Contributions made in `[start, end)`: Tracks they asked for. */
  async countNewTracksBetween(
    userId: string,
    start: Date,
    end: Date,
  ): Promise<number> {
    const [row] = await this.txHost.tx
      .select({ value: count() })
      .from(trackContributions)
      .innerJoin(
        trackContributors,
        eq(trackContributors.id, trackContributions.contributorId),
      )
      .where(
        and(
          eq(trackContributors.userId, userId),
          eq(trackContributions.kind, 'CREATE'),
          ordinaryProcessing(trackContributions.processingId),
          gte(trackContributions.createdAt, start),
          lt(trackContributions.createdAt, end),
        ),
      );
    return row?.value ?? 0;
  }
}
