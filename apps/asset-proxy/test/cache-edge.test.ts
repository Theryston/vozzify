import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDefaultCache } from '../src/asset-cache.js';
import { dispatchAssetRequest } from '../src/asset-delivery.js';
import type { AssetProvider } from '../src/provider.js';

const cache = getDefaultCache();
const bodyOf = async (response: Response) =>
  new Uint8Array(await response.arrayBuffer());

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('asset cache edge behavior', () => {
  it('serves origin bytes when cache lookup fails', async () => {
    const url = 'https://assets.test/lookup/item.bin';
    const provider: AssetProvider = {
      freshnessSeconds: 30,
      cacheMode: 'fixed-ttl',
      async resolve() {
        return new Response(new Uint8Array([9]), {
          headers: { 'Content-Length': '1' },
        });
      },
    };
    vi.spyOn(cache, 'match').mockRejectedValueOnce(new Error('cache offline'));
    const result = await dispatchAssetRequest(
      new Request(url),
      new Map([['lookup', provider]]),
      cache,
      createExecutionContext(),
    );
    expect(await bodyOf(result)).toEqual(new Uint8Array([9]));
  });

  it('cleans up when a revalidation response arrives after timeout', async () => {
    const url = 'https://assets.test/late/item.bin';
    const entry = new Request(url);
    let calls = 0;
    let release: (() => void) | undefined;
    const provider: AssetProvider = {
      freshnessSeconds: 30,
      cacheMode: 'stale-while-revalidate',
      resolve() {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve(
            new Response(new Uint8Array([4]), {
              headers: { 'Content-Length': '1', ETag: '"old"' },
            }),
          );
        }
        if (calls > 2)
          return Promise.resolve(new Response(null, { status: 503 }));
        return new Promise<Response>((resolve) => {
          release = () => resolve(new Response(null, { status: 503 }));
        });
      },
    };
    const execute = async (context = createExecutionContext()) => {
      const response = await dispatchAssetRequest(
        new Request(url),
        new Map([['late', provider]]),
        cache,
        context,
      );
      return { context, response };
    };
    await cache.delete(entry);
    try {
      const cold = await execute();
      await bodyOf(cold.response);
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 30_000);
      const stale = await execute();
      await bodyOf(stale.response);
      await vi.advanceTimersByTimeAsync(10_000);
      await waitOnExecutionContext(stale.context);
      release?.();
      await Promise.resolve();
      await Promise.resolve();
      const expired = await execute();
      expect(expired.response.status).toBe(503);
      await waitOnExecutionContext(expired.context);
    } finally {
      release?.();
      await cache.delete(entry);
    }
  });
});
