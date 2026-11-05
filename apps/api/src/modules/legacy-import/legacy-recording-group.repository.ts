import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import { legacyRecordingImports } from '../../database/schema/legacy-recording-imports.js';
import {
  legacyRecordingPlanRuns,
  legacyRecordingPlans,
} from '../../database/schema/legacy-recording-plans.js';

@Injectable()
export class LegacyRecordingGroupRepository {
  constructor(private readonly host: TransactionHost<DatabaseAdapter>) {}

  async group(recordingMbid: string) {
    const [run] = await this.host.tx
      .select({
        status: legacyRecordingPlanRuns.status,
        sourceDigest: legacyRecordingPlanRuns.sourceDigest,
      })
      .from(legacyRecordingPlanRuns)
      .where(eq(legacyRecordingPlanRuns.id, 'legacy-recordings-v1'));
    if (run?.status !== 'complete')
      throw new Error('RECORDING_PLAN_INCOMPLETE');
    const rows = await this.host.tx
      .select({
        legacyTrackId: legacyRecordingPlans.legacyTrackId,
        sourceDigest: legacyRecordingPlans.sourceDigest,
        sourceCreatedAt: legacyRecordingPlans.sourceCreatedAt,
        sourceCreatorId: legacyRecordingPlans.sourceCreatorId,
        initialContributor: legacyRecordingPlans.initialContributor,
      })
      .from(legacyRecordingPlans)
      .where(
        and(
          eq(legacyRecordingPlans.recordingMbid, recordingMbid),
          eq(legacyRecordingPlans.status, 'planned'),
        ),
      )
      .orderBy(
        asc(legacyRecordingPlans.sourceCreatedAt),
        sql`${legacyRecordingPlans.legacyTrackId} collate "C" asc`,
      );
    const [first] = rows;
    if (
      !first?.initialContributor ||
      rows.filter((row) => row.initialContributor).length !== 1
    )
      throw new Error('RECORDING_GROUP_INVALID');
    if (rows.some((row) => row.sourceDigest !== run.sourceDigest))
      throw new Error('SOURCE_CHANGED');
    return {
      sourceDigest: run.sourceDigest,
      userId: first.sourceCreatorId,
      contributedAt: first.sourceCreatedAt,
      legacyTrackIds: rows.map((row) => row.legacyTrackId),
    };
  }

  async find(recordingMbid: string) {
    const [row] = await this.host.tx
      .select()
      .from(legacyRecordingImports)
      .where(eq(legacyRecordingImports.id, recordingMbid));
    return row;
  }

  async acknowledge(
    row: typeof legacyRecordingImports.$inferInsert,
  ): Promise<void> {
    await this.host.tx
      .insert(legacyRecordingImports)
      .values(row)
      .onConflictDoNothing();
    const existing = await this.find(row.id);
    if (
      existing?.sourceDigest !== row.sourceDigest ||
      existing.trackId !== row.trackId ||
      existing.initialProcessingId !== row.initialProcessingId
    )
      throw new Error('RECORDING_IMPORT_CONFLICT');
  }

  async acknowledgeRetry(
    recordingMbid: string,
    previous: string,
    processingId: string,
  ): Promise<void> {
    await this.host.tx
      .update(legacyRecordingImports)
      .set({ processingId, updatedAt: new Date() })
      .where(
        and(
          eq(legacyRecordingImports.id, recordingMbid),
          eq(legacyRecordingImports.processingId, previous),
        ),
      );
  }
}
