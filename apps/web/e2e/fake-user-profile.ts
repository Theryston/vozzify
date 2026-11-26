import type { IncomingMessage, ServerResponse } from 'node:http';

import type { AvatarIdentity, PublicProfileSummary } from '@vozzify/contracts';

import { json } from './fake-api-http.ts';
import {
  canReadSection,
  hiddenSectionReply,
  ownerReadFails,
  sectionDelay,
} from './fake-user-visibility.ts';

/**
 * The banner fields the fake API serves for one Profile. A chip the User has
 * nothing for is `null`, as the API sends it; unset ones default to `null`.
 */
type FakeProfile = {
  avatarIdentity?: AvatarIdentity;
  name: string;
  image: string | null;
  createdAt: string;
  dailyPracticeTargetSeconds?: number | null;
  vocalRange?: { lowest: number; highest: number } | null;
  mostSungArtist?: { id: string; name: string } | null;
  followersCount?: number;
  followingCount?: number;
  friendsCount?: number;
};

/** Profiles by lowercased username, as the API stores them. */
const profiles = new Map<string, FakeProfile>([
  [
    'studio_admin',
    {
      name: 'Lia Costa',
      image: null,
      createdAt: '2026-01-02T03:04:05.000Z',
      avatarIdentity: { pro: true, admin: true },
    },
  ],
  [
    'studio_missing',
    {
      name: 'Lia Costa',
      image: 'http://127.0.0.1:3333/missing-avatar.png',
      createdAt: '2026-01-02T03:04:05.000Z',
      avatarIdentity: { pro: true },
    },
  ],
  [
    'studio_portrait',
    {
      name: 'Lia Costa',
      image:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWMQWbAdjhiI4wAARAIWsbApZEkAAAAASUVORK5CYII=',
      createdAt: '2026-01-02T03:04:05.000Z',
      avatarIdentity: { pro: true },
    },
  ],
  [
    'ada_lovelace',
    {
      name: 'Ada Lovelace',
      image: null,
      createdAt: '2026-01-02T03:04:05.000Z',
    },
  ],
  [
    'katherine_johnson',
    {
      name: 'Katherine Johnson',
      image: null,
      createdAt: '2026-01-02T03:04:05.000Z',
    },
  ],
  [
    'target_only',
    {
      name: 'Target Only',
      image: null,
      createdAt: '2026-05-06T07:08:09.000Z',
      dailyPracticeTargetSeconds: 300,
    },
  ],
  [
    'artist_only',
    {
      name: 'Artist Only',
      image: null,
      createdAt: '2026-05-06T07:08:09.000Z',
      mostSungArtist: { id: 'artist-solo', name: 'Solo Artist' },
    },
  ],
  [
    'range_only',
    {
      name: 'Range Only',
      image: null,
      createdAt: '2026-05-06T07:08:09.000Z',
      vocalRange: { lowest: 40, highest: 64 },
    },
  ],
  [
    'follow_target',
    {
      name: 'Follow Target',
      image: null,
      createdAt: '2026-06-07T08:09:10.000Z',
      followersCount: 2,
    },
  ],
  [
    'visibility_owner',
    {
      name: 'Visibility Owner',
      image: null,
      createdAt: '2026-06-07T08:09:10.000Z',
    },
  ],
  [
    'grace_hopper',
    {
      name: 'Grace Hopper',
      image: null,
      createdAt: '2026-03-04T05:06:07.000Z',
      dailyPracticeTargetSeconds: 900,
      vocalRange: { lowest: 48, highest: 74 },
      mostSungArtist: {
        id: 'artist-orquestra',
        name: 'Orquestra Sinfônica Brasileira de Câmara Antônio Carlos',
      },
    },
  ],
]);

/** `/v1/users/:username`, the Profile banner path (any casing). */
const isUserProfilePath = (pathname: string): boolean =>
  /^\/v1\/users\/[^/]+$/.test(pathname);

/**
 * Serves the banner of a known Profile (any casing), or the API's `NOT_FOUND`
 * envelope for an unknown username. `pathname` is one `isUserProfilePath`
 * accepted.
 */
async function serveUserProfile(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
): Promise<void> {
  const username = decodeURIComponent(pathname.slice('/v1/users/'.length));
  const normalized = username.toLowerCase();
  if (normalized === 'broken') {
    json(
      response,
      500,
      { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Broken on purpose' },
      request,
    );
    return;
  }
  const profile = profiles.get(normalized);
  if (!profile) {
    json(
      response,
      404,
      { statusCode: 404, code: 'NOT_FOUND', message: 'User not found' },
      request,
    );
    return;
  }
  json(
    response,
    200,
    {
      username: normalized,
      dailyPracticeTargetSeconds: null,
      vocalRange: null,
      mostSungArtist: null,
      followersCount: 0,
      followingCount: 0,
      friendsCount: 0,
      ...profile,
    },
    request,
  );
}

/** Summaries by lowercased username, as the API stores them. */
const summaries = new Map<string, PublicProfileSummary>([
  [
    'ada_lovelace',
    {
      streakDays: 4,
      sungCount: 1250,
      favoritesCount: 7,
      contributionsCount: 1,
    },
  ],
  [
    'visibility_owner',
    {
      streakDays: 2,
      sungCount: 5,
      favoritesCount: 3,
      contributionsCount: 1,
    },
  ],
  [
    'grace_hopper',
    {
      streakDays: 1,
      sungCount: 0,
      favoritesCount: 0,
      contributionsCount: 0,
    },
  ],
]);

/** `/v1/users/:username/summary`, the Summary numbers path (any casing). */
const isUserProfileSummaryPath = (pathname: string): boolean =>
  /^\/v1\/users\/[^/]+\/summary$/.test(pathname);

/**
 * Serves the Summary numbers of a known Profile, or the API's `NOT_FOUND`
 * envelope for an unknown username. `pathname` is one
 * `isUserProfileSummaryPath` accepted.
 */
async function serveUserProfileSummary(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
): Promise<void> {
  const username = decodeURIComponent(
    pathname.slice('/v1/users/'.length, -'/summary'.length),
  );
  const normalized = username.toLowerCase();
  if (!canReadSection(request, normalized, 'summary')) {
    hiddenSectionReply(request, response);
    return;
  }
  const summary = summaries.get(normalized);
  if (!summary) {
    json(
      response,
      404,
      { statusCode: 404, code: 'NOT_FOUND', message: 'User not found' },
      request,
    );
    return;
  }
  if (ownerReadFails(request, normalized, 'summary')) {
    json(
      response,
      500,
      { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Broken on purpose' },
      request,
    );
    return;
  }
  // A counter belongs to the section it counts: a visitor is never sent one
  // whose section is hidden, and the owner always is.
  await sectionDelay();
  json(
    response,
    200,
    {
      ...summary,
      sungCount: canReadSection(request, normalized, 'practiceHistory')
        ? summary.sungCount
        : null,
      favoritesCount: canReadSection(request, normalized, 'favorites')
        ? summary.favoritesCount
        : null,
    },
    request,
  );
}

/**
 * The routes of `GET /v1/users/:username` and `GET /v1/users/:username/summary`
 * in the fake API's table: one entry, dispatching on the path.
 */
export const userProfileRoute = {
  method: 'GET',
  pathname: (pathname: string): boolean =>
    isUserProfilePath(pathname) || isUserProfileSummaryPath(pathname),
  serve: (
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
  ): Promise<void> =>
    isUserProfileSummaryPath(pathname)
      ? serveUserProfileSummary(request, response, pathname)
      : serveUserProfile(request, response, pathname),
};
