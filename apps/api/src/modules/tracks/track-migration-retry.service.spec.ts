import { Test, type TestingModule } from '@nestjs/testing';
import { testMbid } from '../../../test/utils/factories.js';
import { fakeTransactionalDatabase } from '../../../test/utils/fake-transactional-db.js';
import { DATABASE, DATABASE_POOL } from '../../database/database.js';
import { DatabaseModule } from '../../database/database.module.js';
import { TrackContributorRepository } from './track-contributor.repository.js';
import { TrackMigrationRepository } from './track-migration.repository.js';
import { TrackMigrationRetryService } from './track-migration-retry.service.js';
import { TrackProcessingRepository } from './track-processing.repository.js';
import type { RetryableProcessing } from './track-retry.js';
import { TrackRetryRepository } from './track-retry.repository.js';

const MBID = testMbid(1);
const failed: RetryableProcessing = {
  status: 'FAILED',
  failureCode: 'NOTE_DETECTION_FAILED',
  resumeFrom: 'DETECTING_NOTES',
  videoId: 'video',
  videoSource: 'youtube_music',
  musicWavUrl: 'https://storage.test/music.wav',
  musicMp3Url: 'https://storage.test/music.mp3',
  vocalsWavUrl: 'https://storage.test/vocals.wav',
  vocalsMp3Url: null,
  pitchCurveUrl: null,
  detectorVersion: 'detector-v1',
  runpodJobId: 'old-job',
};

describe('TrackMigrationRetryService', () => {
  const migrations = { isMigration: vi.fn(), initial: vi.fn(), mark: vi.fn() };
  const processings = { findLatestProcessing: vi.fn() };
  const retries = {
    lockTrackProcessings: vi.fn(),
    findLatestForRetry: vi.fn(),
    insertRetryProcessing: vi.fn(),
  };
  const contributors = {
    findOrInsertContributor: vi.fn(),
    insertContribution: vi.fn(),
  };
  let moduleRef: TestingModule;
  let service: TrackMigrationRetryService;
  let db: ReturnType<typeof fakeTransactionalDatabase>['db'];

  beforeEach(async () => {
    vi.resetAllMocks();
    processings.findLatestProcessing.mockResolvedValue({
      id: 'failed-processing',
    });
    migrations.isMigration.mockResolvedValue(true);
    migrations.initial.mockResolvedValue({ userId: 'earliest-user' });
    retries.findLatestForRetry.mockResolvedValue(failed);
    retries.insertRetryProcessing.mockResolvedValue('retry-processing');
    contributors.findOrInsertContributor.mockResolvedValue('contributor');
    const database = fakeTransactionalDatabase();
    db = database.db;
    moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule],
      providers: [
        TrackMigrationRetryService,
        { provide: TrackMigrationRepository, useValue: migrations },
        { provide: TrackProcessingRepository, useValue: processings },
        { provide: TrackRetryRepository, useValue: retries },
        { provide: TrackContributorRepository, useValue: contributors },
      ],
    })
      .overrideProvider(DATABASE)
      .useValue(db)
      .overrideProvider(DATABASE_POOL)
      .useValue(database.pool)
      .compile();
    service = moduleRef.get(TrackMigrationRetryService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('reuses the retry plan, marks the attempt and credits the original Contributor', async () => {
    await expect(
      service.retry('track', 'failed-processing', MBID),
    ).resolves.toBe('retry-processing');
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(retries.lockTrackProcessings).toHaveBeenCalledExactlyOnceWith(
      'track',
    );
    expect(retries.insertRetryProcessing).toHaveBeenCalledExactlyOnceWith(
      'track',
      {
        resumeFrom: 'DETECTING_NOTES',
        outputs: {
          videoId: 'video',
          videoSource: 'youtube_music',
          musicWavUrl: 'https://storage.test/music.wav',
          musicMp3Url: 'https://storage.test/music.mp3',
          vocalsWavUrl: 'https://storage.test/vocals.wav',
          vocalsMp3Url: null,
          pitchCurveUrl: null,
          detectorVersion: 'detector-v1',
        },
      },
    );
    expect(migrations.mark).toHaveBeenCalledExactlyOnceWith(
      'retry-processing',
      MBID,
    );
    expect(
      contributors.findOrInsertContributor,
    ).toHaveBeenCalledExactlyOnceWith('track', 'earliest-user');
    expect(contributors.insertContribution).toHaveBeenCalledExactlyOnceWith({
      contributorId: 'contributor',
      processingId: 'retry-processing',
      kind: 'RETRY',
    });
  });

  it('recovers a retry committed before acknowledgement without a second attempt', async () => {
    processings.findLatestProcessing.mockResolvedValue({
      id: 'already-retried',
    });
    await expect(
      service.retry('track', 'failed-processing', MBID),
    ).resolves.toBe('already-retried');
    expect(migrations.isMigration).toHaveBeenCalledExactlyOnceWith(
      'already-retried',
    );
    expect(retries.findLatestForRetry).not.toHaveBeenCalled();
    expect(retries.insertRetryProcessing).not.toHaveBeenCalled();
    expect(migrations.mark).not.toHaveBeenCalled();
    expect(contributors.insertContribution).not.toHaveBeenCalled();
  });

  it('refuses a Track with no current Processing', async () => {
    processings.findLatestProcessing.mockResolvedValue(undefined);
    await expect(
      service.retry('track', 'failed-processing', MBID),
    ).rejects.toThrow('NOT_MIGRATION_PROCESSING');
    expect(migrations.isMigration).not.toHaveBeenCalled();
    expect(retries.insertRetryProcessing).not.toHaveBeenCalled();
  });

  it('refuses an ordinary attempt instead of inheriting the Track migration exemption', async () => {
    migrations.isMigration.mockResolvedValue(false);
    await expect(
      service.retry('track', 'failed-processing', MBID),
    ).rejects.toThrow('NOT_MIGRATION_PROCESSING');
    expect(retries.findLatestForRetry).not.toHaveBeenCalled();
    expect(retries.insertRetryProcessing).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    { ...failed, status: 'QUEUED' },
    { ...failed, status: 'COMPLETED' },
    { ...failed, failureCode: 'VIDEO_NOT_FOUND' },
    { ...failed, failureCode: 'TOO_LONG' },
    { ...failed, failureCode: null },
    { ...failed, resumeFrom: null },
  ])('preserves nonretryable outcomes: %j', async (latest) => {
    retries.findLatestForRetry.mockResolvedValue(latest);
    await expect(
      service.retry('track', 'failed-processing', MBID),
    ).rejects.toThrow('PROCESSING_NOT_RETRYABLE');
    expect(retries.insertRetryProcessing).not.toHaveBeenCalled();
    expect(migrations.mark).not.toHaveBeenCalled();
    expect(contributors.insertContribution).not.toHaveBeenCalled();
  });

  it('refuses a missing initial attribution before inserting a retry', async () => {
    migrations.initial.mockResolvedValue(undefined);
    await expect(
      service.retry('track', 'failed-processing', MBID),
    ).rejects.toThrow('MIGRATION_ATTRIBUTION_NOT_FOUND');
    expect(retries.insertRetryProcessing).not.toHaveBeenCalled();
  });

  it('does not create a Contribution when attempt provenance fails', async () => {
    migrations.mark.mockRejectedValue(new Error('origin failed'));
    await expect(
      service.retry('track', 'failed-processing', MBID),
    ).rejects.toThrow('origin failed');
    expect(contributors.findOrInsertContributor).not.toHaveBeenCalled();
    expect(contributors.insertContribution).not.toHaveBeenCalled();
  });
});
