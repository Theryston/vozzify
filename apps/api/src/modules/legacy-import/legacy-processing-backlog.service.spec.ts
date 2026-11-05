import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../../config/env.js';
import type { TrackMigrationService } from '../tracks/track-migration.service.js';
import type { LegacyProcessingAdmissionService } from './legacy-processing-admission.service.js';
import type {
  BacklogReport,
  LegacyProcessingBacklogRepository,
} from './legacy-processing-backlog.repository.js';
import { LegacyProcessingBacklogService } from './legacy-processing-backlog.service.js';

const env = parseEnv({
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  LEGACY_PROCESSING_CONCURRENCY: '4',
});

const waitingReport: BacklogReport = {
  queued: 1,
  admitted: 1,
  running: 0,
  completed: 0,
  failed: 0,
};
const terminalReport: BacklogReport = {
  queued: 0,
  admitted: 0,
  running: 0,
  completed: 0,
  failed: 1,
};

const createService = (configuredConcurrency: number | null = 4) => {
  const work = { processingId: 'processing-1', trackId: 'track-1' };
  const backlog = {
    admit: vi.fn<LegacyProcessingBacklogRepository['admit']>(),
    unstartedQueued:
      vi.fn<LegacyProcessingBacklogRepository['unstartedQueued']>(),
    markStarted: vi.fn<LegacyProcessingBacklogRepository['markStarted']>(),
    report: vi.fn<LegacyProcessingBacklogRepository['report']>(),
    hasPendingWork:
      vi.fn<LegacyProcessingBacklogRepository['hasPendingWork']>(),
  };
  const tracks = {
    start: vi.fn<TrackMigrationService['start']>(),
  };
  const admission = {
    admit: vi.fn<LegacyProcessingAdmissionService['admit']>(),
  };
  admission.admit.mockImplementation((concurrency) =>
    backlog.admit(concurrency),
  );
  backlog.admit.mockResolvedValue([work]);
  backlog.unstartedQueued.mockResolvedValue([work]);
  backlog.markStarted.mockResolvedValue(undefined);
  backlog.report.mockResolvedValue(waitingReport);
  backlog.hasPendingWork.mockResolvedValue(false);
  tracks.start.mockResolvedValue('started');

  return {
    service: new LegacyProcessingBacklogService(
      {
        ...env,
        LEGACY_PROCESSING_CONCURRENCY: configuredConcurrency ?? undefined,
      },
      backlog as unknown as LegacyProcessingBacklogRepository,
      admission as unknown as LegacyProcessingAdmissionService,
      tracks as unknown as TrackMigrationService,
    ),
    backlog,
    admission,
    tracks,
    work,
  };
};

describe('LegacyProcessingBacklogService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the validated concurrency and starts only admitted attempts', async () => {
    const { service, backlog, admission, tracks, work } = createService();
    backlog.unstartedQueued.mockResolvedValue([work]);

    await expect(service.runCycle()).resolves.toEqual(waitingReport);

    expect(admission.admit).toHaveBeenCalledWith(4);
    expect(tracks.start).toHaveBeenCalledWith(work.trackId, work.processingId);
    expect(backlog.markStarted).toHaveBeenCalledWith(work.processingId);
  });

  it('uses the safe default when no concurrency was configured', async () => {
    const { service, admission } = createService(null);

    await service.runCycle();

    expect(admission.admit).toHaveBeenCalledWith(2);
  });

  it('keeps a failed enqueue unstarted and retries the same reserved attempt', async () => {
    const { service, backlog, admission, tracks, work } = createService();
    tracks.start
      .mockRejectedValueOnce(new Error('queue unavailable'))
      .mockResolvedValueOnce('started');

    await service.runCycle();
    expect(backlog.markStarted).not.toHaveBeenCalled();
    expect(admission.admit).toHaveBeenCalledTimes(1);

    await service.runCycle();
    expect(admission.admit).toHaveBeenCalledWith(4);
    expect(tracks.start).toHaveBeenCalledTimes(2);
    expect(tracks.start).toHaveBeenLastCalledWith(
      work.trackId,
      work.processingId,
    );
    expect(backlog.markStarted).toHaveBeenCalledWith(work.processingId);
  });

  it('does not report drained while queued work remains', async () => {
    vi.useFakeTimers();
    const { service, backlog } = createService();
    backlog.report
      .mockResolvedValueOnce(waitingReport)
      .mockResolvedValueOnce(waitingReport)
      .mockResolvedValueOnce(terminalReport);
    backlog.hasPendingWork
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    let drained = false;
    const result = service.drain().then((report) => {
      drained = true;
      return report;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(drained).toBe(false);
    expect(backlog.hasPendingWork).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(drained).toBe(false);
    expect(backlog.hasPendingWork).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(5_000);
    await expect(result).resolves.toEqual(terminalReport);
    expect(backlog.hasPendingWork).toHaveBeenCalledTimes(3);
  });
});
