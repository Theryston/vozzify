import { Test, type TestingModule } from '@nestjs/testing';
import { fakeTransactionalDatabase } from '../../../test/utils/fake-transactional-db.js';
import { DATABASE, DATABASE_POOL } from '../../database/database.js';
import { DatabaseModule } from '../../database/database.module.js';
import { TrackProcessingRepository } from './track-processing.repository.js';
import { TrackProcessingCompletionService } from './track-processing-completion.service.js';
import { TrackSearchIndexEventRepository } from './track-search-index-event.repository.js';

describe('TrackProcessingCompletionService', () => {
  const processings = { markCompleted: vi.fn() };
  const events = { enqueueCompletedTrack: vi.fn() };
  let moduleRef: TestingModule;
  let service: TrackProcessingCompletionService;

  beforeEach(async () => {
    vi.clearAllMocks();
    processings.markCompleted.mockResolvedValue(true);
    events.enqueueCompletedTrack.mockResolvedValue(undefined);
    const { db, pool } = fakeTransactionalDatabase();
    moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule],
      providers: [
        TrackProcessingCompletionService,
        { provide: TrackProcessingRepository, useValue: processings },
        { provide: TrackSearchIndexEventRepository, useValue: events },
      ],
    })
      .overrideProvider(DATABASE_POOL)
      .useValue(pool)
      .overrideProvider(DATABASE)
      .useValue(db)
      .compile();
    service = moduleRef.get(TrackProcessingCompletionService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('writes the search projection after the guarded Processing completion', async () => {
    await expect(
      service.complete('processing-1', 'track-1', 'EXTRACTING_LYRICS'),
    ).resolves.toBe(true);

    expect(processings.markCompleted).toHaveBeenCalledWith(
      'processing-1',
      'EXTRACTING_LYRICS',
    );
    expect(events.enqueueCompletedTrack).toHaveBeenCalledWith('track-1');
  });

  it('does not enqueue a projection when the Processing moved on', async () => {
    processings.markCompleted.mockResolvedValue(false);

    await expect(
      service.complete('processing-1', 'track-1', 'EXTRACTING_LYRICS'),
    ).resolves.toBe(false);

    expect(events.enqueueCompletedTrack).not.toHaveBeenCalled();
  });
});
