import {
  albumDiscSchema,
  albumTrackSchema,
  albumTracksPageSchema,
  cacheTags,
} from '@vozzify/contracts';

// Locks the album track listing contract: one entry per processed Recording
// in album order, each carrying the disc it sits on, cursor-paginated, and the
// cache tag the web caches it with.
describe('album tracks contracts', () => {
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
    disc: { position: 2, title: 'Bonus Disc' },
  };

  it('parses an album track with its disc', () => {
    expect(albumTrackSchema.parse(track)).toEqual(track);
  });

  it('parses a track on an untitled disc', () => {
    const untitled = { ...track, disc: { position: 1, title: null } };

    expect(albumTrackSchema.parse(untitled)).toEqual(untitled);
  });

  it('rejects a disc position below 1 (MusicBrainz numbers discs from 1)', () => {
    expect(() => albumDiscSchema.parse({ position: 0, title: null })).toThrow();
  });

  it('parses a cursor page with an opaque cursor', () => {
    const page = { items: [track], nextCursor: 'b3BhcXVlLWN1cnNvcg' };

    expect(albumTracksPageSchema.parse(page)).toEqual(page);
  });

  it('parses the end of the listing', () => {
    const page = { items: [], nextCursor: null };

    expect(albumTracksPageSchema.parse(page)).toEqual(page);
  });

  it('builds a tracks tag per album, apart from the header tag', () => {
    expect(cacheTags.albumTracks('album-1')).toBe('album:album-1:tracks');
    expect(cacheTags.albumTracks('album-1')).not.toBe(
      cacheTags.album('album-1'),
    );
  });
});
