'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  privateTrackDetailSchema,
  searchResultSchema,
  type UpdatePrivateTrackMetadataBody,
} from '@vozzify/contracts';
import { browserApi } from '@/lib/api/browser';
import { privateTrackKeys } from '../query-keys';

export function useUpdatePrivateTrackMetadata(userId: string, trackId: string) {
  const queryClient = useQueryClient();
  const detailKey = privateTrackKeys.detail(userId, trackId);
  return useMutation({
    mutationFn: (body: UpdatePrivateTrackMetadataBody) =>
      browserApi(`/me/private-tracks/${encodeURIComponent(trackId)}`, {
        method: 'PATCH',
        body,
        schema: privateTrackDetailSchema,
      }),
    onSuccess: async (updated) => {
      await queryClient.cancelQueries({ queryKey: detailKey });
      queryClient.setQueryData(detailKey, updated);
      await queryClient.invalidateQueries({
        queryKey: privateTrackKeys.list(userId),
      });
    },
  });
}

export function useRecordingPickerSearch(query: string) {
  return useQuery({
    queryKey: privateTrackKeys.recordingSearch(query),
    enabled: query.length > 0,
    queryFn: ({ signal }) =>
      browserApi('/search', {
        schema: searchResultSchema,
        query: { query, limit: 8 },
        signal,
      }),
  });
}
