import type { Album, Artist, TrackDetail } from '@vozzify/contracts';
import { describe, expect, it } from 'vitest';

import {
  albumStructuredData,
  artistStructuredData,
  trackStructuredData,
} from './catalog-structured-data';

const context = {
  siteUrl: new URL('https://vozzify.example'),
  locale: 'pt-BR',
} as const;

const artist: Artist = {
  id: 'queen',
  mbid: '00000000-0000-4000-8000-000000001001',
  name: 'Queen',
  genres: ['rock'],
  trackCount: 2,
};

const album: Album = {
  id: 'opera',
  mbid: '00000000-0000-4000-8000-000000001002',
  title: 'A Night at the Opera',
  primaryType: 'Album',
  secondaryTypes: [],
  year: 1975,
  genres: ['rock'],
  coverArtUrl: 'https://images.example/opera.jpg',
  trackCount: 2,
  artists: [{ id: artist.id, name: artist.name }],
};

const track: TrackDetail = {
  id: 'pressure',
  title: 'Under Pressure',
  coverUrl: 'https://images.example/pressure.jpg',
  artistCredit: [
    { name: 'Queen', joinPhrase: ' & ', artistId: 'queen' },
    { name: 'David Bowie', joinPhrase: '', artistId: null },
  ],
  durationMs: 248_400,
  youtubeVideoId: null,
  contributors: [],
  contributorCount: 0,
  hasNotes: true,
};

describe('catalog structured data', () => {
  it('describes an artist collection without guessing person or band', () => {
    const data = artistStructuredData({ ...context, artist });

    expect(data).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      '@id': 'https://vozzify.example/pt-BR/artists/queen',
      url: 'https://vozzify.example/pt-BR/artists/queen',
      name: 'Queen',
      inLanguage: 'pt-BR',
      about: {
        '@type': 'Thing',
        name: 'Queen',
        url: 'https://vozzify.example/pt-BR/artists/queen',
      },
    });
  });

  it('connects the album to its localized artist and actual cover', () => {
    expect(albumStructuredData({ ...context, album })).toMatchObject({
      '@type': 'MusicAlbum',
      url: 'https://vozzify.example/pt-BR/albums/opera',
      name: 'A Night at the Opera',
      image: album.coverArtUrl,
      byArtist: [
        {
          name: 'Queen',
          url: 'https://vozzify.example/pt-BR/artists/queen',
        },
      ],
    });
  });

  it('does not invent an album image or artist when unknown', () => {
    const data = albumStructuredData({
      ...context,
      album: { ...album, coverArtUrl: null, artists: [] },
    });

    expect(data).not.toHaveProperty('image');
    expect(data.byArtist).toEqual([]);
  });

  it('preserves recording duration precision and known artist links', () => {
    expect(trackStructuredData({ ...context, track })).toMatchObject({
      '@type': 'MusicRecording',
      '@id': 'https://vozzify.example/pt-BR/tracks/pressure',
      url: 'https://vozzify.example/pt-BR/tracks/pressure',
      name: 'Under Pressure',
      image: track.coverUrl,
      duration: 'PT248.4S',
      byArtist: [
        {
          name: 'Queen',
          url: 'https://vozzify.example/pt-BR/artists/queen',
        },
        { name: 'David Bowie' },
      ],
    });
    const data = trackStructuredData({ ...context, track });
    expect(data.byArtist[1]).not.toHaveProperty('url');
  });

  it('omits unknown recording fields and uses the requested locale', () => {
    const data = trackStructuredData({
      ...context,
      locale: 'en',
      track: { ...track, coverUrl: null, durationMs: null, artistCredit: [] },
    });

    expect(data.url).toBe('https://vozzify.example/en/tracks/pressure');
    expect(data).not.toHaveProperty('image');
    expect(data).not.toHaveProperty('duration');
    expect(data.byArtist).toEqual([]);
  });
});
