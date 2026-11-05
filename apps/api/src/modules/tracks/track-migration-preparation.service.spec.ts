import { Test, type TestingModule } from '@nestjs/testing';
import { testMbid } from '../../../test/utils/factories.js';
import { fakeTransactionalDatabase } from '../../../test/utils/fake-transactional-db.js';
import { recordingFixture } from '../../../test/utils/recording-fixtures.js';
import { DATABASE, DATABASE_POOL } from '../../database/database.js';
import { DatabaseModule } from '../../database/database.module.js';
import { TrackMigrationRepository } from './track-migration.repository.js';
import {
  type MigrationGroup,
  TrackMigrationPreparationService,
} from './track-migration-preparation.service.js';
import { TrackProcessingRepository } from './track-processing.repository.js';
import { TrackRequestService } from './track-request.service.js';
import { TracksRepository } from './tracks.repository.js';

const group: MigrationGroup = {
  recordingMbid: testMbid(1),
  userId: 'earliest-user',
  contributedAt: new Date('2020-01-02T03:04:05Z'),
  legacyTrackIds: ['legacy-earliest', 'legacy-duplicate'],
};

const initial = {
  processingId: 'initial-processing',
  userId: group.userId,
  contributedAt: group.contributedAt,
};

describe('TrackMigrationPreparationService', () => {
  const requests = { resolveRecording: vi.fn() };
  const tracks = {
    insertTrack: vi.fn(),
    insertTrackDetails: vi.fn(),
    insertAssociationEvent: vi.fn(),
    findTrackIdsByRecordingMbids: vi.fn(),
  };
  const processings = {
    insertQueuedProcessing: vi.fn(),
    findLatestProcessing: vi.fn(),
  };
  const migrations = {
    lock: vi.fn(),
    attribute: vi.fn(),
    mark: vi.fn(),
    map: vi.fn(),
    initial: vi.fn(),
    isMigration: vi.fn(),
  };
  let moduleRef: TestingModule;
  let service: TrackMigrationPreparationService;
  let db: ReturnType<typeof fakeTransactionalDatabase>['db'];

  beforeEach(async () => {
    vi.resetAllMocks();
    requests.resolveRecording.mockResolvedValue(recordingFixture());
    tracks.insertTrack.mockResolvedValue('track');
    tracks.findTrackIdsByRecordingMbids.mockResolvedValue(
      new Map([[group.recordingMbid, 'track']]),
    );
    processings.insertQueuedProcessing.mockResolvedValue('initial-processing');
    processings.findLatestProcessing.mockResolvedValue({
      id: 'initial-processing',
    });
    migrations.initial.mockResolvedValue(initial);
    migrations.isMigration.mockResolvedValue(true);
    const database = fakeTransactionalDatabase();
    db = database.db;
    moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule],
      providers: [
        TrackMigrationPreparationService,
        { provide: TrackRequestService, useValue: requests },
        { provide: TracksRepository, useValue: tracks },
        { provide: TrackProcessingRepository, useValue: processings },
        { provide: TrackMigrationRepository, useValue: migrations },
      ],
    })
      .overrideProvider(DATABASE)
      .useValue(db)
      .overrideProvider(DATABASE_POOL)
      .useValue(database.pool)
      .compile();
    service = moduleRef.get(TrackMigrationPreparationService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('prepares queued rows, historical attribution and all maps in one transaction', async () => {
    await expect(service.prepare(group)).resolves.toEqual({
      trackId: 'track',
      initialProcessingId: 'initial-processing',
    });
    expect(requests.resolveRecording).toHaveBeenCalledExactlyOnceWith(
      group.recordingMbid,
    );
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(migrations.lock).toHaveBeenCalledExactlyOnceWith(
      group.recordingMbid,
    );
    expect(tracks.insertTrack).toHaveBeenCalledWith(
      expect.objectContaining({
        recordingMbid: group.recordingMbid,
        title: 'Bohemian Rhapsody',
        genres: ['rock'],
      }),
    );
    expect(tracks.insertTrackDetails).toHaveBeenCalledWith(
      'track',
      expect.objectContaining({
        tags: [{ name: 'classic rock', count: 4 }],
      }),
    );
    expect(tracks.insertAssociationEvent).toHaveBeenCalledExactlyOnceWith(
      group.recordingMbid,
      'track',
    );
    expect(processings.insertQueuedProcessing).toHaveBeenCalledExactlyOnceWith(
      'track',
    );
    expect(migrations.attribute).toHaveBeenCalledExactlyOnceWith(
      'track',
      'initial-processing',
      group,
    );
    expect(migrations.mark).toHaveBeenCalledExactlyOnceWith(
      'initial-processing',
      group.recordingMbid,
    );
    expect(migrations.map).toHaveBeenCalledExactlyOnceWith(
      'track',
      group.legacyTrackIds,
    );
  });

  it('recovers a committed Track without duplicating its Processing or attribution', async () => {
    tracks.insertTrack.mockResolvedValue(undefined);
    await expect(service.prepare(group)).resolves.toEqual({
      trackId: 'track',
      initialProcessingId: initial.processingId,
    });
    expect(tracks.findTrackIdsByRecordingMbids).toHaveBeenCalledWith([
      group.recordingMbid,
    ]);
    expect(migrations.initial).toHaveBeenCalledExactlyOnceWith('track');
    expect(migrations.map).toHaveBeenCalledExactlyOnceWith(
      'track',
      group.legacyTrackIds,
    );
    expect(tracks.insertTrackDetails).not.toHaveBeenCalled();
    expect(tracks.insertAssociationEvent).not.toHaveBeenCalled();
    expect(processings.insertQueuedProcessing).not.toHaveBeenCalled();
    expect(migrations.attribute).not.toHaveBeenCalled();
    expect(migrations.mark).not.toHaveBeenCalled();
  });

  it('refuses a new catalog merge before writing against a frozen plan', async () => {
    requests.resolveRecording.mockResolvedValue(
      recordingFixture({ mbid: testMbid(2) }),
    );
    await expect(service.prepare(group)).rejects.toThrow(
      'RECORDING_PLAN_CHANGED',
    );
    expect(db.transaction).not.toHaveBeenCalled();
    expect(tracks.insertTrack).not.toHaveBeenCalled();
  });

  it('propagates an unavailable Recording without creating a Track', async () => {
    requests.resolveRecording.mockRejectedValue(new Error('NOT_FOUND'));
    await expect(service.prepare(group)).rejects.toThrow('NOT_FOUND');
    expect(tracks.insertTrack).not.toHaveBeenCalled();
  });

  it('refuses recovery when a conflicting Track disappeared', async () => {
    tracks.insertTrack.mockResolvedValue(undefined);
    tracks.findTrackIdsByRecordingMbids.mockResolvedValue(new Map());
    await expect(service.prepare(group)).rejects.toThrow(
      'MIGRATION_TRACK_NOT_FOUND',
    );
    expect(migrations.initial).not.toHaveBeenCalled();
    expect(migrations.map).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    { ...initial, userId: 'another-user' },
    { ...initial, contributedAt: new Date('2021-01-01T00:00:00Z') },
  ])('refuses incompatible existing attribution: %j', async (existing) => {
    tracks.insertTrack.mockResolvedValue(undefined);
    migrations.initial.mockResolvedValue(existing);
    await expect(service.prepare(group)).rejects.toThrow(
      'MIGRATION_ATTRIBUTION_CONFLICT',
    );
    expect(migrations.map).not.toHaveBeenCalled();
    expect(migrations.attribute).not.toHaveBeenCalled();
  });

  it('propagates a map conflict instead of acknowledging partial preparation', async () => {
    migrations.map.mockRejectedValue(new Error('LEGACY_TRACK_MAP_CONFLICT'));
    await expect(service.prepare(group)).rejects.toThrow(
      'LEGACY_TRACK_MAP_CONFLICT',
    );
  });

  it('does not publish maps when provenance cannot be persisted', async () => {
    migrations.mark.mockRejectedValue(new Error('origin failed'));
    await expect(service.prepare(group)).rejects.toThrow('origin failed');
    expect(migrations.map).not.toHaveBeenCalled();
  });

  it('accepts the exact current migration attempt', async () => {
    await expect(
      service.assertAttempt('track', 'initial-processing'),
    ).resolves.toBeUndefined();
    expect(processings.findLatestProcessing).toHaveBeenCalledExactlyOnceWith(
      'track',
    );
    expect(migrations.isMigration).toHaveBeenCalledExactlyOnceWith(
      'initial-processing',
    );
  });

  it.each([undefined, { id: 'user-retry' }])(
    'rejects a missing or superseded attempt: %j',
    async (current) => {
      processings.findLatestProcessing.mockResolvedValue(current);
      await expect(
        service.assertAttempt('track', 'initial-processing'),
      ).rejects.toThrow('MIGRATION_PROCESSING_CHANGED');
      expect(migrations.isMigration).not.toHaveBeenCalled();
    },
  );

  it('rejects an ordinary attempt even when its ID matches', async () => {
    migrations.isMigration.mockResolvedValue(false);
    await expect(
      service.assertAttempt('track', 'initial-processing'),
    ).rejects.toThrow('MIGRATION_PROCESSING_CHANGED');
  });
});
