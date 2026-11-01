import { createTrackResultSchema } from '@vozzify/contracts';
import { eq, sql } from 'drizzle-orm';
import { trackAssociationEvents } from '../src/database/schema/track-association-events.js';
import { tracks } from '../src/database/schema/tracks.js';
import { TrackAssociationEventRepository } from '../src/modules/tracks/track-association-event.repository.js';
import { TrackAssociationSyncRepository } from '../src/modules/tracks/track-association-sync.repository.js';
import { TrackAssociationSyncService } from '../src/modules/tracks/track-association-sync.service.js';
import { TracksRepository } from '../src/modules/tracks/tracks.repository.js';
import { createAuthClient, signIn } from './utils/auth.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';
import { resetDatabase } from './utils/database.js';
import {
  createPasswordUser,
  DEFAULT_PASSWORD,
  testMbid,
} from './utils/factories.js';
import {
  FAKE_CATALOG_API_KEY,
  startFakeMusicCatalog,
} from './utils/fake-music-catalog.js';
import { recordingFixture } from './utils/recording-fixtures.js';

describe('Track association score transaction (e2e)', () => {
  let catalog: Awaited<ReturnType<typeof startFakeMusicCatalog>>;
  let testApp: TestApp;

  beforeAll(async () => {
    catalog = await startFakeMusicCatalog((payload) => ({
      result: recordingFixture({ mbid: String(payload.mbid) }),
    }));
    testApp = await createTestApp({
      env: {
        MUSIC_CATALOG_URL: catalog.url,
        MUSIC_CATALOG_API_KEY: FAKE_CATALOG_API_KEY,
      },
    });
  });

  beforeEach(async () => resetDatabase(testApp.db));

  afterAll(async () => {
    await testApp.close();
    await catalog.close();
  });

  it('rolls back the Track score when durable publication fails', async () => {
    const user = await createPasswordUser(testApp.db);
    const client = createAuthClient(testApp);
    await signIn(client, { email: user.email, password: DEFAULT_PASSWORD });
    const response = await client
      .post('/v1/tracks')
      .send({ recordingMbid: testMbid(1), locale: 'en' })
      .expect(202);
    const { trackId } = createTrackResultSchema.parse(response.body);
    await testApp.db.execute(sql`
      alter table track_association_events
      add constraint reject_score_nine check (business_score <> 9)
    `);

    await expect(
      testApp.app.get(TracksRepository).setTrendingScore(trackId, 8),
    ).rejects.toThrow();

    const [track] = await testApp.db
      .select({
        score: tracks.trendingScore,
        revision: tracks.associationRevision,
      })
      .from(tracks)
      .where(eq(tracks.id, trackId));
    const [event] = await testApp.db
      .select({
        score: trackAssociationEvents.businessScore,
        revision: trackAssociationEvents.revision,
      })
      .from(trackAssociationEvents);
    expect(track).toEqual({ score: 0, revision: 1 });
    expect(event).toEqual({ score: 1, revision: 1 });
    await testApp.db.execute(sql`
      alter table track_association_events drop constraint reject_score_nine
    `);
  });

  it('holds the Track row lock through synchronization enqueue', async () => {
    const user = await createPasswordUser(testApp.db);
    const client = createAuthClient(testApp);
    await signIn(client, { email: user.email, password: DEFAULT_PASSWORD });
    const response = await client
      .post('/v1/tracks')
      .send({ recordingMbid: testMbid(1), locale: 'en' })
      .expect(202);
    const { trackId } = createTrackResultSchema.parse(response.body);
    let releaseEnqueue: () => void = () => undefined;
    let notifyEnqueued: () => void = () => undefined;
    const enqueued = new Promise<void>((resolve) => {
      notifyEnqueued = resolve;
    });
    const continueTransaction = new Promise<void>((resolve) => {
      releaseEnqueue = resolve;
    });
    const syncRepository = testApp.app.get(TrackAssociationSyncRepository);
    const eventRepository = testApp.app.get(TrackAssociationEventRepository);
    const sync = syncRepository.findAndEnqueuePage(
      undefined,
      1,
      async (rows) => {
        await eventRepository.enqueueSynchronizationPage(rows);
        notifyEnqueued();
        await continueTransaction;
      },
    );
    await enqueued;
    const score = testApp.app
      .get(TracksRepository)
      .setTrendingScore(trackId, 8);
    await waitForTrackUpdateLock();
    releaseEnqueue();
    await Promise.all([sync, score]);

    const [event] = await testApp.db
      .select()
      .from(trackAssociationEvents)
      .where(eq(trackAssociationEvents.trackId, trackId));
    expect(event).toMatchObject({ businessScore: 9, revision: 3 });
  });

  it('publishes a fresh revision after a legacy score writer changes the source', async () => {
    const user = await createPasswordUser(testApp.db);
    const client = createAuthClient(testApp);
    await signIn(client, { email: user.email, password: DEFAULT_PASSWORD });
    const response = await client
      .post('/v1/tracks')
      .send({ recordingMbid: testMbid(1), locale: 'en' })
      .expect(202);
    const { trackId } = createTrackResultSchema.parse(response.body);
    await testApp.db
      .update(tracks)
      .set({ trendingScore: 8 })
      .where(eq(tracks.id, trackId));

    await testApp.app.get(TrackAssociationSyncService).synchronize();

    const [event] = await testApp.db
      .select()
      .from(trackAssociationEvents)
      .where(eq(trackAssociationEvents.trackId, trackId));
    const [track] = await testApp.db
      .select({
        score: tracks.trendingScore,
        revision: tracks.associationRevision,
      })
      .from(tracks)
      .where(eq(tracks.id, trackId));
    expect(event).toMatchObject({ businessScore: 9, revision: 2 });
    expect(event?.deliveredAt).toBeInstanceOf(Date);
    expect(track).toEqual({ score: 8, revision: 2 });
  });

  const waitForTrackUpdateLock = async (): Promise<void> => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const result = await testApp.db.execute(sql`
        select pid
        from pg_stat_activity
        where wait_event_type = 'Lock'
          and query like '%update "tracks"%'
      `);
      if (result.rows.length > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Score refresh did not wait for the synchronization lock');
  };
});
