import type { IncomingMessage, ServerResponse } from 'node:http';
import { json } from './fake-api-http.ts';
import type { FakeTrack } from './fake-artist-tracks.ts';
import {
  canReadSection,
  hiddenSectionReply,
  ownerReadFails,
  sectionDelay,
} from './fake-user-visibility.ts';

const DEFAULT_LIMIT = 20;

/**
 * A favorite Track. Every other one has a cover, so the grid shows both the
 * cover art and the placeholder. Ids are stable so specs can name them.
 */
const favoriteTrack = (index: number): FakeTrack => {
  const padded = String(index).padStart(2, '0');
  const withCover = index % 2 === 0;
  return {
    id: `fav-track-${padded}`,
    title: `Favorite Song ${padded}`,
    coverUrl: withCover
      ? 'https://coverartarchive.org/release/2101/front-500'
      : null,
    lengthMs: 210_000,
    disambiguation: '',
    video: false,
    isrcs: [],
    artists: [{ id: 'clx456def', name: 'Queen' }],
    genres: ['rock'],
    releases: withCover
      ? [
          {
            mbid: `00000000-0000-4000-8000-0000000045${padded}`,
            title: 'A Night at the Opera',
            year: 1975,
            coverArtUrl: 'https://coverartarchive.org/release/2101/front-500',
          },
        ]
      : [],
  };
};

/**
 * Favorites by lowercased username. `ada_lovelace` has more than one page;
 * `katherine_johnson` has none, so her Profile shows no favorites section.
 */
const favoritesByUsername = new Map<string, FakeTrack[]>([
  [
    'ada_lovelace',
    Array.from({ length: 22 }, (_, index) => favoriteTrack(index)).reverse(),
  ],
  ['katherine_johnson', []],
  [
    'visibility_owner',
    Array.from({ length: 3 }, (_, index) => favoriteTrack(index)).reverse(),
  ],
]);

/** The cursor is the offset of the next page, opaque to the grid. */
const encodeCursor = (offset: number): string =>
  Buffer.from(String(offset), 'utf8').toString('base64url');

const decodeCursor = (cursor: string): number =>
  Number(Buffer.from(cursor, 'base64url').toString('utf8'));

const isUserFavoritesPath = (pathname: string): boolean =>
  /^\/v1\/users\/[^/]+\/favorites$/.test(pathname);

/** Serves one page of a Profile's favorites, newest first, like the API. */
async function serveUserFavorites(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
): Promise<void> {
  const username = decodeURIComponent(
    pathname.slice('/v1/users/'.length, -'/favorites'.length),
  ).toLowerCase();
  if (username === 'broken') {
    json(
      response,
      500,
      { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Broken on purpose' },
      request,
    );
    return;
  }
  if (!canReadSection(request, username, 'favorites')) {
    hiddenSectionReply(request, response);
    return;
  }
  if (ownerReadFails(request, username, 'favorites')) {
    json(
      response,
      500,
      { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Broken on purpose' },
      request,
    );
    return;
  }
  await sectionDelay();
  const favorites = favoritesByUsername.get(username);
  if (!favorites) {
    json(
      response,
      404,
      { statusCode: 404, code: 'NOT_FOUND', message: 'User not found' },
      request,
    );
    return;
  }
  const url = new URL(request.url ?? '/', 'http://fake.local');
  const limit = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT);
  const cursor = url.searchParams.get('cursor');
  const start = cursor ? decodeCursor(cursor) : 0;
  const end = start + limit;
  json(
    response,
    200,
    {
      items: favorites.slice(start, end),
      nextCursor: end < favorites.length ? encodeCursor(end) : null,
    },
    request,
  );
}

/** The route of `GET /v1/users/:username/favorites` in the fake API's table. */
export const userFavoritesRoute = {
  method: 'GET',
  pathname: isUserFavoritesPath,
  serve: serveUserFavorites,
};
