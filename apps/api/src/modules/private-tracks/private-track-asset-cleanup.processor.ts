import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { UnrecoverableError } from 'bullmq';
import { StorageService } from '../../integrations/storage/storage.service.js';
import {
  CLEAN_PRIVATE_TRACK_OBJECT,
  CLEAN_PRIVATE_TRACK_PREFIX,
  cleanPrivateTrackObjectJobSchema,
  cleanPrivateTrackPrefixJobSchema,
  PRIVATE_TRACK_ASSET_CLEANUP_QUEUE,
} from './private-track-asset-cleanup.job.js';
import { PrivateTracksRepository } from './private-tracks.repository.js';

@Processor(PRIVATE_TRACK_ASSET_CLEANUP_QUEUE, { concurrency: 2 })
export class PrivateTrackAssetCleanupProcessor extends WorkerHost {
  constructor(
    private readonly repository: PrivateTracksRepository,
    private readonly storage: StorageService,
  ) {
    super();
  }

  async process(job: Job<unknown>): Promise<void> {
    if (job.name === CLEAN_PRIVATE_TRACK_PREFIX) {
      const parsed = cleanPrivateTrackPrefixJobSchema.safeParse(job.data);
      if (!parsed.success) {
        throw new UnrecoverableError('Invalid private track prefix cleanup');
      }
      await this.cleanPrefix(parsed.data);
      return;
    }
    if (job.name === CLEAN_PRIVATE_TRACK_OBJECT) {
      const parsed = cleanPrivateTrackObjectJobSchema.safeParse(job.data);
      if (!parsed.success) {
        throw new UnrecoverableError('Invalid private object cleanup');
      }
      if (await this.repository.isPrivateObjectReferenced(parsed.data.key)) {
        return;
      }
      await this.storage.deletePrivateObject(parsed.data.key);
      return;
    }
    throw new UnrecoverableError('Unknown private track cleanup job');
  }

  private async cleanPrefix(input: {
    userId: string;
    privateTrackId: string;
    prefix: string;
    sourceKey: string;
  }): Promise<void> {
    if (await this.repository.findOwned(input.userId, input.privateTrackId)) {
      return;
    }
    await Promise.all([
      this.storage.deletePrivateObject(input.sourceKey),
      this.storage.deletePrivateObjectsWithPrefix(input.prefix),
    ]);
  }
}
