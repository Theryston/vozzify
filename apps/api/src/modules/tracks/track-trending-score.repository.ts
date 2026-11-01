import { TransactionHost } from '@nestjs-cls/transactional';
import { and, eq, ne, sql } from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import { trackAssociationEvents } from '../../database/schema/track-association-events.js';
import { tracks } from '../../database/schema/tracks.js';

/** Stores a changed score and its delivery revision in one transaction. */
export const setTrackTrendingScore = async (
  txHost: TransactionHost<DatabaseAdapter>,
  trackId: string,
  score: number,
): Promise<boolean> =>
  txHost.withTransaction(async () => {
    const [updated] = await txHost.tx
      .update(tracks)
      .set({
        trendingScore: score,
        associationRevision: sql`${tracks.associationRevision} + 1`,
      })
      .where(and(eq(tracks.id, trackId), ne(tracks.trendingScore, score)))
      .returning({
        recordingMbid: tracks.recordingMbid,
        revision: tracks.associationRevision,
      });
    if (updated === undefined) return false;
    const businessScore = Math.max(0, score) + 1;
    await txHost.tx
      .insert(trackAssociationEvents)
      .values({
        recordingMbid: updated.recordingMbid,
        trackId,
        businessScore,
        revision: updated.revision,
      })
      .onConflictDoUpdate({
        target: trackAssociationEvents.trackId,
        set: {
          businessScore,
          revision: updated.revision,
          attempts: 0,
          nextAttemptAt: new Date(),
          claimedUntil: null,
          deliveredAt: null,
        },
      });
    return true;
  });
