import type { Queue } from 'bullmq';
import type {
  CleanPrivateTrackAssetsJob,
  ProcessPrivateTrackJob,
} from './private-track-processing.job.js';
import { PrivateTrackProcessingProcessor } from './private-track-processing.processor.js';
import { PrivateTrackProcessingService } from './private-track-processing.service.js';
import type { PrivateTrackProcessingIntegrations } from './private-track-processing-integrations.js';
import { PrivateTracksRepository } from './private-tracks.repository.js';

const queued = [
  { id: 'queued-old', userId: 'owner-1' },
  { id: 'queued-new', userId: 'owner-2' },
];

describe('PrivateTrackProcessingService recovery', () => {
  const queue = { add: vi.fn() };
  const tracks = { listRecoverable: vi.fn() };
  const integrations = {};
  let service: PrivateTrackProcessingService;

  beforeEach(() => {
    vi.resetAllMocks();
    queue.add.mockResolvedValue({ id: 'job-1' });
    tracks.listRecoverable.mockResolvedValue(queued);
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

    expect(tracks.listRecoverable).toHaveBeenCalledWith(100, expect.any(Date));
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

  it('reconciles a queued retry under its own stable start job ID', async () => {
    tracks.listRecoverable.mockResolvedValue([
      { id: 'track-1', userId: 'owner-1', processingRetryId: 'retry-1' },
    ]);

    await service.reconcileQueuedTracks();

    expect(queue.add).toHaveBeenCalledWith(
      'process-private-track',
      {
        userId: 'owner-1',
        privateTrackId: 'track-1',
        poll: 0,
        retryId: 'retry-1',
      },
      {
        jobId: 'track-1-retry-retry-1',
        removeOnComplete: true,
        removeOnFail: true,
      },
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

describe('private track initial poll recovery', () => {
  it('marks the saved attempt failed when resuming an initial job cannot poll', async () => {
    const attemptId = 'attempt-1';
    const tracks = {
      findOwned: vi.fn().mockResolvedValue({
        id: 'track-1',
        userId: 'owner-1',
        objectKey: 'private/source',
        mediaObjectKey: 'private/music.wav',
        processingStatus: 'EXTRACTING_VOCALS',
        processingAttemptId: attemptId,
        processingJobId: 'runpod-job-1',
      }),
      markFailedForAttempt: vi.fn().mockResolvedValue(undefined),
    };
    const integrations = {
      detector: {
        checkJob: vi.fn().mockRejectedValue(new Error('poll enqueue failed')),
      },
    };
    const processing = new PrivateTrackProcessingService(
      { add: vi.fn() } as never,
      tracks as unknown as PrivateTracksRepository,
      integrations as unknown as PrivateTrackProcessingIntegrations,
    );
    const processor = new PrivateTrackProcessingProcessor(processing, {
      upsertJobScheduler: vi.fn(),
    } as never);
    const job = {
      name: 'process-private-track',
      data: { userId: 'owner-1', privateTrackId: 'track-1', poll: 0 },
      attemptsMade: 0,
      opts: { attempts: 1 },
    } as never;

    await expect(processor.process(job)).rejects.toThrow('poll enqueue failed');

    expect(tracks.markFailedForAttempt).toHaveBeenCalledWith(
      'track-1',
      attemptId,
    );
  });
});
