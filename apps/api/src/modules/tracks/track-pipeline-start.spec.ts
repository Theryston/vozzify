import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import { WebRevalidationService } from '../../integrations/web-revalidation/web-revalidation.service.js';
import { TrackPipelineService } from './track-pipeline.service.js';
import { TRACK_PROCESSING_QUEUE } from './track-processing.job.js';
import { TrackProcessingRepository } from './track-processing.repository.js';
import { TrackProcessingCompletionService } from './track-processing-completion.service.js';
import { TrackStepsService } from './track-steps.service.js';

// Where a queued Processing's first step job starts: the first step of a first
// run, and the step a retry resumes at (the row keeps it while it is queued).

const queue = { add: vi.fn() };
const processings = { findLatestProcessing: vi.fn() };
const completion = { complete: vi.fn() };

describe('TrackPipelineService.startIfQueued', () => {
  let pipeline: TrackPipelineService;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    vi.clearAllMocks();
    queue.add.mockResolvedValue(undefined);
    moduleRef = await Test.createTestingModule({
      providers: [
        TrackPipelineService,
        { provide: getQueueToken(TRACK_PROCESSING_QUEUE), useValue: queue },
        { provide: TrackProcessingRepository, useValue: processings },
        { provide: TrackProcessingCompletionService, useValue: completion },
        { provide: TrackStepsService, useValue: {} },
        { provide: WebRevalidationService, useValue: {} },
      ],
    }).compile();
    pipeline = moduleRef.get(TrackPipelineService);
  });

  it('starts a first run at the first step when it names no resume point', async () => {
    processings.findLatestProcessing.mockResolvedValue({
      id: 'processing-1',
      status: 'QUEUED',
      resumeFrom: null,
    });

    await pipeline.startIfQueued('track-1');

    expect(queue.add).toHaveBeenCalledWith(
      'run-step',
      { processingId: 'processing-1', step: 'FINDING_VIDEO' },
      { jobId: 'step-processing-1-FINDING_VIDEO' },
    );
  });

  it('starts a queued retry at the step it names, not at the first one', async () => {
    processings.findLatestProcessing.mockResolvedValue({
      id: 'processing-2',
      status: 'QUEUED',
      resumeFrom: 'EXTRACTING_VOCALS',
    });

    await pipeline.startIfQueued('track-1');

    expect(queue.add).toHaveBeenCalledWith(
      'run-step',
      { processingId: 'processing-2', step: 'EXTRACTING_VOCALS' },
      { jobId: 'step-processing-2-EXTRACTING_VOCALS' },
    );
  });

  it('queues nothing for a Processing that already started', async () => {
    processings.findLatestProcessing.mockResolvedValue({
      id: 'processing-3',
      status: 'FINDING_VIDEO',
      resumeFrom: null,
    });

    await pipeline.startIfQueued('track-1');

    expect(queue.add).not.toHaveBeenCalled();
  });
});
