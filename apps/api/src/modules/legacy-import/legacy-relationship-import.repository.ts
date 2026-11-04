import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, eq, sql } from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import {
  legacyRecordingPlanRuns,
  legacyRecordingPlans,
} from '../../database/schema/legacy-recording-plans.js';
import { legacyRelationshipImports } from '../../database/schema/legacy-relationship-imports.js';

const IMPORT_ID = 'legacy-relationships-v1';

@Injectable()
export class LegacyRelationshipImportRepository {
  constructor(private readonly host: TransactionHost<DatabaseAdapter>) {}

  async prepare(sourceDigest: string) {
    const [existing] = await this.host.tx
      .select()
      .from(legacyRelationshipImports)
      .where(eq(legacyRelationshipImports.id, IMPORT_ID));
    if (existing) {
      if (existing.sourceDigest !== sourceDigest)
        throw new Error('RELATIONSHIP_SOURCE_CHANGED');
      return existing;
    }
    const [created] = await this.host.tx
      .insert(legacyRelationshipImports)
      .values({ id: IMPORT_ID, sourceDigest })
      .returning();
    if (!created) throw new Error('RELATIONSHIP_PROGRESS_NOT_CREATED');
    return created;
  }

  async find() {
    const [row] = await this.host.tx
      .select()
      .from(legacyRelationshipImports)
      .where(eq(legacyRelationshipImports.id, IMPORT_ID));
    return row;
  }

  async assertPlanComplete(sourceDigest: string): Promise<void> {
    const [run] = await this.host.tx
      .select({
        status: legacyRecordingPlanRuns.status,
        sourceDigest: legacyRecordingPlanRuns.sourceDigest,
      })
      .from(legacyRecordingPlanRuns)
      .where(eq(legacyRecordingPlanRuns.id, 'legacy-recordings-v1'));
    if (run?.status !== 'complete')
      throw new Error('RECORDING_PLAN_INCOMPLETE');
    if (run.sourceDigest !== sourceDigest) throw new Error('SOURCE_CHANGED');
  }

  async skippedTracks() {
    const rows = await this.host.tx
      .select({
        legacyTrackId: legacyRecordingPlans.legacyTrackId,
        favorites: sql<number>`(${legacyRecordingPlans.source}->>'dependentFavorites')::integer`,
        views: sql<number>`(${legacyRecordingPlans.source}->>'dependentViews')::integer`,
      })
      .from(legacyRecordingPlans)
      .where(eq(legacyRecordingPlans.status, 'skipped'))
      .orderBy(legacyRecordingPlans.legacyTrackId);
    return rows
      .filter((row) => row.favorites > 0 || row.views > 0)
      .map((row) => ({
        legacyTrackId: row.legacyTrackId,
        favorites: row.favorites,
        views: row.views,
      }));
  }

  async commitFavoritePage(
    cursor: string,
    counts: {
      accepted: number;
      imported: number;
      deduplicated: number;
      skipped: number;
    },
  ): Promise<void> {
    await this.host.tx
      .update(legacyRelationshipImports)
      .set({
        lastFavoriteId: cursor,
        acceptedFavorites: sql`${legacyRelationshipImports.acceptedFavorites} + ${counts.accepted}`,
        importedFavorites: sql`${legacyRelationshipImports.importedFavorites} + ${counts.imported}`,
        deduplicatedFavorites: sql`${legacyRelationshipImports.deduplicatedFavorites} + ${counts.deduplicated}`,
        skippedFavorites: sql`${legacyRelationshipImports.skippedFavorites} + ${counts.skipped}`,
        updatedAt: new Date(),
      })
      .where(eq(legacyRelationshipImports.id, IMPORT_ID));
  }

  async commitViewPage(
    cursor: string,
    counts: { imported: number; skipped: number },
  ): Promise<void> {
    await this.host.tx
      .update(legacyRelationshipImports)
      .set({
        lastViewId: cursor,
        importedViews: sql`${legacyRelationshipImports.importedViews} + ${counts.imported}`,
        skippedViews: sql`${legacyRelationshipImports.skippedViews} + ${counts.skipped}`,
        updatedAt: new Date(),
      })
      .where(eq(legacyRelationshipImports.id, IMPORT_ID));
  }

  async commitRefreshedViewPage(cursor: string): Promise<void> {
    await this.host.tx
      .update(legacyRelationshipImports)
      .set({ lastRefreshedViewId: cursor, updatedAt: new Date() })
      .where(eq(legacyRelationshipImports.id, IMPORT_ID));
  }

  async commitRefreshedFavoritePage(cursor: string): Promise<void> {
    await this.host.tx
      .update(legacyRelationshipImports)
      .set({ lastRefreshedFavoriteId: cursor, updatedAt: new Date() })
      .where(eq(legacyRelationshipImports.id, IMPORT_ID));
  }

  async complete(): Promise<void> {
    await this.host.tx
      .update(legacyRelationshipImports)
      .set({ status: 'complete', updatedAt: new Date() })
      .where(
        and(
          eq(legacyRelationshipImports.id, IMPORT_ID),
          eq(legacyRelationshipImports.status, 'incomplete'),
        ),
      );
  }
}
