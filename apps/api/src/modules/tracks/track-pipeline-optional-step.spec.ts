import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import { WebRevalidationService } from '../../integrations/web-revalidation/web-revalidation.service.js';
import { TrackPipelineService } from './track-pipeline.service.js';
import { TRACK_PROCESSING_QUEUE } from './track-processing.job.js';
import { TrackProcessingRepository } from './track-processing.repository.js';
import { TrackProcessingCompletionService } from './track-processing-completion.service.js';
import { TrackStepsService } from './track-steps.service.js';

// The optional lyrics step (ADR 0004): its failure on the last attempt completes
// the Processing without Timed lyrics, and a failure of what follows the step
// still fails the Processing. The rows, the queue and the steps are fakes.

const queue = { add: vi.fn() };
const processings = {
  findProcessing: vi.fn(),
  markStepStarted: vi.fn(),
  markFailed: vi.fn(),
  findCatalogIds: vi.fn(),
};
const steps = { downloadAudio: vi.fn(), extractLyrics: vi.fn() };
const revalidation = { revalidate: vi.fn() };
const completion = { complete: vi.fn() };

const lyricsJob = {
  processingId: 'processing-1',
  step: 'EXTRACTING_LYRICS',
} as const;

const processing = (status: string) => ({
  id: 'processing-1',
  trackId: 'track-1',
  status,
  videoId: 'aaaaaaaaaaa',
  videoSource: 'musicbrainz',
});

describe('TrackPipelineService optional steps', () => {
  let pipeline: TrackPipelineService;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    vi.clearAllMocks();
    processings.findProcessing.mockResolvedValue(
      processing('EXTRACTING_LYRICS'),
    );
    processings.markStepStarted.mockResolvedValue(true);
    processings.markFailed.mockResolvedValue(true);
    completion.complete.mockResolvedValue(true);
    processings.findCatalogIds.mockResolvedValue({
      artistIds: [],
      albumIds: [],
    });
    steps.extractLyrics.mockResolvedValue({ kind: 'done' });
    revalidation.revalidate.mockResolvedValue(undefined);
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

  it('completes the Processing without its lyrics when the lyrics step fails on its last attempt', async () => {
    steps.extractLyrics.mockRejectedValue(new Error('OpenAI is down'));

    await pipeline.runStep(lyricsJob, true);

    expect(completion.complete).toHaveBeenCalledWith(
      'processing-1',
      'track-1',
      'EXTRACTING_LYRICS',
    );
    expect(processings.markFailed).not.toHaveBeenCalled();
    expect(revalidation.revalidate).toHaveBeenCalled();
  });

  it('lets BullMQ retry the lyrics step before its last attempt, leaving the Processing as it is', async () => {
    steps.extractLyrics.mockRejectedValue(new Error('OpenAI is down'));

    await expect(pipeline.runStep(lyricsJob, false)).rejects.toThrow(
      'OpenAI is down',
    );

    expect(completion.complete).not.toHaveBeenCalled();
    expect(processings.markFailed).not.toHaveBeenCalled();
  });

  it('fails the Processing, resumed at the lyrics step, when completing it fails after the lyrics', async () => {
    revalidation.revalidate.mockRejectedValue(new Error('Redis is down'));

    await pipeline.runStep(lyricsJob, true);

    expect(processings.markFailed).toHaveBeenCalledWith(
      'processing-1',
      expect.arrayContaining(['EXTRACTING_LYRICS']),
      { code: 'INTERNAL', resumeFrom: 'EXTRACTING_LYRICS' },
    );
    expect(completion.complete).not.toHaveBeenCalled();
  });

  it('still fails the Processing when a required step fails on its last attempt', async () => {
    processings.findProcessing.mockResolvedValue(
      processing('DOWNLOADING_AUDIO'),
    );
    steps.downloadAudio.mockRejectedValue(new Error('boom'));

    await pipeline.runStep(
      { processingId: 'processing-1', step: 'DOWNLOADING_AUDIO' },
      true,
    );

    expect(processings.markFailed).toHaveBeenCalledWith(
      'processing-1',
      expect.arrayContaining(['DOWNLOADING_AUDIO']),
      { code: 'INTERNAL', resumeFrom: 'DOWNLOADING_AUDIO' },
    );
    expect(completion.complete).not.toHaveBeenCalled();
  });
});
