import { Test } from '@nestjs/testing';
import { albumTracksPageSchema } from '@vozzify/contracts';
import { AppException } from '../../common/errors/app-exception.js';
import { TracksService } from '../tracks/tracks.service.js';
import { encodeAlbumTrackCursor } from './album-track-cursor.js';
import { AlbumsRepository } from './albums.repository.js';
import { AlbumsService } from './albums.service.js';

const track = {
  id: 'track-1',
  title: 'Bohemian Rhapsody',
  coverUrl: null,
  lengthMs: 354_000,
  disambiguation: '',
  video: false,
  isrcs: ['GBUM71029604'],
  artists: [{ id: 'artist-1', name: 'Queen' }],
  genres: ['rock'],
  releases: [],
  works: [],
  tags: [],
  externalLinks: [],
};

const placement = {
  trackId: 'track-1',
  discPosition: 1,
  trackPosition: 1,
  discTitle: null,
};

const caught = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => undefined,
    (error: unknown) => error,
  );

describe('AlbumsService tracks', () => {
  let service: AlbumsService;
  const repository = {
    findAlbumById: vi.fn(),
    findAlbumExists: vi.fn(),
    findAlbumIdByLegacyId: vi.fn(),
    findTracksByAlbumId: vi.fn(),
  };
  const tracksService = {
    getCatalogTracks: vi.fn(),
  };

  beforeEach(async () => {
    repository.findAlbumById.mockReset();
    repository.findAlbumExists.mockReset();
    repository.findAlbumIdByLegacyId.mockReset();
    repository.findTracksByAlbumId.mockReset();
    tracksService.getCatalogTracks.mockReset();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AlbumsService,
        { provide: AlbumsRepository, useValue: repository },
        { provide: TracksService, useValue: tracksService },
      ],
    }).compile();
    service = moduleRef.get(AlbumsService);
  });

  it('returns the contracted page with each track on its disc', async () => {
    repository.findAlbumExists.mockResolvedValue(true);
    repository.findTracksByAlbumId.mockResolvedValue({
      placements: [{ ...placement, discTitle: 'Bonus Disc', discPosition: 2 }],
      nextCursor: null,
    });
    tracksService.getCatalogTracks.mockResolvedValue([track]);

    const result = await service.getAlbumTracks('album-1', { limit: 20 });

    expect(repository.findTracksByAlbumId).toHaveBeenCalledWith('album-1', {
      cursor: undefined,
      limit: 20,
    });
    expect(tracksService.getCatalogTracks).toHaveBeenCalledWith(['track-1']);
    expect(result).toEqual({
      items: [{ ...track, disc: { position: 2, title: 'Bonus Disc' } }],
      nextCursor: null,
    });
    expect(albumTracksPageSchema.parse(result)).toEqual(result);
  });

  it('keeps the album order of the placements, not the catalog order', async () => {
    repository.findAlbumExists.mockResolvedValue(true);
    repository.findTracksByAlbumId.mockResolvedValue({
      placements: [
        { ...placement, trackId: 'track-2', trackPosition: 2 },
        { ...placement, trackId: 'track-1', trackPosition: 1 },
      ],
      nextCursor: null,
    });
    tracksService.getCatalogTracks.mockResolvedValue([
      track,
      { ...track, id: 'track-2', title: 'Second' },
    ]);

    const result = await service.getAlbumTracks('album-1', { limit: 20 });

    expect(result.items.map((item) => item.id)).toEqual(['track-2', 'track-1']);
  });

  it('never loads the album header to list its tracks', async () => {
    repository.findAlbumExists.mockResolvedValue(true);
    repository.findTracksByAlbumId.mockResolvedValue({
      placements: [],
      nextCursor: null,
    });
    tracksService.getCatalogTracks.mockResolvedValue([]);

    await service.getAlbumTracks('album-1', { limit: 20 });

    expect(repository.findAlbumById).not.toHaveBeenCalled();
  });

  it('decodes the cursor before listing and encodes the next one', async () => {
    const next = { discPosition: 2, trackPosition: 3, trackId: 'track-7' };
    repository.findAlbumExists.mockResolvedValue(true);
    repository.findTracksByAlbumId.mockResolvedValue({
      placements: [placement],
      nextCursor: next,
    });
    tracksService.getCatalogTracks.mockResolvedValue([track]);
    const cursor = encodeAlbumTrackCursor({
      discPosition: 1,
      trackPosition: 2,
      trackId: 'track-4',
    });

    const result = await service.getAlbumTracks('album-1', {
      cursor,
      limit: 1,
    });

    expect(repository.findTracksByAlbumId).toHaveBeenCalledWith('album-1', {
      cursor: { discPosition: 1, trackPosition: 2, trackId: 'track-4' },
      limit: 1,
    });
    expect(result.nextCursor).toBe(encodeAlbumTrackCursor(next));
  });

  it('answers RESOURCE_MOVED with the new ID for a legacy ID', async () => {
    repository.findAlbumExists.mockResolvedValue(false);
    repository.findAlbumIdByLegacyId.mockResolvedValue('album-1');

    const failure = await caught(
      service.getAlbumTracks('legacy-1', { limit: 20 }),
    );

    expect(failure).toBeInstanceOf(AppException);
    expect(failure).toMatchObject({
      code: 'RESOURCE_MOVED',
      details: { id: 'album-1' },
    });
    expect(repository.findTracksByAlbumId).not.toHaveBeenCalled();
  });

  it('answers a real NOT_FOUND for an ID that is neither an album nor legacy', async () => {
    repository.findAlbumExists.mockResolvedValue(false);
    repository.findAlbumIdByLegacyId.mockResolvedValue(undefined);

    const failure = await caught(
      service.getAlbumTracks('unknown', { limit: 20 }),
    );

    expect(failure).toMatchObject({ code: 'NOT_FOUND' });
    expect(repository.findTracksByAlbumId).not.toHaveBeenCalled();
  });

  it('rejects an invalid cursor with a validation error', async () => {
    repository.findAlbumExists.mockResolvedValue(true);

    const failure = await caught(
      service.getAlbumTracks('album-1', { cursor: 'track-1', limit: 20 }),
    );

    expect(failure).toBeInstanceOf(AppException);
    expect(failure).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(repository.findTracksByAlbumId).not.toHaveBeenCalled();
  });
});
