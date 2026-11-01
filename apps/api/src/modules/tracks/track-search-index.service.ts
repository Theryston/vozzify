import { Injectable, Logger } from '@nestjs/common';
import { SonicService } from '../../integrations/sonic/sonic.service.js';
import { trackAssociationRetryDelay } from './track-association-retry.js';
import {
  TRACK_SEARCH_INDEX_BATCH_SIZE,
  TRACK_SEARCH_INDEX_CLAIM_LEASE_MS,
} from './track-search-index.job.js';
import { TrackSearchIndexEventRepository } from './track-search-index-event.repository.js';

const MAX_REVISIONS_PER_DELIVERY = 3;

/** Delivers the independently acknowledged Sonic projection outbox. */
@Injectable()
export class TrackSearchIndexService {
  private readonly logger = new Logger(TrackSearchIndexService.name);

  constructor(
    private readonly events: TrackSearchIndexEventRepository,
    private readonly sonic: SonicService,
  ) {}

  async dispatchPending(now = new Date()): Promise<number> {
    const rows = await this.events.claimPending(
      now,
      new Date(now.getTime() + TRACK_SEARCH_INDEX_CLAIM_LEASE_MS),
      TRACK_SEARCH_INDEX_BATCH_SIZE,
    );
    for (const row of rows) {
      try {
        await this.deliverLatestRevision(row, now);
      } catch (error: unknown) {
        const retryAt = new Date(
          now.getTime() + trackAssociationRetryDelay(row.attempts),
        );
        await this.events.scheduleRetry(row.id, row.revision, retryAt);
        await this.events.requeueNewerRevision(row.id, row.revision, retryAt);
        this.logger.warn(
          `Sonic index delivery failed; retry scheduled for ${retryAt.toISOString()}`,
        );
        if (error instanceof Error) this.logger.debug(error.message);
      }
    }
    return rows.length;
  }

  enqueueBackfillPage(
    rows: Parameters<TrackSearchIndexEventRepository['enqueueBackfillPage']>[0],
  ) {
    return this.events.enqueueBackfillPage(rows);
  }

  countPending(): Promise<number> {
    return this.events.countPending();
  }

  private async deliverLatestRevision(
    claimed: {
      id: string;
      trackId: string;
      operation: 'upsert' | 'delete';
      searchableText: string | null;
      revision: number;
      attempts: number;
    },
    now: Date,
  ): Promise<void> {
    await this.events.withDeliveryLock(claimed.trackId, () =>
      this.deliverLockedRevisions(claimed, now),
    );
  }

  private async deliverLockedRevisions(
    claimed: {
      id: string;
      trackId: string;
      operation: 'upsert' | 'delete';
      searchableText: string | null;
      revision: number;
      attempts: number;
    },
    now: Date,
  ): Promise<void> {
    let current = (await this.events.findById(claimed.id)) ?? claimed;
    for (
      let revisionCount = 0;
      revisionCount < MAX_REVISIONS_PER_DELIVERY;
      revisionCount += 1
    ) {
      const newer = await this.deliverOneRevision(current, now);
      if (newer === undefined) return;
      current = newer;
    }
    const latest = await this.events.findById(current.id);
    if (latest !== undefined && latest.revision !== current.revision) {
      await this.events.requeueNewerRevision(current.id, current.revision, now);
    }
  }

  private async deliverOneRevision(
    current: {
      id: string;
      trackId: string;
      operation: 'upsert' | 'delete';
      searchableText: string | null;
      revision: number;
      attempts: number;
    },
    now: Date,
  ) {
    await this.writeToSonic(current);
    const latest = await this.events.findById(current.id);
    if (latest === undefined) return;
    if (latest.revision !== current.revision) return latest;
    if (await this.events.markDelivered(latest.id, latest.revision, now)) {
      return;
    }
    return (await this.events.findById(latest.id)) ?? current;
  }

  private async writeToSonic(row: {
    trackId: string;
    operation: 'upsert' | 'delete';
    searchableText: string | null;
  }): Promise<void> {
    if (row.operation === 'delete') {
      await this.sonic.removeTrack(row.trackId);
    } else if (row.searchableText !== null) {
      await this.sonic.indexTrack(row.trackId, row.searchableText);
    } else {
      throw new Error(`Track ${row.trackId} has no Sonic document`);
    }
  }
}
