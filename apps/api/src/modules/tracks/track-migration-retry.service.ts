import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { TrackContributorRepository } from './track-contributor.repository.js';
import { TrackMigrationRepository } from './track-migration.repository.js';
import { TrackProcessingRepository } from './track-processing.repository.js';
import { retryPlanOf } from './track-retry.js';
import { TrackRetryRepository } from './track-retry.repository.js';

@Injectable()
export class TrackMigrationRetryService {
  constructor(
    private readonly migrations: TrackMigrationRepository,
    private readonly processings: TrackProcessingRepository,
    private readonly retries: TrackRetryRepository,
    private readonly contributors: TrackContributorRepository,
  ) {}

  @Transactional()
  async retry(
    trackId: string,
    expectedProcessingId: string,
    recordingMbid: string,
  ): Promise<string> {
    await this.retries.lockTrackProcessings(trackId);
    const current = await this.processings.findLatestProcessing(trackId);
    if (!current || !(await this.migrations.isMigration(current.id)))
      throw new Error('NOT_MIGRATION_PROCESSING');
    // A retry can commit before its coordinator acknowledges it.
    if (current.id !== expectedProcessingId) return current.id;
    const plan = retryPlanOf(await this.retries.findLatestForRetry(trackId));
    if (!plan) throw new Error('PROCESSING_NOT_RETRYABLE');
    const initial = await this.migrations.initial(trackId);
    if (!initial) throw new Error('MIGRATION_ATTRIBUTION_NOT_FOUND');
    const processingId = await this.retries.insertRetryProcessing(
      trackId,
      plan,
    );
    await this.migrations.mark(processingId, recordingMbid);
    const contributorId = await this.contributors.findOrInsertContributor(
      trackId,
      initial.userId,
    );
    await this.contributors.insertContribution({
      contributorId,
      processingId,
      kind: 'RETRY',
    });
    return processingId;
  }
}
