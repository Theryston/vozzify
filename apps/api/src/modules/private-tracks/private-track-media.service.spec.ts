import { Readable } from 'node:stream';
import { StorageService } from '../../integrations/storage/storage.service.js';
import { SubscriptionMembershipService } from '../plans/subscription-membership.service.js';
import { PrivateTrackMediaService } from './private-track-media.service.js';
import { PrivateTracksRepository } from './private-tracks.repository.js';

const privateTrack = {
  id: 'private-track-1',
  userId: 'user-1',
  processingStatus: 'COMPLETED',
  mediaObjectKey: 'private-tracks/user-1/track-1/music.wav',
  vocalsObjectKey: 'private-tracks/user-1/track-1/vocals.wav',
};

describe('PrivateTrackMediaService', () => {
  const tracks = { findOwned: vi.fn() };
  const membership = { hasPaidMembership: vi.fn() };
  const storage = {
    headPrivateObject: vi.fn(),
    getPrivateObject: vi.fn(),
  };
  let service: PrivateTrackMediaService;

  beforeEach(() => {
    vi.resetAllMocks();
    tracks.findOwned.mockResolvedValue(privateTrack);
    membership.hasPaidMembership.mockResolvedValue(true);
    storage.headPrivateObject.mockResolvedValue({ size: 100 });
    storage.getPrivateObject.mockResolvedValue(
      Readable.from([Buffer.from('a')]),
    );
    service = new PrivateTrackMediaService(
      tracks as unknown as PrivateTracksRepository,
      membership as unknown as SubscriptionMembershipService,
      storage as unknown as StorageService,
    );
  });

  it('asks storage for only the authenticated byte range', async () => {
    const result = await service.prepareAudio(
      'user-1',
      'private-track-1',
      'music',
      'bytes=20-29',
    );

    expect(storage.headPrivateObject).toHaveBeenCalledWith(
      privateTrack.mediaObjectKey,
    );
    expect(storage.getPrivateObject).toHaveBeenCalledWith(
      privateTrack.mediaObjectKey,
      'bytes=20-29',
    );
    expect(result).toMatchObject({
      size: 100,
      range: { start: 20, end: 29 },
      invalidRange: false,
    });
  });

  it('rejects an invalid range after HEAD without fetching audio bytes', async () => {
    const result = await service.prepareAudio(
      'user-1',
      'private-track-1',
      'music',
      'bytes=100-120',
    );

    expect(result).toMatchObject({ size: 100, body: null, invalidRange: true });
    expect(storage.getPrivateObject).not.toHaveBeenCalled();
  });

  it('does not read object metadata or bytes for a user without Pro', async () => {
    membership.hasPaidMembership.mockResolvedValue(false);

    await expect(
      service.prepareAudio('user-1', 'private-track-1', 'music', 'bytes=0-1'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(storage.headPrivateObject).not.toHaveBeenCalled();
    expect(storage.getPrivateObject).not.toHaveBeenCalled();
  });
});
