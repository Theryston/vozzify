import { Test } from '@nestjs/testing';
import { catalogTracksPageSchema } from '@vozzify/contracts';
import { AppException } from '../../common/errors/app-exception.js';
import { TracksService } from '../tracks/tracks.service.js';
import { ArtistsRepository } from './artists.repository.js';
import { ArtistsService } from './artists.service.js';

const artist = {
  id: 'artist-1',
  mbid: '00000000-0000-4000-8000-000000001001',
  name: 'Queen',
  genres: ['rock'],
  trackCount: 1,
};

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
};

describe('ArtistsService tracks', () => {
  let service: ArtistsService;
  const repository = {
    findArtistById: vi.fn(),
    findArtistIdByLegacyId: vi.fn(),
    findTracksByArtistId: vi.fn(),
  };
  const tracksService = {
    getCatalogTracks: vi.fn(),
  };

  beforeEach(async () => {
    repository.findArtistById.mockReset();
    repository.findArtistIdByLegacyId.mockReset();
    repository.findTracksByArtistId.mockReset();
    tracksService.getCatalogTracks.mockReset();
    tracksService.getCatalogTracks.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ArtistsService,
        { provide: ArtistsRepository, useValue: repository },
        { provide: TracksService, useValue: tracksService },
      ],
    }).compile();
    service = moduleRef.get(ArtistsService);
  });

  it('returns the contracted page for a known artist', async () => {
    repository.findArtistById.mockResolvedValue(artist);
    repository.findTracksByArtistId.mockResolvedValue({
      trackIds: [track.id],
      nextCursor: null,
    });
    tracksService.getCatalogTracks.mockResolvedValue([track]);

    const result = await service.getArtistTracks('artist-1', { limit: 20 });

    expect(repository.findTracksByArtistId).toHaveBeenCalledWith('artist-1', {
      cursorTrackId: undefined,
      limit: 20,
    });
    expect(tracksService.getCatalogTracks).toHaveBeenCalledWith(['track-1']);
    expect(result).toEqual({ items: [track], nextCursor: null });
    expect(catalogTracksPageSchema.parse(result)).toEqual(result);
  });

  it('decodes an opaque cursor before listing', async () => {
    repository.findArtistById.mockResolvedValue(artist);
    repository.findTracksByArtistId.mockResolvedValue({
      trackIds: [],
      nextCursor: null,
    });
    const cursor = Buffer.from('track-1', 'utf8').toString('base64url');

    await service.getArtistTracks('artist-1', { cursor, limit: 2 });

    expect(repository.findTracksByArtistId).toHaveBeenCalledWith('artist-1', {
      cursorTrackId: 'track-1',
      limit: 2,
    });
  });

  it('answers RESOURCE_MOVED with the new ID for a legacy ID', async () => {
    repository.findArtistById.mockResolvedValue(undefined);
    repository.findArtistIdByLegacyId.mockResolvedValue('artist-1');

    const failure = await service
      .getArtistTracks('legacy-1', { limit: 20 })
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(failure).toBeInstanceOf(AppException);
    expect((failure as AppException).code).toBe('RESOURCE_MOVED');
  });

  it('answers NOT_FOUND for an unknown ID', async () => {
    repository.findArtistById.mockResolvedValue(undefined);
    repository.findArtistIdByLegacyId.mockResolvedValue(undefined);

    const failure = await service
      .getArtistTracks('missing', { limit: 20 })
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(failure).toBeInstanceOf(AppException);
    expect((failure as AppException).code).toBe('NOT_FOUND');
  });

  it('rejects an invalid cursor with a validation error', async () => {
    repository.findArtistById.mockResolvedValue(artist);

    const failure = await service
      .getArtistTracks('artist-1', { cursor: '!!!', limit: 20 })
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(failure).toBeInstanceOf(AppException);
    expect((failure as AppException).code).toBe('VALIDATION_FAILED');
    expect(repository.findTracksByArtistId).not.toHaveBeenCalled();
  });

  it.each(['track-1', 'ab'])(
    'rejects the non-canonical cursor %j with a validation error',
    async (cursor) => {
      repository.findArtistById.mockResolvedValue(artist);

      const failure = await service
        .getArtistTracks('artist-1', { cursor, limit: 20 })
        .then(
          () => undefined,
          (error: unknown) => error,
        );

      expect(failure).toBeInstanceOf(AppException);
      expect((failure as AppException).code).toBe('VALIDATION_FAILED');
      expect(repository.findTracksByArtistId).not.toHaveBeenCalled();
    },
  );
});
