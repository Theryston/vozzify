import { QueryClient } from '@tanstack/react-query';
import type {
  MyPrivateTracksPage,
  PrivateTrack,
  PrivateTrackDetail,
} from '@vozzify/contracts';
import { describe, expect, it, vi } from 'vitest';
import { browserApi } from '@/lib/api/browser';
import {
  privateTrackListRefetchInterval,
  privateTrackRetryMutation,
} from './private-track-processing-query';
import { privateTrackKeys } from './query-keys';

vi.mock('@/lib/api/browser', () => ({ browserApi: vi.fn() }));

const failed: PrivateTrackDetail = {
  id: 'private/track',
  ownerId: 'owner',
  title: 'Recording',
  artist: '',
  durationMs: 1000,
  createdAt: '2026-11-24T12:00:00.000Z',
  locked: false,
  processing: { status: 'FAILED', progress: 0 },
  notes: [],
};
const queued = { status: 'QUEUED', progress: 0 } as const;
const page = (track: PrivateTrack): MyPrivateTracksPage => ({
  items: [track],
  canSubmit: true,
  nextCursor: null,
});

describe('private Track processing refresh', () => {
  it('stops scheduled requests when a private library has no active Processing', () => {
    expect(privateTrackListRefetchInterval(undefined)).toBe(false);
    expect(
      privateTrackListRefetchInterval([
        page(failed),
        page({ ...failed, processing: { status: 'COMPLETED', progress: 100 } }),
        page({ ...failed, processing: undefined }),
      ]),
    ).toBe(false);
  });

  it('scales the interval with the number of pages the query must refetch', () => {
    const active = page({ ...failed, processing: queued });
    expect(privateTrackListRefetchInterval([active])).toBe(5_000);
    expect(
      privateTrackListRefetchInterval([page(failed), page(failed), active]),
    ).toBe(15_000);
  });
});

describe('retrying a private Track', () => {
  const detailKey = privateTrackKeys.detail(failed.ownerId, failed.id);
  const listKey = privateTrackKeys.list(failed.ownerId);
  const otherKey = privateTrackKeys.detail('another-owner', failed.id);
  const library = { pages: [page(failed)], pageParams: [undefined] };
  const retry = (client: QueryClient) =>
    client
      .getMutationCache()
      .build(
        client,
        privateTrackRetryMutation(client, failed.ownerId, failed.id),
      )
      .execute(undefined);

  it('updates the same Track and refreshes the owning account alone', async () => {
    vi.mocked(browserApi).mockResolvedValue(queued);
    const client = new QueryClient();
    client.setQueryData(detailKey, failed);
    client.setQueryData(listKey, library);
    client.setQueryData(otherKey, { ...failed, ownerId: 'another-owner' });

    await retry(client);

    expect(browserApi).toHaveBeenCalledWith(
      '/me/private-tracks/private%2Ftrack/retry',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(client.getQueryData(detailKey)).toEqual({
      ...failed,
      processing: queued,
    });
    expect(client.getQueryState(detailKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherKey)?.isInvalidated).toBe(false);
  });

  it('refreshes the detail after refusal while retaining the last state', async () => {
    const refusal = new Error('Pro membership expired');
    vi.mocked(browserApi).mockRejectedValue(refusal);
    const client = new QueryClient();
    client.setQueryData(detailKey, failed);
    client.setQueryData(listKey, library);

    await expect(retry(client)).rejects.toBe(refusal);

    expect(client.getQueryData(detailKey)).toEqual(failed);
    expect(client.getQueryState(detailKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(listKey)?.isInvalidated).toBe(false);
  });

  it('does not create an incomplete detail if the Track is no longer cached', async () => {
    vi.mocked(browserApi).mockResolvedValue(queued);
    const client = new QueryClient();

    await retry(client);

    expect(client.getQueryData(detailKey)).toBeUndefined();
  });
});
