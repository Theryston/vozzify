import { Test, type TestingModule } from '@nestjs/testing';
import { MusicCatalogClient } from '../../integrations/music-catalog/music-catalog.client.js';
import {
  TRACK_ASSOCIATION_BATCH_SIZE,
  TRACK_ASSOCIATION_CLAIM_LEASE_MS,
  TRACK_ASSOCIATION_CLEANUP_BATCH_SIZE,
  TRACK_ASSOCIATION_RETENTION_MS,
} from './track-association.job.js';
import { TrackAssociationService } from './track-association.service.js';
import { TrackAssociationEventRepository } from './track-association-event.repository.js';

const events = {
  claimPending: vi.fn(),
  deleteDeliveredBefore: vi.fn(),
  markDelivered: vi.fn(),
  scheduleRetry: vi.fn(),
};
const catalog = { associateTrack: vi.fn() };
const row = {
  id: 'event-1',
  recordingMbid: '11111111-1111-1111-8111-111111111111',
  trackId: 'track-1',
  attempts: 1,
  businessScore: 4,
  revision: 3,
};
const now = new Date('2026-10-27T12:00:00.000Z');

describe('TrackAssociationService', () => {
  let service: TrackAssociationService;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    vi.clearAllMocks();
    events.deleteDeliveredBefore.mockResolvedValue(0);
    events.claimPending.mockResolvedValue([row]);
    events.markDelivered.mockResolvedValue(undefined);
    events.scheduleRetry.mockResolvedValue(undefined);
    catalog.associateTrack.mockResolvedValue(undefined);
    moduleRef = await Test.createTestingModule({
      providers: [
        TrackAssociationService,
        { provide: TrackAssociationEventRepository, useValue: events },
        { provide: MusicCatalogClient, useValue: catalog },
      ],
    }).compile();
    service = moduleRef.get(TrackAssociationService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('delivers the committed MBID and Track ID before acknowledging the event', async () => {
    const order: string[] = [];
    catalog.associateTrack.mockImplementation(async () => {
      order.push('catalog');
    });
    events.markDelivered.mockImplementation(async () => {
      order.push('ack');
    });

    await service.dispatchPending(now);

    expect(events.deleteDeliveredBefore).toHaveBeenCalledWith(
      new Date(now.getTime() - TRACK_ASSOCIATION_RETENTION_MS),
      TRACK_ASSOCIATION_CLEANUP_BATCH_SIZE,
    );
    expect(events.claimPending).toHaveBeenCalledWith(
      now,
      new Date(now.getTime() + TRACK_ASSOCIATION_CLAIM_LEASE_MS),
      TRACK_ASSOCIATION_BATCH_SIZE,
    );
    expect(catalog.associateTrack).toHaveBeenCalledWith({
      mbid: row.recordingMbid,
      trackId: row.trackId,
      businessScore: row.businessScore,
      revision: row.revision,
    });
    expect(order).toEqual(['catalog', 'ack']);
    expect(events.markDelivered).toHaveBeenCalledWith(
      row.id,
      row.revision,
      now,
    );
  });

  it('leaves failed delivery pending with a durable retry time', async () => {
    catalog.associateTrack.mockRejectedValue(new Error('catalog unavailable'));

    await service.dispatchPending(now);

    expect(events.markDelivered).not.toHaveBeenCalled();
    expect(events.scheduleRetry).toHaveBeenCalledWith(
      row.id,
      row.revision,
      new Date(now.getTime() + 5_000),
    );
  });

  it('redelivers after acknowledgment is interrupted, relying on catalog idempotency', async () => {
    events.markDelivered
      .mockRejectedValueOnce(new Error('database interruption'))
      .mockResolvedValue(undefined);
    await service.dispatchPending(now);
    expect(events.scheduleRetry).toHaveBeenCalledWith(
      row.id,
      row.revision,
      new Date(now.getTime() + 5_000),
    );

    events.claimPending.mockResolvedValue([{ ...row, attempts: 2 }]);
    await service.dispatchPending(new Date(now.getTime() + 5_000));

    expect(catalog.associateTrack).toHaveBeenCalledTimes(2);
    expect(events.markDelivered).toHaveBeenCalledTimes(2);
  });

  it('still cleans old delivered rows when no events are pending', async () => {
    events.claimPending.mockResolvedValue([]);

    await service.dispatchPending(now);

    expect(catalog.associateTrack).not.toHaveBeenCalled();
    expect(events.markDelivered).not.toHaveBeenCalled();
  });
});
