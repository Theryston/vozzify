import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { type Job, UnrecoverableError } from 'bullmq';
import { isFinalAttempt } from '../../queue/job-attempts.js';
import {
  IDENTIFY_PRIVATE_TRACK_JOB,
  identifyPrivateTrackJobSchema,
  PRIVATE_TRACK_IDENTIFICATION_QUEUE,
} from './private-track-identification.job.js';
import { PrivateTrackIdentificationService } from './private-track-identification.service.js';

@Processor(PRIVATE_TRACK_IDENTIFICATION_QUEUE, { concurrency: 1 })
export class PrivateTrackIdentificationProcessor extends WorkerHost {
  private readonly logger = new Logger(
    PrivateTrackIdentificationProcessor.name,
  );

  constructor(
    private readonly identification: PrivateTrackIdentificationService,
  ) {
    super();
  }

  async process(job: Job<unknown>): Promise<void> {
    const parsed = identifyPrivateTrackJobSchema.safeParse(job.data);
    if (job.name !== IDENTIFY_PRIVATE_TRACK_JOB || !parsed.success) {
      throw new UnrecoverableError(
        'Invalid private Recording identification job',
      );
    }
    try {
      await this.identification.identify(parsed.data.privateTrackId);
    } catch {
      if (isFinalAttempt(job))
        this.logger.warn('Private Recording identification could not complete');
      throw new Error('Private Recording identification failed');
    }
  }
}
