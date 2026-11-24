import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PrivateTrackDetail } from '@vozzify/contracts';
import { json, readBody } from './fake-api-http.ts';
import { SIGNED_IN_COOKIE } from './fake-track-api.ts';

type PrivateTrackMockState = Pick<PrivateTrackDetail, 'id' | 'ownerId'> & {
  detail: PrivateTrackDetail;
};

const privateTracks = new Map<string, PrivateTrackDetail>();

export async function setPrivateTrackMock(
  detail: PrivateTrackDetail,
  baseUrl = 'http://127.0.0.1:3333',
): Promise<void> {
  const response = await fetch(`${baseUrl}/__private-track-mock/set`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: detail.id, ownerId: detail.ownerId, detail }),
  });
  if (!response.ok) {
    throw new Error(`setPrivateTrackMock failed with ${response.status}`);
  }
}

export async function setPrivateTrackMockFromRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const state = (await readBody(request)) as PrivateTrackMockState;
  if (state.detail.id !== state.id || state.detail.ownerId !== state.ownerId) {
    json(response, 400, { code: 'VALIDATION_FAILED' }, request);
    return;
  }
  privateTracks.set(state.id, state.detail);
  json(response, 200, { ok: true }, request);
}

export function servePrivateTrack(
  id: string,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  const track = privateTracks.get(id);
  const signedIn = (request.headers.cookie ?? '').includes(
    `${SIGNED_IN_COOKIE.name}=${SIGNED_IN_COOKIE.value}`,
  );
  if (!track || !signedIn || track.ownerId !== 'usr_ada') {
    json(
      response,
      404,
      {
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Private track not found',
      },
      request,
    );
    return;
  }
  response.setHeader('cache-control', 'private, no-store');
  json(response, 200, track, request);
}

export async function servePrivateTrackRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (request.method === 'POST' && pathname === '/__private-track-mock/set') {
    await setPrivateTrackMockFromRequest(request, response);
    return true;
  }
  const match = /^\/v1\/me\/private-tracks\/([^/]+)$/.exec(pathname);
  if (request.method !== 'GET' || !match?.[1]) return false;
  servePrivateTrack(decodeURIComponent(match[1]), request, response);
  return true;
}
