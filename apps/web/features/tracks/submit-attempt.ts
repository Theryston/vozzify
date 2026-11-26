import type { QueryClient } from '@tanstack/react-query';
import type { SubmitPracticeAttemptBody } from '@vozzify/contracts';
import { toast } from 'sonner';

import { submitPracticeAttempt } from './attempt-queries';
import { type RequestErrorMessage, requestErrorMessage } from './request-error';
import { invalidateTrackState } from './track-user-state-query';

/**
 * The mutation behind saving a run: submit it, then read the Track state
 * again so the best score shows at once. A refusal (the run the page sent is
 * not valid anymore) toasts the API's error code. Kept out of the hook so
 * the wiring stays testable without rendering.
 */
export function submitAttemptMutation(
  queryClient: QueryClient,
  trackId: string,
  translate: (message: RequestErrorMessage) => string,
  isPrivate = false,
) {
  return {
    mutationFn: (body: SubmitPracticeAttemptBody) =>
      isPrivate
        ? submitPracticeAttempt(trackId, body, true)
        : submitPracticeAttempt(trackId, body),
    onSuccess: () => {
      if (!isPrivate) void invalidateTrackState(queryClient, trackId);
    },
    onError: (error: unknown) => {
      toast.error(translate(requestErrorMessage(error)));
    },
  };
}
