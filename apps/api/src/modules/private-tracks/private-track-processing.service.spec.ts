import type { Queue } from 'bullmq';
import type {
  CleanPrivateTrackAssetsJob,
  ProcessPrivateTrackJob,
} from './private-track-processing.job.js';
import { PrivateTrackProcessingService } from './private-track-processing.service.js';
import type { PrivateTrackProcessingIntegrations } from './private-track-processing-integrations.js';
import { PrivateTracksRepository } from './private-tracks.repository.js';

const queued = [
  { id: 'queued-old', userId: 'owner-1' },
  { id: 'queued-new', userId: 'owner-2' },
];

describe('PrivateTrackProcessingService recovery', () => {
  const queue = { add: vi.fn() };
  const tracks = { listQueued: vi.fn() };
  const integrations = {};
  let service: PrivateTrackProcessingService;

  beforeEach(() => {
    vi.resetAllMocks();
    queue.add.mockResolvedValue({ id: 'job-1' });
    tracks.listQueued.mockResolvedValue(queued);
    service = new PrivateTrackProcessingService(
      queue as unknown as Queue<
        ProcessPrivateTrackJob | CleanPrivateTrackAssetsJob
      >,
      tracks as unknown as PrivateTracksRepository,
      integrations as PrivateTrackProcessingIntegrations,
    );
  });

  it('requeues a bounded page of queued owner rows with stable job IDs', async () => {
    await service.reconcileQueuedTracks();

    expect(tracks.listQueued).toHaveBeenCalledWith(100);
    expect(queue.add).toHaveBeenNthCalledWith(
      1,
      'process-private-track',
      { userId: 'owner-1', privateTrackId: 'queued-old', poll: 0 },
      { jobId: 'queued-old', removeOnComplete: true },
    );
    expect(queue.add).toHaveBeenNthCalledWith(
      2,
      'process-private-track',
      { userId: 'owner-2', privateTrackId: 'queued-new', poll: 0 },
      { jobId: 'queued-new', removeOnComplete: true },
    );
  });
});

describe('private track processing reconciliation scheduler', () => {
  const queue = { upsertJobScheduler: vi.fn() };
  const processing = { reconcileQueuedTracks: vi.fn() };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('registers a recurring reconciliation job at worker startup', async () => {
    const { PrivateTrackProcessingProcessor } = await import(
      './private-track-processing.processor.js'
    );
    const processor = new PrivateTrackProcessingProcessor(
      processing as unknown as PrivateTrackProcessingService,
      queue as never,
    );

    await processor.onModuleInit();

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'private-track-reconciliation',
      { every: 60_000 },
      { name: 'reconcile-private-tracks', data: {} },
    );
  });

  it('dispatches the reconciliation job without touching terminal tracks', async () => {
    const { PrivateTrackProcessingProcessor } = await import(
      './private-track-processing.processor.js'
    );
    const processor = new PrivateTrackProcessingProcessor(
      processing as unknown as PrivateTrackProcessingService,
      queue as never,
    );
    const job = {
      name: 'reconcile-private-tracks',
      data: {},
    } as never;

    await processor.process(job);

    expect(processing.reconcileQueuedTracks).toHaveBeenCalledOnce();
  });
});
