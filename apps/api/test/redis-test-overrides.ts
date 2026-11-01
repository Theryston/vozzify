import { getQueueToken } from '@nestjs/bullmq';
import type { TestingModuleBuilder } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { EMAIL_QUEUE } from '../src/integrations/email/email.job.js';
import { EmailProcessor } from '../src/integrations/email/email.processor.js';
import { WEB_REVALIDATION_QUEUE } from '../src/integrations/web-revalidation/web-revalidation.job.js';
import { WebRevalidationProcessor } from '../src/integrations/web-revalidation/web-revalidation.processor.js';
import { EDITORIAL_PIN_QUEUE } from '../src/modules/editorial-pins/editorial-pins.job.js';
import { EditorialPinsProcessor } from '../src/modules/editorial-pins/editorial-pins.processor.js';
import { EVENTS_QUEUE } from '../src/modules/events/events.job.js';
import { EventsProcessor } from '../src/modules/events/events.processor.js';
import { HOME_FEED_QUEUE } from '../src/modules/home/home-feed.job.js';
import { HomeFeedProcessor } from '../src/modules/home/home-feed.processor.js';
import { PERSONAL_HOME_FEED_QUEUE } from '../src/modules/home/home-personal.job.js';
import { PersonalHomeProcessor } from '../src/modules/home/home-personal.processor.js';
import { PRICE_CHANGE_QUEUE } from '../src/modules/plans/price-change.job.js';
import { PriceChangeProcessor } from '../src/modules/plans/price-change.processor.js';
import { STREAK_REMINDER_QUEUE } from '../src/modules/streaks/streak-reminder.job.js';
import { StreakReminderProcessor } from '../src/modules/streaks/streak-reminder.processor.js';
import { TrackMetadataProcessor } from '../src/modules/track-metadata/track-metadata.processor.js';
import { TRACK_ASSOCIATION_QUEUE } from '../src/modules/tracks/track-association.job.js';
import { TrackAssociationProcessor } from '../src/modules/tracks/track-association.processor.js';
import { TRACK_MP3_QUEUE } from '../src/modules/tracks/track-mp3.job.js';
import { TrackMp3Processor } from '../src/modules/tracks/track-mp3.processor.js';
import { TRACK_PROCESSING_QUEUE } from '../src/modules/tracks/track-processing.job.js';
import { TrackProcessingProcessor } from '../src/modules/tracks/track-processing.processor.js';
import { TRACK_SEARCH_INDEX_QUEUE } from '../src/modules/tracks/track-search-index.job.js';
import { TrackSearchIndexProcessor } from '../src/modules/tracks/track-search-index.processor.js';
import { TRACK_TRENDING_QUEUE } from '../src/modules/tracks/track-trending.job.js';
import { TrackTrendingProcessor } from '../src/modules/tracks/track-trending.processor.js';
import { TRACK_METADATA_QUEUE } from '../src/queue/track-metadata.job.js';
import { REDIS_CLIENT } from '../src/redis/redis.constants.js';

/** Every BullMQ queue registered by the app; add new queues here. */
const QUEUES = [
  STREAK_REMINDER_QUEUE,
  WEB_REVALIDATION_QUEUE,
  EMAIL_QUEUE,
  TRACK_PROCESSING_QUEUE,
  TRACK_METADATA_QUEUE,
  TRACK_MP3_QUEUE,
  TRACK_TRENDING_QUEUE,
  TRACK_ASSOCIATION_QUEUE,
  TRACK_SEARCH_INDEX_QUEUE,
  HOME_FEED_QUEUE,
  PERSONAL_HOME_FEED_QUEUE,
  EDITORIAL_PIN_QUEUE,
  EVENTS_QUEUE,
  PRICE_CHANGE_QUEUE,
] as const;
/** Every BullMQ processor; overriding one keeps its worker from starting. */
const PROCESSORS = [
  StreakReminderProcessor,
  WebRevalidationProcessor,
  EmailProcessor,
  TrackProcessingProcessor,
  TrackMetadataProcessor,
  TrackMp3Processor,
  TrackTrendingProcessor,
  TrackAssociationProcessor,
  TrackSearchIndexProcessor,
  HomeFeedProcessor,
  PersonalHomeProcessor,
  EditorialPinsProcessor,
  EventsProcessor,
  PriceChangeProcessor,
] as const;

export type FakeQueue = {
  added: { name: string; data: unknown }[];
  /** The options of each job in `added`, at the same index (delay, job ID…). */
  options: unknown[];
  add: (name: string, data: unknown, opts?: unknown) => Promise<{ id: string }>;
  upsertJobScheduler: () => Promise<void>;
};

const createFakeQueue = (): FakeQueue => {
  const added: FakeQueue['added'] = [];
  const options: unknown[] = [];
  return {
    added,
    options,
    add: async (name, data, opts) => {
      added.push({ name, data });
      options.push(opts);
      return { id: String(added.length) };
    },
    // Repeatable jobs are registered on boot; nothing runs them here.
    upsertJobScheduler: async () => undefined,
  };
};

// Only what the shutdown hook and the readiness check touch (reported as
// healthy): any other Redis command called on it throws (not a function), so
// a provider missed by these overrides fails loudly instead of trying to
// connect.
const redisStub = {
  status: 'wait',
  disconnect: () => undefined,
  ping: async () => 'PONG',
};

/**
 * Replaces every Redis-backed provider (shared client, rate-limit storage,
 * BullMQ queues and workers) so e2e specs run without a Redis server.
 * Returns the fake queues, keyed by queue name, to assert enqueued jobs.
 */
export const overrideRedisProviders = (
  builder: TestingModuleBuilder,
): { builder: TestingModuleBuilder; queues: Record<string, FakeQueue> } => {
  const queues: Record<string, FakeQueue> = {};
  let result = builder
    .overrideProvider(REDIS_CLIENT)
    .useValue(redisStub)
    .overrideProvider(ThrottlerStorage)
    .useValue(new ThrottlerStorageService());
  for (const name of QUEUES) {
    const queue = createFakeQueue();
    queues[name] = queue;
    result = result.overrideProvider(getQueueToken(name)).useValue(queue);
  }
  for (const processor of PROCESSORS) {
    result = result.overrideProvider(processor).useValue({});
  }
  return { builder: result, queues };
};
