import type { Logger } from '@nestjs/common';
import type { TrackProcessingFailureCode } from '@vozzify/contracts';

/**
 * A step that ends the Processing with a known failure code (`VIDEO_NOT_FOUND`,
 * `TOO_LONG`, ...). Anything else a step throws is an `INTERNAL` failure, and
 * is retried with backoff until its last attempt.
 */
export class TrackProcessingFailure extends Error {
  override readonly name = 'TrackProcessingFailure';

  constructor(readonly code: TrackProcessingFailureCode) {
    super(`Processing failed: ${code}`);
  }
}

/** The message of any thrown value, for the logs of the tracks module. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * One call to an external service of a step (YouTube, RunPod, ...). Any
 * failure of it is a `code` failure, which BullMQ retries until the last
 * attempt; the cause goes to `logger`.
 */
export async function attemptStepCall<T>(
  logger: Logger,
  code: TrackProcessingFailureCode,
  action: string,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    logger.warn(`Could not ${action}: ${messageOf(error)}`);
    throw new TrackProcessingFailure(code);
  }
}
