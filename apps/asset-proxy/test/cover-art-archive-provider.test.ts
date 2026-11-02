import { SELF } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDefaultCache } from '../src/asset-cache.js';

const MBID = '76df3287-6cda-33eb-8e9a-044b5e15ffdd';
const RELEASE_URL = `https://assets.test/cover-art-archive/release/${MBID}/front-500`;
const RELEASE_GROUP_URL = `https://assets.test/cover-art-archive/release-group/${MBID}/front-500`;
const CACHE = getDefaultCache();
const image = new Uint8Array([137, 80, 78, 71, 13, 10]);

const clearCache = async (url: string): Promise<void> => {
  await CACHE.delete(new Request(url));
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Cover Art Archive public HTTP delivery', () => {
  it('resolves release redirects and caches exact bytes for the 30-day TTL', async () => {
    const fetchOrigin = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === 'coverartarchive.org') {
        expect(url.pathname).toBe(`/release/${MBID}/front-500`);
        return new Response(null, {
          status: 302,
          headers: {
            Location: 'http://s3.us.archive.org/mbid-cover/front.jpg',
          },
        });
      }
      expect(url.href).toBe('https://s3.us.archive.org/mbid-cover/front.jpg');
      return new Response(image, {
        headers: {
          'Content-Length': String(image.length),
          'Content-Type': 'image/jpeg',
          ETag: '"cover"',
        },
      });
    });
    vi.stubGlobal('fetch', fetchOrigin);
    await clearCache(RELEASE_URL);

    try {
      const cold = await SELF.fetch(RELEASE_URL);
      expect(cold.status).toBe(200);
      expect(cold.headers.get('Content-Type')).toBe('image/jpeg');
      expect(cold.headers.get('Cache-Control')).toBe(
        'public, max-age=0, must-revalidate',
      );
      expect(new Uint8Array(await cold.arrayBuffer())).toEqual(image);
      expect(fetchOrigin).toHaveBeenCalledTimes(2);

      const warm = await SELF.fetch(RELEASE_URL);
      expect(new Uint8Array(await warm.arrayBuffer())).toEqual(image);
      expect(fetchOrigin).toHaveBeenCalledTimes(2);
      const stored = await CACHE.match(new Request(RELEASE_URL));
      expect(stored?.headers.get('Cache-Control')).toBe(
        'public, max-age=2592000',
      );
    } finally {
      await clearCache(RELEASE_URL);
    }
  });

  it('resolves release-group redirects and recovers after early cache eviction', async () => {
    const fetchOrigin = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === 'coverartarchive.org') {
        expect(url.href).toBe(
          `https://coverartarchive.org/release-group/${MBID}/front-500`,
        );
        return new Response(null, {
          status: 307,
          headers: { Location: 'https://archive.org/download/album/front.jpg' },
        });
      }
      return new Response(image, {
        headers: { 'Content-Length': String(image.length) },
      });
    });
    vi.stubGlobal('fetch', fetchOrigin);
    await clearCache(RELEASE_GROUP_URL);

    try {
      const first = await SELF.fetch(RELEASE_GROUP_URL);
      expect(first.status).toBe(200);
      expect(new Uint8Array(await first.arrayBuffer())).toEqual(image);
      expect(fetchOrigin).toHaveBeenCalledTimes(2);

      await clearCache(RELEASE_GROUP_URL);
      const afterEviction = await SELF.fetch(RELEASE_GROUP_URL);
      expect(afterEviction.status).toBe(200);
      expect(new Uint8Array(await afterEviction.arrayBuffer())).toEqual(image);
      expect(fetchOrigin).toHaveBeenCalledTimes(4);
    } finally {
      await clearCache(RELEASE_GROUP_URL);
    }
  });

  it.each([404, 429, 500])(
    'does not cache an origin %i response and retries after recovery',
    async (status) => {
      let originCalls = 0;
      const fetchOrigin = vi.fn(async () => {
        originCalls += 1;
        if (originCalls === 1) return new Response(null, { status });
        return new Response(image, {
          headers: {
            'Content-Length': String(image.length),
            'Content-Type': 'image/jpeg',
          },
        });
      });
      vi.stubGlobal('fetch', fetchOrigin);
      await clearCache(RELEASE_URL);

      try {
        const failed = await SELF.fetch(RELEASE_URL);
        expect(failed.status).toBe(status);
        expect(failed.headers.get('Cache-Control')).toBe('no-store');
        const recovered = await SELF.fetch(RELEASE_URL);
        expect(recovered.status).toBe(200);
        expect(new Uint8Array(await recovered.arrayBuffer())).toEqual(image);
        expect(fetchOrigin).toHaveBeenCalledTimes(2);
      } finally {
        await clearCache(RELEASE_URL);
      }
    },
  );

  it('returns 304 metadata from a cold conditional request, then caches a full GET', async () => {
    let originCalls = 0;
    const fetchOrigin = vi.fn(async () => {
      originCalls += 1;
      if (originCalls === 1) {
        return new Response(null, {
          status: 304,
          headers: { ETag: '"cover"' },
        });
      }
      return new Response(image, {
        headers: {
          'Content-Length': String(image.length),
          'Content-Type': 'image/jpeg',
          ETag: '"cover"',
        },
      });
    });
    vi.stubGlobal('fetch', fetchOrigin);
    await clearCache(RELEASE_URL);

    try {
      const conditional = await SELF.fetch(RELEASE_URL, {
        headers: { 'If-None-Match': '"cover"' },
      });
      expect(conditional.status).toBe(304);
      expect(conditional.body).toBeNull();
      expect(conditional.headers.get('ETag')).toBe('"cover"');

      const full = await SELF.fetch(RELEASE_URL);
      expect(full.status).toBe(200);
      expect(new Uint8Array(await full.arrayBuffer())).toEqual(image);
      expect(fetchOrigin).toHaveBeenCalledTimes(2);
    } finally {
      await clearCache(RELEASE_URL);
    }
  });

  it('uses weak comparison for If-None-Match and strong comparison for If-Match', async () => {
    const fetchOrigin = vi.fn(
      async () =>
        new Response(image, {
          headers: {
            'Content-Length': String(image.length),
            ETag: 'W/"cover"',
          },
        }),
    );
    vi.stubGlobal('fetch', fetchOrigin);
    await clearCache(RELEASE_URL);

    try {
      const initial = await SELF.fetch(RELEASE_URL);
      expect(initial.status).toBe(200);
      await initial.arrayBuffer();

      const notModified = await SELF.fetch(RELEASE_URL, {
        headers: { 'If-None-Match': 'W/"cover"' },
      });
      expect(notModified.status).toBe(304);
      expect(notModified.body).toBeNull();

      const preconditionFailed = await SELF.fetch(RELEASE_URL, {
        headers: { 'If-Match': 'W/"cover"' },
      });
      expect(preconditionFailed.status).toBe(412);
      expect(
        new Uint8Array(await preconditionFailed.arrayBuffer()),
      ).toHaveLength(0);
      expect(fetchOrigin).toHaveBeenCalledTimes(1);
    } finally {
      await clearCache(RELEASE_URL);
    }
  });

  it('answers HEAD without a body and does not let HEAD poison the full response', async () => {
    const fetchOrigin = vi.fn(
      async () =>
        new Response(image, {
          headers: {
            'Content-Length': String(image.length),
            'Content-Type': 'image/jpeg',
          },
        }),
    );
    vi.stubGlobal('fetch', fetchOrigin);
    await clearCache(RELEASE_URL);

    try {
      const head = await SELF.fetch(RELEASE_URL, { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(head.headers.get('Content-Length')).toBe(String(image.length));
      expect(head.body).toBeNull();

      const full = await SELF.fetch(RELEASE_URL);
      expect(full.status).toBe(200);
      expect(new Uint8Array(await full.arrayBuffer())).toEqual(image);
      expect(fetchOrigin).toHaveBeenCalledTimes(2);
    } finally {
      await clearCache(RELEASE_URL);
    }
  });

  it('rejects unsupported paths and redirects outside the archive', async () => {
    const fetchOrigin = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: 'https://attacker.example/image.jpg' },
        }),
    );
    vi.stubGlobal('fetch', fetchOrigin);
    await clearCache(RELEASE_URL);

    const invalid = await SELF.fetch(
      `https://assets.test/cover-art-archive/release/${MBID}/front-1200`,
    );
    expect(invalid.status).toBe(404);
    expect(fetchOrigin).not.toHaveBeenCalled();

    const escaped = await SELF.fetch(RELEASE_URL);
    expect(escaped.status).toBe(502);
    expect(fetchOrigin).toHaveBeenCalledTimes(1);
    await clearCache(RELEASE_URL);
  });

  it('converts provider timeouts and network failures to retryable 502 responses', async () => {
    let originCalls = 0;
    const fetchOrigin = vi.fn(async () => {
      originCalls += 1;
      if (originCalls === 1) {
        throw new DOMException('Timed out', 'TimeoutError');
      }
      if (originCalls === 2) throw new Error('Network unavailable');
      return new Response(image, {
        headers: { 'Content-Length': String(image.length) },
      });
    });
    vi.stubGlobal('fetch', fetchOrigin);
    await clearCache(RELEASE_URL);

    try {
      expect((await SELF.fetch(RELEASE_URL)).status).toBe(502);
      expect((await SELF.fetch(RELEASE_URL)).status).toBe(502);
      const recovered = await SELF.fetch(RELEASE_URL);
      expect(recovered.status).toBe(200);
      expect(new Uint8Array(await recovered.arrayBuffer())).toEqual(image);
      expect(fetchOrigin).toHaveBeenCalledTimes(3);
    } finally {
      await clearCache(RELEASE_URL);
    }
  });
});
