import { StorageService } from '../../integrations/storage/storage.service.js';
import { SubscriptionMembershipService } from '../plans/subscription-membership.service.js';
import { PrivateAudioInspector } from './private-audio.js';
import { PrivateTracksRepository } from './private-tracks.repository.js';
import { PrivateTracksService } from './private-tracks.service.js';

describe('PrivateTracksService upload identity', () => {
  const repository = { save: vi.fn() };
  const audio = { inspect: vi.fn(), hash: vi.fn() };
  const storage = {
    putPrivateFile: vi.fn(),
    deletePrivateObject: vi.fn(),
  };
  const membership = { hasPaidMembership: vi.fn() };
  let service: PrivateTracksService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PrivateTracksService(
      repository as unknown as PrivateTracksRepository,
      audio as unknown as PrivateAudioInspector,
      storage as unknown as StorageService,
      membership as unknown as SubscriptionMembershipService,
    );
    membership.hasPaidMembership.mockResolvedValue(true);
    audio.inspect.mockResolvedValue({
      durationMs: 1000,
      title: 'Song',
      artist: 'Singer',
    });
    audio.hash.mockResolvedValue('same-content');
    storage.putPrivateFile.mockResolvedValue(undefined);
    storage.deletePrivateObject.mockResolvedValue(undefined);
  });

  it('stores a tagged source under an owner- and candidate-ID namespace', async () => {
    repository.save.mockImplementation((input) =>
      Promise.resolve({
        ...input,
        createdAt: new Date('2026-01-02T03:04:05.000Z'),
      }),
    );

    const created = await service.submit('owner-1', {
      path: '/tmp/source.wav',
      originalname: 'song.wav',
    });
    const uploaded = storage.putPrivateFile.mock.calls[0]?.[0];
    const candidateId = repository.save.mock.calls[0]?.[0].id;

    expect(uploaded.key).toBe(`private-tracks/owner-1/${candidateId}/source`);
    expect(created.id).toBe(candidateId);
    expect(created.id).toMatch(/^[a-z0-9]+$/);
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: created.id,
        contentSha256: 'same-content',
        objectKey: `private-tracks/owner-1/${candidateId}/source`,
      }),
    );
    expect(storage.deletePrivateObject).not.toHaveBeenCalled();
  });

  it('removes the unused candidate object when the hash deduplicates to an existing entry', async () => {
    repository.save.mockImplementation((input) =>
      Promise.resolve({
        ...input,
        id: 'canonical-entry',
        objectKey: 'private-tracks/owner-1/canonical-entry/source',
        discardedUploadKey: input.objectKey,
        title: 'Song',
        artist: 'Singer',
        durationMs: 1000,
        createdAt: new Date('2026-01-02T03:04:05.000Z'),
      }),
    );

    const created = await service.submit('owner-1', {
      path: '/tmp/source.wav',
      originalname: 'song.wav',
    });
    const uploaded = storage.putPrivateFile.mock.calls[0]?.[0];

    expect(created.id).toBe('canonical-entry');
    expect(uploaded.key).not.toBe(
      'private-tracks/owner-1/canonical-entry/source',
    );
    expect(storage.deletePrivateObject).toHaveBeenCalledWith(uploaded.key);
  });

  it('keeps the source intact when persistence has an ambiguous failure', async () => {
    repository.save.mockRejectedValue(new Error('Database connection lost'));

    await expect(
      service.submit('owner-1', {
        path: '/tmp/source.wav',
        originalname: 'song.wav',
      }),
    ).rejects.toThrow('Database connection lost');

    const uploaded = storage.putPrivateFile.mock.calls[0]?.[0];
    if (!uploaded) throw new Error('Expected the private audio source');
    expect(repository.save).toHaveBeenCalledOnce();
    expect(storage.deletePrivateObject).not.toHaveBeenCalled();
  });
});
