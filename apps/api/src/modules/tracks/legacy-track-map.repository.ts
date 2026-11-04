import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { eq, inArray } from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import { legacyRecordingPlans } from '../../database/schema/legacy-recording-plans.js';
import { legacyTrackIds } from '../../database/schema/tracks.js';

export type LegacyTrackResolution =
  | { kind: 'mapped'; trackId: string }
  | { kind: 'skipped' }
  | { kind: 'pending' }
  | { kind: 'unknown' };

@Injectable()
export class LegacyTrackMapRepository {
  constructor(private readonly host: TransactionHost<DatabaseAdapter>) {}

  async resolve(ids: string[]) {
    if (ids.length === 0) return new Map<string, LegacyTrackResolution>();
    const rows = await this.host.tx
      .select({
        legacyTrackId: legacyRecordingPlans.legacyTrackId,
        planStatus: legacyRecordingPlans.status,
        trackId: legacyTrackIds.trackId,
      })
      .from(legacyRecordingPlans)
      .leftJoin(
        legacyTrackIds,
        eq(legacyTrackIds.legacyId, legacyRecordingPlans.legacyTrackId),
      )
      .where(inArray(legacyRecordingPlans.legacyTrackId, ids));
    return new Map(
      rows.map((row) => [
        row.legacyTrackId,
        row.planStatus === 'skipped'
          ? { kind: 'skipped' as const }
          : row.trackId
            ? { kind: 'mapped' as const, trackId: row.trackId }
            : { kind: 'pending' as const },
      ]),
    );
  }
}
