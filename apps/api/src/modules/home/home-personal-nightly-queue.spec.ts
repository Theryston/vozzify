import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import {
  PERSONAL_HOME_FEED_QUEUE,
  personalNightlyRefreshJobId,
  personalRefreshJobId,
  REFRESH_PERSONAL_HOME_FEED_JOB,
  REFRESH_PERSONAL_NIGHTLY_USER_JOB,
} from './home-personal.job.js';
import { PersonalHomeQueueService } from './home-personal-queue.service.js';

describe('PersonalHomeQueueService nightly User refresh', () => {
  it('uses a per-User job ID separate from mutation refresh jobs', async () => {
    const queue = { add: vi.fn(), upsertJobScheduler: vi.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PersonalHomeQueueService,
        { provide: getQueueToken(PERSONAL_HOME_FEED_QUEUE), useValue: queue },
      ],
    }).compile();
    const service = moduleRef.get(PersonalHomeQueueService);

    await service.scheduleNightlyRefresh('user-1');

    expect(queue.add).toHaveBeenCalledWith(
      REFRESH_PERSONAL_NIGHTLY_USER_JOB,
      { userId: 'user-1' },
      expect.objectContaining({
        jobId: personalNightlyRefreshJobId('user-1'),
        removeOnComplete: true,
        removeOnFail: true,
      }),
    );
    expect(personalNightlyRefreshJobId('user-1')).not.toBe(
      personalRefreshJobId('user-1', 'en', 0, 1),
    );
    expect(queue.add).not.toHaveBeenCalledWith(
      REFRESH_PERSONAL_HOME_FEED_JOB,
      expect.anything(),
      expect.anything(),
    );
  });
});
