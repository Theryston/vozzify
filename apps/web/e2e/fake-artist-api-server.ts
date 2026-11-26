import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { serveAlbumRequest } from './fake-album-api-server.ts';
import { json, matchesPath, readBody } from './fake-api-http.ts';
import { extraFakeRoutes } from './fake-api-routes.ts';
import {
  defaultArtistTracks,
  type FakeTrack,
  paginateFakeTracks,
} from './fake-artist-tracks.ts';
import {
  serveAlbumSitemap,
  serveArtistSitemap,
} from './fake-entity-sitemaps.ts';
import { servePrivateTrackRequest } from './fake-private-track-api.ts';
import {
  tracks as fakeTracks,
  serveSession,
  serveTrackRequest,
} from './fake-track-api.ts';
import { serveSitemap, sitemapTracks } from './fake-track-sitemap.ts';
import { serveUserSitemap } from './fake-user-sitemap.ts';

/**
 * Fake API for server-rendered entity, private-track and legacy-route tests.
 *
 * Run directly: `node e2e/fake-artist-api-server.ts` (Node 26 strips
 * types). Specs import {@link defaultArtist} and
 * {@link setArtistMock} so the file stays in the dependency graph.
 */

export type FakeArtist = {
  id: string;
  mbid: string;
  name: string;
  genres: string[];
  trackCount: number;
  /** Artificial latency per reply, so the loading skeleton can be seen. */
  delayMs?: number;
};

export type ArtistMockState = {
  artists?: FakeArtist[];
  legacyMap?: Record<string, string>;
  tracksByArtist?: Record<string, FakeTrack[]>;
  /** Artists whose track list answers a fixed error (error-UI specs). */
  tracksErrorByArtist?: Record<string, { status: number; code: string }>;
};

/** Resolves the legacy-routes sample without any per-test setup. */
export const defaultArtist: FakeArtist = {
  id: 'clx456def',
  mbid: '00000000-0000-4000-8000-000000001001',
  name: 'Queen',
  genres: ['rock', 'pop'],
  trackCount: 2,
};

const defaultLegacyMap: Record<string, string> = {
  'legacy-queen-1': defaultArtist.id,
};

const artists = new Map<string, FakeArtist>();
const legacyMap = new Map<string, string>();
const tracksByArtist = new Map<string, FakeTrack[]>();
const tracksErrorByArtist = new Map<string, { status: number; code: string }>();

const resetDefaults = (): void => {
  artists.clear();
  legacyMap.clear();
  tracksByArtist.clear();
  artists.set(defaultArtist.id, { ...defaultArtist });
  tracksByArtist.set(defaultArtist.id, [...defaultArtistTracks]);
  for (const [legacyId, artistId] of Object.entries(defaultLegacyMap)) {
    legacyMap.set(legacyId, artistId);
  }
};

resetDefaults();

const notFound = (request: IncomingMessage, response: ServerResponse): void =>
  json(
    response,
    404,
    {
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Artist not found',
    },
    request,
  );

const serveArtist = async (
  id: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> => {
  const artist = artists.get(id);
  if (artist) {
    if (artist.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, artist.delayMs));
    }
    const { delayMs: _ignored, ...body } = artist;
    json(response, 200, body, request);
    return;
  }
  const newId = legacyMap.get(id);
  if (newId) {
    json(
      response,
      404,
      {
        statusCode: 404,
        code: 'RESOURCE_MOVED',
        message: 'Artist moved',
        details: { id: newId },
      },
      request,
    );
    return;
  }
  notFound(request, response);
};

const serveArtistTracks = (
  id: string,
  search: URLSearchParams,
  request: IncomingMessage,
  response: ServerResponse,
): void => {
  if (!artists.get(id)) {
    const newId = legacyMap.get(id);
    if (newId) {
      json(
        response,
        404,
        {
          statusCode: 404,
          code: 'RESOURCE_MOVED',
          message: 'Artist moved',
          details: { id: newId },
        },
        request,
      );
      return;
    }
    notFound(request, response);
    return;
  }
  const failure = tracksErrorByArtist.get(id);
  if (failure) {
    json(
      response,
      failure.status,
      {
        statusCode: failure.status,
        code: failure.code,
        message: 'Fake tracks failure',
      },
      request,
    );
    return;
  }
  const page = paginateFakeTracks(tracksByArtist.get(id) ?? [], search);
  json(response, page.status, page.body, request);
};

const serveMockSet = async (
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> => {
  const state = (await readBody(request)) as ArtistMockState;
  for (const artist of state.artists ?? []) artists.set(artist.id, artist);
  for (const [legacyId, artistId] of Object.entries(state.legacyMap ?? {})) {
    legacyMap.set(legacyId, artistId);
  }
  for (const [artistId, tracks] of Object.entries(state.tracksByArtist ?? {})) {
    tracksByArtist.set(artistId, tracks);
  }
  for (const [artistId, failure] of Object.entries(
    state.tracksErrorByArtist ?? {},
  )) {
    tracksErrorByArtist.set(artistId, failure);
  }
  json(response, 200, { ok: true }, request);
};

/**
 * Point the e2e Next server at this fake by setting its fixtures:
 * upserts artists, tracks and legacy mappings (merged, never reset, so
 * parallel workers with distinct IDs never race).
 */
export const setArtistMock = async (
  state: ArtistMockState,
  baseUrl = 'http://127.0.0.1:3333',
): Promise<void> => {
  const response = await fetch(`${baseUrl}/__artist-mock/set`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(state),
  });
  if (!response.ok) {
    throw new Error(`setArtistMock failed with ${response.status}`);
  }
};

type Route = {
  method: string;
  pathname: string | ((pathname: string) => boolean);
  serve: (
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
  ) => Promise<void>;
};

const routes: Route[] = [
  {
    method: 'OPTIONS',
    pathname: '*',
    serve: (request, response) => {
      json(response, 204, {}, request);
      return Promise.resolve();
    },
  },
  {
    method: 'GET',
    pathname: '/__health',
    serve: (request, response) => {
      json(response, 200, { ok: true }, request);
      return Promise.resolve();
    },
  },
  {
    method: 'POST',
    pathname: '/__artist-mock/set',
    serve: (request, response) => serveMockSet(request, response),
  },
  {
    method: 'GET',
    pathname: '/v1/sitemaps/albums',
    serve: serveAlbumSitemap,
  },
  {
    method: 'GET',
    pathname: '/v1/sitemaps/artists',
    serve: serveArtistSitemap,
  },
  {
    method: 'GET',
    pathname: '/v1/sitemaps/users',
    serve: serveUserSitemap,
  },
  ...extraFakeRoutes,
];

const serveRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  host: string,
  port: number,
): Promise<void> => {
  const url = new URL(request.url ?? '/', `http://${host}:${port}`);
  for (const route of routes) {
    if (route.method !== request.method) continue;
    if (!matchesPath(route.pathname, url.pathname)) continue;
    await route.serve(request, response, url.pathname);
    return;
  }
  if (await servePrivateTrackRequest(request, response, url.pathname)) return;
  const tracksMatch = /^\/v1\/artists\/([^/]+)\/tracks$/.exec(url.pathname);
  if (tracksMatch?.[1] && request.method === 'GET') {
    serveArtistTracks(
      decodeURIComponent(tracksMatch[1]),
      url.searchParams,
      request,
      response,
    );
    return;
  }
  const match = /^\/v1\/artists\/([^/]+)$/.exec(url.pathname);
  if (match?.[1] && request.method === 'GET') {
    await serveArtist(decodeURIComponent(match[1]), request, response);
    return;
  }
  if (
    await serveAlbumRequest(request, response, url.pathname, url.searchParams)
  )
    return;
  if (url.pathname === '/v1/auth/get-session') {
    serveSession(request, response);
    return;
  }
  if (url.pathname === '/v1/sitemaps/tracks') {
    serveSitemap([...sitemapTracks, ...fakeTracks.values()], request, response);
    return;
  }
  if (await serveTrackRequest(request, response, url.pathname)) return;
  notFound(request, response);
};

const startFakeArtistApi = (
  port = 3333,
  host = '127.0.0.1',
): Promise<Server> => {
  const server = createServer((request, response) => {
    serveRequest(request, response, host, port).catch(() => {
      if (!response.headersSent) {
        json(
          response,
          500,
          {
            statusCode: 500,
            code: 'INTERNAL_ERROR',
            message: 'Fake artist API failed',
          },
          request,
        );
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(port, host, () => resolve(server));
  });
};

const isMain = (process.argv[1] ?? '').endsWith('fake-artist-api-server.ts');

if (isMain) await startFakeArtistApi(Number(process.argv[2] ?? 3333));
