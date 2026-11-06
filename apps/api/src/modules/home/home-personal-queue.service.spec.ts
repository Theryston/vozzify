import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import {
  PERSONAL_HOME_FEED_QUEUE,
  PERSONAL_NIGHTLY_CRON,
  PERSONAL_NIGHTLY_SCHEDULER_ID,
  personalRefreshJobId,
  REFRESH_PERSONAL_HOME_FEED_JOB,
  REFRESH_PERSONAL_NIGHTLY_JOB,
} from './home-personal.job.js';
import { PersonalHomeQueueService } from './home-personal-queue.service.js';
import {
  HOME_ALGORITHM_VERSION,
  PERSONAL_REFRESH_DEBOUNCE_MS,
} from './home-rules.js';

const queue = { add: vi.fn(), upsertJobScheduler: vi.fn() };

const jobIdOf = (call: number) => queue.add.mock.calls[call]?.[2].jobId;

describe('PersonalHomeQueueService', () => {
  let service: PersonalHomeQueueService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        PersonalHomeQueueService,
        { provide: getQueueToken(PERSONAL_HOME_FEED_QUEUE), useValue: queue },
      ],
    }).compile();
    service = moduleRef.get(PersonalHomeQueueService);
  });

  it('registers the nightly batch on boot', async () => {
    await service.onModuleInit();

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      PERSONAL_NIGHTLY_SCHEDULER_ID,
      { pattern: PERSONAL_NIGHTLY_CRON, tz: 'UTC' },
      { name: REFRESH_PERSONAL_NIGHTLY_JOB, data: {} },
    );
  });

  it('queues a versioned retryable warm-up that can run again after rollback', async () => {
    await service.onModuleInit();

    expect(queue.add).toHaveBeenCalledWith(
      REFRESH_PERSONAL_NIGHTLY_JOB,
      {},
      {
        jobId: `refresh-personal-stage2-${HOME_ALGORITHM_VERSION}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  });

  it('queues a debounced rebuild for the User, removed when it ends', async () => {
    await service.scheduleRefresh('user-1', 'en', 0);

    expect(queue.add).toHaveBeenCalledWith(
      REFRESH_PERSONAL_HOME_FEED_JOB,
      { userId: 'user-1', locale: 'en' },
      expect.objectContaining({
        delay: PERSONAL_REFRESH_DEBOUNCE_MS,
        // Kept after it ends, the key would block a later schedule.
        removeOnComplete: true,
        removeOnFail: true,
      }),
    );
  });

  it('shares one job between the triggers of a time slot', async () => {
    await service.scheduleRefresh('user-1', 'en', 1000);
    await service.scheduleRefresh(
      'user-1',
      'en',
      PERSONAL_REFRESH_DEBOUNCE_MS - 1,
    );

    expect(jobIdOf(0)).toBe(jobIdOf(1));
  });

  it('gives a trigger of the next time slot a job of its own', async () => {
    await service.scheduleRefresh('user-1', 'en', 1000);
    await service.scheduleRefresh('user-1', 'en', PERSONAL_REFRESH_DEBOUNCE_MS);

    expect(jobIdOf(0)).not.toBe(jobIdOf(1));
  });

  it('keys Users and locales apart', async () => {
    expect(personalRefreshJobId('user-1', 'en', 0, 1000)).not.toBe(
      personalRefreshJobId('user-2', 'en', 0, 1000),
    );
    expect(personalRefreshJobId('user-1', 'en', 0, 1000)).not.toBe(
      personalRefreshJobId('user-1', 'pt-BR', 0, 1000),
    );
  });

  it('queues a rebuild at once for a request that found no snapshot', async () => {
    await service.requestRefresh('user-1', 'en');

    expect(queue.add).toHaveBeenCalledWith(
      REFRESH_PERSONAL_HOME_FEED_JOB,
      { userId: 'user-1', locale: 'en' },
      expect.objectContaining({
        removeOnComplete: true,
        removeOnFail: true,
      }),
    );
  });
});
