import { Injectable, Logger } from '@nestjs/common';
import { cacheTags } from '@vozzify/contracts';
import { UnrecoverableError } from 'bullmq';
import type { z } from 'zod';
import { WebRevalidationService } from '../../integrations/web-revalidation/web-revalidation.service.js';
import { TrackContributorEmailsService } from './track-contributor-emails.service.js';
import { TrackCoverService } from './track-cover.service.js';
import { TrackPipelineService } from './track-pipeline.service.js';
import {
  RUN_STEP_JOB,
  runStepJobSchema,
  STORE_COVER_JOB,
  type StoreCoverJob,
  storeCoverJobSchema,
} from './track-processing.job.js';
import { messageOf } from './track-processing-failure.js';

/**
 * Routes one job of the Processing queue to what runs it: a step to the
 * pipeline, a cover to the cover service. The BullMQ processor and the e2e
 * specs both go through here, so a job runs the same way in both.
 */
@Injectable()
export class TrackJobRunnerService {
  private readonly logger = new Logger(TrackJobRunnerService.name);

  constructor(
    private readonly pipeline: TrackPipelineService,
    private readonly covers: TrackCoverService,
    private readonly revalidation: WebRevalidationService,
    private readonly contributorEmails: TrackContributorEmailsService,
  ) {}

  /**
   * `finalAttempt` tells whether BullMQ gives up on the job when this run
   * throws, which is when a failure is final.
   */
  async run(name: string, data: unknown, finalAttempt: boolean): Promise<void> {
    if (name === RUN_STEP_JOB) {
      const step = parseJob(runStepJobSchema, data);
      await this.pipeline.runStep(step, finalAttempt);
      // The step may have ended its Processing: its Contributors are emailed
      // once the status is written, and a failed round fails this job so BullMQ
      // replays it (see TrackContributorEmailsService).
      return this.contributorEmails.notifyIfEnded(step.processingId);
    }
    if (name === STORE_COVER_JOB) {
      return this.storeCover(parseJob(storeCoverJobSchema, data), finalAttempt);
    }
    throw new UnrecoverableError(`Unknown job "${name}"`);
  }

  /**
   * Stores the cover, then refreshes the Track's pages. The refresh runs after
   * every successful pass, not only after a store, so a replay whose refresh
   * failed still refreshes. A failure is retried; on the last attempt the Track
   * keeps its placeholder, which only a log line records.
   */
  private async storeCover(
    job: StoreCoverJob,
    finalAttempt: boolean,
  ): Promise<void> {
    try {
      await this.covers.storeCover(job.trackId);
      await this.revalidation.revalidate([
        cacheTags.track(job.trackId),
        cacheTags.tracks,
      ]);
    } catch (error) {
      if (!finalAttempt) {
        throw error;
      }
      this.logger.warn(
        `No cover for Track ${job.trackId}: ${messageOf(error)}`,
      );
    }
  }
}

/** A job's payload, parsed; a payload that breaks its schema never succeeds. */
function parseJob<TOutput>(schema: z.ZodType<TOutput>, data: unknown): TOutput {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new UnrecoverableError('Invalid job payload');
  }
  return parsed.data;
}
