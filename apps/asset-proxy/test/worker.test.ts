import { env, SELF } from 'cloudflare:test';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const bytes = {
  image: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  audio: new Uint8Array(48),
  binary: new Uint8Array([0, 1, 2, 128, 255, 10]),
};
const objects = [
  {
    key: 'avatars/singer.png',
    contentType: 'image/svg+xml',
    bytes: bytes.image,
  },
  {
    key: 'track-audio/track.wav',
    contentType: 'audio/wav',
    bytes: bytes.audio,
  },
  {
    key: 'pitch-curves/track.bin',
    contentType: 'application/octet-stream',
    bytes: bytes.binary,
  },
  {
    key: 'fixtures/hello world-#?%-ção.bin',
    contentType: 'application/octet-stream',
    bytes: bytes.binary,
  },
] as const;

const encodeKey = (key: string): string =>
  key.split('/').map(encodeURIComponent).join('/');
const assetUrl = (key: string, query = '') =>
  `https://assets.test/storage/${encodeKey(key)}${query}`;

const makeWav = (): void => {
  const view = new DataView(bytes.audio.buffer);
  bytes.audio.set([82, 73, 70, 70], 0);
  view.setUint32(4, 40, true);
  bytes.audio.set([87, 65, 86, 69, 102, 109, 116, 32], 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  bytes.audio.set([100, 97, 116, 97], 36);
  view.setUint32(40, 4, true);
  view.setInt16(44, 4400, true);
  view.setInt16(46, -4400, true);
};

beforeAll(async () => {
  makeWav();
  await Promise.all(
    objects.map(({ key, contentType, bytes: body }) =>
      env.PUBLIC_ASSETS.put(key, body, {
        httpMetadata: { contentType },
      }),
    ),
  );
});

afterAll(async () => {
  await Promise.all(objects.map(({ key }) => env.PUBLIC_ASSETS.delete(key)));
});

describe('public asset HTTP delivery', () => {
  it.each([
    ['Avatar image', objects[0], bytes.image],
    ['Track audio', objects[1], bytes.audio],
    ['binary Pitch curve', objects[2], bytes.binary],
  ])('serves exact %s bytes and content type', async (_label, object, body) => {
    const response = await SELF.fetch(assetUrl(object.key));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe(object.contentType);
    expect(response.headers.get('Content-Length')).toBe(String(body.length));
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=0, must-revalidate',
    );
    expect(response.headers.get('ETag')).not.toBeNull();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(body);
  });

  it('keeps encoded object identity and Avatar cacheBust query parameters', async () => {
    const response = await SELF.fetch(
      assetUrl(objects[3].key, '?cacheBust=123'),
    );
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes.binary);
  });

  it('returns HEAD metadata without an object body', async () => {
    const response = await SELF.fetch(assetUrl(objects[1].key), {
      method: 'HEAD',
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Length')).toBe(
      String(bytes.audio.length),
    );
    expect(response.body).toBeNull();
  });

  it('answers weak and spaced If-None-Match validators without a body', async () => {
    const initial = await SELF.fetch(assetUrl(objects[2].key));
    const etag = initial.headers.get('ETag') ?? '';
    const response = await SELF.fetch(assetUrl(objects[2].key), {
      headers: { 'If-None-Match': `"older", W/${etag}` },
    });
    expect(response.status).toBe(304);
    expect(response.body).toBeNull();
  });

  it('uses strong If-Match comparisons and does not cache precondition failures', async () => {
    const initial = await SELF.fetch(assetUrl(objects[2].key));
    const etag = initial.headers.get('ETag') ?? '';
    const match = await SELF.fetch(assetUrl(objects[2].key), {
      headers: { 'If-Match': `"older", ${etag}` },
    });
    const failure = await SELF.fetch(assetUrl(objects[2].key), {
      method: 'HEAD',
      headers: { 'If-Match': '"stale-validator"' },
    });
    expect(match.status).toBe(200);
    expect(failure.status).toBe(412);
    expect(failure.headers.get('Content-Length')).toBeNull();
    expect(failure.headers.get('Cache-Control')).toBe('no-store');
  });

  it('accepts an exact Last-Modified If-Unmodified-Since date', async () => {
    const initial = await SELF.fetch(assetUrl(objects[2].key));
    const lastModified = initial.headers.get('Last-Modified');
    expect(lastModified).not.toBeNull();

    const response = await SELF.fetch(assetUrl(objects[2].key), {
      headers: { 'If-Unmodified-Since': lastModified ?? '' },
    });

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes.binary);
  });

  it('uses an exact Last-Modified match for an If-Range date', async () => {
    const initial = await SELF.fetch(assetUrl(objects[1].key));
    const lastModified = initial.headers.get('Last-Modified') ?? '';
    const response = await SELF.fetch(assetUrl(objects[1].key), {
      headers: { Range: 'bytes=44-47', 'If-Range': lastModified },
    });

    expect(response.status).toBe(206);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      bytes.audio.slice(44, 48),
    );
  });

  it('ignores Range when an If-Range date differs from Last-Modified', async () => {
    const response = await SELF.fetch(assetUrl(objects[1].key), {
      headers: {
        Range: 'bytes=44-47',
        'If-Range': 'Thu, 01 Jan 2099 00:00:00 GMT',
      },
    });

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes.audio);
  });

  it('returns partial audio bytes for a satisfiable range', async () => {
    const response = await SELF.fetch(assetUrl(objects[1].key), {
      headers: { Range: 'bytes=44-47' },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe(
      `bytes 44-47/${bytes.audio.length}`,
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      bytes.audio.slice(44, 48),
    );
  });

  it('accepts byte-range units without case sensitivity', async () => {
    const response = await SELF.fetch(assetUrl(objects[1].key), {
      headers: { Range: 'Bytes=44-47' },
    });

    expect(response.status).toBe(206);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      bytes.audio.slice(44, 48),
    );
  });

  it.each(['items=0-1', 'bytes=0-1,4-5'])(
    'serves the full object for unsupported Range value %s',
    async (range) => {
      const response = await SELF.fetch(assetUrl(objects[1].key), {
        headers: { Range: range },
      });

      expect(response.status).toBe(200);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes.audio);
    },
  );

  it('ignores a byte range when If-Range does not match', async () => {
    const response = await SELF.fetch(assetUrl(objects[1].key), {
      headers: { Range: 'bytes=44-47', 'If-Range': '"stale-validator"' },
    });
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes.audio);
  });

  it('rejects unsatisfiable ranges without caching a partial failure', async () => {
    const response = await SELF.fetch(assetUrl(objects[1].key), {
      headers: { Range: 'bytes=99-' },
    });
    expect(response.status).toBe(416);
    expect(response.headers.get('Content-Range')).toBe(
      `bytes */${bytes.audio.length}`,
    );
    expect(response.headers.get('Content-Length')).toBeNull();
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('answers anonymous cross-origin preflight for audio and byte ranges', async () => {
    const response = await SELF.fetch(assetUrl(objects[1].key), {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://vozzify.com',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Range',
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain(
      'GET',
    );
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain(
      'Range',
    );
  });

  it('returns a non-cacheable response when the R2 read fails', async () => {
    const read = vi
      .spyOn(env.PUBLIC_ASSETS, 'get')
      .mockRejectedValueOnce(new Error('R2 read failed'));
    const response = await SELF.fetch(assetUrl(objects[2].key));
    read.mockRestore();
    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('does not serve unknown providers, missing objects or write methods', async () => {
    const unknown = await SELF.fetch('https://assets.test/external/key');
    const missing = await SELF.fetch(assetUrl('missing.bin'));
    const write = await SELF.fetch(assetUrl(objects[1].key), { method: 'PUT' });
    expect(unknown.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(write.status).toBe(405);
    expect(unknown.headers.get('Cache-Control')).toBe('no-store');
    expect(missing.headers.get('Cache-Control')).toBe('no-store');
  });
});
