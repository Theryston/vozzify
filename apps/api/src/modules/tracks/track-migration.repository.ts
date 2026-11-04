import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import { legacyProcessingOrigins } from '../../database/schema/legacy-recording-imports.js';
import {
  trackContributions,
  trackContributors,
} from '../../database/schema/track-contributors.js';
import { trackProcessings } from '../../database/schema/track-processings.js';
import { legacyTrackIds } from '../../database/schema/tracks.js';

import { TrackContributorRepository } from './track-contributor.repository.js';

@Injectable()
export class TrackMigrationRepository {
  constructor(
    private readonly host: TransactionHost<DatabaseAdapter>,
    private readonly contributors: TrackContributorRepository,
  ) {}

  async attribute(
    trackId: string,
    processingId: string,
    historical: { userId: string; contributedAt: Date },
  ): Promise<void> {
    const contributorId = await this.contributors.findOrInsertContributor(
      trackId,
      historical.userId,
      historical.contributedAt,
    );
    await this.contributors.insertContribution({
      contributorId,
      kind: 'CREATE',
      processingId,
      createdAt: historical.contributedAt,
      updatedAt: historical.contributedAt,
    });
  }

  async lock(recordingMbid: string): Promise<void> {
    await this.host.tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('legacy.recording'), hashtext(${recordingMbid}))`,
    );
  }

  async mark(processingId: string, recordingMbid: string): Promise<void> {
    await this.host.tx
      .insert(legacyProcessingOrigins)
      .values({ id: processingId, recordingMbid });
  }

  async isMigration(processingId: string): Promise<boolean> {
    const [row] = await this.host.tx
      .select({ id: legacyProcessingOrigins.id })
      .from(legacyProcessingOrigins)
      .where(eq(legacyProcessingOrigins.id, processingId));
    return row !== undefined;
  }

  async initial(trackId: string) {
    const [row] = await this.host.tx
      .select({
        processingId: trackProcessings.id,
        userId: trackContributors.userId,
        contributedAt: trackContributions.createdAt,
      })
      .from(trackProcessings)
      .innerJoin(
        legacyProcessingOrigins,
        eq(legacyProcessingOrigins.id, trackProcessings.id),
      )
      .innerJoin(
        trackContributions,
        eq(trackContributions.processingId, trackProcessings.id),
      )
      .innerJoin(
        trackContributors,
        eq(trackContributors.id, trackContributions.contributorId),
      )
      .where(
        and(
          eq(trackProcessings.trackId, trackId),
          eq(trackContributions.kind, 'CREATE'),
        ),
      )
      .orderBy(asc(trackProcessings.createdAt), asc(trackProcessings.id))
      .limit(1);
    return row;
  }

  async map(trackId: string, legacyIds: string[]): Promise<void> {
    for (const legacyId of legacyIds) {
      await this.host.tx
        .insert(legacyTrackIds)
        .values({ legacyId, trackId })
        .onConflictDoNothing();
      const [mapped] = await this.host.tx
        .select({ trackId: legacyTrackIds.trackId })
        .from(legacyTrackIds)
        .where(eq(legacyTrackIds.legacyId, legacyId));
      if (mapped?.trackId !== trackId)
        throw new Error('LEGACY_TRACK_MAP_CONFLICT');
    }
  }
}
