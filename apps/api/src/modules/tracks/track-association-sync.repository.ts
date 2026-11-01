import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { asc, gt, inArray, sql } from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import { tracks } from '../../database/schema/tracks.js';

export type TrackAssociationSyncRow = {
  id: string;
  recordingMbid: string;
  businessScore: number;
  revision: number;
};

@Injectable()
export class TrackAssociationSyncRepository {
  constructor(private readonly txHost: TransactionHost<DatabaseAdapter>) {}

  findAndEnqueuePage(
    afterId: string | undefined,
    limit: number,
    enqueue: (rows: TrackAssociationSyncRow[]) => Promise<void>,
  ): Promise<TrackAssociationSyncRow[]> {
    return this.txHost.withTransaction(async () => {
      const rows = await this.txHost.tx
        .select({
          id: tracks.id,
          recordingMbid: tracks.recordingMbid,
          businessScore: tracks.trendingScore,
          revision: tracks.associationRevision,
        })
        .from(tracks)
        .where(afterId ? gt(tracks.id, afterId) : undefined)
        .orderBy(asc(tracks.id))
        .limit(limit)
        .for('update');
      const revisions = await this.txHost.tx
        .update(tracks)
        .set({ associationRevision: sql`${tracks.associationRevision} + 1` })
        .where(
          inArray(
            tracks.id,
            rows.map((row) => row.id),
          ),
        )
        .returning({ id: tracks.id, revision: tracks.associationRevision });
      const revisionByTrack = new Map(
        revisions.map(({ id, revision }) => [id, revision]),
      );
      const page = rows.map((row) => {
        const revision = revisionByTrack.get(row.id);
        if (revision === undefined) {
          throw new Error('A synchronization Track disappeared while locked');
        }
        return {
          ...row,
          businessScore: Math.max(0, row.businessScore) + 1,
          revision,
        };
      });
      if (page.length > 0) await enqueue(page);
      return page;
    });
  }
}
