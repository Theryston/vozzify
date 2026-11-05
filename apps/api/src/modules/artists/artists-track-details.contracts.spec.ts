import {
  catalogTrackExternalLinkSchema,
  catalogTrackReleaseSchema,
  catalogTrackSchema,
  catalogTrackTagSchema,
  catalogTrackWorkSchema,
} from '@vozzify/contracts';
import { testMbid } from '../../../test/utils/factories.js';

// Locks the MusicBrainz sections of a track entry: releases, works, tags
// and external links travel with every nested track, empty when the
// catalog has none.
describe('artist track details contracts', () => {
  const base = {
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

  it('parses an entry with its deeper sections', () => {
    const track = {
      ...base,
      releases: [
        {
          mbid: testMbid(2101),
          title: 'A Night at the Opera',
          year: 1975,
          coverArtUrl: 'https://coverartarchive.org/release/2101/front-500',
        },
      ],
      works: [{ mbid: testMbid(3101), title: 'Bohemian Rhapsody work' }],
      tags: [{ name: 'rock', count: 10 }],
      externalLinks: [
        { url: 'https://open.spotify.com/track/123', linkType: 'streaming' },
      ],
    };

    expect(catalogTrackSchema.parse(track)).toEqual(track);
  });

  it('parses an entry without the deeper sections', () => {
    expect(catalogTrackSchema.parse(base)).toEqual(base);
  });

  it('parses an entry with empty sections', () => {
    const track = {
      ...base,
      releases: [],
      works: [],
      tags: [],
      externalLinks: [],
    };

    expect(catalogTrackSchema.parse(track)).toEqual(track);
  });

  it('parses a release without year or cover art', () => {
    expect(
      catalogTrackReleaseSchema.parse({
        mbid: testMbid(2102),
        title: 'Greatest Hits',
        year: null,
        coverArtUrl: null,
      }),
    ).toEqual({
      mbid: testMbid(2102),
      title: 'Greatest Hits',
      year: null,
      coverArtUrl: null,
    });
  });

  it('parses a work, a tag and a link', () => {
    expect(
      catalogTrackWorkSchema.parse({
        mbid: testMbid(3101),
        title: 'Work',
      }),
    ).toBeDefined();
    expect(
      catalogTrackTagSchema.parse({ name: 'rock', count: 3 }),
    ).toBeDefined();
    expect(
      catalogTrackExternalLinkSchema.parse({
        url: 'https://musicbrainz.org/recording/1',
        linkType: 'musicbrainz',
      }),
    ).toBeDefined();
  });

  it.each([
    {
      releases: [
        { mbid: 'not-a-uuid', title: 'Bad', year: null, coverArtUrl: null },
      ],
    },
    { works: [{ mbid: testMbid(1), title: '' }] },
    { tags: [{ name: '', count: 1 }] },
    { externalLinks: [{ url: '', linkType: 'streaming' }] },
  ])('rejects the invalid details %j', (overrides) => {
    expect(() => catalogTrackSchema.parse({ ...base, ...overrides })).toThrow();
  });
});
