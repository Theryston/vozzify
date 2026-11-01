import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import { trackAssociationEvents } from '../../database/schema/track-association-events.js';

export type ClaimedTrackAssociation = {
  id: string;
  recordingMbid: string;
  trackId: string;
  attempts: number;
  businessScore: number;
  revision: number;
};

/** Durable queue state for Track links that the Music catalog has not acknowledged. */
@Injectable()
export class TrackAssociationEventRepository {
  constructor(private readonly txHost: TransactionHost<DatabaseAdapter>) {}

  async claimPending(
    now: Date,
    claimExpiresAt: Date,
    limit: number,
  ): Promise<ClaimedTrackAssociation[]> {
    const due = this.txHost.tx
      .select({ id: trackAssociationEvents.id })
      .from(trackAssociationEvents)
      .where(
        and(
          isNull(trackAssociationEvents.deliveredAt),
          lte(trackAssociationEvents.nextAttemptAt, now),
          or(
            isNull(trackAssociationEvents.claimedUntil),
            lte(trackAssociationEvents.claimedUntil, now),
          ),
        ),
      )
      .orderBy(
        asc(trackAssociationEvents.nextAttemptAt),
        asc(trackAssociationEvents.createdAt),
      )
      .limit(limit)
      .for('update', { skipLocked: true });

    return this.txHost.tx
      .update(trackAssociationEvents)
      .set({
        claimedUntil: claimExpiresAt,
        attempts: sql`${trackAssociationEvents.attempts} + 1`,
      })
      .where(inArray(trackAssociationEvents.id, due))
      .returning({
        id: trackAssociationEvents.id,
        recordingMbid: trackAssociationEvents.recordingMbid,
        trackId: trackAssociationEvents.trackId,
        businessScore: trackAssociationEvents.businessScore,
        revision: trackAssociationEvents.revision,
        attempts: trackAssociationEvents.attempts,
      });
  }

  /** Records delivery only after the catalog's durable acknowledgment. */
  async markDelivered(
    id: string,
    revision: number,
    deliveredAt: Date,
  ): Promise<void> {
    await this.txHost.tx
      .update(trackAssociationEvents)
      .set({ deliveredAt, claimedUntil: null })
      .where(
        and(
          eq(trackAssociationEvents.id, id),
          eq(trackAssociationEvents.revision, revision),
          isNull(trackAssociationEvents.deliveredAt),
        ),
      );
  }

  /** Releases a failed claim with durable exponential backoff. */
  async scheduleRetry(
    id: string,
    revision: number,
    nextAttemptAt: Date,
  ): Promise<void> {
    await this.txHost.tx
      .update(trackAssociationEvents)
      .set({ nextAttemptAt, claimedUntil: null })
      .where(
        and(
          eq(trackAssociationEvents.id, id),
          eq(trackAssociationEvents.revision, revision),
          isNull(trackAssociationEvents.deliveredAt),
        ),
      );
  }

  /** Deletes at most one old delivered page; pending events are never eligible. */
  async deleteDeliveredBefore(cutoff: Date, limit: number): Promise<number> {
    const expired = this.txHost.tx
      .select({ id: trackAssociationEvents.id })
      .from(trackAssociationEvents)
      .where(lt(trackAssociationEvents.deliveredAt, cutoff))
      .orderBy(asc(trackAssociationEvents.deliveredAt))
      .limit(limit);
    const deleted = await this.txHost.tx
      .delete(trackAssociationEvents)
      .where(inArray(trackAssociationEvents.id, expired))
      .returning({ id: trackAssociationEvents.id });
    return deleted.length;
  }

  async enqueueSynchronizationPage(
    rows: {
      id: string;
      recordingMbid: string;
      businessScore: number;
      revision: number;
    }[],
  ): Promise<void> {
    if (rows.length === 0) return;
    await this.txHost.tx
      .insert(trackAssociationEvents)
      .values(
        rows.map((row) => ({
          trackId: row.id,
          recordingMbid: row.recordingMbid,
          businessScore: row.businessScore,
          revision: row.revision,
        })),
      )
      .onConflictDoUpdate({
        target: trackAssociationEvents.trackId,
        set: {
          recordingMbid: sql`case when excluded.revision >= ${trackAssociationEvents.revision} then excluded.recording_mbid else ${trackAssociationEvents.recordingMbid} end`,
          businessScore: sql`case when excluded.revision >= ${trackAssociationEvents.revision} then excluded.business_score else ${trackAssociationEvents.businessScore} end`,
          revision: sql`greatest(${trackAssociationEvents.revision}, excluded.revision)`,
          attempts: sql`case when excluded.revision >= ${trackAssociationEvents.revision} then 0 else ${trackAssociationEvents.attempts} end`,
          nextAttemptAt: sql`case when excluded.revision >= ${trackAssociationEvents.revision} then now() else ${trackAssociationEvents.nextAttemptAt} end`,
          claimedUntil: sql`case when excluded.revision >= ${trackAssociationEvents.revision} then null else ${trackAssociationEvents.claimedUntil} end`,
          deliveredAt: sql`case when excluded.revision >= ${trackAssociationEvents.revision} then null else ${trackAssociationEvents.deliveredAt} end`,
        },
      });
  }

  countPendingForTracks(trackIds: string[]): Promise<{ count: number }[]> {
    return this.txHost.tx
      .select({ count: sql<number>`count(*)::int` })
      .from(trackAssociationEvents)
      .where(
        and(
          inArray(trackAssociationEvents.trackId, trackIds),
          isNull(trackAssociationEvents.deliveredAt),
        ),
      );
  }

  countPending(): Promise<{ count: number }[]> {
    return this.txHost.tx
      .select({ count: sql<number>`count(*)::int` })
      .from(trackAssociationEvents)
      .where(isNull(trackAssociationEvents.deliveredAt));
  }
}
