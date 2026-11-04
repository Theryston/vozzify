import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { eq, inArray } from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import { legacyRecordingImports } from '../../database/schema/legacy-recording-imports.js';

export type TrackMetadataProgressStatus = 'pending' | 'completed' | 'failed';

/** Persists legacy metadata outcomes beyond BullMQ's job retention. */
@Injectable()
export class TrackMetadataProgressRepository {
  constructor(private readonly txHost: TransactionHost<DatabaseAdapter>) {}

  async markTrack(
    trackId: string,
    metadataStatus: TrackMetadataProgressStatus,
  ) {
    await this.txHost.tx
      .update(legacyRecordingImports)
      .set({ metadataStatus, updatedAt: new Date() })
      .where(eq(legacyRecordingImports.trackId, trackId));
  }

  async findStatuses(trackIds: string[]) {
    if (trackIds.length === 0) return [];
    return this.txHost.tx
      .select({
        trackId: legacyRecordingImports.trackId,
        status: legacyRecordingImports.metadataStatus,
      })
      .from(legacyRecordingImports)
      .where(inArray(legacyRecordingImports.trackId, trackIds));
  }
}
