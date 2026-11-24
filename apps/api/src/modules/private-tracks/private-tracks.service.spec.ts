import { StorageService } from '../../integrations/storage/storage.service.js';
import { SubscriptionMembershipService } from '../plans/subscription-membership.service.js';
import { PrivateAudioInspector } from './private-audio.js';
import { PrivateTracksRepository } from './private-tracks.repository.js';
import { PrivateTracksService } from './private-tracks.service.js';

describe('PrivateTracksService', () => {
  const repository = { listPage: vi.fn(), save: vi.fn() };
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
    expect(storage.putPrivateFile).toHaveBeenCalledWith({
      key: 'u1/ab12',
      filePath: '/tmp/upload',
      contentType: 'application/octet-stream',
    });
    expect(repository.save).toHaveBeenCalledWith({
      userId: 'u1',
      contentSha256: 'ab12',
      objectKey: 'u1/ab12',
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
