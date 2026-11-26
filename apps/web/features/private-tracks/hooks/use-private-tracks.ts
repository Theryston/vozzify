'use client';

import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  type CreatePrivateYouTubeTrackBody,
  type MyPrivateTracksPage,
  myPrivateTracksPageSchema,
  type PrivateTrackDetail,
  privateTrackDetailSchema,
  privateTrackSchema,
} from '@vozzify/contracts';
import { z } from 'zod';
import { browserApi } from '@/lib/api/browser';
import { privateTrackKeys } from '../query-keys';

export function usePrivateTrackDetail(
  userId: string,
  trackId: string,
  initial: PrivateTrackDetail | undefined,
) {
  const queryKey = privateTrackKeys.detail(userId, trackId);
  return useQuery({
    queryKey,
    queryFn: () =>
      browserApi(`/me/private-tracks/${encodeURIComponent(trackId)}`, {
        schema: privateTrackDetailSchema,
      }),
    ...(initial === undefined ? {} : { initialData: initial }),
    // Membership can expire after processing ends, so keep the private
    // owner-scoped authorization state fresh for the active detail page.
    refetchOnWindowFocus: 'always',
    refetchInterval: (query) =>
      query.state.data?.processing.status === 'COMPLETED' ||
      query.state.data?.processing.status === 'FAILED'
        ? 60_000
        : 5_000,
  });
}

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
    mutationFn: (source: File | CreatePrivateYouTubeTrackBody) => {
      if (!(source instanceof File)) {
        return browserApi('/me/private-tracks/youtube', {
          method: 'POST',
          body: source,
          schema: privateTrackSchema,
        });
      }
      const body = new FormData();
      body.set('audio', source);
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
          pages: current.pages.map((page, index) => ({
            ...page,
            items:
              index === 0
                ? [
                    created,
                    ...page.items.filter((track) => track.id !== created.id),
                  ]
                : page.items.filter((track) => track.id !== created.id),
          })),
        };
      });
      await queryClient.invalidateQueries({
        queryKey: privateTrackKeys.list(userId),
      });
    },
  });
}

export function useDeletePrivateTrack(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (privateTrackId: string) =>
      browserApi(`/me/private-tracks/${privateTrackId}`, {
        method: 'DELETE',
        schema: z.undefined(),
      }),
    onSuccess: async (_deleted, privateTrackId) => {
      queryClient.removeQueries({
        queryKey: privateTrackKeys.detail(userId, privateTrackId),
        exact: true,
      });
      await queryClient.setQueryData<
        InfiniteData<MyPrivateTracksPage, string | undefined>
      >(privateTrackKeys.list(userId), (current) => {
        if (!current) return current;
        return {
          ...current,
          pages: current.pages.map((page) => ({
            ...page,
            items: page.items.filter((track) => track.id !== privateTrackId),
          })),
        };
      });
      await queryClient.invalidateQueries({
        queryKey: privateTrackKeys.list(userId),
      });
    },
  });
}
