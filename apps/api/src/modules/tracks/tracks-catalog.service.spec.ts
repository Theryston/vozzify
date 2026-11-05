import { Test } from '@nestjs/testing';
import { catalogTrackSchema } from '@vozzify/contracts';
import { TracksRepository } from './tracks.repository.js';
import { TracksService } from './tracks.service.js';

const catalogTrack = (id: string) => ({
  id,
  title: `Track ${id}`,
  coverUrl: null,
  lengthMs: 180_000,
  disambiguation: '',
  video: false,
  isrcs: [],
  artists: [{ id: 'artist-1', name: 'Queen' }],
  genres: [],
  releases: [],
  works: [],
  tags: [],
  externalLinks: [],
});

describe('TracksService catalog details', () => {
  let service: TracksService;
  const repository = {
    findCatalogTracks: vi.fn(),
  };

  beforeEach(async () => {
    repository.findCatalogTracks.mockReset();
    const moduleRef = await Test.createTestingModule({
      providers: [
        TracksService,
        { provide: TracksRepository, useValue: repository },
      ],
    }).compile();
    service = moduleRef.get(TracksService);
  });

  describe('getCatalogTracks', () => {
    it('returns the details in the order of the IDs given', async () => {
      repository.findCatalogTracks.mockResolvedValue([
        catalogTrack('track-1'),
        catalogTrack('track-2'),
      ]);

      const tracks = await service.getCatalogTracks(['track-2', 'track-1']);

      expect(tracks.map((track) => track.id)).toEqual(['track-2', 'track-1']);
      expect(tracks.map((track) => catalogTrackSchema.parse(track))).toEqual(
        tracks,
      );
    });

    it('asks the repository for exactly the IDs given, in one call', async () => {
      repository.findCatalogTracks.mockResolvedValue([]);

      await service.getCatalogTracks(['track-1', 'track-2']);

      expect(repository.findCatalogTracks).toHaveBeenCalledTimes(1);
      expect(repository.findCatalogTracks).toHaveBeenCalledWith([
        'track-1',
        'track-2',
      ]);
    });

    it('leaves out an ID that has no Track', async () => {
      repository.findCatalogTracks.mockResolvedValue([catalogTrack('track-1')]);

      const tracks = await service.getCatalogTracks(['missing', 'track-1']);

      expect(tracks.map((track) => track.id)).toEqual(['track-1']);
    });

    it('returns nothing for no IDs', async () => {
      repository.findCatalogTracks.mockResolvedValue([]);

      await expect(service.getCatalogTracks([])).resolves.toEqual([]);
    });
  });
});
