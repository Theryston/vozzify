import type { IncomingMessage, ServerResponse } from 'node:http';

import type { ProfileSection, ProfileVisibility } from '@vozzify/contracts';

import { json, readBody } from './fake-api-http.ts';

/**
 * Section visibility of the fake API. The Next server reads a Profile's
 * sections with the browser's cookies, so a spec signs its owner in on the
 * server side with {@link OWNER_COOKIE} (the browser session is mocked
 * separately, as for every signed-in spec). A section the owner hid answers
 * the API's `NOT_FOUND` to anyone else, as the real API does.
 */

/** The cookie that signs a request in as the owner of one Profile. */
export const OWNER_COOKIE = 'vozzify-e2e-owner';

/** The API's address, where specs reach the fake to set its state. */
const FAKE_API = 'http://127.0.0.1:3333';

const SHOWN: ProfileVisibility = {
  summary: true,
  practiceHistory: true,
  favorites: true,
};

/** The mock's state: hidden flags, a reply delay, and owner reads that fail. */
type VisibilityMock = {
  visibility: Record<string, ProfileVisibility>;
  delayMs?: number;
  ownerFailing?: ProfileSection[];
};

let state: VisibilityMock = { visibility: {} };

/** The username the request is signed in as the owner of, if any. */
export const ownerOf = (request: IncomingMessage): string | undefined =>
  /(?:^|;\s*)vozzify-e2e-owner=([^;]+)/.exec(request.headers.cookie ?? '')?.[1];

const flagsOf = (username: string): ProfileVisibility =>
  state.visibility[username] ?? SHOWN;

/** Whether the request may read a section: the owner always, a visitor when it is shown. */
export const canReadSection = (
  request: IncomingMessage,
  username: string,
  section: ProfileSection,
): boolean => ownerOf(request) === username || flagsOf(username)[section];

/**
 * Waits as the mock's reply delay asks. The real API is not instant, and a
 * delayed reply is what makes a Suspense fallback show up in the first paint.
 */
export const sectionDelay = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, state.delayMs ?? 0));

/** Whether the mock fails the owner's read of this section (a 500 to the owner). */
export const ownerReadFails = (
  request: IncomingMessage,
  username: string,
  section: ProfileSection,
): boolean =>
  ownerOf(request) === username && !!state.ownerFailing?.includes(section);

/** The API's answer to a visitor who asks for a hidden section. */
export const hiddenSectionReply = (
  request: IncomingMessage,
  response: ServerResponse,
): void => {
  json(
    response,
    404,
    { statusCode: 404, code: 'NOT_FOUND', message: 'Section not found' },
    request,
  );
};

/** `GET /v1/me`: the owner the cookie signs in as, else the API's `UNAUTHORIZED`. */
const serveMe = (request: IncomingMessage, response: ServerResponse): void => {
  const owner = ownerOf(request);
  if (!owner) {
    json(
      response,
      401,
      { statusCode: 401, code: 'UNAUTHORIZED', message: 'No valid session' },
      request,
    );
    return;
  }
  json(
    response,
    200,
    {
      id: `usr_${owner}`,
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      emailVerified: true,
      username: owner,
      image: null,
      role: 'USER',
      createdAt: '2026-01-02T03:04:05.000Z',
      dailyPracticeTargetSeconds: null,
    },
    request,
  );
};

/** `GET /v1/users/:username/sections`: the flags a visitor sees, no data. */
const serveSections = async (
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
): Promise<void> => {
  const username = decodeURIComponent(
    pathname.slice('/v1/users/'.length, -'/sections'.length),
  ).toLowerCase();
  await sectionDelay();
  json(response, 200, flagsOf(username), request);
};

/**
 * `POST /__visibility-mock/set`: replaces the mock's state with the one given.
 * Specs call {@link setProfileVisibilityMock}.
 */
const serveVisibilityMockSet = async (
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> => {
  const body = (await readBody(request)) as VisibilityMock | undefined;
  const visibility: Record<string, ProfileVisibility> = {};
  for (const [username, flags] of Object.entries(body?.visibility ?? {})) {
    visibility[username.toLowerCase()] = flags;
  }
  state = {
    visibility,
    delayMs: body?.delayMs,
    ownerFailing: body?.ownerFailing,
  };
  json(response, 200, { ok: true }, request);
};

/**
 * Sets the hidden flags of the Profiles named (every other Profile shows
 * everything), a delay on the section reads, and sections the owner's reads
 * fail on.
 */
export const setProfileVisibilityMock = async (
  visibility: Record<string, ProfileVisibility>,
  options: { delayMs?: number; ownerFailing?: ProfileSection[] } = {},
): Promise<void> => {
  const response = await fetch(`${FAKE_API}/__visibility-mock/set`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ visibility, ...options }),
  });
  if (!response.ok) {
    throw new Error(`Visibility mock refused (${response.status})`);
  }
};

/** The routes the fake API serves for section visibility. */
export const userVisibilityRoutes = [
  {
    method: 'GET',
    pathname: '/v1/me',
    serve: (request: IncomingMessage, response: ServerResponse) => {
      serveMe(request, response);
      return Promise.resolve();
    },
  },
  {
    method: 'GET',
    pathname: (pathname: string): boolean =>
      /^\/v1\/users\/[^/]+\/sections$/.test(pathname),
    serve: (
      request: IncomingMessage,
      response: ServerResponse,
      pathname: string,
    ) => serveSections(request, response, pathname),
  },
  {
    method: 'POST',
    pathname: '/__visibility-mock/set',
    serve: serveVisibilityMockSet,
  },
];
