import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `proxy.ts` reads validated server env, which imports `server-only`:
// meaningless outside a bundled server, so stub it for these tests.
vi.mock('server-only', () => ({}));

const fetchMock = vi.fn();

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('API_URL', 'https://api.test');
  vi.stubEnv('REVALIDATE_SECRET', 'test-revalidate-secret-32-chars-long');
  fetchMock.mockReset();
});

const loadProxy = async () => {
  const module = (await import('./proxy')) as typeof import('./proxy');
  return module.proxy;
};

const artistBody = (id: string) => ({
  id,
  mbid: '00000000-0000-4000-8000-000000001001',
  name: 'Queen',
  genres: ['rock'],
  trackCount: 2,
});

const jsonResponse = (status: number, body: unknown) => ({
  status,
  json: async () => body,
});

describe('proxy artist guard', () => {
  it('redirects a legacy artist ID with 308 keeping the query', async () => {
    const proxy = await loadProxy();
    fetchMock.mockResolvedValue(
      jsonResponse(404, {
        statusCode: 404,
        code: 'RESOURCE_MOVED',
        message: 'Artist moved',
        details: { id: 'artist-1' },
      }),
    );

    const response = await proxy(
      new NextRequest('http://localhost:3000/en/artists/legacy-1?x=1'),
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.lastCall?.[0]).toBe(
      'https://api.test/v1/artists/legacy-1',
    );
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/en/artists/artist-1?x=1',
    );
  });

  it('answers an unknown artist ID with a real 404', async () => {
    const proxy = await loadProxy();
    fetchMock.mockResolvedValue(
      jsonResponse(404, {
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Artist not found',
      }),
    );

    const response = await proxy(
      new NextRequest('http://localhost:3000/en/artists/does-not-exist'),
    );

    // Keep the locale layout and the shared site 404 UI in the rewrite.
    expect(response.status).toBe(404);
    expect(response.headers.get('x-middleware-rewrite')).toBe(
      'http://localhost:3000/en/not-found',
    );
  });

  it('lets a known artist through to the page', async () => {
    const proxy = await loadProxy();
    fetchMock.mockResolvedValue(jsonResponse(200, artistBody('artist-1')));

    const response = await proxy(
      new NextRequest('http://localhost:3000/en/artists/artist-1'),
    );

    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
  });

  it('lets the page render when the API is down', async () => {
    const proxy = await loadProxy();
    fetchMock.mockRejectedValue(new Error('connection refused'));

    const response = await proxy(
      new NextRequest('http://localhost:3000/en/artists/artist-1'),
    );

    expect(response.headers.get('location')).toBeNull();
  });

  it('lets the page render when no API is configured', async () => {
    vi.stubEnv('API_URL', '');
    const proxy = await loadProxy();

    const response = await proxy(
      new NextRequest('http://localhost:3000/en/artists/artist-1'),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBeNull();
  });

  it('ignores non-artist paths', async () => {
    const proxy = await loadProxy();

    const response = await proxy(
      new NextRequest('http://localhost:3000/en/search?q=queen'),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBeNull();
  });
});
