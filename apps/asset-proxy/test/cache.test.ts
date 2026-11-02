import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDefaultCache } from '../src/asset-cache.js';
import { dispatchAssetRequest } from '../src/asset-delivery.js';
import worker from '../src/index.js';
import type { AssetProvider } from '../src/provider.js';

const cache = getDefaultCache();
const pathFor = (key: string, query = '') =>
  `https://assets.test/storage/${key.split('/').map(encodeURIComponent).join('/')}${query}`;
const cacheKeyFor = (url: string) => new Request(url, { method: 'GET' });
const bodyOf = async (response: Response) =>
  new Uint8Array(await response.arrayBuffer());
const requestAsset = (url: string, init?: RequestInit) => {
  const execution = createExecutionContext();
  return {
    response: worker.fetch(new Request(url, init), env, execution),
    finish: () => waitOnExecutionContext(execution),
  };
};
const fetchAsset = async (
  url: string,
  init?: RequestInit,
): Promise<Response> => {
  const call = requestAsset(url, init);
  const response = await call.response;
  await call.finish();
  return response;
};
const putObject = (key: string, bytes: Uint8Array) =>
  env.PUBLIC_ASSETS.put(key, bytes, {
    httpMetadata: { contentType: 'application/octet-stream' },
  });

const clear = async (url: string, key: string): Promise<void> => {
  await cache.delete(cacheKeyFor(url));
  await env.PUBLIC_ASSETS.delete(key);
};

type RevalidationFailureCase = {
  key: string;
  oldBytes: Uint8Array;
  newBytes: Uint8Array;
  makeOriginFail(key: string): Promise<void>;
};

const expectRevalidationFailureToEvictAndRecover = async ({
  key,
  oldBytes,
  newBytes,
  makeOriginFail,
}: RevalidationFailureCase): Promise<void> => {
  const url = pathFor(key);
  await clear(url, key);
  await putObject(key, oldBytes);

  try {
    const initial = await fetchAsset(url);
    await bodyOf(initial);
    vi.setSystemTime(Date.now() + 10_800_000);
    await makeOriginFail(key);

    const stale = await fetchAsset(url);
    expect(await bodyOf(stale)).toEqual(oldBytes);
    expect(await cache.match(cacheKeyFor(url))).toBeUndefined();

    await putObject(key, newBytes);
    const recovered = await fetchAsset(url);
    expect(recovered.status).toBe(200);
    expect(await bodyOf(recovered)).toEqual(newBytes);
  } finally {
    await clear(url, key);
  }
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('asset cache over the public Worker endpoint', () => {
  it('serves a cold R2 response then avoids origin reads during freshness', async () => {
    const key = 'cache/fresh-hit.bin';
    const url = pathFor(key);
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await clear(url, key);
    await putObject(key, bytes);

    try {
      const cold = await fetchAsset(url);
      expect(cold.status).toBe(200);
      expect(await bodyOf(cold)).toEqual(bytes);

      const read = vi
        .spyOn(env.PUBLIC_ASSETS, 'get')
        .mockRejectedValue(new Error('origin unavailable'));
      const warm = await fetchAsset(url);

      expect(warm.status).toBe(200);
      expect(await bodyOf(warm)).toEqual(bytes);
      expect(read).not.toHaveBeenCalled();
    } finally {
      await clear(url, key);
    }
  });

  it('streams valid objects when Cache API admission fails or an entry is evicted', async () => {
    const key = 'cache/admission-failure.bin';
    const url = pathFor(key);
    const bytes = new Uint8Array([5, 6, 7]);
    await clear(url, key);
    await putObject(key, bytes);

    try {
      vi.spyOn(cache, 'put').mockRejectedValueOnce(
        new Error('Cache API declined admission'),
      );
      const uncached = await fetchAsset(url);
      expect(uncached.status).toBe(200);
      expect(await bodyOf(uncached)).toEqual(bytes);

      await putObject(key, new Uint8Array([8, 9, 10]));
      const admissionRecovered = await fetchAsset(url);
      expect(await bodyOf(admissionRecovered)).toEqual(
        new Uint8Array([8, 9, 10]),
      );
      expect(await cache.match(cacheKeyFor(url))).toBeDefined();

      await cache.delete(cacheKeyFor(url));
      const earlyEviction = await fetchAsset(url);
      expect(earlyEviction.status).toBe(200);
      expect(await bodyOf(earlyEviction)).toEqual(new Uint8Array([8, 9, 10]));
    } finally {
      await clear(url, key);
    }
  });

  it('revalidates at the exact three-hour boundary and replaces changed bytes', async () => {
    const key = 'cache/changed.bin';
    const url = pathFor(key);
    const oldBytes = new Uint8Array([1, 2, 3]);
    const newBytes = new Uint8Array([7, 8, 9, 10]);
    await clear(url, key);
    await putObject(key, oldBytes);

    try {
      vi.useFakeTimers();
      const admittedAt = Date.now();
      vi.setSystemTime(admittedAt);
      const cold = await fetchAsset(url);
      expect(await bodyOf(cold)).toEqual(oldBytes);
      const retained = await cache.match(cacheKeyFor(url));
      expect(retained?.headers.get('Cache-Control')).toBe(
        'public, max-age=14400',
      );
      vi.setSystemTime(admittedAt + 10_799_999);
      expect(await bodyOf(await fetchAsset(url))).toEqual(oldBytes);
      vi.setSystemTime(admittedAt + 10_800_000);
      await putObject(key, newBytes);

      const stale = await fetchAsset(url);
      expect(stale.status).toBe(200);
      expect(await bodyOf(stale)).toEqual(oldBytes);
      const updated = await cache.match(cacheKeyFor(url));
      expect(updated).not.toBeUndefined();
      expect(await bodyOf(updated ?? new Response())).toEqual(newBytes);

      const fresh = await fetchAsset(url);
      expect(await bodyOf(fresh)).toEqual(newBytes);
    } finally {
      await clear(url, key);
    }
  });

  it('confirms unchanged bytes with a validator and begins a new freshness window', async () => {
    const key = 'cache/unchanged.bin';
    const url = pathFor(key);
    const bytes = new Uint8Array([11, 12, 13]);
    await clear(url, key);
    await putObject(key, bytes);

    try {
      const initial = await fetchAsset(url);
      await bodyOf(initial);
      vi.setSystemTime(Date.now() + 10_800_000);

      const stale = await fetchAsset(url);
      expect(await bodyOf(stale)).toEqual(bytes);

      const read = vi
        .spyOn(env.PUBLIC_ASSETS, 'get')
        .mockRejectedValue(new Error('fresh entries must not read origin'));
      const fresh = await fetchAsset(url);
      expect(await bodyOf(fresh)).toEqual(bytes);
      expect(read).not.toHaveBeenCalled();
    } finally {
      await clear(url, key);
    }
  });

  it('returns stale bytes before a pending background revalidation completes', async () => {
    const key = 'cache/pending.bin';
    const url = pathFor(key);
    const bytes = new Uint8Array([21, 22, 23]);
    let release: (() => void) | undefined;
    let started: (() => void) | undefined;
    const originStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const originGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await clear(url, key);
    await putObject(key, bytes);

    try {
      const initial = await fetchAsset(url);
      await bodyOf(initial);
      vi.setSystemTime(Date.now() + 10_800_000);
      const originalHead = env.PUBLIC_ASSETS.head.bind(env.PUBLIC_ASSETS);
      vi.spyOn(env.PUBLIC_ASSETS, 'head').mockImplementation(
        async (requestedKey) => {
          started?.();
          await originGate;
          return originalHead(requestedKey);
        },
      );

      const staleCall = requestAsset(url);
      const stale = await staleCall.response;
      expect(await bodyOf(stale)).toEqual(bytes);
      await originStarted;
      release?.();
      await staleCall.finish();
    } finally {
      release?.();
      await clear(url, key);
    }
  });

  it('evicts stale bytes on origin failure and lets a later request recover', async () => {
    await expectRevalidationFailureToEvictAndRecover({
      key: 'cache/recovery.bin',
      oldBytes: new Uint8Array([31, 32]),
      newBytes: new Uint8Array([41, 42]),
      async makeOriginFail(key) {
        await putObject(key, new Uint8Array([33, 34, 35]));
        vi.spyOn(env.PUBLIC_ASSETS, 'get').mockRejectedValueOnce(
          new Error('R2 unavailable'),
        );
      },
    });
  });

  it('evicts stale bytes when the object disappears and retries after recovery', async () => {
    await expectRevalidationFailureToEvictAndRecover({
      key: 'cache/missing-on-refresh.bin',
      oldBytes: new Uint8Array([45, 46]),
      newBytes: new Uint8Array([47, 48]),
      async makeOriginFail(key) {
        await env.PUBLIC_ASSETS.delete(key);
      },
    });
  });

  it('evicts a cached copy when background revalidation times out', async () => {
    const url = 'https://assets.test/timeout/item.bin';
    const entry = cacheKeyFor(url);
    const oldBytes = new Uint8Array([81, 82]);
    let calls = 0;
    let cancelled = false;
    const provider: AssetProvider = {
      freshnessSeconds: 10_800,
      cacheMode: 'stale-while-revalidate',
      async resolve() {
        calls += 1;
        if (calls === 1) {
          return new Response(oldBytes, {
            headers: {
              'Content-Length': String(oldBytes.length),
              ETag: '"old"',
            },
          });
        }
        if (calls > 2) return new Response(null, { status: 503 });
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([83]));
            },
            cancel() {
              cancelled = true;
            },
          }),
          {
            headers: { 'Content-Length': '2', ETag: '"new"' },
          },
        );
      },
    };
    const providers = new Map([['timeout', provider]]);
    const execute = async (): Promise<Response> => {
      const context = createExecutionContext();
      const response = await dispatchAssetRequest(
        new Request(url),
        providers,
        cache,
        context,
      );
      await waitOnExecutionContext(context);
      return response;
    };
    await cache.delete(entry);

    try {
      const initial = await execute();
      await bodyOf(initial);
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 10_800_000);

      const context = createExecutionContext();
      const stale = await dispatchAssetRequest(
        new Request(url),
        providers,
        cache,
        context,
      );
      expect(await bodyOf(stale)).toEqual(oldBytes);
      await vi.advanceTimersByTimeAsync(10_000);
      await waitOnExecutionContext(context);
      expect(cancelled).toBe(true);

      const unavailable = await execute();
      expect(unavailable.status).toBe(503);
      expect(unavailable.headers.get('Cache-Control')).toBe('no-store');
    } finally {
      await cache.delete(entry);
    }
  });

  it('keeps cache-busting queries isolated and preserves warm HTTP semantics', async () => {
    const key = 'cache/query-identity.bin';
    const firstUrl = pathFor(key, '?cacheBust=first');
    const secondUrl = pathFor(key, '?cacheBust=second');
    const firstBytes = new Uint8Array([51, 52, 53, 54]);
    const secondBytes = new Uint8Array([61, 62, 63, 64]);
    await clear(firstUrl, key);
    await cache.delete(cacheKeyFor(secondUrl));
    await putObject(key, firstBytes);

    try {
      const first = await fetchAsset(firstUrl);
      const etag = first.headers.get('ETag') ?? '';
      expect(await bodyOf(first)).toEqual(firstBytes);
      await putObject(key, secondBytes);

      const second = await fetchAsset(secondUrl);
      expect(await bodyOf(second)).toEqual(secondBytes);

      const stillFirst = await fetchAsset(firstUrl);
      expect(await bodyOf(stillFirst)).toEqual(firstBytes);
      const head = await fetchAsset(firstUrl, { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(head.body).toBeNull();
      expect(head.headers.get('Content-Length')).toBe(
        String(firstBytes.length),
      );

      const notModified = await fetchAsset(firstUrl, {
        headers: { 'If-None-Match': etag },
      });
      expect(notModified.status).toBe(304);
      expect(notModified.body).toBeNull();

      const ranged = await fetchAsset(firstUrl, {
        headers: { Range: 'bytes=1-2' },
      });
      expect(ranged.status).toBe(206);
      expect(ranged.headers.get('Content-Range')).toBe('bytes 1-2/4');
      expect(await bodyOf(ranged)).toEqual(firstBytes.slice(1, 3));
      expect((await fetchAsset(firstUrl)).status).toBe(200);
    } finally {
      await clear(firstUrl, key);
      await cache.delete(cacheKeyFor(secondUrl));
    }
  });

  it('does not replace a complete entry with a range response', async () => {
    const key = 'cache/range-first.bin';
    const url = pathFor(key);
    const bytes = new Uint8Array([101, 102, 103, 104, 105]);
    await clear(url, key);
    await putObject(key, bytes);

    try {
      const coldRange = await fetchAsset(url, {
        headers: { Range: 'bytes=1-2' },
      });
      expect(coldRange.status).toBe(206);
      expect(await bodyOf(coldRange)).toEqual(bytes.slice(1, 3));
      expect(await cache.match(cacheKeyFor(url))).toBeUndefined();

      const full = await fetchAsset(url);
      expect(full.status).toBe(200);
      expect(await bodyOf(full)).toEqual(bytes);

      const warmRange = await fetchAsset(url, {
        headers: { Range: 'bytes=2-4' },
      });
      expect(warmRange.status).toBe(206);
      expect(await bodyOf(warmRange)).toEqual(bytes.slice(2));
      const stillFull = await fetchAsset(url);
      expect(stillFull.status).toBe(200);
      expect(await bodyOf(stillFull)).toEqual(bytes);
    } finally {
      await clear(url, key);
    }
  });

  it('does not admit cold HEAD or conditional responses as full objects', async () => {
    for (const method of ['HEAD', 'conditional'] as const) {
      const key = `cache/cold-${method}.bin`;
      const url = pathFor(key);
      const bytes = new Uint8Array([111, 112, 113]);
      await clear(url, key);
      await putObject(key, bytes);
      try {
        const options =
          method === 'HEAD'
            ? { method: 'HEAD' as const }
            : { headers: { 'If-None-Match': '*' } };
        const partial = await fetchAsset(url, options);
        expect(partial.status).toBe(method === 'HEAD' ? 200 : 304);
        expect(await cache.match(cacheKeyFor(url))).toBeUndefined();
        const full = await fetchAsset(url);
        expect(full.status).toBe(200);
        expect(await bodyOf(full)).toEqual(bytes);
      } finally {
        await clear(url, key);
      }
    }
  });

  it('keeps browser freshness separate from internal cache retention', async () => {
    const key = 'cache/browser-policy.bin';
    const url = pathFor(key);
    await clear(url, key);
    await putObject(key, new Uint8Array([71]));

    try {
      const response = await fetchAsset(url);
      expect(response.headers.get('Cache-Control')).toBe(
        'public, max-age=0, must-revalidate',
      );
      await bodyOf(response);
      const hit = await fetchAsset(url);
      expect(hit.headers.get('Cache-Control')).toBe(
        'public, max-age=0, must-revalidate',
      );
    } finally {
      await clear(url, key);
    }
  });

  it('applies registered provider freshness and mode without provider-name logic', async () => {
    const url = 'https://assets.test/other/item.bin';
    const entry = cacheKeyFor(url);
    await cache.delete(entry);
    const responses = [new Uint8Array([91]), new Uint8Array([92])];
    let calls = 0;
    const provider: AssetProvider = {
      freshnessSeconds: 30,
      cacheMode: 'fixed-ttl',
      async resolve() {
        const bytes = responses[calls];
        calls += 1;
        return new Response(bytes, {
          headers: { 'Content-Length': String(bytes?.length ?? 0) },
        });
      },
    };
    const providers = new Map([['other', provider]]);
    const execute = async (): Promise<Response> => {
      const context = createExecutionContext();
      const response = await dispatchAssetRequest(
        new Request(url),
        providers,
        cache,
        context,
      );
      await waitOnExecutionContext(context);
      return response;
    };

    try {
      expect(await bodyOf(await execute())).toEqual(new Uint8Array([91]));
      expect(await bodyOf(await execute())).toEqual(new Uint8Array([91]));
      expect(calls).toBe(1);
      vi.setSystemTime(Date.now() + 30_000);
      expect(await bodyOf(await execute())).toEqual(new Uint8Array([92]));
      expect(calls).toBe(2);
    } finally {
      await cache.delete(entry);
    }
  });
});
