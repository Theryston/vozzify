import type { AssetProvider } from './provider.js';

const COVER_ART_ARCHIVE_ORIGIN = 'https://coverartarchive.org';
const COVER_PATH = /^((?:release|release-group)\/[0-9a-fA-F-]{36}\/front-500)$/;
const VALID_UUID =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const FRESHNESS_SECONDS = 30 * 24 * 60 * 60;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const originUrlFor = (key: string): URL | undefined => {
  const match = COVER_PATH.exec(key);
  if (!match) return undefined;
  const [kind, mbid, size] = key.split('/');
  if (
    (kind !== 'release' && kind !== 'release-group') ||
    !mbid ||
    !VALID_UUID.test(mbid) ||
    size !== 'front-500'
  ) {
    return undefined;
  }
  return new URL(`${kind}/${mbid}/${size}`, COVER_ART_ARCHIVE_ORIGIN);
};

const requestHeaders = (request: Request): Headers => {
  const headers = new Headers();
  for (const name of [
    'If-Match',
    'If-Modified-Since',
    'If-None-Match',
    'If-Unmodified-Since',
  ]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
};

const allowedRedirect = (url: URL): boolean =>
  url.protocol === 'https:' &&
  !url.username &&
  !url.password &&
  (url.hostname === 'coverartarchive.org' ||
    url.hostname === 'archive.org' ||
    url.hostname.endsWith('.archive.org'));

const fetchCover = async (
  initialUrl: URL,
  headers: Headers,
): Promise<Response> => {
  let currentUrl = initialUrl;
  for (
    let redirectCount = 0;
    redirectCount <= MAX_REDIRECTS;
    redirectCount += 1
  ) {
    const response = await fetch(currentUrl, {
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get('Location');
    try {
      await response.body?.cancel();
    } catch {
      // A redirect body is discarded before following its Location.
    }
    if (!location || redirectCount === MAX_REDIRECTS) {
      return new Response(null, { status: 502 });
    }
    const target = new URL(location, currentUrl);
    if (
      target.protocol === 'http:' &&
      (target.hostname === 'archive.org' ||
        target.hostname.endsWith('.archive.org'))
    ) {
      target.protocol = 'https:';
    }
    if (!allowedRedirect(target)) return new Response(null, { status: 502 });
    currentUrl = target;
  }
  return new Response(null, { status: 502 });
};

export const createCoverArtArchiveProvider = (): AssetProvider => ({
  freshnessSeconds: FRESHNESS_SECONDS,
  cacheMode: 'fixed-ttl',
  async resolve({ request, key }) {
    const originUrl = originUrlFor(key);
    if (!originUrl) return new Response(null, { status: 404 });

    const response = await fetchCover(originUrl, requestHeaders(request));
    if (request.method === 'HEAD') {
      try {
        await response.body?.cancel();
      } catch {
        // HEAD returns metadata only, so its origin body is discarded.
      }
      return new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
    return response;
  },
});
