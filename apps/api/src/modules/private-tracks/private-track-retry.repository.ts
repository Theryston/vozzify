import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../../database/database.js';
import { privateTracks } from '../../database/schema/private-tracks.js';

export type PrivateTrackRetry = {
  userId: string;
  id: string;
  previousRetryId: string | null;
  retryId: string;
};

export function matchesPrivateTrackRetry(retryId: string | null) {
  return retryId === null
    ? isNull(privateTracks.processingRetryId)
    : eq(privateTracks.processingRetryId, retryId);
}

export async function resetFailedPrivateTrackProcessing(
  database: Pick<Database, 'update'>,
  { userId, id, previousRetryId, retryId }: PrivateTrackRetry,
): Promise<boolean> {
  const updated = await database
    .update(privateTracks)
    .set({
      processingStatus: 'QUEUED',
      processingProgress: 0,
      processingJobId: null,
      // Fence late failures before the retry starts its own detector attempt.
      processingAttemptId: retryId,
      processingRetryId: retryId,
    })
    .where(
      and(
        eq(privateTracks.userId, userId),
        eq(privateTracks.id, id),
        eq(privateTracks.processingStatus, 'FAILED'),
        matchesPrivateTrackRetry(previousRetryId),
      ),
    )
    .returning({ id: privateTracks.id });
  return updated.length > 0;
}
