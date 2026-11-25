import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { createId } from '@paralleldrive/cuid2';
import type { Queue } from 'bullmq';
import {
  CLEAN_PRIVATE_TRACK_OBJECT,
  CLEAN_PRIVATE_TRACK_PREFIX,
  type CleanPrivateTrackObjectJob,
  type CleanPrivateTrackPrefixJob,
  PRIVATE_TRACK_ASSET_CLEANUP_QUEUE,
} from './private-track-asset-cleanup.job.js';

const retryOptions = {
  attempts: 10,
  backoff: { type: 'exponential' as const, delay: 60_000 },
  removeOnComplete: true,
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 5000 },
};

@Injectable()
export class PrivateTrackAssetCleanupQueue {
  constructor(
    @InjectQueue(PRIVATE_TRACK_ASSET_CLEANUP_QUEUE)
    private readonly queue: Queue<
      CleanPrivateTrackPrefixJob | CleanPrivateTrackObjectJob
    >,
  ) {}

  async schedulePrefixCleanup(input: {
    userId: string;
    privateTrackId: string;
    prefix: string;
    sourceKey: string;
    delayMs: number;
  }): Promise<void> {
    await this.queue.add(CLEAN_PRIVATE_TRACK_PREFIX, input, {
      ...retryOptions,
      delay: input.delayMs,
      jobId: `private-track-prefix-cleanup-${createId()}`,
    });
  }

  async schedulePrivateObjectCleanup(
    key: string,
    delayMs: number,
  ): Promise<void> {
    await this.queue.add(
      CLEAN_PRIVATE_TRACK_OBJECT,
      { key },
      {
        ...retryOptions,
        delay: delayMs,
        jobId: `private-track-object-cleanup-${createId()}`,
      },
    );
  }
}
