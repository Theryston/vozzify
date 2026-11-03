import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { asc, gt } from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import { tracks } from '../../database/schema/tracks.js';

export type TrackCoverRepairRow = {
  id: string;
  recordingMbid: string;
};

@Injectable()
export class TrackCoverRepairRepository {
  constructor(private readonly txHost: TransactionHost<DatabaseAdapter>) {}

  page(
    afterId: string | undefined,
    limit: number,
  ): Promise<TrackCoverRepairRow[]> {
    return this.txHost.tx
      .select({ id: tracks.id, recordingMbid: tracks.recordingMbid })
      .from(tracks)
      .where(afterId === undefined ? undefined : gt(tracks.id, afterId))
      .orderBy(asc(tracks.id))
      .limit(limit);
  }
}
