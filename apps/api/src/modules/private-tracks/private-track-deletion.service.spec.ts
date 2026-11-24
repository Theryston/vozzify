import { StorageService } from '../../integrations/storage/storage.service.js';
import { PrivateTrackAssetCleanupQueue } from './private-track-asset-cleanup.queue.js';
import { PrivateTrackDeletionService } from './private-track-deletion.service.js';
import { PrivateTracksRepository } from './private-tracks.repository.js';

describe('PrivateTrackDeletionService', () => {
  const repository = { findOwned: vi.fn(), delete: vi.fn() };
  const storage = {
    deletePrivateObject: vi.fn(),
    deletePrivateObjectsWithPrefix: vi.fn(),
  };
  const cleanup = { schedulePrefixCleanup: vi.fn() };
  let service: PrivateTrackDeletionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PrivateTrackDeletionService(
      repository as unknown as PrivateTracksRepository,
      storage as unknown as StorageService,
      cleanup as unknown as PrivateTrackAssetCleanupQueue,
    );
    cleanup.schedulePrefixCleanup.mockResolvedValue(undefined);
    storage.deletePrivateObject.mockResolvedValue(undefined);
    storage.deletePrivateObjectsWithPrefix.mockResolvedValue(undefined);
  });

  it('queues a delayed cleanup before revoking the owned entry', async () => {
    repository.findOwned.mockResolvedValue({
      id: 'entry-1',
      objectKey: 'owner-1/legacy-hash',
    });
    repository.delete.mockResolvedValue({ objectKey: 'owner-1/legacy-hash' });

    await expect(service.delete('owner-1', 'entry-1')).resolves.toBeUndefined();

    expect(cleanup.schedulePrefixCleanup).toHaveBeenCalledWith({
      userId: 'owner-1',
      privateTrackId: 'entry-1',
      prefix: 'private-tracks/owner-1/entry-1/',
      sourceKey: 'owner-1/legacy-hash',
      delayMs: 2 * 60 * 60 * 1000,
    });
    expect(repository.delete).toHaveBeenCalledWith('owner-1', 'entry-1');
    expect(storage.deletePrivateObject).toHaveBeenCalledWith(
      'owner-1/legacy-hash',
    );
    expect(storage.deletePrivateObjectsWithPrefix).toHaveBeenCalledWith(
      'private-tracks/owner-1/entry-1/',
    );
    expect(storage.deletePrivateObjectsWithPrefix).toHaveBeenCalledOnce();
  });

  it('keeps retryable cleanup queued when the immediate storage sweep fails', async () => {
    repository.findOwned.mockResolvedValue({
      id: 'entry-1',
      objectKey: 'owner-1/legacy-hash',
    });
    repository.delete.mockResolvedValue({ objectKey: 'owner-1/legacy-hash' });
    storage.deletePrivateObjectsWithPrefix.mockRejectedValue(
      new Error('storage unavailable'),
    );

    await expect(service.delete('owner-1', 'entry-1')).resolves.toBeUndefined();

    expect(cleanup.schedulePrefixCleanup).toHaveBeenCalledOnce();
    expect(repository.delete).toHaveBeenCalledOnce();
  });

  it('leaves a live entry intact when the durable cleanup cannot be queued', async () => {
    repository.findOwned.mockResolvedValue({
      id: 'entry-1',
      objectKey: 'owner-1/hash',
    });
    cleanup.schedulePrefixCleanup.mockRejectedValue(
      new Error('queue unavailable'),
    );

    await expect(service.delete('owner-1', 'entry-1')).rejects.toThrow(
      'queue unavailable',
    );

    expect(repository.delete).not.toHaveBeenCalled();
    expect(storage.deletePrivateObject).not.toHaveBeenCalled();
  });

  it('does not purge storage when the owner scoped lookup found no entry', async () => {
    repository.findOwned.mockResolvedValue(undefined);

    await expect(service.delete('other-user', 'entry-1')).rejects.toMatchObject(
      { code: 'NOT_FOUND' },
    );

    expect(cleanup.schedulePrefixCleanup).not.toHaveBeenCalled();
    expect(repository.delete).not.toHaveBeenCalled();
    expect(storage.deletePrivateObject).not.toHaveBeenCalled();
  });
});
