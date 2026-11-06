import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { Locale } from '@vozzify/contracts';
import type { Queue } from 'bullmq';
import {
  PERSONAL_HOME_FEED_QUEUE,
  PERSONAL_NIGHTLY_CRON,
  PERSONAL_NIGHTLY_SCHEDULER_ID,
  personalNightlyRefreshJobId,
  personalRefreshJobId,
  personalRequestRefreshJobId,
  REFRESH_PERSONAL_HOME_FEED_JOB,
  REFRESH_PERSONAL_NIGHTLY_JOB,
  REFRESH_PERSONAL_NIGHTLY_USER_JOB,
  type RefreshPersonalHomeFeedJob,
} from './home-personal.job.js';
import {
  HOME_ALGORITHM_VERSION,
  PERSONAL_REFRESH_DEBOUNCE_MS,
} from './home-rules.js';

/** Schedules rebuilds of one User's personal snapshot. */
@Injectable()
export class PersonalHomeQueueService implements OnModuleInit {
  constructor(
    @InjectQueue(PERSONAL_HOME_FEED_QUEUE)
    private readonly queue: Queue<
      RefreshPersonalHomeFeedJob | { userId: string } | Record<string, never>
    >,
  ) {}

  /** Registers the nightly batch; upserting is safe on every boot. */
  async onModuleInit(): Promise<void> {
    await this.queue.add(
      REFRESH_PERSONAL_NIGHTLY_JOB,
      {},
      {
        jobId: `refresh-personal-stage2-${HOME_ALGORITHM_VERSION}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        // A later rollback can rebuild legacy raw-count pairs, so do not keep
        // a completed v5 marker that would suppress the next v5 warm-up.
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    await this.queue.upsertJobScheduler(
      PERSONAL_NIGHTLY_SCHEDULER_ID,
      { pattern: PERSONAL_NIGHTLY_CRON, tz: 'UTC' },
      { name: REFRESH_PERSONAL_NIGHTLY_JOB, data: {} },
    );
  }

  /**
   * Schedules a rebuild after the debounce delay unless one already waits for
   * the User in this time slot (see `personalRefreshJobId`). The job is
   * removed when it ends. Called after an Attempt or a favorite.
   */
  async scheduleRefresh(
    userId: string,
    locale: Locale,
    now = Date.now(),
  ): Promise<void> {
    await this.queue.add(
      REFRESH_PERSONAL_HOME_FEED_JOB,
      { userId, locale },
      {
        jobId: personalRefreshJobId(
          userId,
          locale,
          now,
          PERSONAL_REFRESH_DEBOUNCE_MS,
        ),
        delay: PERSONAL_REFRESH_DEBOUNCE_MS,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  /**
   * Queues a rebuild at once, for a request that found no snapshot. The job
   * is removed when it ends.
   */
  async requestRefresh(userId: string, locale: Locale): Promise<void> {
    await this.queue.add(
      REFRESH_PERSONAL_HOME_FEED_JOB,
      { userId, locale },
      {
        jobId: personalRequestRefreshJobId(userId, locale),
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  /** Queues one nightly rebuild for every locale of an active User. */
  async scheduleNightlyRefresh(userId: string): Promise<void> {
    await this.queue.add(
      REFRESH_PERSONAL_NIGHTLY_USER_JOB,
      { userId },
      {
        jobId: personalNightlyRefreshJobId(userId),
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }
}
