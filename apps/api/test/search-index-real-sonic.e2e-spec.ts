import { searchResultSchema } from '@vozzify/contracts';
import { eq } from 'drizzle-orm';
import { trackProcessings } from '../src/database/schema/track-processings.js';
import { trackSearchIndexEvents } from '../src/database/schema/track-search-index-events.js';
import { tracks } from '../src/database/schema/tracks.js';
import { SonicService } from '../src/integrations/sonic/sonic.service.js';
import { SearchIndexService } from '../src/modules/search/search-index.service.js';
import { TrackPipelineService } from '../src/modules/tracks/track-pipeline.service.js';
import { TrackSearchIndexService } from '../src/modules/tracks/track-search-index.service.js';
import { TrackSearchIndexEventRepository } from '../src/modules/tracks/track-search-index-event.repository.js';
import { DONE } from '../src/modules/tracks/track-step-outcome.js';
import { TrackStepsService } from '../src/modules/tracks/track-steps.service.js';
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
  let sonicEnv: {
    MUSIC_CATALOG_URL: string;
    MUSIC_CATALOG_API_KEY: string;
    MUSIC_CATALOG_REQUEST_TIMEOUT_MS: number;
    SONIC_HOST: string;
    SONIC_PORT: number;
    SONIC_AUTH_PASSWORD: string;
    SONIC_REQUEST_TIMEOUT_MS: number;
  };

  beforeAll(async () => {
    sonic = await startSonicContainer();
    catalog = await startFakeMusicCatalog(() => ({ result: { results: [] } }));
    sonicEnv = {
      MUSIC_CATALOG_URL: catalog.url,
      MUSIC_CATALOG_API_KEY: FAKE_CATALOG_API_KEY,
      MUSIC_CATALOG_REQUEST_TIMEOUT_MS: 200,
      SONIC_HOST: sonic.getHost(),
      SONIC_PORT: sonic.getMappedPort(1491),
      SONIC_AUTH_PASSWORD: 'local-dev-sonic-password-change-me',
      SONIC_REQUEST_TIMEOUT_MS: 2_000,
    };
    testApp = await createProcessingApp();
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
      title: 'Outbox quartzobsolete phrase',
      artistCredit: [
        { name: 'Index Artist', joinPhrase: ' feat. ' },
        { name: 'Guest Artist', joinPhrase: '' },
      ],
    });
    await testApp.db.insert(trackProcessings).values({
      id: processingId,
      trackId,
      status: 'EXTRACTING_LYRICS',
    });

    await testApp.app
      .get(TrackPipelineService)
      .runStep({ processingId, step: 'EXTRACTING_LYRICS' }, true);
    const delivery = testApp.app.get(TrackSearchIndexService);
    const [initial] = await testApp.db
      .select()
      .from(trackSearchIndexEvents)
      .where(eq(trackSearchIndexEvents.trackId, trackId));
    expect(initial?.searchableText).toBe(
      'Outbox quartzobsolete phrase Index Artist feat. Guest Artist',
    );
    const firstSonic = testApp.app.get(SonicService);
    const failWrite = vi
      .spyOn(firstSonic, 'replaceTrack')
      .mockRejectedValueOnce(new Error('simulated Sonic outage'));
    await delivery.dispatchPending();
    failWrite.mockRestore();
    const [failed] = await testApp.db
      .select()
      .from(trackSearchIndexEvents)
      .where(eq(trackSearchIndexEvents.trackId, trackId));
    expect(failed).toMatchObject({ deliveredAt: null, attempts: 1 });
    if (failed === undefined) throw new Error('Expected retryable event');

    await testApp.close();
    testApp = await createProcessingApp();
    const restartedDelivery = testApp.app.get(TrackSearchIndexService);
    const restartedEvents = testApp.app.get(TrackSearchIndexEventRepository);
    const acknowledge = vi
      .spyOn(restartedEvents, 'markDelivered')
      .mockRejectedValueOnce(new Error('simulated worker interruption'));
    await restartedDelivery.dispatchPending(failed.nextAttemptAt);
    acknowledge.mockRestore();
    const fallback = await getFallbackApp();

    const original = await fallback.http
      .get('/v1/search')
      .set('X-Forwarded-For', '203.0.113.44')
      .query({ query: 'quartzobsolete' })
      .expect(200);
    expect(searchResultSchema.parse(original.body)).toMatchObject({
      source: 'sonic',
      results: [
        expect.objectContaining({
          title: 'Outbox quartzobsolete phrase',
          trackId,
        }),
      ],
    });

    const [pending] = await testApp.db
      .select()
      .from(trackSearchIndexEvents)
      .where(eq(trackSearchIndexEvents.trackId, trackId));
    expect(pending?.deliveredAt).toBeNull();
    if (pending === undefined) throw new Error('Expected retryable event');
    await restartedDelivery.dispatchPending(pending.nextAttemptAt);
    const resent = await fallback.http
      .get('/v1/search')
      .set('X-Forwarded-For', '203.0.113.45')
      .query({ query: 'quartzobsolete' })
      .expect(200);
    expect(
      searchResultSchema
        .parse(resent.body)
        .results.filter((item) => item.trackId === trackId),
    ).toHaveLength(1);

    await testApp.db
      .update(tracks)
      .set({
        title: 'Outbox zirconreplacement phrase',
        updatedAt: new Date(Date.now() + 1_000),
      })
      .where(eq(tracks.id, trackId));
    await testApp.app.get(SearchIndexService).rebuild();
    const replaced = await fallback.http
      .get('/v1/search')
      .set('X-Forwarded-For', '203.0.113.46')
      .query({ query: 'zirconreplacement' })
      .expect(200);
    expect(searchResultSchema.parse(replaced.body).results).toEqual([
      expect.objectContaining({
        title: 'Outbox zirconreplacement phrase',
        artistCredit: 'Index Artist feat. Guest Artist',
        trackId,
      }),
    ]);

    const oldTerms = await fallback.http
      .get('/v1/search')
      .set('X-Forwarded-For', '203.0.113.48')
      .query({ query: 'quartzobsolete' })
      .expect(200);
    expect(
      searchResultSchema
        .parse(oldTerms.body)
        .results.some((item) => item.trackId === trackId),
    ).toBe(false);

    await testApp.db.delete(tracks).where(eq(tracks.id, trackId));
    const removedAt = new Date(Date.now() + 2_000);
    await restartedEvents.enqueueDelete(trackId, removedAt);
    await restartedDelivery.dispatchPending(removedAt);
    const removed = await fallback.http
      .get('/v1/search')
      .set('X-Forwarded-For', '203.0.113.47')
      .query({ query: 'zirconreplacement' })
      .expect(200);
    expect(searchResultSchema.parse(removed.body).results).toEqual([]);
  }, 30_000);

  it('delivers a completion that lands during keyset reconstruction', async () => {
    const completedDuringRebuild = {
      id: 'a-completed-during-rebuild',
      processingId: 'a-completed-during-rebuild-run',
    };
    const backfillTrackId = 'z-backfill-page-track';
    await testApp.db.insert(tracks).values([
      {
        id: completedDuringRebuild.id,
        recordingMbid: '00000000-0000-4000-8000-000000000015',
        title: 'Concurrentrebuildunique',
        artistCredit: [{ name: 'Concurrent Artist', joinPhrase: '' }],
      },
      {
        id: backfillTrackId,
        recordingMbid: '00000000-0000-4000-8000-000000000016',
        title: 'Backfill page title',
        artistCredit: [{ name: 'Backfill Artist', joinPhrase: '' }],
      },
    ]);
    await testApp.db.insert(trackProcessings).values([
      {
        id: completedDuringRebuild.processingId,
        trackId: completedDuringRebuild.id,
        status: 'EXTRACTING_LYRICS',
      },
      { trackId: backfillTrackId, status: 'COMPLETED' },
    ]);

    const events = testApp.app.get(TrackSearchIndexEventRepository);
    const enqueuePage = events.enqueueBackfillPage.bind(events);
    const complete = testApp.app
      .get(TrackPipelineService)
      .runStep.bind(testApp.app.get(TrackPipelineService));
    let didComplete = false;
    vi.spyOn(events, 'enqueueBackfillPage').mockImplementation(async (rows) => {
      await enqueuePage(rows);
      if (!didComplete) {
        didComplete = true;
        await complete(
          {
            processingId: completedDuringRebuild.processingId,
            step: 'EXTRACTING_LYRICS',
          },
          true,
        );
      }
    });

    await testApp.app.get(SearchIndexService).rebuild();

    const fallback = await getFallbackApp();
    const response = await fallback.http
      .get('/v1/search')
      .set('X-Forwarded-For', '203.0.113.49')
      .query({ query: 'concurrentrebuildunique' })
      .expect(200);
    expect(searchResultSchema.parse(response.body).results).toEqual([
      expect.objectContaining({
        title: 'Concurrentrebuildunique',
        trackId: completedDuringRebuild.id,
      }),
    ]);
  }, 30_000);

  async function createProcessingApp(): Promise<TestApp> {
    return createTestApp({
      env: sonicEnv,
      override: (builder) =>
        builder.overrideProvider(TrackStepsService).useValue({
          extractLyrics: vi.fn().mockResolvedValue(DONE),
        }),
    });
  }

  async function getFallbackApp(): Promise<TestApp> {
    fallbackApp ??= await createTestApp({
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
    return fallbackApp;
  }
});
