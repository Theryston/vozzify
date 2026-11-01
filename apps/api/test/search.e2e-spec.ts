import { searchResultSchema } from '@vozzify/contracts';
import { trackProcessings } from '../src/database/schema/track-processings.js';
import { tracks } from '../src/database/schema/tracks.js';
import { SonicService } from '../src/integrations/sonic/sonic.service.js';
import { SearchIndexService } from '../src/modules/search/search-index.service.js';
import { TracksSearchService } from '../src/modules/tracks/tracks-search.service.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';
import { resetDatabase } from './utils/database.js';
import { testMbid } from './utils/factories.js';
import {
  FAKE_CATALOG_API_KEY,
  type FakeCatalogHandler,
  type FakeMusicCatalog,
  startFakeMusicCatalog,
} from './utils/fake-music-catalog.js';
import { recordingSummary } from './utils/recording-summaries.js';
import { startSonicContainer } from './utils/sonic-container.js';

// End-to-end unauthenticated search through the API over one persistent
// Music catalog WebSocket: the API multiplexes queries by request id,
// forwards each catalog-provided Track association, bounds abuse with a per-IP rate
// limit, and surfaces catalog outages as retryable 503/504 errors.
describe('Catalog search plus limits plus errors (e2e)', () => {
  let catalog: FakeMusicCatalog;
  let testApp: TestApp;
  let sonic: Awaited<ReturnType<typeof startSonicContainer>>;
  let probeReady = false;

  beforeAll(async () => {
    sonic = await startSonicContainer();
  }, 120_000);

  beforeEach(async () => {
    probeReady = false;
    catalog = await startFakeMusicCatalog((payload) =>
      fakeCatalogAnswer(payload, probeReady),
    );
    testApp = await createTestApp({
      env: {
        MUSIC_CATALOG_URL: catalog.url,
        MUSIC_CATALOG_API_KEY: FAKE_CATALOG_API_KEY,
        MUSIC_CATALOG_REQUEST_TIMEOUT_MS: 200,
        SONIC_HOST: sonic.getHost(),
        SONIC_PORT: sonic.getMappedPort(1491),
        SONIC_AUTH_PASSWORD: 'local-dev-sonic-password-change-me',
        SONIC_REQUEST_TIMEOUT_MS: 2_000,
      },
    });
    await resetDatabase(testApp.db);
    await testApp.db.insert(tracks).values([
      {
        id: 'sonic-completed',
        recordingMbid: testMbid(10),
        title: 'Not ready fallback song',
        artistCredit: [{ name: 'Fallback Artist', joinPhrase: '' }],
      },
      {
        id: 'sonic-pending',
        recordingMbid: testMbid(11),
        title: 'Not ready pending song',
        artistCredit: [{ name: 'Fallback Artist', joinPhrase: '' }],
      },
      {
        id: 'sonic-completed-2',
        recordingMbid: testMbid(13),
        title: 'Not ready alternate fallback song',
        artistCredit: [{ name: 'Fallback Artist', joinPhrase: '' }],
      },
      {
        id: 'sonic-failed',
        recordingMbid: testMbid(12),
        title: 'Not ready failed song',
        artistCredit: [{ name: 'Fallback Artist', joinPhrase: '' }],
      },
    ]);
    await testApp.db.insert(trackProcessings).values([
      { trackId: 'sonic-completed', status: 'COMPLETED' },
      { trackId: 'sonic-pending', status: 'QUEUED' },
      { trackId: 'sonic-failed', status: 'FAILED' },
      { trackId: 'sonic-completed-2', status: 'COMPLETED' },
    ]);
    const index = testApp.app.get(SearchIndexService);
    await index.rebuild();
  }, 30_000);

  afterEach(async () => {
    await testApp?.close();
    await catalog?.close();
  });

  afterAll(async () => {
    await sonic?.stop();
  });

  // Supertest connects from loopback, a trusted proxy by default, so
  // X-Forwarded-For sets the client IP and isolates each test's rate-limit
  // bucket (the search route allows 30/min per IP).
  type SearchParams = {
    query: string;
    scope?: string;
    limit?: string;
    offset?: string;
  };
  const searchAs = (app: TestApp, clientIp: string, query: SearchParams) =>
    app.http.get('/v1/search').set('X-Forwarded-For', clientIp).query(query);

  it('returns catalog association ids in relevance order', async () => {
    const response = await searchAs(testApp, '203.0.113.11', {
      query: 'queen',
    }).expect(200);

    expect(searchResultSchema.parse(response.body)).toEqual(response.body);
    expect(response.body.source).toBe('music-catalog');
    expect(
      response.body.results.map((item: { title: string }) => item.title),
    ).toEqual(['First Song', 'Second Song']);
    expect(
      response.body.results.map((item: { trackId: unknown }) => item.trackId),
    ).toEqual(['catalog-track-1', null]);
    expect(response.body.results[0].coverUrl).toContain('https://');
  });

  it('needs no authentication', async () => {
    await searchAs(testApp, '203.0.113.12', { query: 'queen' }).expect(200);
    expect(catalog.seenAuth).toEqual(
      expect.arrayContaining([`Bearer ${FAKE_CATALOG_API_KEY}`]),
    );
  });

  it('ignores a scope an older client sends and forwards the paging', async () => {
    const response = await searchAs(testApp, '203.0.113.13', {
      query: 'queen',
      scope: 'lyrics',
      limit: '10',
      offset: '5',
    }).expect(200);

    expect(response.body.results).toHaveLength(2);
  });

  it.each([
    { query: '   ' },
    { query: '', scope: 'metadata' },
    { query: 'queen', limit: '0' },
    { query: 'queen', limit: '101' },
    { query: 'queen', offset: '-1' },
  ])('rejects the invalid query %j with VALIDATION_FAILED', async (query) => {
    const response = await searchAs(testApp, '203.0.113.14', query).expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      details: expect.objectContaining({ location: 'query' }),
    });
  });

  it('preserves Sonic order and hydrates only eligible Tracks', async () => {
    const fallbackApp = await createFallbackTestApp();
    try {
      const sonicService = testApp.app.get(SonicService);
      await sonicService.indexTrack('sonic-pending', 'not-ready fallback song');
      await sonicService.indexTrack('sonic-failed', 'not-ready fallback song');
      await sonicService.indexTrack('sonic-stale', 'not-ready fallback song');
      const sonicOrder = await sonicService.search(
        'not-ready fallback song',
        20,
        0,
      );
      const response = await searchAs(fallbackApp, '203.0.113.15', {
        query: 'not-ready fallback song',
      }).expect(200);
      expect(response.body.source).toBe('sonic');
      expect(sonicOrder).toEqual(
        expect.arrayContaining([
          'sonic-completed',
          'sonic-completed-2',
          'sonic-pending',
          'sonic-failed',
          'sonic-stale',
        ]),
      );
      expect(
        response.body.results.map((item: { trackId: string }) => item.trackId),
      ).toEqual(
        sonicOrder.filter((id) =>
          ['sonic-completed', 'sonic-completed-2'].includes(id),
        ),
      );
      expect(response.body.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ trackId: 'sonic-completed' }),
          expect.objectContaining({ trackId: 'sonic-completed-2' }),
        ]),
      );
    } finally {
      await fallbackApp.close();
    }
  });

  it('falls back to Sonic when the catalog times out and bypasses it afterward', async () => {
    await testApp.db.insert(tracks).values({
      id: 'sonic-slow',
      recordingMbid: testMbid(14),
      title: 'Slow fallback result',
      artistCredit: [{ name: 'Fallback Artist', joinPhrase: '' }],
    });
    await testApp.db.insert(trackProcessings).values({
      trackId: 'sonic-slow',
      status: 'COMPLETED',
    });
    await testApp.app.get(SearchIndexService).rebuild();

    const response = await searchAs(testApp, '203.0.113.16', {
      query: 'slow',
    }).expect(200);
    expect(response.body.source).toBe('sonic');
    expect(response.body.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ trackId: 'sonic-slow' }),
      ]),
    );

    const next = await searchAs(testApp, '203.0.113.16', {
      query: 'after-timeout',
    }).expect(200);
    expect(next.body.source).toBe('sonic');
    expect(catalog.seenQueries).not.toContain('after-timeout');
  });

  it('returns INTERNAL_ERROR for an unreadable catalog frame instead of hiding it', async () => {
    const response = await searchAs(testApp, '203.0.113.22', {
      query: 'malformed',
    }).expect(500);

    expect(response.body).toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
    });
  });

  it('returns INTERNAL_ERROR when the catalog sends only an unreadable frame', async () => {
    const response = await searchAs(testApp, '203.0.113.23', {
      query: 'garbage',
    }).expect(500);

    expect(response.body).toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
    });
  });

  it('does not hide an unreadable response when the catalog closes', async () => {
    const response = await searchAs(testApp, '203.0.113.26', {
      query: 'garbage-close',
    }).expect(500);

    expect(response.body).toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
    });
  });

  it('falls back on a graceful in-flight close and verifies recovery without visitor traffic', async () => {
    const interrupted = await searchAs(testApp, '203.0.113.24', {
      query: 'disconnect',
    }).expect(200);
    expect(interrupted.body).toEqual({ results: [], source: 'sonic' });

    const afterClose = await searchAs(testApp, '203.0.113.24', {
      query: 'fallback',
    }).expect(200);
    expect(afterClose.body.source).toBe('sonic');
    expect(catalog.seenQueries ?? []).not.toContain('fallback');

    const probeQuery = 'vozzify primary health check';
    await vi.waitFor(
      () => expect(catalog.seenQueries ?? []).toContain(probeQuery),
      {
        timeout: 5_000,
      },
    );
    const stillFallback = await searchAs(testApp, '203.0.113.24', {
      query: 'fallback',
    }).expect(200);
    expect(stillFallback.body.source).toBe('sonic');

    probeReady = true;
    await vi.waitFor(
      () =>
        expect(
          (catalog.seenQueries ?? []).filter((query) => query === probeQuery),
        ).toHaveLength(2),
      { timeout: 5_000 },
    );
    const recovered = await searchAs(testApp, '203.0.113.24', {
      query: 'queen',
    }).expect(200);
    expect(recovered.body).toMatchObject({ source: 'music-catalog' });
  }, 15_000);

  it('keeps Sonic unavailable through an interrupted rebuild and restores it on rerun', async () => {
    const index = testApp.app.get(SearchIndexService);
    const tracksSearch = testApp.app.get(TracksSearchService);
    const originalPage = tracksSearch.findSearchIndexPage.bind(tracksSearch);
    const pageSpy = vi
      .spyOn(tracksSearch, 'findSearchIndexPage')
      .mockImplementationOnce(async (afterId, limit) =>
        (await originalPage(afterId, limit)).slice(0, 1),
      )
      .mockRejectedValueOnce(new Error('injected backfill interruption'));

    await expect(index.rebuild()).rejects.toThrow(
      'injected backfill interruption',
    );
    await searchAs(testApp, '203.0.113.25', {
      query: 'not-ready fallback song',
    }).expect(503);

    pageSpy.mockRestore();
    await index.rebuild();
    const completedProbesBefore = (catalog.seenQueries ?? []).filter(
      (query) => query === 'vozzify primary health check',
    ).length;
    const recovered = await searchAs(testApp, '203.0.113.25', {
      query: 'not-ready fallback song',
    }).expect(200);
    expect(recovered.body.source).toBe('sonic');
    await vi.waitFor(
      () =>
        expect(
          (catalog.seenQueries ?? []).filter(
            (query) => query === 'vozzify primary health check',
          ).length,
        ).toBeGreaterThan(completedProbesBefore),
      { timeout: 5_000 },
    );
  });

  it('multiplexes concurrent searches with out-of-order answers', async () => {
    const responses = await Promise.all(
      [0, 1, 2, 3, 4].map((index) =>
        searchAs(testApp, '203.0.113.17', {
          query: `concurrent-${index}`,
        }).expect(200),
      ),
    );

    for (const [index, response] of responses.entries()) {
      expect(
        response.body.results.map((item: { title: string }) => item.title),
      ).toEqual([`Song ${index}`]);
    }
  });

  it('rate limits the public endpoint per IP', async () => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await searchAs(testApp, '203.0.113.18', { query: 'queen' }).expect(200);
    }
    const limited = await searchAs(testApp, '203.0.113.18', {
      query: 'queen',
    }).expect(429);

    expect(limited.body).toMatchObject({
      statusCode: 429,
      code: 'RATE_LIMITED',
    });
    // Another client IP still has its own bucket.
    await searchAs(testApp, '203.0.113.19', { query: 'queen' }).expect(200);
  });

  it('keeps healthy primary results when Sonic is unavailable', async () => {
    const app = await createSearchApp({
      SONIC_HOST: '127.0.0.1',
      SONIC_PORT: 1,
      SONIC_AUTH_PASSWORD: 'invalid-sonic-password',
    });
    try {
      const response = await searchAs(app, '203.0.113.20', {
        query: 'queen',
      }).expect(200);
      expect(response.body.source).toBe('music-catalog');
    } finally {
      await app.close();
    }
  });

  it('answers 503 when both search engines are unavailable', async () => {
    const app = await createSearchApp({
      MUSIC_CATALOG_URL: 'ws://127.0.0.1:1',
      SONIC_HOST: '127.0.0.1',
      SONIC_PORT: 1,
      SONIC_AUTH_PASSWORD: 'invalid-sonic-password',
    });
    try {
      const response = await searchAs(app, '203.0.113.21', {
        query: 'queen',
      }).expect(503);
      expect(response.body).toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        statusCode: 503,
      });
    } finally {
      await app.close();
    }
  });

  it('surfaces Sonic authentication failures as INTERNAL_ERROR', async () => {
    const app = await createSearchApp({
      MUSIC_CATALOG_URL: 'ws://127.0.0.1:1',
      SONIC_AUTH_PASSWORD: 'incorrect-sonic-password',
    });
    try {
      const response = await searchAs(app, '203.0.113.23', {
        query: 'queen',
      }).expect(500);
      expect(response.body).toMatchObject({ code: 'INTERNAL_ERROR' });
    } finally {
      await app.close();
    }
  });

  const createFallbackTestApp = (): Promise<TestApp> =>
    createSearchApp({
      SONIC_HOST: sonic.getHost(),
      SONIC_PORT: sonic.getMappedPort(1491),
      SONIC_AUTH_PASSWORD: 'local-dev-sonic-password-change-me',
    });

  const createSearchApp = (
    env: Partial<import('../src/config/env.js').Env>,
  ): Promise<TestApp> =>
    createTestApp({
      env: {
        MUSIC_CATALOG_URL: catalog.url,
        MUSIC_CATALOG_API_KEY: FAKE_CATALOG_API_KEY,
        MUSIC_CATALOG_REQUEST_TIMEOUT_MS: 200,
        SONIC_HOST: sonic.getHost(),
        SONIC_PORT: sonic.getMappedPort(1491),
        SONIC_AUTH_PASSWORD: 'local-dev-sonic-password-change-me',
        SONIC_REQUEST_TIMEOUT_MS: 2_000,
        ...env,
      },
    });
});

function fakeCatalogAnswer(
  payload: Record<string, unknown>,
  probeReady: boolean,
): ReturnType<FakeCatalogHandler> {
  const query = String(payload.query ?? '');
  if (query === 'garbage') return { sendUnreadableFrame: true };
  if (query === 'garbage-close') {
    return { sendUnreadableFrame: true, closeAfterUnreadableFrame: true };
  }
  if (query === 'slow') return { delayMs: 1_000, result: { results: [] } };
  const exceptional = exceptionalCatalogAnswer(query, probeReady);
  if (exceptional !== undefined) return exceptional;
  return concurrentCatalogAnswer(query) ?? regularCatalogAnswer();
}

function exceptionalCatalogAnswer(
  query: string,
  probeReady: boolean,
): ReturnType<FakeCatalogHandler> | undefined {
  if (query.startsWith('not-ready')) {
    return {
      error: { code: 'CATALOG_NOT_READY', message: 'Catalog is starting' },
    };
  }
  if (query === 'disconnect') return { closeConnection: true };
  if (query === 'vozzify primary health check') {
    return probeReady
      ? { result: { results: [] } }
      : {
          error: {
            code: 'CATALOG_NOT_READY',
            message: 'Catalog is starting',
          },
        };
  }
  if (query === 'malformed')
    return { result: { results: [{ malformed: true }] } };
  return undefined;
}

function concurrentCatalogAnswer(
  query: string,
): ReturnType<FakeCatalogHandler> | undefined {
  if (!query.startsWith('concurrent-')) return undefined;
  // Later queries answer first, so the API must route by request id.
  const index = Number(query.split('-')[1] ?? 0);
  return {
    delayMs: (5 - index) * 20,
    result: {
      results: [
        {
          ...recordingSummary(testMbid(index + 1), `Song ${index}`),
          coverUrl: 'https://coverartarchive.org/release/test/front-500',
        },
      ],
    },
  };
}

function regularCatalogAnswer(): ReturnType<FakeCatalogHandler> {
  return {
    result: {
      results: [
        {
          ...recordingSummary(testMbid(1), 'First Song'),
          trackId: 'catalog-track-1',
          coverUrl: 'https://coverartarchive.org/release/test/front-500',
        },
        recordingSummary(testMbid(2), 'Second Song'),
      ],
    },
  };
}
