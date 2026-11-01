import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import type { TrackProcessingStep } from '@vozzify/contracts';
import { UnrecoverableError } from 'bullmq';
import { WebRevalidationService } from '../../integrations/web-revalidation/web-revalidation.service.js';
import { TrackAudioService } from './track-audio.service.js';
import { TrackLyricsStepService } from './track-lyrics-step.service.js';
import { TrackNoteDetectionService } from './track-note-detection.service.js';
import { TrackPipelineService } from './track-pipeline.service.js';
import { coverJobId, TRACK_PROCESSING_QUEUE } from './track-processing.job.js';
import { TrackProcessingRepository } from './track-processing.repository.js';
import { TrackProcessingCompletionService } from './track-processing-completion.service.js';
import { TrackProcessingFailure } from './track-processing-failure.js';
import { TrackStepsService } from './track-steps.service.js';
import { TrackVideoStepService } from './track-video-step.service.js';

// The pipeline's decisions: what a step job does with its outcome. The rows
// and the queue are fakes; the database-facing guards are covered by e2e.

const queue = { add: vi.fn() };
const processings = {
  findLatestProcessing: vi.fn(),
  findProcessing: vi.fn(),
  markStepStarted: vi.fn(),
  markFailed: vi.fn(),
  findCatalogIds: vi.fn(),
};
const videoStep = { run: vi.fn() };
const audio = { run: vi.fn() };
const noteDetection = { extractVocals: vi.fn(), detectNotes: vi.fn() };
const lyrics = { run: vi.fn() };
const revalidation = { revalidate: vi.fn() };
const completion = { complete: vi.fn() };

const processing = (overrides: Record<string, unknown> = {}) => ({
  id: 'processing-1',
  trackId: 'track-1',
  status: 'QUEUED',
  videoId: null,
  videoSource: null,
  ...overrides,
});

const findingVideoJob = {
  processingId: 'processing-1',
  step: 'FINDING_VIDEO',
} as const;

const lyricsJob = {
  processingId: 'processing-1',
  step: 'EXTRACTING_LYRICS',
} as const;

const detectingNotesJob = {
  processingId: 'processing-1',
  step: 'DETECTING_NOTES',
} as const;

describe('TrackPipelineService', () => {
  let pipeline: TrackPipelineService;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    vi.clearAllMocks();
    // `clearAllMocks` keeps implementations: each case starts from success.
    videoStep.run.mockResolvedValue('https://img.test/artwork.jpg');
    audio.run.mockResolvedValue({ kind: 'done' });
    noteDetection.extractVocals.mockResolvedValue({ kind: 'done' });
    noteDetection.detectNotes.mockResolvedValue({ kind: 'done' });
    processings.markStepStarted.mockResolvedValue(true);
    processings.markFailed.mockResolvedValue(true);
    completion.complete.mockResolvedValue(true);
    processings.findCatalogIds.mockResolvedValue({
      artistIds: [],
      albumIds: [],
    });
    queue.add.mockResolvedValue(undefined);
    moduleRef = await Test.createTestingModule({
      providers: [
        TrackPipelineService,
        TrackStepsService,
        { provide: getQueueToken(TRACK_PROCESSING_QUEUE), useValue: queue },
        { provide: TrackProcessingRepository, useValue: processings },
        { provide: TrackProcessingCompletionService, useValue: completion },
        { provide: TrackVideoStepService, useValue: videoStep },
        { provide: TrackAudioService, useValue: audio },
        { provide: TrackNoteDetectionService, useValue: noteDetection },
        { provide: TrackLyricsStepService, useValue: lyrics },
        { provide: WebRevalidationService, useValue: revalidation },
      ],
    }).compile();
    pipeline = moduleRef.get(TrackPipelineService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  describe('startIfQueued', () => {
    it('queues the first step of a Processing that has not started', async () => {
      processings.findLatestProcessing.mockResolvedValue({
        id: 'processing-1',
        status: 'QUEUED',
      });

      await pipeline.startIfQueued('track-1');

      expect(processings.findLatestProcessing).toHaveBeenCalledWith('track-1');
      expect(queue.add).toHaveBeenCalledWith('run-step', findingVideoJob, {
        jobId: 'step-processing-1-FINDING_VIDEO',
      });
    });

    it('queues nothing for a Processing that already started or ended', async () => {
      for (const status of ['FINDING_VIDEO', 'COMPLETED', 'FAILED']) {
        processings.findLatestProcessing.mockResolvedValueOnce({
          id: 'processing-1',
          status,
        });
        await pipeline.startIfQueued('track-1');
      }

      expect(queue.add).not.toHaveBeenCalled();
    });

    it('queues nothing for a Track with no Processing', async () => {
      processings.findLatestProcessing.mockResolvedValue(undefined);

      await pipeline.startIfQueued('track-1');

      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  describe('runStep', () => {
    it('refuses a step this build does not know, without retrying it', async () => {
      // A job queued by another build may name a step this one lacks.
      const unknownStep: string = 'EXTRACTING_SOMETHING_NEW';
      await expect(
        pipeline.runStep(
          {
            processingId: 'processing-1',
            step: unknownStep as TrackProcessingStep,
          },
          true,
        ),
      ).rejects.toBeInstanceOf(UnrecoverableError);

      expect(processings.findProcessing).not.toHaveBeenCalled();
    });

    it('does nothing for a Processing that is gone', async () => {
      processings.findProcessing.mockResolvedValue(undefined);

      await pipeline.runStep(findingVideoJob, true);

      expect(processings.markStepStarted).not.toHaveBeenCalled();
      expect(videoStep.run).not.toHaveBeenCalled();
    });

    it('does nothing for a Processing that is past the step', async () => {
      processings.findProcessing.mockResolvedValue(
        processing({ status: 'COMPLETED' }),
      );

      await pipeline.runStep(findingVideoJob, true);

      expect(processings.markStepStarted).not.toHaveBeenCalled();
      expect(videoStep.run).not.toHaveBeenCalled();
    });

    it('stops at once when the guarded start finds the Processing moved on', async () => {
      processings.findProcessing.mockResolvedValue(processing());
      processings.markStepStarted.mockResolvedValue(false);

      await pipeline.runStep(findingVideoJob, true);

      expect(videoStep.run).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
      expect(completion.complete).not.toHaveBeenCalled();
      expect(processings.markFailed).not.toHaveBeenCalled();
    });

    it('starts the step only from the statuses it may run in', async () => {
      processings.findProcessing.mockResolvedValue(processing());

      await pipeline.runStep(findingVideoJob, true);

      expect(processings.markStepStarted).toHaveBeenCalledWith(
        'processing-1',
        'FINDING_VIDEO',
        ['QUEUED', 'FINDING_VIDEO'],
      );
    });

    it('queues the lyrics step once the notes are detected, without completing the Processing', async () => {
      processings.findProcessing.mockResolvedValue(
        processing({
          status: 'DETECTING_NOTES',
          videoId: 'video-1',
          videoSource: 'youtube_music',
        }),
      );

      await pipeline.runStep(detectingNotesJob, true);

      expect(noteDetection.detectNotes).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'processing-1', trackId: 'track-1' }),
        undefined,
      );
      expect(queue.add).toHaveBeenCalledWith('run-step', lyricsJob, {
        jobId: 'step-processing-1-EXTRACTING_LYRICS',
      });
      expect(revalidation.revalidate).not.toHaveBeenCalled();
      expect(completion.complete).not.toHaveBeenCalled();
    });

    it('completes the Processing after the lyrics step, revalidating the Track first', async () => {
      processings.findProcessing.mockResolvedValue(
        processing({
          status: 'EXTRACTING_LYRICS',
          videoId: 'video-1',
          videoSource: 'youtube_music',
        }),
      );
      lyrics.run.mockResolvedValue({ kind: 'done' });
      processings.findCatalogIds.mockResolvedValue({
        artistIds: ['artist-1'],
        albumIds: ['album-1'],
      });

      await pipeline.runStep(lyricsJob, true);

      expect(lyrics.run).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'processing-1', trackId: 'track-1' }),
      );
      expect(revalidation.revalidate).toHaveBeenCalledWith([
        'track:track-1',
        'track:track-1:notes',
        'track:track-1:lyrics',
        'tracks',
        'artist:artist-1',
        'artist:artist-1:tracks',
        'album:album-1',
        'album:album-1:tracks',
      ]);
      expect(completion.complete).toHaveBeenCalledWith(
        'processing-1',
        'track-1',
        'EXTRACTING_LYRICS',
      );
      expect(revalidation.revalidate.mock.invocationCallOrder[0]).toBeLessThan(
        completion.complete.mock.invocationCallOrder[0] ?? 0,
      );
    });

    it('invalidates the shared sitemap tag when a Track completes, before completing it', async () => {
      processings.findProcessing.mockResolvedValue(
        processing({
          status: 'EXTRACTING_LYRICS',
          videoId: 'video-1',
          videoSource: 'youtube_music',
        }),
      );
      lyrics.run.mockResolvedValue({ kind: 'done' });

      await pipeline.runStep(lyricsJob, true);

      expect(revalidation.revalidate).toHaveBeenCalledWith(['sitemap']);
      expect(
        revalidation.revalidate.mock.invocationCallOrder.at(-1),
      ).toBeLessThan(completion.complete.mock.invocationCallOrder[0] ?? 0);
    });

    it('queues the cover keyed by its Processing, with the artwork the video step found', async () => {
      processings.findProcessing.mockResolvedValue(processing());

      await pipeline.runStep(findingVideoJob, true);

      expect(queue.add).toHaveBeenCalledWith(
        'store-cover',
        {
          trackId: 'track-1',
          processingId: 'processing-1',
          artworkUrl: 'https://img.test/artwork.jpg',
        },
        { jobId: coverJobId('processing-1') },
      );
    });

    it('keeps the cover job without artwork when the video step did not search', async () => {
      processings.findProcessing.mockResolvedValue(processing());
      videoStep.run.mockResolvedValue(undefined);

      await pipeline.runStep(findingVideoJob, true);

      expect(queue.add).toHaveBeenCalledWith(
        'store-cover',
        expect.not.objectContaining({ artworkUrl: expect.anything() }),
        { jobId: coverJobId('processing-1') },
      );
    });

    it('ends the Processing at once on a failure that repeating cannot fix', async () => {
      processings.findProcessing.mockResolvedValue(processing());
      videoStep.run.mockRejectedValue(
        new TrackProcessingFailure('VIDEO_NOT_FOUND'),
      );

      await expect(pipeline.runStep(findingVideoJob, false)).resolves.toBe(
        undefined,
      );

      expect(processings.markFailed).toHaveBeenCalledWith(
        'processing-1',
        ['QUEUED', 'FINDING_VIDEO'],
        { code: 'VIDEO_NOT_FOUND', resumeFrom: 'FINDING_VIDEO' },
      );
      expect(completion.complete).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('lets BullMQ retry a retryable failure before its last attempt', async () => {
      processings.findProcessing.mockResolvedValue(processing());
      const failure = new TrackProcessingFailure('DOWNLOAD_FAILED');
      videoStep.run.mockRejectedValue(failure);

      await expect(pipeline.runStep(findingVideoJob, false)).rejects.toBe(
        failure,
      );

      expect(processings.markFailed).not.toHaveBeenCalled();
    });

    it('marks a retryable failure FAILED with its code on the last attempt', async () => {
      processings.findProcessing.mockResolvedValue(processing());
      videoStep.run.mockRejectedValue(
        new TrackProcessingFailure('DOWNLOAD_FAILED'),
      );

      await pipeline.runStep(findingVideoJob, true);

      expect(processings.markFailed).toHaveBeenCalledWith(
        'processing-1',
        ['QUEUED', 'FINDING_VIDEO'],
        { code: 'DOWNLOAD_FAILED', resumeFrom: 'FINDING_VIDEO' },
      );
    });

    it('lets BullMQ retry an unexpected error before its last attempt', async () => {
      processings.findProcessing.mockResolvedValue(processing());
      const error = new Error('YouTube is down');
      videoStep.run.mockRejectedValue(error);

      await expect(pipeline.runStep(findingVideoJob, false)).rejects.toBe(
        error,
      );

      expect(processings.markFailed).not.toHaveBeenCalled();
    });

    it('marks a failure after the video is saved INTERNAL on the last attempt', async () => {
      processings.findProcessing.mockResolvedValue(processing());
      queue.add.mockRejectedValueOnce(new Error('redis is down'));

      await pipeline.runStep(findingVideoJob, true);

      expect(videoStep.run).toHaveBeenCalled();
      expect(processings.markFailed).toHaveBeenCalledWith(
        'processing-1',
        ['QUEUED', 'FINDING_VIDEO'],
        { code: 'INTERNAL', resumeFrom: 'FINDING_VIDEO' },
      );
      expect(completion.complete).not.toHaveBeenCalled();
    });

    it('lets BullMQ retry a failure after the video is saved before its last attempt', async () => {
      processings.findProcessing.mockResolvedValue(processing());
      queue.add.mockRejectedValueOnce(new Error('redis is down'));

      await expect(pipeline.runStep(findingVideoJob, false)).rejects.toThrow(
        'redis is down',
      );
      expect(processings.markFailed).not.toHaveBeenCalled();
    });

    it('lets a late failure leave a Processing that already completed as it is', async () => {
      processings.findProcessing.mockResolvedValue(processing());
      videoStep.run.mockRejectedValue(new Error('YouTube is down'));
      processings.markFailed.mockResolvedValue(false);

      await expect(pipeline.runStep(findingVideoJob, true)).resolves.toBe(
        undefined,
      );

      expect(processings.markFailed).toHaveBeenCalledTimes(1);
    });

    it('marks an unexpected error INTERNAL on the last attempt', async () => {
      processings.findProcessing.mockResolvedValue(processing());
      videoStep.run.mockRejectedValue(new Error('YouTube is down'));

      await pipeline.runStep(findingVideoJob, true);

      expect(processings.markFailed).toHaveBeenCalledWith(
        'processing-1',
        ['QUEUED', 'FINDING_VIDEO'],
        { code: 'INTERNAL', resumeFrom: 'FINDING_VIDEO' },
      );
      expect(revalidation.revalidate).not.toHaveBeenCalled();
    });
  });
});
