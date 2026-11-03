import { Test, type TestingModule } from '@nestjs/testing';
import { UnrecoverableError } from 'bullmq';
import { WebRevalidationService } from '../../integrations/web-revalidation/web-revalidation.service.js';
import { TrackContributorEmailsService } from './track-contributor-emails.service.js';
import { TrackCoverService } from './track-cover.service.js';
import { TrackJobRunnerService } from './track-job-runner.service.js';
import { TrackPipelineService } from './track-pipeline.service.js';

const pipeline = { runStep: vi.fn() };
const covers = { storeCover: vi.fn() };
const revalidation = { revalidate: vi.fn() };

const coverJob = {
  trackId: 'track-1',
  processingId: 'processing-1',
  artworkUrl: 'https://img.test/hit.jpg',
};

describe('TrackJobRunnerService', () => {
  let runner: TrackJobRunnerService;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    vi.clearAllMocks();
    covers.storeCover.mockResolvedValue(true);
    revalidation.revalidate.mockResolvedValue(undefined);
    moduleRef = await Test.createTestingModule({
      providers: [
        TrackJobRunnerService,
        { provide: TrackPipelineService, useValue: pipeline },
        { provide: TrackCoverService, useValue: covers },
        {
          provide: TrackContributorEmailsService,
          useValue: { notifyIfEnded: vi.fn() },
        },
        { provide: WebRevalidationService, useValue: revalidation },
      ],
    }).compile();
    runner = moduleRef.get(TrackJobRunnerService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  describe('a step job', () => {
    it('goes to the pipeline, with its parsed payload', async () => {
      await runner.run(
        'run-step',
        { processingId: 'processing-1', step: 'FINDING_VIDEO' },
        true,
      );

      expect(pipeline.runStep).toHaveBeenCalledWith(
        { processingId: 'processing-1', step: 'FINDING_VIDEO' },
        true,
      );
    });
  });

  describe('a cover job', () => {
    it('ignores artwork from old queued jobs and refreshes the Track', async () => {
      await runner.run('store-cover', coverJob, true);

      expect(covers.storeCover).toHaveBeenCalledWith('track-1');
      expect(revalidation.revalidate).toHaveBeenCalledWith([
        'track:track-1',
        'tracks',
      ]);
    });

    it('accepts cover jobs without legacy artwork', async () => {
      await runner.run(
        'store-cover',
        { trackId: 'track-1', processingId: 'processing-1' },
        true,
      );

      expect(covers.storeCover).toHaveBeenCalledWith('track-1');
    });

    it('refreshes the pages after a pass that stored nothing too, so a replay refreshes', async () => {
      covers.storeCover.mockResolvedValue(false);

      await runner.run('store-cover', coverJob, true);

      expect(revalidation.revalidate).toHaveBeenCalledTimes(1);
    });

    it('lets BullMQ retry a failed download before its last attempt', async () => {
      const error = new Error('Image download failed with HTTP 503');
      covers.storeCover.mockRejectedValue(error);

      await expect(runner.run('store-cover', coverJob, false)).rejects.toBe(
        error,
      );
      expect(revalidation.revalidate).not.toHaveBeenCalled();
    });

    it('lets BullMQ retry when the refresh fails before its last attempt', async () => {
      const error = new Error('web is down');
      revalidation.revalidate.mockRejectedValueOnce(error);

      await expect(runner.run('store-cover', coverJob, false)).rejects.toBe(
        error,
      );
    });

    it('only logs a failure on its last attempt, leaving the placeholder', async () => {
      covers.storeCover.mockRejectedValue(new Error('storage is down'));

      await expect(runner.run('store-cover', coverJob, true)).resolves.toBe(
        undefined,
      );
      expect(revalidation.revalidate).not.toHaveBeenCalled();
    });
  });

  it('refuses a job it does not know, without retrying it', async () => {
    await expect(runner.run('send-email', {}, true)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it('refuses a payload that breaks its schema, without retrying it', async () => {
    await expect(
      runner.run(
        'run-step',
        { processingId: 'processing-1', step: 'NOPE' },
        true,
      ),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(
      runner.run('store-cover', { trackId: 'track-1' }, true),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    expect(pipeline.runStep).not.toHaveBeenCalled();
    expect(covers.storeCover).not.toHaveBeenCalled();
  });
});
