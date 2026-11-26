// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type PrivateTrackDetail,
  privateTrackDetailSchema,
  searchResultSchema,
} from '@vozzify/contracts';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browserApi } from '@/lib/api/browser';
import { privateTrackKeys } from '../query-keys';
import {
  useRecordingPickerSearch,
  useUpdatePrivateTrackMetadata,
} from './use-private-track-metadata';

vi.mock('@/lib/api/browser', () => ({ browserApi: vi.fn() }));

const track: PrivateTrackDetail = {
  id: 'private/recording',
  ownerId: 'owner',
  title: 'Source title',
  artist: '',
  durationMs: 2_000,
  createdAt: '2026-11-24T00:00:00.000Z',
  notes: [],
  locked: false,
  processing: { status: 'COMPLETED', progress: 100 },
};

let client: QueryClient;
let root: ReturnType<typeof createRoot>;
let edit: ReturnType<typeof useUpdatePrivateTrackMetadata>['mutateAsync'];

function MetadataProbe({ query }: { query: string }) {
  edit = useUpdatePrivateTrackMetadata(track.ownerId, track.id).mutateAsync;
  useRecordingPickerSearch(query);
  return null;
}

const show = (query = '') =>
  act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(MetadataProbe, { query }),
      ),
    );
  });

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  client = new QueryClient();
  root = createRoot(document.createElement('div'));
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
});

describe('private Recording metadata queries', () => {
  it('searches the catalog only after receiving a query', async () => {
    const page = { results: [], source: 'music-catalog' };
    vi.mocked(browserApi).mockResolvedValue(page);
    await show();
    expect(browserApi).not.toHaveBeenCalled();

    const query = 'Noite de Samba';
    await show(query);
    expect(browserApi).toHaveBeenCalledExactlyOnceWith('/search', {
      schema: searchResultSchema,
      query: { query, limit: 8 },
      signal: expect.any(AbortSignal),
    });
    expect(
      client.getQueryData(privateTrackKeys.recordingSearch(query)),
    ).toEqual(page);
  });

  it('cancels stale detail reads and refreshes only the owning library', async () => {
    const detail = privateTrackKeys.detail(track.ownerId, track.id);
    const library = privateTrackKeys.list(track.ownerId);
    const otherLibrary = privateTrackKeys.list('another-owner');
    client.setQueryData(library, []);
    client.setQueryData(otherLibrary, []);
    const stale = client
      .fetchQuery({
        queryKey: detail,
        queryFn: ({ signal }) =>
          new Promise((resolve) => {
            signal.addEventListener('abort', () => resolve(track));
          }),
      })
      .catch(() => undefined);
    const changes = { title: 'My rehearsal', recordingMbid: null };
    const saved = { ...track, title: changes.title };
    vi.mocked(browserApi).mockResolvedValue(saved);
    await show();

    await act(async () => {
      await edit(changes);
    });
    expect(await stale).toBeUndefined();
    expect(browserApi).toHaveBeenCalledExactlyOnceWith(
      '/me/private-tracks/private%2Frecording',
      { method: 'PATCH', body: changes, schema: privateTrackDetailSchema },
    );
    expect(client.getQueryData(detail)).toEqual(saved);
    expect(client.getQueryState(library)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherLibrary)?.isInvalidated).toBe(false);
  });
});
