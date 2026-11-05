import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { eq, sql } from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import { legacyAlbumIds } from '../../database/schema/albums.js';
import { legacyArtistIds } from '../../database/schema/artists.js';
import { legacyPersonalImports } from '../../database/schema/legacy-personal-imports.js';
import { legacyRecordingImports } from '../../database/schema/legacy-recording-imports.js';
import {
  legacyRecordingPlanRuns,
  legacyRecordingPlans,
} from '../../database/schema/legacy-recording-plans.js';
import { legacyRelationshipImports } from '../../database/schema/legacy-relationship-imports.js';
import { legacyUserImports } from '../../database/schema/legacy-user-imports.js';
import { trackProcessings } from '../../database/schema/track-processings.js';
import { legacyTrackIds, tracks } from '../../database/schema/tracks.js';

/** Operator projections of durable import checkpoints, never a destination reset. */
@Injectable()
export class LegacyCutoverRepository {
  constructor(private readonly host: TransactionHost<DatabaseAdapter>) {}

  async read() {
    const db = this.host.tx;
    const [users] = await db
      .select()
      .from(legacyUserImports)
      .where(eq(legacyUserImports.id, 'legacy-users-v1'));
    const [personal] = await db
      .select()
      .from(legacyPersonalImports)
      .where(eq(legacyPersonalImports.id, 'legacy-personal-v1'));
    const [plan] = await db
      .select()
      .from(legacyRecordingPlanRuns)
      .where(eq(legacyRecordingPlanRuns.id, 'legacy-recordings-v1'));
    const [relationships] = await db
      .select()
      .from(legacyRelationshipImports)
      .where(eq(legacyRelationshipImports.id, 'legacy-relationships-v1'));
    return {
      users,
      personal,
      plan,
      relationships,
      planComplete: plan?.status === 'complete',
      tracks: await this.trackOutcomes(),
      artistMaps: await db
        .select({
          legacyId: legacyArtistIds.legacyId,
          destinationId: legacyArtistIds.artistId,
        })
        .from(legacyArtistIds),
      albumMaps: await db
        .select({
          legacyId: legacyAlbumIds.legacyId,
          destinationId: legacyAlbumIds.albumId,
        })
        .from(legacyAlbumIds),
    };
  }

  private trackOutcomes() {
    return this.host.tx
      .select({
        legacyId: legacyRecordingPlans.legacyTrackId,
        recordingMbid: legacyRecordingPlans.recordingMbid,
        status: legacyRecordingPlans.status,
        reason: legacyRecordingPlans.skipReason,
        trackId: legacyRecordingImports.trackId,
        mappedTrackId: legacyTrackIds.trackId,
        processingId: trackProcessings.id,
        processingStatus: trackProcessings.status,
        failureCode: trackProcessings.failureCode,
        runpodJobId: trackProcessings.runpodJobId,
        metadataStatus: legacyRecordingImports.metadataStatus,
        sourceCreatorId: legacyRecordingPlans.sourceCreatorId,
        initialContributor: legacyRecordingPlans.initialContributor,
        dependentFavorites: sql<number>`coalesce((${legacyRecordingPlans.source}->>'dependentFavorites')::integer, 0)`,
        dependentViews: sql<number>`coalesce((${legacyRecordingPlans.source}->>'dependentViews')::integer, 0)`,
      })
      .from(legacyRecordingPlans)
      .leftJoin(
        legacyRecordingImports,
        eq(legacyRecordingImports.id, legacyRecordingPlans.recordingMbid),
      )
      .leftJoin(
        legacyTrackIds,
        eq(legacyTrackIds.legacyId, legacyRecordingPlans.legacyTrackId),
      )
      .leftJoin(tracks, eq(tracks.id, legacyRecordingImports.trackId))
      .leftJoin(
        trackProcessings,
        sql`${trackProcessings.id} = (
        select p.id from track_processings p where p.track_id = ${tracks.id}
        order by p.created_at desc, p.id desc limit 1
      )`,
      )
      .orderBy(legacyRecordingPlans.legacyTrackId);
  }
}
