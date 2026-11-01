import { searchResultSchema } from '@vozzify/contracts';
import { eq } from 'drizzle-orm';
import { trackProcessings } from '../src/database/schema/track-processings.js';
import { trackSearchIndexEvents } from '../src/database/schema/track-search-index-events.js';
import { tracks } from '../src/database/schema/tracks.js';
import { SearchIndexService } from '../src/modules/search/search-index.service.js';
import { TrackProcessingRepository } from '../src/modules/tracks/track-processing.repository.js';
import { TrackSearchIndexService } from '../src/modules/tracks/track-search-index.service.js';
import { TrackSearchIndexEventRepository } from '../src/modules/tracks/track-search-index-event.repository.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';
import { resetDatabase } from './utils/database.js';
import {
  FAKE_CATALOG_API_KEY,
  startFakeMusicCatalog,
} from './utils/fake-music-catalog.js';
import { startSonicContainer } from './utils/sonic-container.js';

describe('completed Track Sonic indexing with real Sonic (e2e)', () => {
  let testApp: TestApp;
  let fallbackApp: TestApp | undefined;
  let catalog: Awaited<ReturnType<typeof startFakeMusicCatalog>>;
  let sonic: Awaited<ReturnType<typeof startSonicContainer>>;

  beforeAll(async () => {
    sonic = await startSonicContainer();
    catalog = await startFakeMusicCatalog(() => ({ result: { results: [] } }));
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
  }, 120_000);

  afterAll(async () => {
    await testApp?.close();
    await fallbackApp?.close();
    await catalog?.close();
    await sonic?.stop();
  });

  beforeEach(async () => {
    await resetDatabase(testApp.db);
    await testApp.app.get(SearchIndexService).rebuild();
  }, 30_000);

  it('delivers completion, safely resends, rebuilds changed metadata and removes a tombstoned document', async () => {
    const trackId = 'sonic-completed-by-processing';
    const processingId = 'sonic-completed-by-processing-run';
    await testApp.db.insert(tracks).values({
      id: trackId,
      recordingMbid: '00000000-0000-4000-8000-000000000014',
      title: 'Outbox original phrase',
      artistCredit: [{ name: 'Index Artist', joinPhrase: '' }],
    });
    await testApp.db.insert(trackProcessings).values({
      id: processingId,
      trackId,
      status: 'EXTRACTING_LYRICS',
    });

    await expect(
      testApp.app
        .get(TrackProcessingRepository)
        .markCompleted(processingId, 'EXTRACTING_LYRICS'),
    ).resolves.toBe(true);
    const delivery = testApp.app.get(TrackSearchIndexService);
    const events = testApp.app.get(TrackSearchIndexEventRepository);
    const acknowledge = vi
      .spyOn(events, 'markDelivered')
      .mockRejectedValueOnce(new Error('simulated worker interruption'));
    await delivery.dispatchPending();
    acknowledge.mockRestore();
    fallbackApp = await createTestApp({
      env: {
        MUSIC_CATALOG_URL: 'ws://127.0.0.1:1',
        MUSIC_CATALOG_API_KEY: FAKE_CATALOG_API_KEY,
        MUSIC_CATALOG_REQUEST_TIMEOUT_MS: 200,
        SONIC_HOST: sonic.getHost(),
        SONIC_PORT: sonic.getMappedPort(1491),
        SONIC_AUTH_PASSWORD: 'local-dev-sonic-password-change-me',
        SONIC_REQUEST_TIMEOUT_MS: 2_000,
      },
    });

    const original = await fallbackApp.http
      .get('/v1/search')
      .set('X-Forwarded-For', '203.0.113.44')
      .query({ query: 'outbox original phrase' })
      .expect(200);
    expect(searchResultSchema.parse(original.body)).toMatchObject({
      source: 'sonic',
      results: [
        expect.objectContaining({ title: 'Outbox original phrase', trackId }),
      ],
    });

    const [pending] = await testApp.db
      .select()
      .from(trackSearchIndexEvents)
      .where(eq(trackSearchIndexEvents.trackId, trackId));
    expect(pending?.deliveredAt).toBeNull();
    if (pending === undefined) throw new Error('Expected retryable event');
    await delivery.dispatchPending(pending.nextAttemptAt);
    const resent = await fallbackApp.http
      .get('/v1/search')
      .set('X-Forwarded-For', '203.0.113.45')
      .query({ query: 'outbox original phrase' })
      .expect(200);
    expect(
      searchResultSchema
        .parse(resent.body)
        .results.filter((item) => item.trackId === trackId),
    ).toHaveLength(1);

    await testApp.db
      .update(tracks)
      .set({
        title: 'Outbox replacement phrase',
        updatedAt: new Date(Date.now() + 1_000),
      })
      .where(eq(tracks.id, trackId));
    await testApp.app.get(SearchIndexService).rebuild();
    const replaced = await fallbackApp.http
      .get('/v1/search')
      .set('X-Forwarded-For', '203.0.113.46')
      .query({ query: 'outbox replacement phrase' })
      .expect(200);
    expect(searchResultSchema.parse(replaced.body).results).toEqual([
      expect.objectContaining({ title: 'Outbox replacement phrase', trackId }),
    ]);

    await testApp.db.delete(tracks).where(eq(tracks.id, trackId));
    const removedAt = new Date(Date.now() + 2_000);
    await events.enqueueDelete(trackId, removedAt);
    await delivery.dispatchPending(removedAt);
    const removed = await fallbackApp.http
      .get('/v1/search')
      .set('X-Forwarded-For', '203.0.113.47')
      .query({ query: 'outbox replacement phrase' })
      .expect(200);
    expect(searchResultSchema.parse(removed.body).results).toEqual([]);
  }, 30_000);
});
