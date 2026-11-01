import { fileURLToPath } from 'node:url';
import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from 'testcontainers';
import { trackProcessings } from '../src/database/schema/track-processings.js';
import { tracks } from '../src/database/schema/tracks.js';
import { SearchIndexService } from '../src/modules/search/search-index.service.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';
import { resetDatabase } from './utils/database.js';
import {
  type DelayedHandshakeMusicCatalog,
  startDelayedHandshakeMusicCatalog,
} from './utils/delayed-handshake-music-catalog.js';
import { testMbid } from './utils/factories.js';

describe('Music catalog search deadline (e2e)', () => {
  let catalog: DelayedHandshakeMusicCatalog;
  let testApp: TestApp;
  let sonic: StartedTestContainer;

  beforeAll(async () => {
    sonic = await new GenericContainer('valeriansaliou/sonic:v1.10.1')
      .withCommand(['sonic', '-c', '/etc/sonic/config.toml'])
      .withCopyFilesToContainer([
        {
          source: fileURLToPath(
            new URL('../sonic/config.toml', import.meta.url),
          ),
          target: '/etc/sonic/config.toml',
        },
      ])
      .withExposedPorts(1491)
      .withWaitStrategy(Wait.forLogMessage('reading config file', 1))
      .withStartupTimeout(120_000)
      .start();
  }, 120_000);

  beforeEach(async () => {
    testApp = await createTestApp({
      env: {
        MUSIC_CATALOG_URL: undefined,
        MUSIC_CATALOG_API_KEY: undefined,
        SONIC_HOST: sonic.getHost(),
        SONIC_PORT: sonic.getMappedPort(1491),
        SONIC_AUTH_PASSWORD: 'local-dev-sonic-password-change-me',
        SONIC_REQUEST_TIMEOUT_MS: 2_000,
      },
    });
    await resetDatabase(testApp.db);
    await testApp.db.insert(tracks).values({
      id: 'sonic-completed',
      recordingMbid: testMbid(10),
      title: 'Not ready fallback song',
      artistCredit: [{ name: 'Fallback Artist', joinPhrase: '' }],
    });
    await testApp.db.insert(trackProcessings).values({
      trackId: 'sonic-completed',
      status: 'COMPLETED',
    });
    await testApp.app.get(SearchIndexService).rebuild();
    await testApp.close();

    catalog = await startDelayedHandshakeMusicCatalog();
    testApp = await createTestApp({
      env: {
        MUSIC_CATALOG_URL: catalog.url,
        MUSIC_CATALOG_API_KEY: 'fake-music-catalog-key-change-me-0001',
        MUSIC_CATALOG_REQUEST_TIMEOUT_MS: 10_000,
        SONIC_HOST: sonic.getHost(),
        SONIC_PORT: sonic.getMappedPort(1491),
        SONIC_AUTH_PASSWORD: 'local-dev-sonic-password-change-me',
        SONIC_REQUEST_TIMEOUT_MS: 2_000,
      },
    });
    await catalog.waitForHandshake();
  }, 30_000);

  afterEach(async () => {
    await testApp?.close();
    await catalog?.close();
  });

  afterAll(async () => {
    await sonic?.stop();
  });

  it('uses Sonic at the two-second boundary and recovers only after an empty probe', async () => {
    vi.useFakeTimers({
      toFake: [
        'Date',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
      ],
    });
    try {
      const startedAt = Date.now();
      let settled = false;
      const timedSearch = search('not-ready fallback song').then((response) => {
        settled = true;
        return response;
      });
      setTimeout(() => catalog.acceptHandshake(), 1_500);
      await vi.advanceTimersByTimeAsync(1_499);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await catalog.waitForQueryCount('not-ready fallback song', 1);
      await vi.advanceTimersByTimeAsync(499);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      const fallback = await timedSearch;
      expect(Date.now() - startedAt).toBe(2_000);
      expect(fallback.status).toBe(200);
      expect(fallback.body.source).toBe('sonic');
      expect(
        fallback.body.results.map(
          (result: { trackId: string }) => result.trackId,
        ),
      ).toContain('sonic-completed');

      const stillFallback = await search('still-fallback');
      expect(stillFallback.body.source).toBe('sonic');
      expect(catalog.seenQueries).not.toContain('still-fallback');

      const firstProbe = catalog.waitForQueryCount(
        'vozzify primary health check',
        1,
      );
      await vi.advanceTimersByTimeAsync(3_000);
      await firstProbe;
      catalog.answerVisitorLate();
      catalog.answerProbe(false);
      await new Promise<void>((resolve) => setImmediate(resolve));
      const secondProbe = catalog.waitForQueryCount(
        'vozzify primary health check',
        2,
      );
      await vi.advanceTimersByTimeAsync(3_000);
      await secondProbe;
      catalog.answerProbe(true);
      await new Promise<void>((resolve) => setImmediate(resolve));

      const recovered = await search('fresh-after-recovery');
      expect(recovered.body.source).toBe('music-catalog');
      expect(catalog.seenQueries).toContain('fresh-after-recovery');
    } finally {
      vi.useRealTimers();
    }
  });

  function search(query: string) {
    return testApp.http
      .get('/v1/search')
      .set('X-Forwarded-For', '203.0.113.28')
      .query({ query });
  }
});
