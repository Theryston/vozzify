import { Injectable } from '@nestjs/common';
import { TrackMetadataQueueService } from './track-metadata-queue.service.js';
import {
  type MigrationGroup,
  TrackMigrationPreparationService,
} from './track-migration-preparation.service.js';
import { TrackMigrationRetryService } from './track-migration-retry.service.js';
import { TrackPipelineService } from './track-pipeline.service.js';

/** Operator-only entry point. No HTTP controller exposes historical attribution. */
@Injectable()
export class TrackMigrationService {
  constructor(
    private readonly preparation: TrackMigrationPreparationService,
    private readonly retries: TrackMigrationRetryService,
    private readonly metadata: TrackMetadataQueueService,
    private readonly pipeline: TrackPipelineService,
  ) {}

  async prepare(group: MigrationGroup) {
    const prepared = await this.preparation.prepare(group);
    await this.metadata.enqueueImport(prepared.trackId);
    return prepared;
  }

  async start(trackId: string, processingId: string): Promise<void> {
    await this.preparation.assertAttempt(trackId, processingId);
    await this.metadata.enqueueImport(trackId);
    await this.pipeline.startIfQueued(trackId);
  }

  retry(trackId: string, expectedProcessingId: string, recordingMbid: string) {
    return this.retries.retry(trackId, expectedProcessingId, recordingMbid);
  }
}
