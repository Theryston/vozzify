import type { SubmitPracticeAttemptBody } from '@vozzify/contracts';
import { AppException } from '../../common/errors/app-exception.js';

/** Turns a qualifying run into storage fields shared by each Track source. */
export function qualifyingAttempt(body: SubmitPracticeAttemptBody) {
  if (body.forwardSkip) {
    throw new AppException('ATTEMPT_REJECTED', 'The run skipped forward', {
      reason: 'FORWARD_SKIP',
    });
  }
  if (body.coverage < 0.9) {
    throw new AppException(
      'ATTEMPT_REJECTED',
      'The run covered under 90% of the notes',
      { reason: 'COVERAGE' },
    );
  }
  const { viewId, startedAt, endedAt, ...scores } = body;
  return {
    ...scores,
    startedAt: new Date(startedAt),
    endedAt: new Date(endedAt),
    ...(viewId === undefined ? {} : { viewId }),
  };
}
