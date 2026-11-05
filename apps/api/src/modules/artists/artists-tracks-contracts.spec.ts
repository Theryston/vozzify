import {
  cacheTags,
  catalogTrackSchema,
  catalogTracksPageSchema,
} from '@vozzify/contracts';
import { testMbid } from '../../../test/utils/factories.js';

// Locks the nested track-list contract: one entry per processed Recording
// with its core fields, cursor-paginated, and the cache tag the web caches
// it with.
describe('artist tracks contracts', () => {
  const track = {
    id: 'track-1',
    title: 'Bohemian Rhapsody',
    coverUrl: null,
    lengthMs: 354_000,
    disambiguation: '',
    video: false,
    isrcs: ['GBUM71029604'],
    artists: [{ id: 'artist-1', name: 'Queen' }],
    genres: ['rock', 'pop'],
  };

  it('parses a core track entry', () => {
    expect(catalogTrackSchema.parse(track)).toEqual(track);
  });

  it('parses an entry without optional display data', () => {
    const minimal = {
      id: 'track-2',
      title: 'Unknown Take',
      coverUrl: null,
      lengthMs: null,
      disambiguation: 'live',
      video: true,
      isrcs: [],
      artists: [{ id: 'artist-1', name: 'Queen' }],
      genres: [],
    };

    expect(catalogTrackSchema.parse(minimal)).toEqual(minimal);
  });

  it.each([
    { title: '' },
    { lengthMs: -1 },
    { artists: [] },
    { artists: [{ id: 'artist-1', name: '' }] },
    { genres: [''] },
  ])('rejects the invalid track %j', (overrides) => {
    expect(() =>
      catalogTrackSchema.parse({
        id: 'track-1',
        title: 'Bohemian Rhapsody',
        coverUrl: null,
        lengthMs: null,
        disambiguation: '',
        video: false,
        isrcs: [],
        artists: [{ id: 'artist-1', name: 'Queen' }],
        genres: [],
        ...overrides,
      }),
    ).toThrow();
  });

  it('parses a cursor page with an opaque cursor', () => {
    const page = {
      items: [
        {
          ...track,
          id: 'track-1',
          title: 'First',
        },
      ],
      nextCursor: Buffer.from('track-1', 'utf8').toString('base64url'),
    };

    expect(catalogTracksPageSchema.parse(page)).toEqual(page);
  });

  it('parses the end of the listing', () => {
    expect(
      catalogTracksPageSchema.parse({ items: [], nextCursor: null }),
    ).toEqual({ items: [], nextCursor: null });
  });

  it('builds a deterministic tracks tag per artist', () => {
    expect(cacheTags.artistTracks('artist-1')).toBe('artist:artist-1:tracks');
    expect(cacheTags.artistTracks('artist-1')).not.toBe(
      cacheTags.artist('artist-1'),
    );
  });

  it('uses a valid MBID fixture for linked entries', () => {
    expect(() => testMbid(7)).not.toThrow();
  });
});
