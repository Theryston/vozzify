import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { AcoustidClient } from '../../integrations/acoustid/acoustid.client.js';
import {
  IDENTIFY_PRIVATE_TRACK_JOB,
  type IdentifyPrivateTrackJob,
  PRIVATE_TRACK_IDENTIFICATION_QUEUE,
} from './private-track-identification.job.js';

@Injectable()
export class PrivateTrackIdentificationQueue {
  private readonly logger = new Logger(PrivateTrackIdentificationQueue.name);

  constructor(
    @InjectQueue(PRIVATE_TRACK_IDENTIFICATION_QUEUE)
    private readonly queue: Queue<IdentifyPrivateTrackJob>,
    private readonly acoustid: AcoustidClient,
  ) {}

  async enqueue(privateTrackId: string): Promise<void> {
    if (!this.acoustid.isConfigured()) return;
    try {
      await this.queue.add(
        IDENTIFY_PRIVATE_TRACK_JOB,
        { privateTrackId },
        {
          jobId: privateTrackId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch {
      this.logger.warn('Could not queue private Recording identification');
    }
  }
}
