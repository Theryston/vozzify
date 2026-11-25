import type { Job } from 'bullmq';
import { StorageService } from '../../integrations/storage/storage.service.js';
import {
  CLEAN_PRIVATE_TRACK_OBJECT,
  CLEAN_PRIVATE_TRACK_PREFIX,
  PRIVATE_TRACK_ASSET_CLEANUP_QUEUE,
} from './private-track-asset-cleanup.job.js';
import { PrivateTrackAssetCleanupProcessor } from './private-track-asset-cleanup.processor.js';
import { PrivateTracksRepository } from './private-tracks.repository.js';

describe('PrivateTrackAssetCleanupProcessor', () => {
  const repository = {
    findOwned: vi.fn(),
    isPrivateObjectReferenced: vi.fn(),
  };
  const storage = {
    deletePrivateObject: vi.fn(),
    deletePrivateObjectsWithPrefix: vi.fn(),
  };
  let processor: PrivateTrackAssetCleanupProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new PrivateTrackAssetCleanupProcessor(
      repository as unknown as PrivateTracksRepository,
      storage as unknown as StorageService,
    );
    storage.deletePrivateObject.mockResolvedValue(undefined);
    storage.deletePrivateObjectsWithPrefix.mockResolvedValue(undefined);
  });

  it('skips the delayed prefix sweep if the entry still exists', async () => {
    repository.findOwned.mockResolvedValue({ id: 'entry-1' });

    await processor.process(
      job(CLEAN_PRIVATE_TRACK_PREFIX, {
        userId: 'owner-1',
        privateTrackId: 'entry-1',
        prefix: 'private-tracks/owner-1/entry-1/',
        sourceKey: 'owner-1/hash',
      }),
    );

    expect(storage.deletePrivateObject).not.toHaveBeenCalled();
    expect(storage.deletePrivateObjectsWithPrefix).not.toHaveBeenCalled();
  });

  it('cleans the source and derivatives after the entry has been deleted', async () => {
    repository.findOwned.mockResolvedValue(undefined);

    await processor.process(
      job(CLEAN_PRIVATE_TRACK_PREFIX, {
        userId: 'owner-1',
        privateTrackId: 'entry-1',
        prefix: 'private-tracks/owner-1/entry-1/',
        sourceKey: 'owner-1/hash',
      }),
    );

    expect(storage.deletePrivateObject).toHaveBeenCalledWith('owner-1/hash');
    expect(storage.deletePrivateObjectsWithPrefix).toHaveBeenCalledWith(
      'private-tracks/owner-1/entry-1/',
    );
  });

  it('does not remove an exact object still referenced by a live entry', async () => {
    repository.isPrivateObjectReferenced.mockResolvedValue(true);

    await processor.process(
      job(CLEAN_PRIVATE_TRACK_OBJECT, { key: 'private-tracks/owner-1/a.wav' }),
    );

    expect(storage.deletePrivateObject).not.toHaveBeenCalled();
  });

  it('removes an exact object after it is no longer referenced', async () => {
    repository.isPrivateObjectReferenced.mockResolvedValue(false);

    await processor.process(
      job(CLEAN_PRIVATE_TRACK_OBJECT, { key: 'private-tracks/owner-1/a.wav' }),
    );

    expect(storage.deletePrivateObject).toHaveBeenCalledWith(
      'private-tracks/owner-1/a.wav',
    );
  });
});

function job(name: string, data: unknown): Job<unknown> {
  return {
    name,
    data,
    queueName: PRIVATE_TRACK_ASSET_CLEANUP_QUEUE,
  } as Job<unknown>;
}
