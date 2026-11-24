import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { isFinalAttempt } from '../../queue/job-attempts.js';
import {
  CLEAN_PRIVATE_TRACK_ASSETS_JOB,
  type CleanPrivateTrackAssetsJob,
  PRIVATE_TRACK_PROCESSING_QUEUE,
  PRIVATE_TRACK_RECONCILIATION_SCHEDULER,
  PROCESS_PRIVATE_TRACK_JOB,
  type ProcessPrivateTrackJob,
  RECONCILE_PRIVATE_TRACKS_JOB,
  type ReconcilePrivateTracksJob,
} from './private-track-processing.job.js';
import { PrivateTrackProcessingService } from './private-track-processing.service.js';

@Processor(PRIVATE_TRACK_PROCESSING_QUEUE, { concurrency: 3 })
export class PrivateTrackProcessingProcessor
  extends WorkerHost
  implements OnModuleInit
{
  constructor(
    private readonly processing: PrivateTrackProcessingService,
    @InjectQueue(PRIVATE_TRACK_PROCESSING_QUEUE)
    private readonly queue: Queue<
      | ProcessPrivateTrackJob
      | CleanPrivateTrackAssetsJob
      | ReconcilePrivateTracksJob
    >,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      PRIVATE_TRACK_RECONCILIATION_SCHEDULER,
      { every: 60_000 },
      { name: RECONCILE_PRIVATE_TRACKS_JOB, data: {} },
    );
  }

  async process(job: Job<unknown>): Promise<void> {
    if (job.name === RECONCILE_PRIVATE_TRACKS_JOB) {
      await this.processing.reconcileQueuedTracks();
      return;
    }
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
        const data = job.data as {
          attemptId?: unknown;
          privateTrackId?: unknown;
        };
        if (typeof data.privateTrackId === 'string') {
          await this.processing.markFailed(
            data.privateTrackId,
            typeof data.attemptId === 'string' ? data.attemptId : null,
          );
        }
      }
      throw error;
    }
  }
}
