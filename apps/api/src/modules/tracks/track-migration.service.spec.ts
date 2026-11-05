import { Test } from '@nestjs/testing';
import { testMbid } from '../../../test/utils/factories.js';
import { TrackMetadataQueueService } from './track-metadata-queue.service.js';
import { TrackMigrationService } from './track-migration.service.js';
import { TrackMigrationPreparationService } from './track-migration-preparation.service.js';
import { TrackMigrationRetryService } from './track-migration-retry.service.js';
import { TrackPipelineService } from './track-pipeline.service.js';

describe('TrackMigrationService', () => {
  const preparation = { prepare: vi.fn(), assertAttempt: vi.fn() };
  const retries = { retry: vi.fn() };
  const metadata = { enqueueImport: vi.fn() };
  const pipeline = { startIfQueued: vi.fn() };
  let service: TrackMigrationService;
  beforeEach(async () => {
    vi.resetAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        TrackMigrationService,
        { provide: TrackMigrationPreparationService, useValue: preparation },
        { provide: TrackMigrationRetryService, useValue: retries },
        { provide: TrackMetadataQueueService, useValue: metadata },
        { provide: TrackPipelineService, useValue: pipeline },
      ],
    }).compile();
    service = module.get(TrackMigrationService);
  });

  it('queues independent metadata after preparation without paid work', async () => {
    const group = {
      recordingMbid: testMbid(1),
      userId: 'first',
      contributedAt: new Date(0),
      legacyTrackIds: ['old'],
    };
    const prepared = { trackId: 'track', initialProcessingId: 'initial' };
    preparation.prepare.mockResolvedValue(prepared);
    expect(await service.prepare(group)).toEqual(prepared);
    expect(preparation.prepare).toHaveBeenCalledWith(group);
    expect(metadata.enqueueImport).toHaveBeenCalledWith('track');
    expect(pipeline.startIfQueued).not.toHaveBeenCalled();
  });

  it('validates provenance before enqueueing the existing pipeline', async () => {
    await service.start('track', 'initial');
    expect(preparation.assertAttempt).toHaveBeenCalledWith('track', 'initial');
    expect(metadata.enqueueImport).toHaveBeenCalledWith('track');
    expect(pipeline.startIfQueued).toHaveBeenCalledWith('track');
  });

  it('never launches a later User attempt from the operator command', async () => {
    preparation.assertAttempt.mockRejectedValue(new Error('changed'));
    await expect(service.start('track', 'initial')).rejects.toThrow('changed');
    expect(metadata.enqueueImport).not.toHaveBeenCalled();
    expect(pipeline.startIfQueued).not.toHaveBeenCalled();
  });

  it('returns the durable migration retry attempt without launching it', async () => {
    retries.retry.mockResolvedValue('next');
    expect(await service.retry('track', 'previous', testMbid(1))).toBe('next');
    expect(retries.retry).toHaveBeenCalledWith(
      'track',
      'previous',
      testMbid(1),
    );
    expect(pipeline.startIfQueued).not.toHaveBeenCalled();
  });
});
