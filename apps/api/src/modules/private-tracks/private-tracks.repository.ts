import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, asc, desc, eq, isNull, lt, notInArray, or } from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import {
  privateTrackNotes,
  privateTracks,
} from '../../database/schema/private-tracks.js';
import {
  matchesPrivateTrackRetry,
  type PrivateTrackRetry,
  resetFailedPrivateTrackProcessing,
} from './private-track-retry.repository.js';

@Injectable()
export class PrivateTracksRepository {
  constructor(private readonly txHost: TransactionHost<DatabaseAdapter>) {}

  async listPage(
    userId: string,
    query: { after?: { createdAt: Date; id: string }; limit: number },
  ) {
    const cursor = query.after
      ? or(
          lt(privateTracks.createdAt, query.after.createdAt),
          and(
            eq(privateTracks.createdAt, query.after.createdAt),
            lt(privateTracks.id, query.after.id),
          ),
        )
      : undefined;
    return this.txHost.tx
      .select()
      .from(privateTracks)
      .where(
        cursor
          ? and(eq(privateTracks.userId, userId), cursor)
          : eq(privateTracks.userId, userId),
      )
      .orderBy(desc(privateTracks.createdAt), desc(privateTracks.id))
      .limit(query.limit + 1);
  }

  async save(
    input: typeof privateTracks.$inferInsert & { contentSha256: string },
  ): Promise<
    typeof privateTracks.$inferSelect & { discardedUploadKey?: string }
  > {
    const inserted = await this.txHost.tx
      .insert(privateTracks)
      .values(input)
      .onConflictDoNothing({
        target: [privateTracks.userId, privateTracks.contentSha256],
      })
      .returning();
    if (inserted[0]) return inserted[0];
    const existing = await this.txHost.tx
      .select()
      .from(privateTracks)
      .where(
        and(
          eq(privateTracks.userId, input.userId),
          eq(privateTracks.contentSha256, input.contentSha256),
        ),
      );
    const row = existing[0];
    if (!row) throw new Error('Private audio deduplication failed');
    return { ...row, discardedUploadKey: input.objectKey };
  }

  findOwned(userId: string, id: string) {
    return this.txHost.tx.query.privateTracks.findFirst({
      where: and(eq(privateTracks.userId, userId), eq(privateTracks.id, id)),
    });
  }

  findById(id: string) {
    return this.txHost.tx.query.privateTracks.findFirst({
      where: eq(privateTracks.id, id),
    });
  }

  resetFailedProcessing(retry: PrivateTrackRetry): Promise<boolean> {
    return resetFailedPrivateTrackProcessing(this.txHost.tx, retry);
  }

  async saveMusicMedia(
    track: { id: string; processingRetryId: string | null },
    mediaObjectKey: string,
  ): Promise<boolean> {
    const updated = await this.txHost.tx
      .update(privateTracks)
      .set({
        mediaObjectKey,
        processingStatus: 'EXTRACTING_VOCALS',
        processingProgress: 5,
      })
      .where(
        and(
          eq(privateTracks.id, track.id),
          matchesPrivateTrackRetry(track.processingRetryId),
          isNull(privateTracks.mediaObjectKey),
          notInArray(privateTracks.processingStatus, ['COMPLETED', 'FAILED']),
        ),
      )
      .returning({ id: privateTracks.id });
    return updated.length > 0;
  }

  async claimProcessingAttempt(
    id: string,
    expectedAttemptId: string | null,
    attemptId: string,
  ): Promise<boolean> {
    const expectedAttempt = expectedAttemptId
      ? eq(privateTracks.processingAttemptId, expectedAttemptId)
      : isNull(privateTracks.processingAttemptId);
    const claimed = await this.txHost.tx
      .update(privateTracks)
      .set({ processingAttemptId: attemptId, processingJobId: null })
      .where(
        and(
          eq(privateTracks.id, id),
          expectedAttempt,
          isNull(privateTracks.processingJobId),
          notInArray(privateTracks.processingStatus, ['COMPLETED', 'FAILED']),
        ),
      )
      .returning({ id: privateTracks.id });
    return claimed.length > 0;
  }

  async saveProcessingJob(
    id: string,
    attemptId: string,
    jobId: string,
  ): Promise<boolean> {
    const saved = await this.txHost.tx
      .update(privateTracks)
      .set({
        processingJobId: jobId,
        processingStatus: 'EXTRACTING_VOCALS',
        processingProgress: 10,
      })
      .where(
        and(
          eq(privateTracks.id, id),
          eq(privateTracks.processingAttemptId, attemptId),
          isNull(privateTracks.processingJobId),
          notInArray(privateTracks.processingStatus, ['COMPLETED', 'FAILED']),
        ),
      )
      .returning({ id: privateTracks.id });
    return saved.length > 0;
  }

  async updateProcessingAttempt(
    id: string,
    attemptId: string,
    jobId: string,
    values: Partial<typeof privateTracks.$inferInsert>,
  ): Promise<boolean> {
    const updated = await this.txHost.tx
      .update(privateTracks)
      .set(values)
      .where(
        and(
          eq(privateTracks.id, id),
          eq(privateTracks.processingAttemptId, attemptId),
          eq(privateTracks.processingJobId, jobId),
          notInArray(privateTracks.processingStatus, ['COMPLETED', 'FAILED']),
        ),
      )
      .returning({ id: privateTracks.id });
    return updated.length > 0;
  }

  async markFailedForAttempt(
    id: string,
    attemptId: string | null,
  ): Promise<boolean> {
    const expectedAttempt = attemptId
      ? eq(privateTracks.processingAttemptId, attemptId)
      : isNull(privateTracks.processingAttemptId);
    const updated = await this.txHost.tx
      .update(privateTracks)
      .set({ processingStatus: 'FAILED', processingProgress: 0 })
      .where(
        and(
          eq(privateTracks.id, id),
          expectedAttempt,
          notInArray(privateTracks.processingStatus, ['COMPLETED', 'FAILED']),
        ),
      )
      .returning({ id: privateTracks.id });
    return updated.length > 0;
  }

  listRecoverable(limit: number, staleBefore: Date) {
    return this.txHost.tx
      .select({
        id: privateTracks.id,
        userId: privateTracks.userId,
        processingRetryId: privateTracks.processingRetryId,
      })
      .from(privateTracks)
      .where(
        or(
          eq(privateTracks.processingStatus, 'QUEUED'),
          and(
            eq(privateTracks.processingStatus, 'EXTRACTING_VOCALS'),
            isNull(privateTracks.processingJobId),
            lt(privateTracks.updatedAt, staleBefore),
          ),
        ),
      )
      .orderBy(asc(privateTracks.updatedAt), asc(privateTracks.id))
      .limit(limit);
  }

  async replaceNotes({
    privateTrackId,
    attemptId,
    jobId,
    notes,
    processingValues,
  }: {
    privateTrackId: string;
    attemptId: string;
    jobId: string;
    notes: readonly { pitch: number; start: number; end: number }[];
    processingValues: Pick<
      typeof privateTracks.$inferInsert,
      | 'processingStatus'
      | 'processingProgress'
      | 'vocalsObjectKey'
      | 'pitchCurveObjectKey'
      | 'detectorVersion'
    >;
  }): Promise<boolean> {
    const committed = await this.txHost.tx
      .update(privateTracks)
      .set(processingValues)
      .where(
        and(
          eq(privateTracks.id, privateTrackId),
          eq(privateTracks.processingAttemptId, attemptId),
          eq(privateTracks.processingJobId, jobId),
          notInArray(privateTracks.processingStatus, ['COMPLETED', 'FAILED']),
        ),
      )
      .returning({ id: privateTracks.id });
    if (!committed[0]) return false;
    await this.txHost.tx
      .delete(privateTrackNotes)
      .where(eq(privateTrackNotes.privateTrackId, privateTrackId));
    if (notes.length) {
      await this.txHost.tx
        .insert(privateTrackNotes)
        .values(notes.map((note) => ({ privateTrackId, ...note })));
    }
    return true;
  }

  listNotes(privateTrackId: string) {
    return this.txHost.tx
      .select({
        pitch: privateTrackNotes.pitch,
        start: privateTrackNotes.start,
        end: privateTrackNotes.end,
      })
      .from(privateTrackNotes)
      .where(eq(privateTrackNotes.privateTrackId, privateTrackId))
      .orderBy(privateTrackNotes.start);
  }

  async isPrivateObjectReferenced(key: string): Promise<boolean> {
    const row = await this.txHost.tx.query.privateTracks.findFirst({
      where: or(
        eq(privateTracks.objectKey, key),
        eq(privateTracks.mediaObjectKey, key),
        eq(privateTracks.vocalsObjectKey, key),
        eq(privateTracks.pitchCurveObjectKey, key),
      ),
      columns: { id: true },
    });
    return row !== undefined;
  }

  async delete(userId: string, privateTrackId: string) {
    const deleted = await this.txHost.tx
      .delete(privateTracks)
      .where(
        and(
          eq(privateTracks.userId, userId),
          eq(privateTracks.id, privateTrackId),
        ),
      )
      .returning({ objectKey: privateTracks.objectKey });
    return deleted[0];
  }
}
