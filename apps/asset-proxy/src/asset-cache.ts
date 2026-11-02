import { conditionalStatus } from './cache-conditionals.js';
import { toStoredResponse, VALIDATED_AT_HEADER } from './cache-retention.js';
import type { AssetProvider } from './provider.js';

const REVALIDATION_TIMEOUT_MS = 10_000;

export const getDefaultCache = (): Cache =>
  (caches as unknown as { readonly default: Cache }).default;

type CacheRequest = {
  request: Request;
  provider: AssetProvider;
  key: string;
  cache: Cache;
  execution: ExecutionContext;
};

type RefreshState = {
  timedOut: boolean;
  cancelBody?: () => void;
  provider: AssetProvider;
};

const deleteSafely = async (cache: Cache, key: Request): Promise<void> => {
  try {
    await cache.delete(key);
  } catch {
    // Cleanup is best effort when the runtime cache is unavailable.
  }
};

const cancelReaderSafely = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> => {
  try {
    await reader.cancel();
  } catch {
    // A body can finish or fail between timeout and cancellation.
  }
};

const cacheKeyFor = (request: Request): Request =>
  new Request(new URL(request.url), { method: 'GET' });

const validatedAtOf = (response: Response): number | undefined => {
  const value = Number(response.headers.get(VALIDATED_AT_HEADER));
  return Number.isFinite(value) && value >= 0 ? value : undefined;
};

const fresh = (response: Response, provider: AssetProvider): boolean => {
  const validatedAt = validatedAtOf(response);
  return (
    validatedAt !== undefined &&
    Date.now() - validatedAt < provider.freshnessSeconds * 1000
  );
};

const cacheable = (response: Response): boolean =>
  response.status === 200 &&
  response.body !== null &&
  response.headers.get('Content-Length') !== null;

const store = async (
  cache: Cache,
  key: Request,
  response: Response,
): Promise<boolean> => {
  try {
    await cache.put(key, response);
    return true;
  } catch {
    // A valid asset still streams when the runtime declines cache admission.
    return false;
  }
};

const storeRefreshed = async (
  cache: Cache,
  cacheKey: Request,
  response: Response,
  state: RefreshState,
): Promise<void> => {
  const retained = await store(
    cache,
    cacheKey,
    toStoredResponse(response, Date.now(), state.provider),
  );
  if (state.timedOut || !retained) await deleteSafely(cache, cacheKey);
};

const refreshResponse = async ({
  cache,
  cacheKey,
  cached,
  response,
  state,
}: {
  cache: Cache;
  cacheKey: Request;
  cached: Response;
  response: Response;
  state: RefreshState;
}): Promise<void> => {
  if (response.status === 304) {
    const headers = new Headers(cached.headers);
    for (const [name, value] of response.headers) {
      if (name.toLowerCase() !== 'cache-control') headers.set(name, value);
    }
    await storeRefreshed(
      cache,
      cacheKey,
      new Response(cached.body, { status: 200, headers }),
      state,
    );
    return;
  }
  if (cacheable(response)) {
    const reader = response.body?.getReader();
    if (reader) {
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const chunk = await reader.read();
          if (chunk.done) controller.close();
          else controller.enqueue(chunk.value);
        },
        cancel() {
          return cancelReaderSafely(reader);
        },
      });
      state.cancelBody = () => void cancelReaderSafely(reader);
      response = new Response(body, response);
    }
    await storeRefreshed(cache, cacheKey, response, state);
    return;
  }
  await deleteSafely(cache, cacheKey);
};

const refresh = async ({
  cache,
  cacheKey,
  cached,
  resolve,
  provider,
}: {
  cache: Cache;
  cacheKey: Request;
  cached: Response;
  resolve: () => Promise<Response>;
  provider: AssetProvider;
}): Promise<void> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const state: RefreshState = { timedOut: false, provider };
  let response: Response | undefined;
  let revalidation: Promise<void> | undefined;
  try {
    revalidation = (async (): Promise<void> => {
      response = await resolve();
      if (state.timedOut) {
        if (response.body) {
          try {
            await response.body.cancel();
          } catch {
            // The provider may have already consumed or locked its body.
          }
        }
        return;
      }
      await refreshResponse({
        cache,
        cacheKey,
        cached,
        response,
        state,
      });
    })();
    await Promise.race([
      revalidation,
      new Promise<void>((_resolve, reject) => {
        timeout = setTimeout(() => {
          state.timedOut = true;
          reject(new Error('Asset revalidation timed out'));
        }, REVALIDATION_TIMEOUT_MS);
      }),
    ]);
  } catch {
    if (!state.timedOut) await deleteSafely(cache, cacheKey);
  } finally {
    if (state.timedOut) state.cancelBody?.();
    if (timeout !== undefined) clearTimeout(timeout);
  }
  if (state.timedOut && revalidation !== undefined) {
    const clean = (): Promise<void> => deleteSafely(cache, cacheKey);
    void revalidation.then(clean, clean);
    await deleteSafely(cache, cacheKey);
  }
};

const clientResponse = async (
  request: Request,
  cached: Response,
  cache: Cache,
): Promise<Response> => {
  const headers = new Headers(cached.headers);
  headers.delete(VALIDATED_AT_HEADER);
  headers.delete('Cache-Control');
  const status = conditionalStatus(request, cached);
  if (status !== undefined) {
    if (status === 412) headers.delete('Content-Length');
    return new Response(null, { status, headers });
  }
  if (request.method === 'HEAD') return new Response(null, { headers });
  const rangeHeader = request.headers.get('Range');
  if (rangeHeader === null || !cached.body) {
    return new Response(cached.body, { headers });
  }
  const rangeUnit = rangeHeader.split('=', 1)[0]?.toLowerCase();
  if (rangeUnit !== 'bytes' || rangeHeader.includes(',')) {
    return new Response(cached.body, { headers });
  }
  const ifRange = request.headers.get('If-Range');
  if (
    ifRange &&
    ifRange !== cached.headers.get('ETag') &&
    ifRange !== cached.headers.get('Last-Modified')
  ) {
    return new Response(cached.body, { headers });
  }
  const ranged = await cache.match(request);
  if (!ranged) return new Response(cached.body, { headers });
  const rangedHeaders = new Headers(ranged.headers);
  rangedHeaders.delete(VALIDATED_AT_HEADER);
  rangedHeaders.delete('Cache-Control');
  return new Response(ranged.body, {
    status: ranged.status,
    statusText: ranged.statusText,
    headers: rangedHeaders,
  });
};

export const deliverCachedAsset = async ({
  request,
  provider,
  key,
  cache,
  execution,
}: CacheRequest): Promise<Response> => {
  const cacheKey = cacheKeyFor(request);
  const resolve = (): Promise<Response> => provider.resolve({ request, key });
  let cached: Response | undefined;
  try {
    cached = (await cache.match(cacheKey)) ?? undefined;
  } catch {
    return resolve();
  }

  if (cached && fresh(cached, provider)) {
    return clientResponse(request, cached, cache);
  }
  if (
    cached &&
    provider.cacheMode === 'stale-while-revalidate' &&
    validatedAtOf(cached) !== undefined
  ) {
    const conditionalRequest = new Request(request.url, {
      method: 'GET',
      headers: new Headers(),
    });
    const etag = cached.headers.get('ETag');
    if (etag) conditionalRequest.headers.set('If-None-Match', etag);
    execution.waitUntil(
      refresh({
        cache,
        cacheKey,
        cached: cached.clone(),
        resolve: () => provider.resolve({ request: conditionalRequest, key }),
        provider,
      }),
    );
    return clientResponse(request, cached, cache);
  }

  const response = await resolve();
  if (cacheable(response)) {
    execution.waitUntil(
      store(
        cache,
        cacheKey,
        toStoredResponse(response.clone(), Date.now(), provider),
      ),
    );
  }
  return response;
};
