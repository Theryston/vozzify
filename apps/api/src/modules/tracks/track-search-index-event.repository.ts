import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TrackProcessingStep } from '@vozzify/contracts';
import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import { trackProcessings } from '../../database/schema/track-processings.js';
import { trackSearchIndexEvents } from '../../database/schema/track-search-index-events.js';
import { tracks } from '../../database/schema/tracks.js';

const processingInStatus = (
  processingId: string,
  status: TrackProcessingStep,
) =>
  and(
    eq(trackProcessings.id, processingId),
    eq(trackProcessings.status, status),
  );

/** Joins completion and its first searchable projection in the caller's transaction. */
export const completeProcessingWithSearchIndexEvent = async (
  txHost: TransactionHost<DatabaseAdapter>,
  processingId: string,
  lastStep: TrackProcessingStep,
): Promise<boolean> => {
  const completed = await txHost.tx
    .update(trackProcessings)
    .set({
      status: 'COMPLETED',
      failureCode: null,
      resumeFrom: null,
      finishedAt: new Date(),
    })
    .where(processingInStatus(processingId, lastStep))
    .returning({ trackId: trackProcessings.trackId });
  const trackId = completed[0]?.trackId;
  if (trackId === undefined) return false;

  const track = await txHost.tx.query.tracks.findFirst({
    where: eq(tracks.id, trackId),
    columns: { title: true, artistCredit: true, updatedAt: true },
  });
  if (track === undefined) throw new Error(`No Track ${trackId}`);
  const searchableText = formatSearchableTrackText(track);
  await txHost.tx
    .insert(trackSearchIndexEvents)
    .values({
      trackId,
      operation: 'upsert',
      searchableText,
      sourceUpdatedAt: track.updatedAt,
    })
    .onConflictDoUpdate({
      target: trackSearchIndexEvents.trackId,
      set: {
        operation: 'upsert',
        searchableText,
        sourceUpdatedAt: track.updatedAt,
        revision: sql`${trackSearchIndexEvents.revision} + 1`,
        attempts: 0,
        nextAttemptAt: new Date(),
        claimedUntil: null,
        deliveredAt: null,
      },
    });
  return true;
};

const formatSearchableTrackText = (track: {
  title: string;
  artistCredit: { name: string; joinPhrase: string }[];
}): string =>
  `${track.title} ${track.artistCredit
    .map(({ name, joinPhrase }) => `${name}${joinPhrase}`)
    .join('')}`;

export type ClaimedTrackSearchIndexEvent = {
  id: string;
  trackId: string;
  operation: 'upsert' | 'delete';
  searchableText: string | null;
  revision: number;
  attempts: number;
};

/** PostgreSQL owns pending Sonic work; Redis only wakes its consumer. */
@Injectable()
export class TrackSearchIndexEventRepository {
  constructor(private readonly txHost: TransactionHost<DatabaseAdapter>) {}

  /** Serializes Sonic side effects for one Track across API instances. */
  withDeliveryLock<Result>(
    trackId: string,
    deliver: () => Promise<Result>,
  ): Promise<Result> {
    return this.txHost.withTransaction(async () => {
      await this.txHost.tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${trackId}, 0))`,
      );
      return deliver();
    });
  }

  async claimPending(
    now: Date,
    claimExpiresAt: Date,
    limit: number,
  ): Promise<ClaimedTrackSearchIndexEvent[]> {
    const due = this.txHost.tx
      .select({ id: trackSearchIndexEvents.id })
      .from(trackSearchIndexEvents)
      .where(
        and(
          isNull(trackSearchIndexEvents.deliveredAt),
          lte(trackSearchIndexEvents.nextAttemptAt, now),
          or(
            isNull(trackSearchIndexEvents.claimedUntil),
            lte(trackSearchIndexEvents.claimedUntil, now),
          ),
        ),
      )
      .orderBy(
        asc(trackSearchIndexEvents.nextAttemptAt),
        asc(trackSearchIndexEvents.createdAt),
      )
      .limit(limit)
      .for('update', { skipLocked: true });

    return this.txHost.tx
      .update(trackSearchIndexEvents)
      .set({
        claimedUntil: claimExpiresAt,
        attempts: sql`${trackSearchIndexEvents.attempts} + 1`,
      })
      .where(inArray(trackSearchIndexEvents.id, due))
      .returning({
        id: trackSearchIndexEvents.id,
        trackId: trackSearchIndexEvents.trackId,
        operation: trackSearchIndexEvents.operation,
        searchableText: trackSearchIndexEvents.searchableText,
        revision: trackSearchIndexEvents.revision,
        attempts: trackSearchIndexEvents.attempts,
      });
  }

  async enqueueBackfillPage(
    rows: {
      id: string;
      title: string;
      artistCredit: { name: string; joinPhrase: string }[];
      updatedAt: Date;
    }[],
  ): Promise<void> {
    if (rows.length === 0) return;
    await this.txHost.tx
      .insert(trackSearchIndexEvents)
      .values(
        rows.map((row) => ({
          trackId: row.id,
          operation: 'upsert' as const,
          searchableText: formatSearchableTrackText(row),
          sourceUpdatedAt: row.updatedAt,
        })),
      )
      .onConflictDoUpdate({
        target: trackSearchIndexEvents.trackId,
        set: {
          operation: 'upsert',
          searchableText: sql`excluded.searchable_text`,
          sourceUpdatedAt: sql`excluded.source_updated_at`,
          revision: sql`${trackSearchIndexEvents.revision} + 1`,
          attempts: 0,
          nextAttemptAt: new Date(),
          claimedUntil: null,
          deliveredAt: null,
        },
        where: or(
          lt(
            trackSearchIndexEvents.sourceUpdatedAt,
            sql`excluded.source_updated_at`,
          ),
          and(
            eq(
              trackSearchIndexEvents.sourceUpdatedAt,
              sql`excluded.source_updated_at`,
            ),
            eq(trackSearchIndexEvents.operation, 'upsert'),
            eq(
              trackSearchIndexEvents.searchableText,
              sql`excluded.searchable_text`,
            ),
          ),
        ),
      });
  }

  /** Keeps a Track removal durable even though the Track row no longer exists. */
  async enqueueDelete(trackId: string, removedAt = new Date()): Promise<void> {
    await this.txHost.tx
      .insert(trackSearchIndexEvents)
      .values({
        trackId,
        operation: 'delete',
        searchableText: null,
        sourceUpdatedAt: removedAt,
      })
      .onConflictDoUpdate({
        target: trackSearchIndexEvents.trackId,
        set: {
          operation: 'delete',
          searchableText: null,
          sourceUpdatedAt: removedAt,
          revision: sql`${trackSearchIndexEvents.revision} + 1`,
          attempts: 0,
          nextAttemptAt: removedAt,
          claimedUntil: null,
          deliveredAt: null,
        },
        where: lte(trackSearchIndexEvents.sourceUpdatedAt, removedAt),
      });
  }

  async countPending(): Promise<number> {
    const rows = await this.txHost.tx
      .select({ count: sql<number>`count(*)::int` })
      .from(trackSearchIndexEvents)
      .where(isNull(trackSearchIndexEvents.deliveredAt));
    return rows[0]?.count ?? 0;
  }

  findById(id: string): Promise<ClaimedTrackSearchIndexEvent | undefined> {
    return this.txHost.tx.query.trackSearchIndexEvents.findFirst({
      where: eq(trackSearchIndexEvents.id, id),
      columns: {
        id: true,
        trackId: true,
        operation: true,
        searchableText: true,
        revision: true,
        attempts: true,
      },
    });
  }

  async markDelivered(
    id: string,
    revision: number,
    deliveredAt: Date,
  ): Promise<boolean> {
    const rows = await this.txHost.tx
      .update(trackSearchIndexEvents)
      .set({ deliveredAt, claimedUntil: null })
      .where(
        and(
          eq(trackSearchIndexEvents.id, id),
          eq(trackSearchIndexEvents.revision, revision),
        ),
      )
      .returning({ id: trackSearchIndexEvents.id });
    return rows.length > 0;
  }

  async scheduleRetry(id: string, revision: number, nextAttemptAt: Date) {
    await this.txHost.tx
      .update(trackSearchIndexEvents)
      .set({ nextAttemptAt, claimedUntil: null })
      .where(
        and(
          eq(trackSearchIndexEvents.id, id),
          eq(trackSearchIndexEvents.revision, revision),
          isNull(trackSearchIndexEvents.deliveredAt),
        ),
      );
  }

  /** A late external write can overwrite a newer acknowledged document. */
  async requeueNewerRevision(
    id: string,
    staleRevision: number,
    nextAttemptAt: Date,
  ): Promise<void> {
    await this.txHost.tx
      .update(trackSearchIndexEvents)
      .set({ nextAttemptAt, claimedUntil: null, deliveredAt: null })
      .where(
        and(
          eq(trackSearchIndexEvents.id, id),
          sql`${trackSearchIndexEvents.revision} <> ${staleRevision}`,
        ),
      );
  }
}
