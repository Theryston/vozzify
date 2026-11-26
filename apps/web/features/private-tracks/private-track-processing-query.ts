import { mutationOptions, type QueryClient } from '@tanstack/react-query';
import {
  type MyPrivateTracksPage,
  type PrivateTrackDetail,
  privateTrackProcessingStateSchema,
} from '@vozzify/contracts';
import { browserApi } from '@/lib/api/browser';
import { privateTrackKeys } from './query-keys';

export function privateTrackListRefetchInterval(
  pages: readonly MyPrivateTracksPage[] | undefined,
): number | false {
  if (!pages) return false;
  const processing = pages.some((page) =>
    page.items.some(
      (track) =>
        track.processing &&
        track.processing.status !== 'FAILED' &&
        track.processing.status !== 'COMPLETED',
    ),
  );
  // Refetching an infinite query requests every page loaded so far.
  return processing ? pages.length * 5_000 : false;
}

export function privateTrackRetryMutation(
  queryClient: QueryClient,
  userId: string,
  privateTrackId: string,
) {
  const queryKey = privateTrackKeys.detail(userId, privateTrackId);
  return mutationOptions({
    mutationFn: () =>
      browserApi(
        `/me/private-tracks/${encodeURIComponent(privateTrackId)}/retry`,
        {
          method: 'POST',
          schema: privateTrackProcessingStateSchema,
        },
      ),
    onSuccess: async (processing) => {
      await queryClient.cancelQueries({ queryKey, exact: true });
      queryClient.setQueryData<PrivateTrackDetail>(queryKey, (track) =>
        track ? { ...track, processing } : undefined,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey, exact: true }),
        queryClient.invalidateQueries({
          queryKey: privateTrackKeys.list(userId),
        }),
      ]);
    },
    onError: async () => {
      await queryClient.invalidateQueries({ queryKey, exact: true });
    },
  });
}
