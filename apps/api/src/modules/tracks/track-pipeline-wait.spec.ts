import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import { WebRevalidationService } from '../../integrations/web-revalidation/web-revalidation.service.js';
import { TrackPipelineService } from './track-pipeline.service.js';
import { TRACK_PROCESSING_QUEUE } from './track-processing.job.js';
import { TrackProcessingRepository } from './track-processing.repository.js';
import { TrackProcessingCompletionService } from './track-processing-completion.service.js';
import { TrackProcessingFailure } from './track-processing-failure.js';
import { TrackStepsService } from './track-steps.service.js';

// The pipeline's waits: a step that answers "wait" is checked again by a
// delayed run of the same step, numbered by round, and a failure of the
// download is retried until its last attempt. The e2e spec runs the jobs.

const queue = { add: vi.fn() };
const processings = {
  findProcessing: vi.fn(),
  markStepStarted: vi.fn(),
  markFailed: vi.fn(),
  findCatalogIds: vi.fn(),
};
const steps = { findVideo: vi.fn(), downloadAudio: vi.fn() };
const revalidation = { revalidate: vi.fn() };
const completion = { complete: vi.fn() };

const processing = (status: string) => ({
  id: 'processing-1',
  trackId: 'track-1',
  status,
  videoId: 'aaaaaaaaaaa',
  videoSource: 'musicbrainz',
});

const PROGRESS = { progressUrl: 'https://rapidapi.test/progress/aaaaaaaaaaa' };

describe('TrackPipelineService waits', () => {
  let pipeline: TrackPipelineService;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    vi.clearAllMocks();
    processings.markStepStarted.mockResolvedValue(true);
    processings.markFailed.mockResolvedValue(true);
    completion.complete.mockResolvedValue(true);
    processings.findCatalogIds.mockResolvedValue({
      artistIds: [],
      albumIds: [],
    });
    queue.add.mockResolvedValue(undefined);
    steps.findVideo.mockResolvedValue('https://img.test/artwork.jpg');
    moduleRef = await Test.createTestingModule({
      providers: [
        TrackPipelineService,
        { provide: getQueueToken(TRACK_PROCESSING_QUEUE), useValue: queue },
        { provide: TrackProcessingRepository, useValue: processings },
        { provide: TrackProcessingCompletionService, useValue: completion },
        { provide: TrackStepsService, useValue: steps },
        { provide: WebRevalidationService, useValue: revalidation },
      ],
    }).compile();
    pipeline = moduleRef.get(TrackPipelineService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('queues the download step after the video, keyed by its Processing', async () => {
    processings.findProcessing.mockResolvedValue(processing('QUEUED'));

    await pipeline.runStep(
      { processingId: 'processing-1', step: 'FINDING_VIDEO' },
      true,
    );

    expect(queue.add).toHaveBeenCalledWith(
      'run-step',
      { processingId: 'processing-1', step: 'DOWNLOADING_AUDIO' },
      { jobId: 'step-processing-1-DOWNLOADING_AUDIO' },
    );
    expect(completion.complete).not.toHaveBeenCalled();
  });

  it('queues the first re-check of a waiting step after its delay, as round 1', async () => {
    processings.findProcessing.mockResolvedValue(
      processing('DOWNLOADING_AUDIO'),
    );
    steps.downloadAudio.mockResolvedValue({
      kind: 'wait',
      delayMs: 10_000,
      state: PROGRESS,
    });

    await pipeline.runStep(
      { processingId: 'processing-1', step: 'DOWNLOADING_AUDIO' },
      true,
    );

    expect(queue.add).toHaveBeenCalledWith(
      'run-step',
      {
        processingId: 'processing-1',
        step: 'DOWNLOADING_AUDIO',
        wait: { round: 1, state: PROGRESS },
      },
      { jobId: 'wait-processing-1-DOWNLOADING_AUDIO-1', delay: 10_000 },
    );
    expect(completion.complete).not.toHaveBeenCalled();
    expect(revalidation.revalidate).not.toHaveBeenCalled();
  });

  it('numbers each re-check after the round that queued it', async () => {
    processings.findProcessing.mockResolvedValue(
      processing('DOWNLOADING_AUDIO'),
    );
    steps.downloadAudio.mockResolvedValue({
      kind: 'wait',
      delayMs: 10_000,
      state: PROGRESS,
    });

    await pipeline.runStep(
      {
        processingId: 'processing-1',
        step: 'DOWNLOADING_AUDIO',
        wait: { round: 4, state: PROGRESS },
      },
      true,
    );

    expect(steps.downloadAudio).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'processing-1' }),
      { round: 4, state: PROGRESS },
    );
    expect(queue.add).toHaveBeenCalledWith(
      'run-step',
      expect.objectContaining({ wait: { round: 5, state: PROGRESS } }),
      { jobId: 'wait-processing-1-DOWNLOADING_AUDIO-5', delay: 10_000 },
    );
  });

  it('queues the vocals stage when the download is done, without completing the Processing', async () => {
    processings.findProcessing.mockResolvedValue(
      processing('DOWNLOADING_AUDIO'),
    );
    steps.downloadAudio.mockResolvedValue({ kind: 'done' });

    await pipeline.runStep(
      { processingId: 'processing-1', step: 'DOWNLOADING_AUDIO' },
      true,
    );

    expect(queue.add).toHaveBeenCalledWith(
      'run-step',
      { processingId: 'processing-1', step: 'EXTRACTING_VOCALS' },
      { jobId: 'step-processing-1-EXTRACTING_VOCALS' },
    );
    expect(completion.complete).not.toHaveBeenCalled();
  });

  it('ends the Processing FAILED with DOWNLOAD_FAILED on the last attempt, resuming at the download', async () => {
    processings.findProcessing.mockResolvedValue(
      processing('DOWNLOADING_AUDIO'),
    );
    steps.downloadAudio.mockRejectedValue(
      new TrackProcessingFailure('DOWNLOAD_FAILED'),
    );

    await pipeline.runStep(
      { processingId: 'processing-1', step: 'DOWNLOADING_AUDIO' },
      true,
    );

    expect(processings.markFailed).toHaveBeenCalledWith(
      'processing-1',
      ['QUEUED', 'FINDING_VIDEO', 'DOWNLOADING_AUDIO'],
      { code: 'DOWNLOAD_FAILED', resumeFrom: 'DOWNLOADING_AUDIO' },
    );
  });

  it('lets BullMQ retry DOWNLOAD_FAILED before the last attempt', async () => {
    processings.findProcessing.mockResolvedValue(
      processing('DOWNLOADING_AUDIO'),
    );
    const failure = new TrackProcessingFailure('DOWNLOAD_FAILED');
    steps.downloadAudio.mockRejectedValue(failure);

    await expect(
      pipeline.runStep(
        { processingId: 'processing-1', step: 'DOWNLOADING_AUDIO' },
        false,
      ),
    ).rejects.toBe(failure);
    expect(processings.markFailed).not.toHaveBeenCalled();
  });

  it('ends the Processing as the step failed it, on any attempt, without a BullMQ retry', async () => {
    processings.findProcessing.mockResolvedValue(
      processing('DOWNLOADING_AUDIO'),
    );
    steps.downloadAudio.mockResolvedValue({
      kind: 'failed',
      code: 'DOWNLOAD_FAILED',
    });

    await expect(
      pipeline.runStep(
        { processingId: 'processing-1', step: 'DOWNLOADING_AUDIO' },
        false,
      ),
    ).resolves.toBe(undefined);

    expect(processings.markFailed).toHaveBeenCalledWith(
      'processing-1',
      ['QUEUED', 'FINDING_VIDEO', 'DOWNLOADING_AUDIO'],
      { code: 'DOWNLOAD_FAILED', resumeFrom: 'DOWNLOADING_AUDIO' },
    );
    expect(queue.add).not.toHaveBeenCalled();
    expect(completion.complete).not.toHaveBeenCalled();
  });

  it('stops without advancing a Processing that moved on while the download ran', async () => {
    processings.findProcessing.mockResolvedValue(
      processing('DOWNLOADING_AUDIO'),
    );
    steps.downloadAudio.mockResolvedValue({ kind: 'stopped' });

    await pipeline.runStep(
      { processingId: 'processing-1', step: 'DOWNLOADING_AUDIO' },
      true,
    );

    expect(completion.complete).not.toHaveBeenCalled();
    expect(processings.markFailed).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
    expect(revalidation.revalidate).not.toHaveBeenCalled();
  });

  it('does nothing for a re-check of a Processing that has moved past the download', async () => {
    processings.findProcessing.mockResolvedValue(processing('COMPLETED'));

    await pipeline.runStep(
      {
        processingId: 'processing-1',
        step: 'DOWNLOADING_AUDIO',
        wait: { round: 2, state: PROGRESS },
      },
      true,
    );

    expect(steps.downloadAudio).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });
});
