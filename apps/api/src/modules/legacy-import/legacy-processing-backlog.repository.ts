import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import {
  TRACK_PROCESSING_TERMINAL_STATUSES,
  type TrackProcessingStatus,
} from '@vozzify/contracts';
import { and, asc, count, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import { legacyProcessingAdmissions } from '../../database/schema/legacy-processing-admissions.js';
import {
  legacyProcessingOrigins,
  legacyRecordingImports,
} from '../../database/schema/legacy-recording-imports.js';
import { trackProcessings } from '../../database/schema/track-processings.js';

export type BacklogWork = {
  processingId: string;
  trackId: string;
};

export type BacklogReport = {
  queued: number;
  admitted: number;
  running: number;
  completed: number;
  failed: number;
};

const LOCK_SCOPE = 'legacy.processing.admission';

@Injectable()
export class LegacyProcessingBacklogRepository {
  constructor(private readonly host: TransactionHost<DatabaseAdapter>) {}

  /** Claims at most the remaining slots and repairs progress after a restart. */
  async admit(concurrency: number): Promise<BacklogWork[]> {
    await this.host.tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${LOCK_SCOPE}))`,
    );
    await this.reconcileLatestMigrationAttempts();
    await this.reconcileActiveAdmissions();
    const active = await this.activeCount();
    const available = Math.max(concurrency - active, 0);
    if (available === 0) return [];

    const rows = await this.host.tx
      .select({
        processingId: trackProcessings.id,
        trackId: trackProcessings.trackId,
      })
      .from(legacyRecordingImports)
      .innerJoin(
        trackProcessings,
        eq(trackProcessings.id, legacyRecordingImports.processingId),
      )
      .innerJoin(
        legacyProcessingOrigins,
        eq(legacyProcessingOrigins.id, trackProcessings.id),
      )
      .leftJoin(
        legacyProcessingAdmissions,
        eq(legacyProcessingAdmissions.id, trackProcessings.id),
      )
      .where(
        and(
          eq(trackProcessings.status, 'QUEUED'),
          sql`${legacyProcessingAdmissions.id} is null`,
        ),
      )
      .orderBy(asc(trackProcessings.createdAt), asc(trackProcessings.id))
      .limit(available);

    if (rows.length === 0) return [];
    await this.host.tx
      .insert(legacyProcessingAdmissions)
      .values(rows.map((row) => ({ id: row.processingId })))
      .onConflictDoNothing();
    return rows;
  }

  async reserveStarted(
    processingId: string,
    concurrency: number,
  ): Promise<boolean> {
    await this.host.tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${LOCK_SCOPE}))`,
    );
    await this.reconcileLatestMigrationAttempts();
    await this.reconcileActiveAdmissions();
    const [existing] = await this.host.tx
      .select({ id: legacyProcessingAdmissions.id })
      .from(legacyProcessingAdmissions)
      .where(eq(legacyProcessingAdmissions.id, processingId));
    const active = await this.activeCount();
    if (existing !== undefined) return true;
    if (active >= concurrency) return false;
    await this.host.tx
      .insert(legacyProcessingAdmissions)
      .values({ id: processingId })
      .onConflictDoNothing();
    return true;
  }

  async markStarted(processingId: string): Promise<void> {
    await this.host.tx
      .update(legacyProcessingAdmissions)
      .set({ startedAt: new Date() })
      .where(
        and(
          eq(legacyProcessingAdmissions.id, processingId),
          sql`${legacyProcessingAdmissions.startedAt} is null`,
        ),
      );
  }

  async unstartedQueued(): Promise<BacklogWork[]> {
    return this.host.tx
      .select({
        processingId: trackProcessings.id,
        trackId: trackProcessings.trackId,
      })
      .from(legacyProcessingAdmissions)
      .innerJoin(
        trackProcessings,
        eq(trackProcessings.id, legacyProcessingAdmissions.id),
      )
      .where(
        and(
          eq(trackProcessings.status, 'QUEUED'),
          sql`${legacyProcessingAdmissions.startedAt} is null`,
        ),
      )
      .orderBy(asc(legacyProcessingAdmissions.admittedAt));
  }

  async report(): Promise<BacklogReport> {
    const rows = await this.loadStatusRows();
    const report: BacklogReport = {
      queued: await this.countWaiting(),
      admitted: 0,
      running: 0,
      completed: 0,
      failed: 0,
    };
    for (const row of rows) {
      this.addStatusCount(
        report,
        row.status,
        row.count,
        row.admittedAt !== null,
      );
    }
    return report;
  }

  private loadStatusRows() {
    return this.host.tx
      .select({
        status: trackProcessings.status,
        admittedAt: legacyProcessingAdmissions.admittedAt,
        count: count(),
      })
      .from(legacyRecordingImports)
      .innerJoin(
        trackProcessings,
        eq(trackProcessings.id, legacyRecordingImports.processingId),
      )
      .innerJoin(
        legacyProcessingOrigins,
        eq(legacyProcessingOrigins.id, trackProcessings.id),
      )
      .leftJoin(
        legacyProcessingAdmissions,
        eq(legacyProcessingAdmissions.id, trackProcessings.id),
      )
      .groupBy(trackProcessings.status, legacyProcessingAdmissions.admittedAt);
  }

  private async countWaiting(): Promise<number> {
    // A queued Processing without an admission is work waiting for a slot.
    const [queued] = await this.host.tx
      .select({ count: count() })
      .from(legacyRecordingImports)
      .innerJoin(
        trackProcessings,
        eq(trackProcessings.id, legacyRecordingImports.processingId),
      )
      .innerJoin(
        legacyProcessingOrigins,
        eq(legacyProcessingOrigins.id, trackProcessings.id),
      )
      .leftJoin(
        legacyProcessingAdmissions,
        eq(legacyProcessingAdmissions.id, trackProcessings.id),
      )
      .where(
        and(
          eq(trackProcessings.status, 'QUEUED'),
          sql`${legacyProcessingAdmissions.id} is null`,
        ),
      );
    return queued?.count ?? 0;
  }

  async hasPendingWork(): Promise<boolean> {
    const [row] = await this.host.tx
      .select({ count: count() })
      .from(legacyRecordingImports)
      .innerJoin(
        trackProcessings,
        eq(trackProcessings.id, legacyRecordingImports.processingId),
      )
      .innerJoin(
        legacyProcessingOrigins,
        eq(legacyProcessingOrigins.id, trackProcessings.id),
      )
      .where(
        notInArray(trackProcessings.status, [
          ...TRACK_PROCESSING_TERMINAL_STATUSES,
        ]),
      );
    return (row?.count ?? 0) > 0;
  }

  private addStatusCount(
    report: BacklogReport,
    status: TrackProcessingStatus,
    amount: number,
    admitted: boolean,
  ): void {
    if (status === 'QUEUED') {
      if (admitted) report.admitted += amount;
      return;
    }
    if (status === 'COMPLETED') {
      report.completed += amount;
      return;
    }
    if (status === 'FAILED') {
      report.failed += amount;
      return;
    }
    report.running += amount;
  }

  private async activeCount(): Promise<number> {
    const [row] = await this.host.tx
      .select({ count: count() })
      .from(legacyProcessingAdmissions)
      .innerJoin(
        trackProcessings,
        eq(trackProcessings.id, legacyProcessingAdmissions.id),
      )
      .where(
        notInArray(trackProcessings.status, [
          ...TRACK_PROCESSING_TERMINAL_STATUSES,
        ]),
      );
    return row?.count ?? 0;
  }

  private async reconcileActiveAdmissions(): Promise<void> {
    const active = await this.host.tx
      .select({
        processingId: legacyRecordingImports.processingId,
        status: trackProcessings.status,
        runpodJobId: trackProcessings.runpodJobId,
      })
      .from(legacyRecordingImports)
      .innerJoin(
        trackProcessings,
        eq(trackProcessings.id, legacyRecordingImports.processingId),
      )
      .innerJoin(
        legacyProcessingOrigins,
        eq(legacyProcessingOrigins.id, trackProcessings.id),
      )
      .where(
        and(
          notInArray(trackProcessings.status, [
            ...TRACK_PROCESSING_TERMINAL_STATUSES,
          ]),
          sql`(${trackProcessings.status} <> 'QUEUED' or ${trackProcessings.runpodJobId} is not null)`,
        ),
      );
    if (active.length === 0) return;
    await this.host.tx
      .insert(legacyProcessingAdmissions)
      .values(active.map((row) => ({ id: row.processingId })))
      .onConflictDoNothing();
    const alreadyRunning = active.filter(
      (row) => row.status !== 'QUEUED' || row.runpodJobId !== null,
    );
    if (alreadyRunning.length === 0) return;
    await this.host.tx
      .update(legacyProcessingAdmissions)
      .set({ startedAt: new Date() })
      .where(
        and(
          inArray(
            legacyProcessingAdmissions.id,
            alreadyRunning.map((row) => row.processingId),
          ),
          sql`${legacyProcessingAdmissions.startedAt} is null`,
        ),
      );
  }

  private async reconcileLatestMigrationAttempts(): Promise<void> {
    await this.host.tx.execute(sql`
      update legacy_recording_imports as imports
      set processing_id = latest.processing_id, updated_at = now()
      from (
        select distinct on (imports.id)
          imports.id as import_id,
          processings.id as processing_id
        from legacy_recording_imports as imports
        inner join track_processings as processings
          on processings.track_id = imports.track_id
        inner join legacy_processing_origins as origins
          on origins.id = processings.id
        where origins.recording_mbid = imports.id
        order by imports.id, processings.created_at desc, processings.id desc
      ) as latest
      where imports.id = latest.import_id
        and imports.processing_id <> latest.processing_id
        and exists (
          select 1 from legacy_processing_origins as current_origin
          where current_origin.id = imports.processing_id
            and current_origin.recording_mbid = imports.id
        )
    `);
  }
}
