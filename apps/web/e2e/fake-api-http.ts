import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * HTTP helpers for the fake APIs the Playwright suites start (artist and
 * album). Replies are JSON; the CORS headers let the browser call them
 * with cookies, as the real API does.
 */

export const readBody = (request: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(text) as unknown);
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });

/**
 * CORS headers for the reply. The browser calls the API cross-origin with
 * cookies, so it needs its origin echoed with credentials (a `*` origin
 * plus credentials is rejected); server-to-server calls carry no origin
 * and keep the wildcard.
 */
const cors = (request: IncomingMessage): Record<string, string> => {
  const origin = request.headers.origin;
  return origin
    ? {
        'access-control-allow-origin': origin,
        'access-control-allow-credentials': 'true',
      }
    : { 'access-control-allow-origin': '*' };
};

export const json = (
  response: ServerResponse,
  status: number,
  body: unknown,
  request: IncomingMessage,
): void => {
  response.writeHead(status, {
    'content-type': 'application/json',
    ...cors(request),
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers':
      request.headers['access-control-request-headers'] ?? 'content-type',
  });
  response.end(JSON.stringify(body));
};

/** Whether a route's path pattern (`*`, a path or a matcher) accepts `pathname`. */
export const matchesPath = (
  pattern: string | ((pathname: string) => boolean),
  pathname: string,
): boolean =>
  typeof pattern === 'function'
    ? pattern(pathname)
    : pattern === '*' || pattern === pathname;
