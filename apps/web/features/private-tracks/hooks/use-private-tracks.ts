'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type MyPrivateTracks,
  myPrivateTracksSchema,
  privateTrackSchema,
} from '@vozzify/contracts';
import { browserApi } from '@/lib/api/browser';
import { privateTrackKeys } from '../query-keys';

export function usePrivateTracks(userId: string) {
  return useQuery({
    queryKey: privateTrackKeys.list(userId),
    enabled: Boolean(userId),
    queryFn: () =>
      browserApi('/me/private-tracks', { schema: myPrivateTracksSchema }),
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
      await queryClient.setQueryData<MyPrivateTracks>(
        privateTrackKeys.list(userId),
        (current) =>
          current
            ? { ...current, tracks: [created, ...current.tracks] }
            : current,
      );
      await queryClient.invalidateQueries({
        queryKey: privateTrackKeys.list(userId),
      });
    },
  });
}
