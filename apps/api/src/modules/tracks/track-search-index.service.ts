import { Inject, Injectable, Logger } from '@nestjs/common';
import { SonicService } from '../../integrations/sonic/sonic.service.js';
import { trackAssociationRetryDelay } from './track-association-retry.js';
import {
  TRACK_SEARCH_INDEX_BATCH_SIZE,
  TRACK_SEARCH_INDEX_CLAIM_LEASE_MS,
} from './track-search-index.job.js';
import type { ClaimedTrackSearchIndexEvent } from './track-search-index-event.repository.js';
import { TrackSearchIndexEventRepository } from './track-search-index-event.repository.js';

const MAX_REVISIONS_PER_DELIVERY = 3;

export type TrackSearchIndexDeliveryStore = Pick<
  TrackSearchIndexEventRepository,
  | 'claimPending'
  | 'findById'
  | 'markDelivered'
  | 'scheduleRetry'
  | 'requeueNewerRevision'
  | 'enqueueBackfillPage'
  | 'countPending'
> & {
  withDeliveryLock(
    trackId: string,
    deliver: () => Promise<void>,
  ): Promise<void>;
};

export type TrackSearchIndexSonicWriter = Pick<
  SonicService,
  'replaceTrack' | 'removeTrack'
>;

/** Delivers the independently acknowledged Sonic projection outbox. */
@Injectable()
export class TrackSearchIndexService {
  private readonly logger = new Logger(TrackSearchIndexService.name);

  constructor(
    @Inject(TrackSearchIndexEventRepository)
    private readonly events: TrackSearchIndexDeliveryStore,
    @Inject(SonicService) private readonly sonic: TrackSearchIndexSonicWriter,
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
    claimed: ClaimedTrackSearchIndexEvent,
    now: Date,
  ): Promise<void> {
    await this.events.withDeliveryLock(claimed.trackId, () =>
      this.deliverLockedRevisions(claimed, now),
    );
  }

  private async deliverLockedRevisions(
    claimed: ClaimedTrackSearchIndexEvent,
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
    current: ClaimedTrackSearchIndexEvent,
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

  private async writeToSonic(
    row: Pick<
      ClaimedTrackSearchIndexEvent,
      'trackId' | 'operation' | 'searchableText'
    >,
  ): Promise<void> {
    if (row.operation === 'delete') {
      await this.sonic.removeTrack(row.trackId);
    } else if (row.searchableText !== null) {
      await this.sonic.replaceTrack(row.trackId, row.searchableText);
    } else {
      throw new Error(`Track ${row.trackId} has no Sonic document`);
    }
  }
}
