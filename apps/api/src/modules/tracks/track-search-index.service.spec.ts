import type {
  TrackSearchIndexDeliveryStore,
  TrackSearchIndexSonicWriter,
} from './track-search-index.service.js';
import { TrackSearchIndexService } from './track-search-index.service.js';
import type {
  ClaimedTrackSearchIndexEvent,
  TrackSearchIndexEventRepository,
} from './track-search-index-event.repository.js';

const firstEvent: ClaimedTrackSearchIndexEvent = {
  id: 'event-1',
  trackId: 'track-1',
  operation: 'upsert',
  searchableText: 'Title Artist',
  revision: 1,
  attempts: 1,
};

describe('TrackSearchIndexService', () => {
  const events = {
    claimPending: vi.fn<TrackSearchIndexEventRepository['claimPending']>(),
    withDeliveryLock: vi.fn(
      async <Result>(
        _trackId: string,
        deliver: () => Promise<Result>,
      ): Promise<Result> => deliver(),
    ),
    findById: vi.fn<TrackSearchIndexEventRepository['findById']>(),
    markDelivered: vi.fn<TrackSearchIndexEventRepository['markDelivered']>(),
    scheduleRetry: vi.fn<TrackSearchIndexEventRepository['scheduleRetry']>(),
    requeueNewerRevision:
      vi.fn<TrackSearchIndexEventRepository['requeueNewerRevision']>(),
    enqueueBackfillPage:
      vi.fn<TrackSearchIndexEventRepository['enqueueBackfillPage']>(),
    countPending: vi.fn<TrackSearchIndexEventRepository['countPending']>(),
  } satisfies TrackSearchIndexDeliveryStore;
  const sonic = {
    replaceTrack: vi.fn<TrackSearchIndexSonicWriter['replaceTrack']>(),
    removeTrack: vi.fn<TrackSearchIndexSonicWriter['removeTrack']>(),
  } satisfies TrackSearchIndexSonicWriter;
  let service: TrackSearchIndexService;

  beforeEach(() => {
    vi.clearAllMocks();
    events.claimPending.mockResolvedValue([firstEvent]);
    events.findById.mockResolvedValue(firstEvent);
    events.markDelivered.mockResolvedValue(true);
    events.scheduleRetry.mockResolvedValue(undefined);
    events.requeueNewerRevision.mockResolvedValue(undefined);
    sonic.replaceTrack.mockResolvedValue(undefined);
    sonic.removeTrack.mockResolvedValue(undefined);
    service = new TrackSearchIndexService(events, sonic);
  });

  it('replaces and acknowledges the current upsert revision', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');

    await expect(service.dispatchPending(now)).resolves.toBe(1);

    expect(sonic.replaceTrack).toHaveBeenCalledWith('track-1', 'Title Artist');
    expect(events.markDelivered).toHaveBeenCalledWith('event-1', 1, now);
  });

  it('removes and acknowledges a tombstone', async () => {
    events.claimPending.mockResolvedValue([
      { ...firstEvent, operation: 'delete', searchableText: null },
    ]);
    events.findById.mockResolvedValue({
      ...firstEvent,
      operation: 'delete',
      searchableText: null,
    });

    await service.dispatchPending();

    expect(sonic.removeTrack).toHaveBeenCalledWith('track-1');
    expect(sonic.replaceTrack).not.toHaveBeenCalled();
  });

  it('returns zero without external work when nothing is due', async () => {
    events.claimPending.mockResolvedValue([]);

    await expect(service.dispatchPending()).resolves.toBe(0);

    expect(events.withDeliveryLock).not.toHaveBeenCalled();
    expect(sonic.replaceTrack).not.toHaveBeenCalled();
  });

  it('exposes durable backfill and pending-count operations to rebuild', async () => {
    const page = [
      {
        id: 'track-2',
        title: 'Another title',
        artistCredit: [],
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ];
    events.enqueueBackfillPage.mockResolvedValue(undefined);
    events.countPending.mockResolvedValue(2);

    await service.enqueueBackfillPage(page);

    await expect(service.countPending()).resolves.toBe(2);
    expect(events.enqueueBackfillPage).toHaveBeenCalledWith(page);
    expect(events.countPending).toHaveBeenCalledOnce();
  });

  it('keeps a failed write pending with a retry time', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    sonic.replaceTrack.mockRejectedValue(new Error('Sonic unavailable'));

    await service.dispatchPending(now);

    expect(events.scheduleRetry).toHaveBeenCalledWith(
      'event-1',
      1,
      new Date(now.getTime() + 5_000),
    );
    expect(events.requeueNewerRevision).toHaveBeenCalledWith(
      'event-1',
      1,
      new Date(now.getTime() + 5_000),
    );
  });

  it('redelivers after a failed acknowledgment observes a newer revision', async () => {
    const newer = { ...firstEvent, revision: 2, searchableText: 'New title' };
    events.findById
      .mockResolvedValueOnce(firstEvent)
      .mockResolvedValueOnce(firstEvent)
      .mockResolvedValueOnce(newer)
      .mockResolvedValueOnce(newer);
    events.markDelivered
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await service.dispatchPending();

    expect(sonic.replaceTrack).toHaveBeenNthCalledWith(
      1,
      'track-1',
      'Title Artist',
    );
    expect(sonic.replaceTrack).toHaveBeenNthCalledWith(
      2,
      'track-1',
      'New title',
    );
    expect(events.markDelivered).toHaveBeenLastCalledWith(
      'event-1',
      2,
      expect.any(Date),
    );
  });

  it('bounds revision chasing and leaves newer work queued', async () => {
    const second = { ...firstEvent, revision: 2, searchableText: 'Title two' };
    const third = { ...firstEvent, revision: 3, searchableText: 'Title three' };
    const fourth = { ...firstEvent, revision: 4, searchableText: 'Title four' };
    events.findById
      .mockResolvedValueOnce(firstEvent)
      .mockResolvedValueOnce(second)
      .mockResolvedValueOnce(third)
      .mockResolvedValueOnce(fourth)
      .mockResolvedValueOnce(fourth);

    await service.dispatchPending();

    expect(sonic.replaceTrack).toHaveBeenCalledTimes(3);
    expect(events.markDelivered).not.toHaveBeenCalled();
    expect(events.requeueNewerRevision).not.toHaveBeenCalled();
  });
});
