import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { UnrecoverableError } from 'bullmq';
import {
  DELIVER_TRACK_SEARCH_INDEX_JOB,
  deliverTrackSearchIndexJobSchema,
  TRACK_SEARCH_INDEX_POLL_INTERVAL_MS,
  TRACK_SEARCH_INDEX_QUEUE,
  TRACK_SEARCH_INDEX_SCHEDULER_ID,
} from './track-search-index.job.js';
import { TrackSearchIndexService } from './track-search-index.service.js';

/** Repeats delivery so PostgreSQL work resumes after Redis or worker restarts. */
@Processor(TRACK_SEARCH_INDEX_QUEUE, { concurrency: 1 })
export class TrackSearchIndexProcessor
  extends WorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(TrackSearchIndexProcessor.name);

  constructor(
    private readonly indexing: TrackSearchIndexService,
    @InjectQueue(TRACK_SEARCH_INDEX_QUEUE)
    private readonly queue: Queue<unknown>,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        TRACK_SEARCH_INDEX_SCHEDULER_ID,
        { every: TRACK_SEARCH_INDEX_POLL_INTERVAL_MS },
        { name: DELIVER_TRACK_SEARCH_INDEX_JOB, data: {} },
      );
    } catch (error: unknown) {
      this.logger.error(
        'Could not schedule Sonic search index delivery',
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  async process(job: Job<unknown>): Promise<void> {
    if (
      job.name !== DELIVER_TRACK_SEARCH_INDEX_JOB ||
      !deliverTrackSearchIndexJobSchema.safeParse(job.data).success
    ) {
      throw new UnrecoverableError('Invalid Sonic search index job');
    }
    await this.indexing.dispatchPending();
  }
}
