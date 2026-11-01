import { searchResultSchema } from '@vozzify/contracts';
import { createTestApp, type TestApp } from './utils/create-test-app.js';
import { testMbid } from './utils/factories.js';
import {
  FAKE_CATALOG_API_KEY,
  type FakeMusicCatalog,
  startFakeMusicCatalog,
} from './utils/fake-music-catalog.js';
import { recordingSummary } from './utils/recording-summaries.js';

// End-to-end unauthenticated search through the API over one persistent
// Music catalog WebSocket: the API multiplexes queries by request id,
// forwards each catalog-provided Track association, bounds abuse with a per-IP rate
// limit, and surfaces catalog outages as retryable 503/504 errors.
describe('Catalog search plus limits plus errors (e2e)', () => {
  let catalog: FakeMusicCatalog;
  let testApp: TestApp;

  beforeAll(async () => {
    catalog = await startFakeMusicCatalog((payload) => {
      const query = String(payload.query ?? '');
      if (query === 'slow') {
        return { delayMs: 1_000, result: { results: [] } };
      }
      if (query === 'not-ready') {
        return {
          error: { code: 'CATALOG_NOT_READY', message: 'Catalog is starting' },
        };
      }
      if (query.startsWith('concurrent-')) {
        // Later queries answer first, so the API must route by id instead
        // of arrival order.
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
    });
    testApp = await createTestApp({
      env: {
        MUSIC_CATALOG_URL: catalog.url,
        MUSIC_CATALOG_API_KEY: FAKE_CATALOG_API_KEY,
        MUSIC_CATALOG_REQUEST_TIMEOUT_MS: 200,
      },
    });
  });

  afterAll(async () => {
    await testApp.close();
    await catalog.close();
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
  const searchAs = (clientIp: string, query: SearchParams) =>
    testApp.http
      .get('/v1/search')
      .set('X-Forwarded-For', clientIp)
      .query(query);

  it('returns catalog association ids in relevance order', async () => {
    const response = await searchAs('203.0.113.11', {
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
    await searchAs('203.0.113.12', { query: 'queen' }).expect(200);
    expect(catalog.seenAuth).toEqual(
      expect.arrayContaining([`Bearer ${FAKE_CATALOG_API_KEY}`]),
    );
  });

  it('ignores a scope an older client sends and forwards the paging', async () => {
    const response = await searchAs('203.0.113.13', {
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
    const response = await searchAs('203.0.113.14', query).expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      details: expect.objectContaining({ location: 'query' }),
    });
  });

  it('answers 503 SERVICE_UNAVAILABLE when the catalog is not ready', async () => {
    const response = await searchAs('203.0.113.15', {
      query: 'not-ready',
    }).expect(503);

    expect(response.body).toMatchObject({
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
    });
  });

  it('answers 504 GATEWAY_TIMEOUT instead of hanging', async () => {
    const response = await searchAs('203.0.113.16', { query: 'slow' }).expect(
      504,
    );

    expect(response.body).toMatchObject({
      statusCode: 504,
      code: 'GATEWAY_TIMEOUT',
    });
  });

  it('multiplexes concurrent searches with out-of-order answers', async () => {
    const responses = await Promise.all(
      [0, 1, 2, 3, 4].map((index) =>
        searchAs('203.0.113.17', { query: `concurrent-${index}` }).expect(200),
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
      await searchAs('203.0.113.18', { query: 'queen' }).expect(200);
    }
    const limited = await searchAs('203.0.113.18', {
      query: 'queen',
    }).expect(429);

    expect(limited.body).toMatchObject({
      statusCode: 429,
      code: 'RATE_LIMITED',
    });
    // Another client IP still has its own bucket.
    await searchAs('203.0.113.19', { query: 'queen' }).expect(200);
  });
});
