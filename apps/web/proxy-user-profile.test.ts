import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Same stubs as `proxy.test.ts`: the proxy reads validated server env, which
// imports `server-only`, meaningless outside a bundled server.
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

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('proxy user profile guard', () => {
  it('redirects a mixed-case username with 308 keeping the query, without asking the API', async () => {
    const proxy = await loadProxy();

    const response = await proxy(
      new NextRequest('http://localhost:3000/en/users/Ada_Lovelace?x=1'),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/en/users/ada_lovelace?x=1',
    );
  });

  it('answers an unknown username with a real 404', async () => {
    const proxy = await loadProxy();
    fetchMock.mockResolvedValue(
      jsonResponse(404, {
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'User not found',
      }),
    );

    const response = await proxy(
      new NextRequest('http://localhost:3000/pt-BR/users/nobody'),
    );

    expect(fetchMock.mock.lastCall?.[0]).toBe(
      'https://api.test/v1/users/nobody',
    );
    expect(response.status).toBe(404);
    expect(response.headers.get('x-middleware-rewrite')).toBe(
      'http://localhost:3000/pt-BR/not-found',
    );
  });

  it('lets a known Profile through to the page', async () => {
    const proxy = await loadProxy();
    fetchMock.mockResolvedValue(jsonResponse(200, { username: 'grace' }));

    const response = await proxy(
      new NextRequest('http://localhost:3000/en/users/grace'),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
  });

  it('lets the page render when the API is down', async () => {
    const proxy = await loadProxy();
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const response = await proxy(
      new NextRequest('http://localhost:3000/en/users/grace'),
    );

    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    expect(response.status).toBe(200);
  });

  it('ignores paths that are not a Profile', async () => {
    const proxy = await loadProxy();

    const response = await proxy(
      new NextRequest('http://localhost:3000/en/users/grace/extra'),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBeNull();
  });
});
