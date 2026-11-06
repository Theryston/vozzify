import { describe, expect, it, vi } from 'vitest';

import { getPublicHomePage, getSessionHomePage } from './home-queries';

vi.mock('server-only', () => ({}));

const serverApi = vi.fn();
const cacheTag = vi.fn();
const cacheLife = vi.fn();

vi.mock('@/lib/api/server', () => ({
  serverApi: (...args: unknown[]) => serverApi(...args),
}));

vi.mock('next/cache', () => ({
  cacheTag: (...args: unknown[]) => cacheTag(...args),
  cacheLife: (...args: unknown[]) => cacheLife(...args),
}));

const publicPage = {
  audience: 'public',
  version: 'a1b2c3d4e5f60718',
  algorithmVersion: 1,
  rows: [],
  nextCursor: null,
};

describe('getPublicHomePage', () => {
  it('tags the cache entry with the locale feed and never forwards cookies', async () => {
    serverApi.mockResolvedValue(publicPage);

    await getPublicHomePage('pt-BR');

    expect(cacheTag).toHaveBeenCalledWith('home:pt-BR');
    expect(cacheLife).toHaveBeenCalledWith({
      stale: 60,
      revalidate: 300,
      expire: 600,
    });
    expect(serverApi).toHaveBeenCalledWith(
      '/home',
      expect.objectContaining({
        query: { locale: 'pt-BR' },
        forwardCookies: false,
      }),
    );
  });

  it('refuses a response whose audience is not public, so nothing personal is cached', async () => {
    serverApi.mockResolvedValue({ ...publicPage, audience: 'personal' });

    await expect(getPublicHomePage('en')).rejects.toThrow(/refusing it/);
  });
});

describe('getSessionHomePage', () => {
  it('forwards the visitor cookies and asks for the locale', async () => {
    serverApi.mockResolvedValue(publicPage);

    await getSessionHomePage('en');

    expect(serverApi).toHaveBeenCalledWith(
      '/home',
      expect.objectContaining({
        query: { locale: 'en' },
        forwardCookies: true,
      }),
    );
    expect(cacheTag).not.toHaveBeenCalled();
  });
});
