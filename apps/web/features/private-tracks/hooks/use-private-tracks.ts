'use client';

import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import {
  type MyPrivateTracksPage,
  myPrivateTracksPageSchema,
  privateTrackSchema,
} from '@vozzify/contracts';
import { browserApi } from '@/lib/api/browser';
import { privateTrackKeys } from '../query-keys';

export function usePrivateTracks(userId: string) {
  return useInfiniteQuery({
    queryKey: privateTrackKeys.list(userId),
    enabled: Boolean(userId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      browserApi('/me/private-tracks', {
        schema: myPrivateTracksPageSchema,
        query: {
          limit: 20,
          ...(pageParam === undefined ? {} : { cursor: pageParam }),
        },
        signal,
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

export function useSubmitPrivateTrack(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (audio: File) => {
      const body = new FormData();
      body.set('audio', audio);
      return browserApi('/me/private-tracks', {
        method: 'POST',
        body,
        schema: privateTrackSchema,
      });
    },
    onSuccess: async (created) => {
      await queryClient.setQueryData<
        InfiniteData<MyPrivateTracksPage, string | undefined>
      >(privateTrackKeys.list(userId), (current) => {
        if (!current?.pages[0]) return current;
        return {
          ...current,
          pages: current.pages.map((page, index) =>
            index === 0
              ? {
                  ...page,
                  items: [
                    created,
                    ...page.items.filter((track) => track.id !== created.id),
                  ],
                }
              : page,
          ),
        };
      });
      await queryClient.invalidateQueries({
        queryKey: privateTrackKeys.list(userId),
      });
    },
  });
}
