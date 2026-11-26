'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';

import { submitAttemptMutation } from '../submit-attempt';

/**
 * Saves a signed-in User's valid run. The title row and the result sheet read
 * the state again once it lands, so the best score shows at once. A refusal
 * (the run the page sent is not valid anymore) toasts the API's error code.
 */
export function useSubmitAttempt(trackId: string, isPrivate = false) {
  const queryClient = useQueryClient();
  const t = useTranslations();

  return useMutation(
    submitAttemptMutation(
      queryClient,
      trackId,
      (message) => t(message.key, message.values),
      isPrivate,
    ),
  );
}
