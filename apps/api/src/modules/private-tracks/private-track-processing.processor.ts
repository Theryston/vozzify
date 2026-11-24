import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { isFinalAttempt } from '../../queue/job-attempts.js';
import {
  CLEAN_PRIVATE_TRACK_ASSETS_JOB,
  PRIVATE_TRACK_PROCESSING_QUEUE,
  PROCESS_PRIVATE_TRACK_JOB,
} from './private-track-processing.job.js';
import { PrivateTrackProcessingService } from './private-track-processing.service.js';

@Processor(PRIVATE_TRACK_PROCESSING_QUEUE, { concurrency: 3 })
export class PrivateTrackProcessingProcessor extends WorkerHost {
  constructor(private readonly processing: PrivateTrackProcessingService) {
    super();
  }

  async process(job: Job<unknown>): Promise<void> {
    if (job.name === CLEAN_PRIVATE_TRACK_ASSETS_JOB) {
      await this.processing.cleanAssets(job.data);
      return;
    }
    if (job.name !== PROCESS_PRIVATE_TRACK_JOB) {
      throw new Error(`Unknown private Track job ${job.name}`);
    }
    try {
      await this.processing.process(job.data);
    } catch (error) {
      if (isFinalAttempt(job)) {
        const data = job.data as { privateTrackId?: unknown };
        if (typeof data.privateTrackId === 'string') {
          await this.processing.markFailed(data.privateTrackId);
        }
      }
      throw error;
    }
  }
}
