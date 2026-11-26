import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  PracticeAttemptHistoryItem,
  SubmitPracticeAttemptBody,
} from '@vozzify/contracts';

import { json, readBody } from './fake-api-http.ts';
import {
  canReadSection,
  hiddenSectionReply,
  ownerOf,
  ownerReadFails,
  sectionDelay,
} from './fake-user-visibility.ts';

export const privatePracticeTrack = {
  id: 'private-practice-rehearsal',
  title: 'Rehearsal take with an A4',
  artist: 'Studio rehearsal',
};
let privateRun: PracticeAttemptHistoryItem | undefined;

/** The page size the API answers with by default (`limit` is 20 in the page). */
const PAGE_SIZE = 20;

/** Runs in the history of the Profile, newest first. */
const RUN_COUNT = 23;

/** The first run is at this instant; each older run is two hours earlier. */
const NEWEST_AT = Date.parse('2026-10-19T09:00:00.000Z');
const TWO_HOURS = 2 * 3_600_000;

/** The accuracy of the n-th run, cycling through hit, near and miss. */
const accuracyOf = (index: number): number => [0.92, 0.7, 0.4][index % 3] ?? 0;

/** The runs of the one Profile this fake serves (`ada_lovelace`), newest first. */
const runs = Array.from({ length: RUN_COUNT }, (_, index) => {
  const createdAt = new Date(NEWEST_AT - index * TWO_HOURS).toISOString();
  return {
    id: `run-${index + 1}`,
    trackId: `track-${index + 1}`,
    difficulty: ['EASY', 'NORMAL', 'HARD'][index % 3],
    octaveMode: index % 2 === 0 ? 'ANY' : 'EXACT',
    // Song 1 is +2, Song 2 +1, Song 3 -1, Song 4 -3 and Song 5 the original key.
    transposeSemitones: [2, 1, -1, -3, 0][index % 5] ?? 0,
    speed: 1,
    accuracy: accuracyOf(index),
    coverage: 0.95,
    forwardSkip: false,
    // The second-newest run is flagged, so one row carries the marker.
    bleedSuspected: index === 1,
    startedAt: createdAt,
    endedAt: createdAt,
    createdAt,
    track: {
      id: `track-${index + 1}`,
      title: `Song ${index + 1}`,
      coverUrl: null,
      artistCredit: [{ name: 'Ada Artist', joinPhrase: '' }],
    },
  };
});

/** `/v1/users/:username/attempts`, the public history path (any casing). */
const isUserAttemptsPath = (pathname: string): boolean =>
  /^\/v1\/users\/[^/]+\/attempts$/.test(pathname);

/**
 * Serves one page of the Profile's history: the cursor is the offset of the
 * next run, `nextCursor` is null on the last page. Any other username is the
 * API's `NOT_FOUND` envelope.
 */
async function serveUserAttempts(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
): Promise<void> {
  const username = decodeURIComponent(
    pathname.split('/').slice(3, -1).join('/'),
  );
  if (!canReadSection(request, username.toLowerCase(), 'practiceHistory')) {
    hiddenSectionReply(request, response);
    return;
  }
  if (ownerReadFails(request, username.toLowerCase(), 'practiceHistory')) {
    json(
      response,
      500,
      { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Broken on purpose' },
      request,
    );
    return;
  }
  await sectionDelay();
  if (
    ['visibility_owner', 'katherine_johnson'].includes(username.toLowerCase())
  ) {
    json(response, 200, { items: [], nextCursor: null }, request);
    return;
  }
  if (username.toLowerCase() !== 'ada_lovelace') {
    json(
      response,
      404,
      { statusCode: 404, code: 'NOT_FOUND', message: 'User not found' },
      request,
    );
    return;
  }
  const url = new URL(request.url ?? '/', 'http://fake.local');
  const limit = Number(url.searchParams.get('limit') ?? PAGE_SIZE);
  const offset = Number(url.searchParams.get('cursor') ?? 0);
  const visible =
    privateRun &&
    ownerOf(request) === username &&
    url.searchParams.get('includePrivate') === 'true'
      ? [privateRun, ...runs]
      : runs;
  const items = visible.slice(offset, offset + limit);
  const next = offset + limit;
  json(
    response,
    200,
    { items, nextCursor: next < visible.length ? String(next) : null },
    request,
  );
}

/** The route of `GET /v1/users/:username/attempts` in the fake API's table. */
export const userAttemptsRoute = {
  method: 'GET',
  pathname: isUserAttemptsPath,
  serve: serveUserAttempts,
};

/** Lets the browser spec save a practice run before visiting the Profile. */
export const privateAttemptRoute = {
  method: 'POST',
  pathname: `/v1/me/private-tracks/${privatePracticeTrack.id}/attempts`,
  async serve(request: IncomingMessage, response: ServerResponse) {
    if (ownerOf(request) !== 'ada_lovelace') {
      hiddenSectionReply(request, response);
      return;
    }
    const body = (await readBody(request)) as SubmitPracticeAttemptBody;
    const { id, title, artist } = privatePracticeTrack;
    const attempt = {
      ...body,
      id: 'private-fixture-attempt',
      trackId: id,
      createdAt: new Date().toISOString(),
      isPrivate: true as const,
    };
    privateRun = {
      ...attempt,
      track: {
        id,
        title,
        coverUrl: null,
        artistCredit: [{ name: artist, joinPhrase: '' }],
      },
    };
    json(response, 201, attempt, request);
  },
};
