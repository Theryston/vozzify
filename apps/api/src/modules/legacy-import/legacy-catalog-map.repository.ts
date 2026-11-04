import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { eq } from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import { legacyRecordingImports } from '../../database/schema/legacy-recording-imports.js';
import {
  legacyRecordingPlanRuns,
  legacyRecordingPlans,
} from '../../database/schema/legacy-recording-plans.js';

/** A frozen legacy Track and any destination Track already created for it. */
export type ImportedLegacyPlan = {
  status: string;
  recordingMbid: string | null;
  trackId: string | null;
  processingId: string | null;
  source: unknown;
};

@Injectable()
export class LegacyCatalogMapRepository {
  constructor(private readonly txHost: TransactionHost<DatabaseAdapter>) {}

  /** Reads the frozen source after planning has finished; missing imports stay pending. */
  async findPlans(): Promise<ImportedLegacyPlan[]> {
    const [run] = await this.txHost.tx
      .select({ status: legacyRecordingPlanRuns.status })
      .from(legacyRecordingPlanRuns)
      .where(eq(legacyRecordingPlanRuns.id, 'legacy-recordings-v1'));
    if (run?.status !== 'complete')
      throw new Error('RECORDING_PLAN_INCOMPLETE');

    return this.txHost.tx
      .select({
        status: legacyRecordingPlans.status,
        recordingMbid: legacyRecordingPlans.recordingMbid,
        trackId: legacyRecordingImports.trackId,
        processingId: legacyRecordingImports.processingId,
        source: legacyRecordingPlans.source,
      })
      .from(legacyRecordingPlans)
      .leftJoin(
        legacyRecordingImports,
        eq(legacyRecordingPlans.recordingMbid, legacyRecordingImports.id),
      );
  }
}
