import { Test } from '@nestjs/testing';
import { HomeFeedBuilder } from './home-feed-builder.service.js';
import {
  HOME_ENTITY_ROW_SOURCES,
  HOME_ROW_SOURCES,
  type HomeEntityRowSource,
  type HomeRowSource,
} from './home-row-sources.js';

const track = (id: string, artist: string) => ({
  id,
  title: `Track ${id}`,
  coverUrl: `https://cdn.example/${id}.webp`,
  artistCredit: [{ name: artist, joinPhrase: '' }],
  durationMs: 180_000,
  vocalRange: { lowest: 60, highest: 72 },
  artistKey: artist,
  hasCover: true,
  isCompleted: true,
});

const tracks = (count: number, prefix = 't') =>
  Array.from({ length: count }, (_, i) =>
    track(`${prefix}${i}`, `Artist ${i}`),
  );

const heroSource = (): HomeRowSource => ({
  id: 'hero',
  layout: 'hero',
  load: async () => tracks(1, 'h'),
});

const trendingSource = (): HomeRowSource => ({
  id: 'trending-today',
  layout: 'standard',
  title: { key: 'home.rows.trendingToday', params: {} },
  load: async () => tracks(6),
});

const genresSource = (names: string[]): HomeEntityRowSource => ({
  id: 'genres',
  layout: 'genres',
  title: { key: 'home.rows.genres', params: {} },
  load: async () => names.map((name) => ({ id: name, name })),
});

const artistsSource = (count: number): HomeEntityRowSource => ({
  id: 'featured-artists',
  layout: 'artists',
  title: { key: 'home.rows.featuredArtists', params: {} },
  load: async () =>
    Array.from({ length: count }, (_, i) => ({
      id: `artist-${i}`,
      name: `Artist ${i}`,
    })),
});

const albumsSource = (count: number): HomeEntityRowSource => ({
  id: 'featured-albums',
  layout: 'albums',
  title: { key: 'home.rows.featuredAlbums', params: {} },
  load: async () =>
    Array.from({ length: count }, (_, i) => ({
      id: `album-${i}`,
      title: `Album ${i}`,
      coverArtUrl: `https://cdn.example/album-${i}.webp`,
      year: 2000 + i,
    })),
});

const albumSnapshotSource = (): HomeEntityRowSource => ({
  id: 'featured-albums',
  layout: 'albums',
  title: { key: 'home.rows.featuredAlbums', params: {} },
  load: async () =>
    Array.from({ length: 6 }, (_, i) => ({
      id: `album-${i}`,
      title: `Album ${i}`,
      coverArtUrl: null,
      year: 2000 + i,
    })),
  loadSnapshot: async () => ({
    items: Array.from({ length: 6 }, (_, i) => ({
      id: `album-${i}`,
      title: `Album ${i}`,
      coverArtUrl: null,
      year: 2000 + i,
    })),
    candidates: [
      {
        id: 'album-candidate',
        title: 'Candidate',
        coverArtUrl: null,
        year: 2000,
        availableTracks: [{ id: 'candidate-track', popularity: 0.4 }],
      },
    ],
  }),
});

const genreNames = (count: number) =>
  Array.from({ length: count }, (_, i) => `Genre ${i}`);

const buildWith = (
  sources: HomeRowSource[],
  entitySources?: HomeEntityRowSource[],
) =>
  Test.createTestingModule({
    providers: [
      HomeFeedBuilder,
      { provide: HOME_ROW_SOURCES, useValue: sources },
      ...(entitySources === undefined
        ? []
        : [{ provide: HOME_ENTITY_ROW_SOURCES, useValue: entitySources }]),
    ],
  })
    .compile()
    .then((moduleRef) => moduleRef.get(HomeFeedBuilder).build());

describe('HomeFeedBuilder entity rows', () => {
  it('stores the bounded Album candidate pool with the public feed snapshot', async () => {
    const feed = await buildWith([heroSource()], [albumSnapshotSource()]);

    expect(feed.albumCandidates).toEqual([
      {
        id: 'album-candidate',
        title: 'Candidate',
        coverArtUrl: null,
        year: 2000,
        availableTracks: [{ id: 'candidate-track', popularity: 0.4 }],
      },
    ]);
  });

  it('appends the genre tiles, artists and albums rows after the Tracks', async () => {
    const feed = await buildWith(
      [heroSource(), trendingSource()],
      [genresSource(genreNames(6)), artistsSource(6), albumsSource(6)],
    );

    expect(feed.rows.map((row) => row.id)).toEqual([
      'hero',
      'trending-today',
      'genres',
      'featured-artists',
      'featured-albums',
    ]);
    const [genres, artists, albums] = feed.rows.slice(2);
    expect(genres).toEqual({
      id: 'genres',
      layout: 'genres',
      title: { key: 'home.rows.genres', params: {} },
      items: genreNames(6).map((name) => ({ name })),
    });
    expect(artists?.layout).toBe('artists');
    expect(albums?.layout).toBe('albums');
    if (albums?.layout !== 'albums') {
      throw new Error('Expected the albums row');
    }
    expect(albums.items).toHaveLength(6);
    expect(albums.items[0]).toEqual({
      id: 'album-0',
      title: 'Album 0',
      coverArtUrl: 'https://cdn.example/album-0.webp',
      year: 2000,
    });
  });

  it('drops an entity row with fewer than six entries', async () => {
    const feed = await buildWith(
      [heroSource(), trendingSource()],
      [genresSource(genreNames(2)), artistsSource(6), albumsSource(6)],
    );

    expect(feed.rows.map((row) => row.id)).toEqual([
      'hero',
      'trending-today',
      'featured-artists',
      'featured-albums',
    ]);
  });

  it('builds the feed without entity sources, as before', async () => {
    const feed = await buildWith([heroSource(), trendingSource()]);

    expect(feed.rows.map((row) => row.id)).toEqual(['hero', 'trending-today']);
  });

  it('drops a Track row of an entity layout instead of misrendering it', async () => {
    const feed = await buildWith([
      heroSource(),
      trendingSource(),
      {
        id: 'genres',
        layout: 'genres',
        title: { key: 'home.rows.genres', params: {} },
        load: async () => tracks(6, 'g'),
      },
    ]);

    expect(feed.rows.map((row) => row.id)).toEqual(['hero', 'trending-today']);
  });

  it('never marks an algorithmic entity row as sponsored', async () => {
    const feed = await buildWith(
      [heroSource(), trendingSource()],
      [genresSource(genreNames(6)), artistsSource(6), albumsSource(6)],
    );

    for (const row of feed.rows) {
      expect(row).not.toHaveProperty('sponsored');
    }
  });
});
