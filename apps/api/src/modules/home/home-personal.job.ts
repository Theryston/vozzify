import { localeSchema } from '@vozzify/contracts';
import { z } from 'zod';

// A User's personal feed is rebuilt by a delayed job, never inside a request.
// An Attempt or a favorite schedules one after a debounce delay, so a practice
// session costs one rebuild; loading the home with a missing or stale snapshot
// queues one at once; a nightly batch rebuilds the Users active lately. See
// docs/adr/0013-personal-home-feed.md.

export const PERSONAL_HOME_FEED_QUEUE = 'personal-home-feed';
export const REFRESH_PERSONAL_HOME_FEED_JOB = 'refresh-personal-home-feed';
export const REFRESH_PERSONAL_NIGHTLY_USER_JOB =
  'refresh-personal-nightly-user';
export const REFRESH_PERSONAL_NIGHTLY_JOB = 'refresh-personal-nightly';

/** The repeatable job's scheduler ID and cron (every night at 02:30 UTC). */
export const PERSONAL_NIGHTLY_SCHEDULER_ID = 'refresh-personal-nightly';
export const PERSONAL_NIGHTLY_CRON = '30 2 * * *';

export const refreshPersonalHomeFeedJobSchema = z.object({
  userId: z.string().min(1).max(128),
  locale: localeSchema.optional(),
});

export const refreshPersonalNightlyUserJobSchema = z.object({
  userId: z.string().min(1).max(128),
});

export type RefreshPersonalHomeFeedJob = z.infer<
  typeof refreshPersonalHomeFeedJobSchema
>;
/**
 * Keyed by the User, the locale and the delay-long time slot of the trigger.
 * Triggers in one slot share the job, which runs after the slot ends so it
 * sees all of them; a trigger in the next slot gets a job of its own even
 * while the previous one is still running. (A custom ID may not contain a
 * colon.)
 */
export const personalRefreshJobId = (
  userId: string,
  locale: string,
  now: number,
  delayMs: number,
): string => `personal-home-${userId}-${locale}-${Math.floor(now / delayMs)}`;

export const personalRequestRefreshJobId = (
  userId: string,
  locale: string,
): string => `personal-request-${userId}-${locale}`;

export const personalNightlyRefreshJobId = (userId: string): string =>
  `personal-nightly-user-${userId}`;
