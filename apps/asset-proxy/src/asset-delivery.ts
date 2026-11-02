import { deliverCachedAsset } from './asset-cache.js';
import type { ProviderRegistry } from './provider.js';

const SUCCESS_CACHE_CONTROL = 'public, max-age=0, must-revalidate';
const FAILURE_CACHE_CONTROL = 'no-store';
const ALLOW_METHODS = 'GET, HEAD, OPTIONS';
const EXPOSE_HEADERS =
  'Accept-Ranges, Content-Length, Content-Range, ETag, Last-Modified';

const corsHeaders = (): Headers =>
  new Headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': ALLOW_METHODS,
    'Access-Control-Allow-Headers':
      'If-Match, If-Modified-Since, If-None-Match, If-Range, If-Unmodified-Since, Range',
    'Access-Control-Expose-Headers': EXPOSE_HEADERS,
  });

const failureResponse = (status: number, headers = new Headers()): Response => {
  headers.set('Cache-Control', FAILURE_CACHE_CONTROL);
  for (const [name, value] of corsHeaders()) headers.set(name, value);
  return new Response(null, { status, headers });
};

const decodeObjectKey = (
  pathname: string,
  providerName: string,
): string | undefined => {
  const prefix = `/${providerName}/`;
  if (!pathname.startsWith(prefix)) return undefined;
  const encodedKey = pathname.slice(prefix.length);
  if (!encodedKey) return undefined;
  try {
    return encodedKey.split('/').map(decodeURIComponent).join('/');
  } catch {
    return undefined;
  }
};

const withDeliveryHeaders = (response: Response): Response => {
  const headers = new Headers(response.headers);
  for (const [name, value] of corsHeaders()) headers.set(name, value);
  headers.set(
    'Cache-Control',
    response.status >= 400 ? FAILURE_CACHE_CONTROL : SUCCESS_CACHE_CONTROL,
  );
  return new Response(response.body, { status: response.status, headers });
};

export const dispatchAssetRequest = async (
  request: Request,
  providers: ProviderRegistry,
  cache: Cache,
  execution: ExecutionContext,
): Promise<Response> => {
  const pathname = new URL(request.url).pathname;
  const providerName = pathname.split('/')[1];
  const provider = providerName ? providers.get(providerName) : undefined;
  if (!providerName || !provider) return failureResponse(404);

  const key = decodeObjectKey(pathname, providerName);
  if (!key) return failureResponse(404);

  if (request.method === 'OPTIONS') {
    const headers = corsHeaders();
    headers.set('Cache-Control', FAILURE_CACHE_CONTROL);
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return failureResponse(405, new Headers({ Allow: ALLOW_METHODS }));
  }

  try {
    return withDeliveryHeaders(
      await deliverCachedAsset({ request, provider, key, cache, execution }),
    );
  } catch {
    return failureResponse(502);
  }
};
