import { createHomeEntityRowSources } from './home-row-sources.js';
import { MIN_TRACKS_PER_GENRE } from './home-rules.js';

const genreCounts = (entries: [string, number][]) =>
  entries.map(([genre, trackCount]) => ({ genre, trackCount }));

const artists = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `artist-${i}`,
    name: `Artist ${i}`,
  }));

const albums = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `album-${i}`,
    title: `Album ${i}`,
    coverArtUrl: `https://cdn.example/album-${i}.webp`,
    year: 2000 + i,
  }));

describe('the entity row sources', () => {
  const repository = {
    findGenreTrackCounts: vi.fn(),
    findPopularArtists: vi.fn(),
    findPopularAlbums: vi.fn(),
    localePracticeEvidence: vi.fn().mockResolvedValue({
      distinctUsers: 0,
      activeDays: 0,
    }),
  };
  const ranking = { rank: vi.fn().mockResolvedValue(undefined) };

  const sourceOf = (id: string) =>
    createHomeEntityRowSources(repository, ranking).find(
      (row) => row.id === id,
    );

  beforeEach(() => {
    vi.resetAllMocks();
    repository.findGenreTrackCounts.mockResolvedValue([]);
    repository.findPopularArtists.mockResolvedValue([]);
    repository.findPopularAlbums.mockResolvedValue([]);
    repository.localePracticeEvidence.mockResolvedValue({
      distinctUsers: 0,
      activeDays: 0,
    });
  });

  it('lists the genres with enough completed Tracks, in the feed order', async () => {
    repository.findGenreTrackCounts.mockResolvedValue(
      genreCounts([
        ['rock', 9],
        ['pop', 5],
        ['lo-fi', MIN_TRACKS_PER_GENRE - 1],
      ]),
    );

    const sources = createHomeEntityRowSources(repository, ranking);
    const genres = sourceOf('genres');

    expect(sources.map((source) => source.id)).toEqual([
      'genres',
      'featured-artists',
      'featured-albums',
    ]);
    expect(genres?.layout).toBe('genres');
    expect(genres?.title).toEqual({ key: 'home.rows.genres', params: {} });
    expect(await genres?.load('en')).toEqual([
      { id: 'rock', name: 'rock' },
      { id: 'pop', name: 'pop' },
    ]);
    expect(repository.findGenreTrackCounts).toHaveBeenCalledWith(60);
  });

  it('lists the popular artists with their pages as destinations', async () => {
    repository.findPopularArtists.mockResolvedValue(artists(2));

    const artistsSource = sourceOf('featured-artists');

    expect(artistsSource?.layout).toBe('artists');
    expect(artistsSource?.title).toEqual({
      key: 'home.rows.featuredArtists',
      params: {},
    });
    expect(await artistsSource?.load('en')).toEqual([
      { id: 'artist-0', name: 'Artist 0' },
      { id: 'artist-1', name: 'Artist 1' },
    ]);
  });

  it('lists the popular albums with their pages as destinations', async () => {
    repository.findPopularAlbums.mockResolvedValue(albums(2));

    const albumsSource = sourceOf('featured-albums');

    expect(albumsSource?.layout).toBe('albums');
    expect(albumsSource?.title).toEqual({
      key: 'home.rows.featuredAlbums',
      params: {},
    });
    expect(await albumsSource?.load('pt-BR')).toEqual([
      {
        id: 'album-0',
        title: 'Album 0',
        coverArtUrl: 'https://cdn.example/album-0.webp',
        year: 2000,
      },
      {
        id: 'album-1',
        title: 'Album 1',
        coverArtUrl: 'https://cdn.example/album-1.webp',
        year: 2001,
      },
    ]);
  });
});
