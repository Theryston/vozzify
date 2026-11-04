import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, eq, sql } from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import {
  legacyRecordingPlanRuns,
  legacyRecordingPlans,
} from '../../database/schema/legacy-recording-plans.js';
import type { LegacyTrack } from './legacy-recording.js';

const RUN_ID = 'legacy-recordings-v1';

export type RecordingPlanDecision = {
  recordingMbid: string | null;
  rationale: string;
  skipReason: string | null;
};

@Injectable()
export class LegacyRecordingPlanRepository {
  constructor(private readonly txHost: TransactionHost<DatabaseAdapter>) {}

  private get db() {
    return this.txHost.tx;
  }

  async prepare(sourceDigest: string, sourceTracks: number) {
    const [existing] = await this.db
      .select()
      .from(legacyRecordingPlanRuns)
      .where(eq(legacyRecordingPlanRuns.id, RUN_ID));
    if (existing && existing.sourceDigest !== sourceDigest) {
      throw new Error('SOURCE_CHANGED');
    }
    if (existing) {
      if (existing.sourceTracks !== sourceTracks)
        throw new Error('SOURCE_CHANGED');
      if (existing.status === 'complete') return existing;
      const [resumed] = await this.db
        .update(legacyRecordingPlanRuns)
        .set({ status: 'incomplete', updatedAt: new Date() })
        .where(eq(legacyRecordingPlanRuns.id, RUN_ID))
        .returning();
      if (!resumed) throw new Error('RECORDING_PLAN_RUN_NOT_FOUND');
      return resumed;
    }
    const [created] = await this.db
      .insert(legacyRecordingPlanRuns)
      .values({ id: RUN_ID, sourceDigest, sourceTracks })
      .returning();
    if (!created) throw new Error('RECORDING_PLAN_RUN_NOT_CREATED');
    return created;
  }

  async find(legacyTrackId: string) {
    const [plan] = await this.db
      .select()
      .from(legacyRecordingPlans)
      .where(eq(legacyRecordingPlans.legacyTrackId, legacyTrackId));
    return plan;
  }

  async save(
    track: LegacyTrack,
    sourceDigest: string,
    decision: RecordingPlanDecision,
  ): Promise<void> {
    await this.db.insert(legacyRecordingPlans).values({
      legacyTrackId: track.id,
      sourceDigest,
      sourceCreatedAt: track.createdAt,
      sourceCreatorId: track.creatorId,
      recordingMbid: decision.recordingMbid,
      status: decision.recordingMbid === null ? 'skipped' : 'planned',
      rationale: decision.rationale,
      skipReason: decision.skipReason,
      source: track,
    });
  }

  async assertPlanSource(
    track: LegacyTrack,
    sourceDigest: string,
  ): Promise<boolean> {
    const existing = await this.find(track.id);
    if (!existing) return false;
    if (existing.sourceDigest !== sourceDigest) {
      throw new Error('SOURCE_CHANGED');
    }
    return true;
  }

  async complete(): Promise<void> {
    await this.db.execute(
      sql.raw(`
      update legacy_recording_plans p
      set initial_contributor = ranked.is_initial, updated_at = now()
      from (
        select legacy_track_id,
          row_number() over (
            partition by recording_mbid
            order by source_created_at asc, legacy_track_id collate "C" asc
          ) = 1 as is_initial
        from legacy_recording_plans
        where status = 'planned'
      ) ranked
      where p.legacy_track_id = ranked.legacy_track_id
    `),
    );
    await this.db
      .update(legacyRecordingPlanRuns)
      .set({ status: 'complete', updatedAt: new Date() })
      .where(
        and(
          eq(legacyRecordingPlanRuns.id, RUN_ID),
          eq(legacyRecordingPlanRuns.status, 'incomplete'),
        ),
      );
  }

  async counts(): Promise<{ planned: number; skipped: number }> {
    const results = await this.db.execute<{
      status: string;
      count: string;
    }>(
      sql.raw(`
      select status, count(*)::text as count
      from legacy_recording_plans group by status
    `),
    );
    return {
      planned: Number(
        results.rows.find((row) => row.status === 'planned')?.count ?? 0,
      ),
      skipped: Number(
        results.rows.find((row) => row.status === 'skipped')?.count ?? 0,
      ),
    };
  }

  async initialContributorCount(): Promise<number> {
    const result = await this.db.execute<{ count: string }>(
      sql.raw(`
      select count(*)::text as count
      from legacy_recording_plans where initial_contributor = true
    `),
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async skippedDependents(): Promise<{
    favorites: number;
    views: number;
  }> {
    const result = await this.db.execute<{
      favorites: string | null;
      views: string | null;
    }>(
      sql.raw(`
      select
        coalesce(sum((source->>'dependentFavorites')::integer), 0)::text as favorites,
        coalesce(sum((source->>'dependentViews')::integer), 0)::text as views
      from legacy_recording_plans where status = 'skipped'
    `),
    );
    return {
      favorites: Number(result.rows[0]?.favorites ?? 0),
      views: Number(result.rows[0]?.views ?? 0),
    };
  }
}
