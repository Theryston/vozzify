import { TrackAssociationService } from './track-association.service.js';
import { TrackAssociationEventRepository } from './track-association-event.repository.js';
import {
  type TrackAssociationSyncRepository,
  type TrackAssociationSyncRow,
} from './track-association-sync.repository.js';
import { TrackAssociationSyncService } from './track-association-sync.service.js';

describe('TrackAssociationSyncService', () => {
  const pages: TrackAssociationSyncRow[][] = [];
  const tracks = {
    findAndEnqueuePage: vi.fn(
      async (
        _afterId: string | undefined,
        _limit: number,
        enqueue: (rows: TrackAssociationSyncRow[]) => Promise<void>,
      ) => {
        const page = pages.shift() ?? [];
        if (page.length > 0) await enqueue(page);
        return page;
      },
    ),
  };
  const events = {
    enqueueSynchronizationPage: vi.fn(),
    countPendingForTracks: vi.fn(),
    countPending: vi.fn(),
  };
  const delivery = { dispatchPending: vi.fn() };
  let service: TrackAssociationSyncService;

  beforeEach(() => {
    vi.resetAllMocks();
    pages.length = 0;
    tracks.findAndEnqueuePage.mockImplementation(
      async (
        _afterId: string | undefined,
        _limit: number,
        enqueue: (rows: TrackAssociationSyncRow[]) => Promise<void>,
      ) => {
        const page = pages.shift() ?? [];
        if (page.length > 0) await enqueue(page);
        return page;
      },
    );
    events.enqueueSynchronizationPage.mockResolvedValue(undefined);
    events.countPendingForTracks.mockResolvedValue([{ count: 0 }]);
    events.countPending.mockResolvedValue([{ count: 0 }]);
    service = new TrackAssociationSyncService(
      tracks as unknown as TrackAssociationSyncRepository,
      events as unknown as TrackAssociationEventRepository,
      delivery as unknown as TrackAssociationService,
    );
  });

  it('walks a stable keyset and enqueues every row regardless of Processing state', async () => {
    const page = Array.from({ length: 250 }, (_, index) => ({
      id: `track-${String(index).padStart(3, '0')}`,
      recordingMbid: `mbid-${index}`,
      businessScore: 1,
      revision: 1,
    }));
    pages.push(
      page,
      [
        {
          id: 'track-z',
          recordingMbid: 'mbid-z',
          businessScore: 1,
          revision: 1,
        },
      ],
      [],
    );

    await service.synchronize();

    expect(
      tracks.findAndEnqueuePage.mock.calls.map(([after, limit]) => [
        after,
        limit,
      ]),
    ).toEqual([
      [undefined, 250],
      ['track-249', 250],
      ['track-z', 250],
    ]);
    expect(events.enqueueSynchronizationPage).toHaveBeenCalledTimes(2);
    expect(delivery.dispatchPending).toHaveBeenCalledTimes(3);
  });

  it('reruns from the beginning to restore previously lost projection state', async () => {
    const page = [
      {
        id: 'track-a',
        recordingMbid: 'mbid-a',
        businessScore: 1,
        revision: 1,
      },
    ];
    pages.push(page, []);
    await service.synchronize();
    tracks.findAndEnqueuePage.mockClear();
    pages.push(page, []);

    await service.synchronize();

    expect(tracks.findAndEnqueuePage.mock.calls[0]?.slice(0, 2)).toEqual([
      undefined,
      250,
    ]);
    expect(events.enqueueSynchronizationPage).toHaveBeenCalledTimes(2);
  });

  it('restarts from the first page after an interrupted delivery', async () => {
    const page = [
      {
        id: 'track-a',
        recordingMbid: 'mbid-a',
        businessScore: 1,
        revision: 1,
      },
    ];
    pages.push(page, page, []);
    delivery.dispatchPending
      .mockRejectedValueOnce(new Error('database connection lost'))
      .mockResolvedValue(undefined);

    await expect(service.synchronize()).rejects.toThrow(
      'database connection lost',
    );
    await service.synchronize();

    expect(tracks.findAndEnqueuePage.mock.calls[0]?.slice(0, 2)).toEqual([
      undefined,
      250,
    ]);
    expect(tracks.findAndEnqueuePage.mock.calls[1]?.slice(0, 2)).toEqual([
      undefined,
      250,
    ]);
    expect(events.enqueueSynchronizationPage).toHaveBeenCalledTimes(2);
  });
});
