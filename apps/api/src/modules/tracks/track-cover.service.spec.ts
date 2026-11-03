import { Test, type TestingModule } from '@nestjs/testing';
import sharp from 'sharp';
import { CoverArtClient } from '../../integrations/cover-art/cover-art.client.js';
import { StorageService } from '../../integrations/storage/storage.service.js';
import { TrackCoverService } from './track-cover.service.js';
import type { PipelineTrack } from './track-repository.helpers.js';
import { TracksRepository } from './tracks.repository.js';

const track = (overrides: Partial<PipelineTrack> = {}): PipelineTrack => ({
  id: 'track-1',
  title: 'Shape of You',
  lengthMs: 234_000,
  coverUrl: null,
  primaryReleaseMbid: 'original',
  youtubeVideoId: 'aaaaaaaaaaa',
  artistNames: ['Ed Sheeran'],
  externalUrls: [],
  releases: [
    { mbid: 'compilation', title: 'Bravo: The Hits 2017', year: 2017 },
    { mbid: 'original', title: 'Shape of You', year: 2017 },
  ],
  ...overrides,
});
const thumbnail = 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg';
const oldCover = 'https://files.test/track-covers/track-1.webp';
const repairedCover = 'https://files.test/track-covers/track-1/original.webp';
const tracks = {
  findPipelineTrack:
    vi.fn<(trackId: string) => Promise<PipelineTrack | undefined>>(),
  setCover: vi.fn(),
};
const coverArt = {
  fetchReleaseFrontCover: vi.fn(),
  fetchImage: vi.fn(),
};
const storage = {
  putPublicObject: vi.fn(),
  publicUrl: vi.fn((key: string) => `https://files.test/${key}`),
};
const image = async () => ({
  bytes: await sharp({
    create: {
      width: 800,
      height: 800,
      channels: 3,
      background: { r: 200, g: 40, b: 40 },
    },
  })
    .png()
    .toBuffer(),
  contentType: 'image/png',
});

describe('TrackCoverService', () => {
  let service: TrackCoverService;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    vi.resetAllMocks();
    storage.publicUrl.mockImplementation((key) => `https://files.test/${key}`);
    moduleRef = await Test.createTestingModule({
      providers: [
        TrackCoverService,
        { provide: TracksRepository, useValue: tracks },
        { provide: CoverArtClient, useValue: coverArt },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();
    service = moduleRef.get(TrackCoverService);
    tracks.findPipelineTrack.mockResolvedValue(track());
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('stores nothing for a Track that is unknown or has a cover already', async () => {
    tracks.findPipelineTrack.mockResolvedValueOnce(undefined);
    await expect(service.storeCover('track-1')).resolves.toBe(false);
    tracks.findPipelineTrack.mockResolvedValueOnce(
      track({ coverUrl: oldCover }),
    );
    await expect(service.storeCover('track-1')).resolves.toBe(false);
    expect(coverArt.fetchReleaseFrontCover).not.toHaveBeenCalled();
    expect(storage.putPublicObject).not.toHaveBeenCalled();
  });

  it('stores the catalog release even when a same-year compilation sorts first', async () => {
    coverArt.fetchReleaseFrontCover.mockResolvedValue(await image());

    await expect(service.storeCover('track-1')).resolves.toBe(true);

    expect(coverArt.fetchReleaseFrontCover).toHaveBeenCalledWith('original');
    expect(coverArt.fetchImage).not.toHaveBeenCalled();
    expect(storage.putPublicObject).toHaveBeenCalledTimes(1);
    const [stored] = storage.putPublicObject.mock.calls[0] ?? [];
    expect(stored).toMatchObject({
      key: 'track-covers/track-1.webp',
      contentType: 'image/webp',
    });
    const metadata = await sharp(stored.body).metadata();
    expect(metadata.format).toBe('webp');
    expect(Math.max(metadata.width ?? 0, metadata.height ?? 0)).toBe(500);
    expect(tracks.setCover).toHaveBeenCalledWith('track-1', {
      coverUrl: oldCover,
      primaryReleaseMbid: 'original',
    });
    expect(tracks.setCover.mock.invocationCallOrder[0]).toBeGreaterThan(
      storage.putPublicObject.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('uses the selected video thumbnail when the archive has no image', async () => {
    coverArt.fetchImage.mockResolvedValue(await image());
    await expect(service.storeCover('track-1')).resolves.toBe(true);
    expect(coverArt.fetchImage).toHaveBeenCalledExactlyOnceWith(thumbnail);
  });

  it('uses the selected video when the catalog has no release', async () => {
    tracks.findPipelineTrack.mockResolvedValue(
      track({ primaryReleaseMbid: null }),
    );
    coverArt.fetchImage.mockResolvedValue(await image());
    await expect(service.storeCover('track-1')).resolves.toBe(true);
    expect(coverArt.fetchReleaseFrontCover).not.toHaveBeenCalled();
    expect(coverArt.fetchImage).toHaveBeenCalledWith(thumbnail);
  });

  it('stores nothing when neither source has an image', async () => {
    await expect(service.storeCover('track-1')).resolves.toBe(false);
    expect(storage.putPublicObject).not.toHaveBeenCalled();
    expect(tracks.setCover).not.toHaveBeenCalled();
  });

  it('does not request a thumbnail when no video has been chosen', async () => {
    tracks.findPipelineTrack.mockResolvedValue(track({ youtubeVideoId: null }));
    await expect(service.storeCover('track-1')).resolves.toBe(false);
    expect(coverArt.fetchImage).not.toHaveBeenCalled();
  });

  it('rejects downloaded bytes that cannot be decoded', async () => {
    coverArt.fetchReleaseFrontCover.mockResolvedValue({
      bytes: new TextEncoder().encode('not a picture'),
      contentType: 'image/png',
    });
    await expect(service.storeCover('track-1')).resolves.toBe(false);
    expect(storage.putPublicObject).not.toHaveBeenCalled();
    expect(tracks.setCover).not.toHaveBeenCalled();
  });

  describe('repairing existing covers', () => {
    beforeEach(() => {
      tracks.findPipelineTrack.mockResolvedValue(
        track({
          primaryReleaseMbid: null,
          coverUrl: oldCover,
        }),
      );
    });

    it('keeps the recovered identity for a later cover job when no image exists yet', async () => {
      tracks.findPipelineTrack.mockResolvedValue(
        track({
          primaryReleaseMbid: null,
          youtubeVideoId: null,
        }),
      );

      await expect(service.repairCover('track-1', 'original')).resolves.toBe(
        false,
      );

      expect(tracks.setCover).toHaveBeenCalledWith('track-1', {
        coverUrl: null,
        primaryReleaseMbid: 'original',
      });
      tracks.findPipelineTrack.mockResolvedValue(track());
      coverArt.fetchReleaseFrontCover.mockResolvedValue(await image());

      await expect(service.storeCover('track-1')).resolves.toBe(true);

      expect(coverArt.fetchReleaseFrontCover).toHaveBeenLastCalledWith(
        'original',
      );
      expect(coverArt.fetchImage).not.toHaveBeenCalled();
    });

    it('uses a separate key and saves the release identity with its cover', async () => {
      coverArt.fetchReleaseFrontCover.mockResolvedValue(await image());
      await expect(service.repairCover('track-1', 'original')).resolves.toBe(
        true,
      );
      expect(storage.putPublicObject).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'track-covers/track-1/original.webp',
        }),
      );
      expect(tracks.setCover).toHaveBeenCalledWith('track-1', {
        coverUrl: repairedCover,
        primaryReleaseMbid: 'original',
      });
    });

    it('keeps the old cover when the replacement is absent', async () => {
      await expect(service.repairCover('track-1', 'original')).rejects.toThrow(
        'No replacement cover',
      );
      expect(storage.putPublicObject).not.toHaveBeenCalled();
      expect(tracks.setCover).not.toHaveBeenCalled();
    });

    it('preserves the old URL when downloading or uploading fails', async () => {
      coverArt.fetchReleaseFrontCover.mockRejectedValueOnce(
        new Error('download failed'),
      );
      await expect(service.repairCover('track-1', 'original')).rejects.toThrow(
        'download failed',
      );
      coverArt.fetchReleaseFrontCover.mockResolvedValue(await image());
      storage.putPublicObject.mockRejectedValueOnce(new Error('upload failed'));
      await expect(service.repairCover('track-1', 'original')).rejects.toThrow(
        'upload failed',
      );
      expect(tracks.setCover).not.toHaveBeenCalled();
    });

    it('replays a successful repair without downloading or overwriting images', async () => {
      tracks.findPipelineTrack.mockResolvedValue(
        track({ coverUrl: repairedCover }),
      );
      await expect(service.repairCover('track-1', 'original')).resolves.toBe(
        false,
      );
      expect(coverArt.fetchReleaseFrontCover).not.toHaveBeenCalled();
      expect(storage.putPublicObject).not.toHaveBeenCalled();
    });

    it('uses a versioned video fallback when the catalog has no release', async () => {
      coverArt.fetchImage.mockResolvedValue(await image());
      await expect(service.repairCover('track-1', null)).resolves.toBe(true);
      expect(coverArt.fetchReleaseFrontCover).not.toHaveBeenCalled();
      expect(coverArt.fetchImage).toHaveBeenCalledWith(thumbnail);
      expect(tracks.setCover).toHaveBeenCalledWith('track-1', {
        primaryReleaseMbid: null,
        coverUrl:
          'https://files.test/track-covers/track-1/youtube-aaaaaaaaaaa.webp',
      });
    });
  });
});
