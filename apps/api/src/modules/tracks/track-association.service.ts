import { Injectable, Logger } from '@nestjs/common';
import type { MusicCatalogTrackAssociationPayload } from '@vozzify/contracts';
import { MusicCatalogClient } from '../../integrations/music-catalog/music-catalog.client.js';
import {
  TRACK_ASSOCIATION_BATCH_SIZE,
  TRACK_ASSOCIATION_CLAIM_LEASE_MS,
  TRACK_ASSOCIATION_CLEANUP_BATCH_SIZE,
  TRACK_ASSOCIATION_RETENTION_MS,
} from './track-association.job.js';
import { TrackAssociationEventRepository } from './track-association-event.repository.js';
import { trackAssociationRetryDelay } from './track-association-retry.js';

/** Delivers committed Track links and keeps failed or interrupted work pending. */
@Injectable()
export class TrackAssociationService {
  private readonly logger = new Logger(TrackAssociationService.name);

  constructor(
    private readonly events: TrackAssociationEventRepository,
    private readonly catalog: MusicCatalogClient,
  ) {}

  /** One bounded pass; a recurring scheduler resumes it after failures or restarts. */
  async dispatchPending(now = new Date()): Promise<void> {
    await this.events.deleteDeliveredBefore(
      new Date(now.getTime() - TRACK_ASSOCIATION_RETENTION_MS),
      TRACK_ASSOCIATION_CLEANUP_BATCH_SIZE,
    );
    const rows = await this.events.claimPending(
      now,
      new Date(now.getTime() + TRACK_ASSOCIATION_CLAIM_LEASE_MS),
      TRACK_ASSOCIATION_BATCH_SIZE,
    );
    for (const row of rows) {
      await this.deliver(row, now);
    }
  }

  private async deliver(
    row: {
      id: string;
      recordingMbid: string;
      trackId: string;
      attempts: number;
      businessScore: number;
      revision: number;
    },
    now: Date,
  ): Promise<void> {
    const payload: MusicCatalogTrackAssociationPayload = {
      mbid: row.recordingMbid,
      trackId: row.trackId,
      businessScore: row.businessScore,
      revision: row.revision,
    };
    try {
      await this.catalog.associateTrack(payload);
      await this.events.markDelivered(row.id, row.revision, now);
    } catch (error) {
      const retryAt = new Date(
        now.getTime() + trackAssociationRetryDelay(row.attempts),
      );
      await this.events.scheduleRetry(row.id, row.revision, retryAt);
      this.logger.warn(
        `Track association delivery failed; retry scheduled for ${retryAt.toISOString()}`,
      );
      if (error instanceof Error) {
        this.logger.debug(error.message);
      }
    }
  }
}
