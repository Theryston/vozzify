/**
 * Fake track-grid fixtures for the artist Playwright suite.
 *
 * Kept separate so `fake-artist-api-server.ts` stays under the file-size
 * gate: pure pagination over in-memory tracks, no HTTP here.
 */

type FakeTrackRelease = {
  mbid: string;
  title: string;
  year: number | null;
  coverArtUrl: string | null;
};

type FakeTrackWork = { mbid: string; title: string };

type FakeTrackTag = { name: string; count: number };

type FakeTrackExternalLink = { url: string; linkType: string };

export type FakeTrack = {
  id: string;
  title: string;
  coverUrl: string | null;
  lengthMs: number | null;
  disambiguation: string;
  video: boolean;
  isrcs: string[];
  artists: { id: string; name: string }[];
  genres: string[];
  releases?: FakeTrackRelease[];
  works?: FakeTrackWork[];
  tags?: FakeTrackTag[];
  externalLinks?: FakeTrackExternalLink[];
};

export const defaultArtistTracks: FakeTrack[] = [
  {
    id: 'track-default-1',
    title: 'Bohemian Rhapsody',
    coverUrl: 'https://coverartarchive.org/release/2101/front-500',
    lengthMs: 354_000,
    disambiguation: '',
    video: false,
    isrcs: ['GBUM71029604'],
    artists: [{ id: 'clx456def', name: 'Queen' }],
    genres: ['rock'],
    releases: [
      {
        mbid: '00000000-0000-4000-8000-000000002101',
        title: 'A Night at the Opera',
        year: 1975,
        coverArtUrl: 'https://coverartarchive.org/release/2101/front-500',
      },
    ],
    works: [
      {
        mbid: '00000000-0000-4000-8000-000000003101',
        title: 'Bohemian Rhapsody work',
      },
    ],
    tags: [{ name: 'rock', count: 10 }],
    externalLinks: [
      { url: 'https://open.spotify.com/track/123', linkType: 'streaming' },
    ],
  },
  {
    id: 'track-default-2',
    title: 'Another One',
    coverUrl: null,
    lengthMs: 210_000,
    disambiguation: '',
    video: false,
    isrcs: [],
    artists: [{ id: 'clx456def', name: 'Queen' }],
    genres: ['pop'],
    releases: [],
    works: [],
    tags: [],
    externalLinks: [],
  },
];

const encodeTrackCursor = (id: string): string =>
  Buffer.from(id, 'utf8').toString('base64url');

const decodeTrackCursor = (cursor: string): string | undefined => {
  try {
    const id = Buffer.from(cursor, 'base64url').toString('utf8');
    if (
      id.length === 0 ||
      id.length > 128 ||
      Buffer.from(id, 'utf8').toString('base64url') !== cursor
    ) {
      return undefined;
    }
    return id;
  } catch {
    return undefined;
  }
};

export type FakeTracksPage =
  | { status: 200; body: { items: FakeTrack[]; nextCursor: string | null } }
  | { status: 400; body: { statusCode: 400; code: string; message: string } };

/** Cursor-paginates in-memory tracks in stable `id` order. */
export function paginateFakeTracks(
  allTracks: FakeTrack[],
  search: URLSearchParams,
): FakeTracksPage {
  const all = [...allTracks].sort((a, b) => a.id.localeCompare(b.id));
  const rawLimit = search.get('limit');
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return {
      status: 400,
      body: {
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        message: 'Invalid limit',
      },
    };
  }
  const rawCursor = search.get('cursor');
  const cursorId = rawCursor ? decodeTrackCursor(rawCursor) : undefined;
  if (rawCursor && !cursorId) {
    return {
      status: 400,
      body: {
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        message: 'Invalid cursor',
      },
    };
  }
  const found = cursorId ? all.findIndex((track) => track.id > cursorId) : 0;
  const from = found === -1 ? all.length : found;
  const page = all.slice(from, from + limit);
  const hasMore = from + limit < all.length;
  const last = page[page.length - 1];
  return {
    status: 200,
    body: {
      items: page,
      nextCursor: hasMore && last ? encodeTrackCursor(last.id) : null,
    },
  };
}
