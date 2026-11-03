import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  WEB_REVALIDATION_JOB,
  WEB_REVALIDATION_QUEUE,
  type WebRevalidationJob,
  webRevalidationJobSchema,
} from './web-revalidation.job.js';

const TAGS_PER_JOB = 50;

/**
 * Asks the web app to revalidate cached pages after the data they render
 * changed. Runs in the background with retries, so a slow or briefly
 * unavailable web app never fails the API request that triggered it.
 *
 * Build tags with `cacheTags` from `@vozzify/contracts`, never by hand:
 * `revalidate([cacheTags.track(id), cacheTags.tracks])`.
 */
@Injectable()
export class WebRevalidationService {
  constructor(
    @InjectQueue(WEB_REVALIDATION_QUEUE)
    private readonly queue: Queue<WebRevalidationJob>,
  ) {}

  /** @throws {ZodError} when tags are empty or contain an invalid tag. */
  async revalidate(tags: readonly string[]): Promise<void> {
    const uniqueTags = [...new Set(tags)];
    // Catalog pages can exceed the endpoint's per-request limit. Validate all
    // batches first so an invalid tag never queues a partial revalidation.
    const payloads = Array.from(
      { length: Math.max(1, Math.ceil(uniqueTags.length / TAGS_PER_JOB)) },
      (_, index) =>
        webRevalidationJobSchema.parse({
          tags: uniqueTags.slice(
            index * TAGS_PER_JOB,
            (index + 1) * TAGS_PER_JOB,
          ),
        }),
    );
    for (const payload of payloads) {
      await this.queue.add(WEB_REVALIDATION_JOB, payload);
    }
  }
}
