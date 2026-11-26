import { StorageService } from '../../integrations/storage/storage.service.js';
import { SubscriptionMembershipService } from '../plans/subscription-membership.service.js';
import { PrivateAudioInspector } from './private-audio.js';
import { PrivateTracksRepository } from './private-tracks.repository.js';
import { PrivateTracksService } from './private-tracks.service.js';

describe('PrivateTracksService', () => {
  const repository = {
    findOwned: vi.fn(),
    listPage: vi.fn(),
    resetFailedProcessing: vi.fn(),
    save: vi.fn(),
  };
  const audio = { inspect: vi.fn(), hash: vi.fn() };
  const storage = { putPrivateFile: vi.fn() };
  const subscriptions = { hasPaidMembership: vi.fn() };
  let service: PrivateTracksService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PrivateTracksService(
      repository as unknown as PrivateTracksRepository,
      audio as unknown as PrivateAudioInspector,
      storage as unknown as StorageService,
      subscriptions as unknown as SubscriptionMembershipService,
    );
  });

  it('lists only the owner’s private entries with current membership', async () => {
    subscriptions.hasPaidMembership.mockResolvedValue(true);
    repository.listPage.mockResolvedValue([
      {
        id: 'entry-1',
        title: 'Song',
        artist: 'Singer',
        durationMs: 1000,
        createdAt: new Date('2026-01-02T03:04:05.000Z'),
      },
    ]);
    await expect(service.listPage('u1', { limit: 20 })).resolves.toEqual({
      canSubmit: true,
      items: [
        {
          id: 'entry-1',
          title: 'Song',
          artist: 'Singer',
          durationMs: 1000,
          createdAt: '2026-01-02T03:04:05.000Z',
        },
      ],
      nextCursor: null,
    });
    expect(repository.listPage).toHaveBeenCalledWith('u1', {
      after: undefined,
      limit: 20,
    });
  });

  it('rejects free uploads before inspection or storage', async () => {
    subscriptions.hasPaidMembership.mockResolvedValue(false);
    await expect(
      service.submit('u1', { path: '/tmp/upload', originalname: 'song.wav' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(audio.inspect).not.toHaveBeenCalled();
    expect(storage.putPrivateFile).not.toHaveBeenCalled();
  });

  it('rejects retry for a missing or locked entry', async () => {
    repository.findOwned
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ processingStatus: 'FAILED' });
    subscriptions.hasPaidMembership.mockResolvedValue(false);

    await expect(
      service.prepareRetry('u1', 'other-track'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      service.prepareRetry('u1', 'owned-track'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(repository.resetFailedProcessing).not.toHaveBeenCalled();
  });

  it('returns a new Processing generation for a failed entry', async () => {
    subscriptions.hasPaidMembership.mockResolvedValue(true);
    repository.findOwned.mockResolvedValue({
      processingStatus: 'FAILED',
      processingRetryId: 'old-retry',
    });
    repository.resetFailedProcessing.mockResolvedValue(true);

    const result = await service.prepareRetry('u1', 'entry-1');
    expect(result).toEqual({
      processing: { status: 'QUEUED', progress: 0 },
      retryId: expect.any(String),
    });
    expect(repository.resetFailedProcessing).toHaveBeenCalledWith({
      userId: 'u1',
      id: 'entry-1',
      previousRetryId: 'old-retry',
      retryId: result.retryId,
    });
  });

  it('returns the current Processing when a concurrent request retries first', async () => {
    subscriptions.hasPaidMembership.mockResolvedValue(true);
    repository.findOwned
      .mockResolvedValueOnce({
        processingStatus: 'FAILED',
        processingRetryId: null,
      })
      .mockResolvedValueOnce({
        processingStatus: 'EXTRACTING_VOCALS',
        processingProgress: 10,
      });
    repository.resetFailedProcessing.mockResolvedValue(false);

    await expect(service.prepareRetry('u1', 'entry-1')).resolves.toEqual({
      processing: { status: 'EXTRACTING_VOCALS', progress: 10 },
    });
  });

  it('stores a tagged source under an owner-scoped content hash', async () => {
    subscriptions.hasPaidMembership.mockResolvedValue(true);
    audio.inspect.mockResolvedValue({
      durationMs: 12_000,
      title: '',
      artist: '',
    });
    audio.hash.mockResolvedValue('ab12');
    storage.putPrivateFile.mockResolvedValue(undefined);
    repository.save.mockResolvedValue({
      id: 'entry-1',
      title: 'original song.flac',
      artist: '',
      durationMs: 12_000,
      createdAt: new Date('2026-01-02T03:04:05.000Z'),
    });
    await expect(
      service.submit('u1', {
        path: '/tmp/upload',
        originalname: 'original song.flac',
      }),
    ).resolves.toEqual({
      id: 'entry-1',
      title: 'original song.flac',
      artist: '',
      durationMs: 12_000,
      createdAt: '2026-01-02T03:04:05.000Z',
    });
    const uploaded = storage.putPrivateFile.mock.calls[0]?.[0];
    const saved = repository.save.mock.calls[0]?.[0];
    if (!uploaded) throw new Error('Expected the private audio source');
    if (!saved) throw new Error('Expected the candidate private track row');
    expect(uploaded.key).toBe(`private-tracks/u1/${saved.id}/source`);
    expect(storage.putPrivateFile).toHaveBeenCalledWith({
      key: uploaded.key,
      filePath: '/tmp/upload',
      contentType: 'application/octet-stream',
    });
    expect(repository.save).toHaveBeenCalledWith({
      id: expect.any(String),
      userId: 'u1',
      contentSha256: 'ab12',
      objectKey: `private-tracks/u1/${saved.id}/source`,
      originalFilename: 'original song.flac',
      title: 'original song.flac',
      artist: '',
      durationMs: 12_000,
    });
  });

  it('uses title and artist tags when present', async () => {
    subscriptions.hasPaidMembership.mockResolvedValue(true);
    audio.inspect.mockResolvedValue({
      durationMs: 12_000,
      title: 'Tagged title',
      artist: 'Tagged artist',
    });
    audio.hash.mockResolvedValue('cd34');
    storage.putPrivateFile.mockResolvedValue(undefined);
    repository.save.mockResolvedValue({
      id: 'entry-2',
      title: 'Tagged title',
      artist: 'Tagged artist',
      durationMs: 12_000,
      createdAt: new Date('2026-01-02T03:04:05.000Z'),
    });
    await service.submit('u1', {
      path: '/tmp/upload',
      originalname: 'filename.mp3',
    });
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Tagged title',
        artist: 'Tagged artist',
      }),
    );
  });
});
