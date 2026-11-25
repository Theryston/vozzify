import type {
  PrivateFile,
  StorageService,
} from '../../integrations/storage/storage.service.js';
import { PRIVATE_TRACK_UPLOAD_URL_TTL_MS } from './private-track-asset-cleanup.job.js';
import { PrivateTrackAssetCleanupQueue } from './private-track-asset-cleanup.queue.js';
import { PrivateTrackSourceStorage } from './private-track-source-storage.js';

describe('PrivateTrackSourceStorage', () => {
  const storage = {
    putPrivateFile: vi.fn(),
    deletePrivateObject: vi.fn(),
  };
  const cleanup = { schedulePrivateObjectCleanup: vi.fn() };
  let sourceStorage: PrivateTrackSourceStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    sourceStorage = new PrivateTrackSourceStorage(
      storage as unknown as StorageService,
      cleanup as unknown as PrivateTrackAssetCleanupQueue,
    );
    cleanup.schedulePrivateObjectCleanup.mockResolvedValue(undefined);
    storage.putPrivateFile.mockResolvedValue(undefined);
    storage.deletePrivateObject.mockResolvedValue(undefined);
  });

  it('reserves unassociated source cleanup before uploading to private storage', async () => {
    const source: PrivateFile = {
      key: 'private-tracks/owner-1/candidate-1/source',
      filePath: '/tmp/source.wav',
      contentType: 'application/octet-stream',
    };

    await sourceStorage.putPrivateFile(source);

    expect(cleanup.schedulePrivateObjectCleanup).toHaveBeenCalledWith(
      source.key,
      PRIVATE_TRACK_UPLOAD_URL_TTL_MS,
    );
    expect(storage.putPrivateFile).toHaveBeenCalledWith(source);
    const reservationOrder =
      cleanup.schedulePrivateObjectCleanup.mock.invocationCallOrder[0];
    const uploadOrder = storage.putPrivateFile.mock.invocationCallOrder[0];
    if (reservationOrder === undefined || uploadOrder === undefined) {
      throw new Error('Expected cleanup reservation and upload calls');
    }
    expect(reservationOrder).toBeLessThan(uploadOrder);
  });

  it('fails closed when durable cleanup cannot be reserved', async () => {
    cleanup.schedulePrivateObjectCleanup.mockRejectedValue(
      new Error('Redis unavailable'),
    );

    await expect(
      sourceStorage.putPrivateFile({
        key: 'private-tracks/owner-1/candidate-1/source',
        filePath: '/tmp/source.wav',
        contentType: 'application/octet-stream',
      }),
    ).rejects.toThrow('Redis unavailable');

    expect(storage.putPrivateFile).not.toHaveBeenCalled();
  });

  it('delegates exact source deletion to private storage', async () => {
    await sourceStorage.deletePrivateObject(
      'private-tracks/owner-1/entry/source',
    );

    expect(storage.deletePrivateObject).toHaveBeenCalledWith(
      'private-tracks/owner-1/entry/source',
    );
  });
});
