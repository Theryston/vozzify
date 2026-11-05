import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, Optional } from '@nestjs/common';
import { LOCALES, type Locale } from '@vozzify/contracts';
import { type Job, UnrecoverableError } from 'bullmq';
import { runBoundedBatch } from './home-batch.js';
import {
  PERSONAL_HOME_FEED_QUEUE,
  REFRESH_PERSONAL_HOME_FEED_JOB,
  REFRESH_PERSONAL_NIGHTLY_JOB,
  refreshPersonalHomeFeedJobSchema,
} from './home-personal.job.js';
import { PersonalHomeRepository } from './home-personal.repository.js';
import { PersonalHomeStore } from './home-personal.store.js';
import { PersonalHomeBuilder } from './home-personal-builder.service.js';
import { PersonalHomeQueueService } from './home-personal-queue.service.js';
import {
  PERSONAL_NIGHTLY_ACTIVE_WITHIN_DAYS,
  PERSONAL_NIGHTLY_MAX_USERS,
} from './home-rules.js';
import { HomeSocialService } from './home-social.service.js';

const PERSONAL_NIGHTLY_CONCURRENCY = 10;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Rebuilds personal snapshots. A refresh rebuilds one User's feed in one
 * locale and commits it; the nightly batch rebuilds every locale of the Users
 * with practice activity lately. Idempotent: rebuilding twice stores the same
 * snapshot, and an unchanged feed keeps its version.
 */
@Processor(PERSONAL_HOME_FEED_QUEUE, { concurrency: 2 })
export class PersonalHomeProcessor extends WorkerHost {
  private readonly logger = new Logger(PersonalHomeProcessor.name);

  constructor(
    private readonly builder: PersonalHomeBuilder,
    private readonly store: PersonalHomeStore,
    private readonly personal: PersonalHomeRepository,
    private readonly queue: PersonalHomeQueueService,
  ) {
    super();
  }

  @Optional()
  @Inject(HomeSocialService)
  private readonly social?: HomeSocialService;

  async process(job: Job<unknown>): Promise<void> {
    if (job.name === REFRESH_PERSONAL_HOME_FEED_JOB) {
      await this.refreshOne(job);
      return;
    }
    if (job.name === REFRESH_PERSONAL_NIGHTLY_JOB) {
      await this.refreshNightly();
      return;
    }
    throw new UnrecoverableError('Unknown personal home feed job');
  }

  private async refreshOne(job: Job<unknown>): Promise<void> {
    const parsed = refreshPersonalHomeFeedJobSchema.safeParse(job.data);
    if (!parsed.success) {
      throw new UnrecoverableError('Invalid personal home feed job');
    }
    const { userId, locale } = parsed.data;
    await this.social?.refreshFor(userId);
    const next = await this.builder.build(userId, locale ?? 'en');
    const current = await this.store.readCurrent(userId, next.locale);
    if (current && current.version !== next.version) {
      await this.store.retire(current);
    }
    await this.store.writeCurrent(userId, next.locale, next);
  }

  private async refreshNightly(): Promise<void> {
    await this.builder.refreshCommunityCooccurrence();
    const since = new Date(
      Date.now() - PERSONAL_NIGHTLY_ACTIVE_WITHIN_DAYS * 24 * 60 * 60 * 1000,
    );
    const userIds = await this.personal.findActiveUserIds(
      since,
      PERSONAL_NIGHTLY_MAX_USERS,
    );
    if (userIds.length >= PERSONAL_NIGHTLY_MAX_USERS) {
      this.logger.warn(
        `Personal nightly batch hit its cap of ${PERSONAL_NIGHTLY_MAX_USERS} Users`,
      );
    }
    await runBoundedBatch(
      userIds,
      PERSONAL_NIGHTLY_CONCURRENCY,
      async (userId) => {
        await this.social?.refreshFor(userId);
      },
    );
    const refreshes = userIds.flatMap((userId) =>
      LOCALES.map((locale: Locale) => ({ userId, locale })),
    );
    await runBoundedBatch(
      refreshes,
      PERSONAL_NIGHTLY_CONCURRENCY,
      async ({ userId, locale }) => {
        try {
          await this.queue.scheduleRefresh(userId, locale);
        } catch (error) {
          throw new Error(
            `Personal nightly refresh of ${userId} failed: ${errorMessage(error)}`,
          );
        }
      },
    );
  }
}
