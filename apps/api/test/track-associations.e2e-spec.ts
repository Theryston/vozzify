import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  createTrackResultSchema,
  musicCatalogTrackAssociationPayloadSchema,
} from '@vozzify/contracts';
import type { Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { trackAssociationEvents } from '../src/database/schema/track-association-events.js';
import { tracks } from '../src/database/schema/tracks.js';
import { MusicCatalogClient } from '../src/integrations/music-catalog/music-catalog.client.js';
import {
  DELIVER_TRACK_ASSOCIATIONS_JOB,
  TRACK_ASSOCIATION_CLAIM_LEASE_MS,
  TRACK_ASSOCIATION_POLL_INTERVAL_MS,
  TRACK_ASSOCIATION_QUEUE,
  TRACK_ASSOCIATION_SCHEDULER_ID,
} from '../src/modules/tracks/track-association.job.js';
import { TrackAssociationProcessor } from '../src/modules/tracks/track-association.processor.js';
import { TrackAssociationService } from '../src/modules/tracks/track-association.service.js';
import { TrackAssociationEventRepository } from '../src/modules/tracks/track-association-event.repository.js';
import { TrackAssociationSyncRepository } from '../src/modules/tracks/track-association-sync.repository.js';
import { TrackAssociationSyncService } from '../src/modules/tracks/track-association-sync.service.js';
import { TrackProcessingRepository } from '../src/modules/tracks/track-processing.repository.js';
import { TracksRepository } from '../src/modules/tracks/tracks.repository.js';
import { type AuthClient, createAuthClient, signIn } from './utils/auth.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';
import { resetDatabase } from './utils/database.js';
import {
  createPasswordUser,
  DEFAULT_PASSWORD,
  testMbid,
  type User,
} from './utils/factories.js';
import {
  FAKE_CATALOG_API_KEY,
  type FakeMusicCatalog,
  startFakeMusicCatalog,
} from './utils/fake-music-catalog.js';
import { recordingFixture } from './utils/recording-fixtures.js';

const recordProjectedAssociation = (
  projected: Map<string, string>,
  mbid: string,
  trackId: string | null,
): void => {
  if (trackId === null) {
    projected.delete(mbid);
    return;
  }
  projected.set(mbid, trackId);
};

const searchMbid = (
  query: unknown,
  searchMbids: Map<string, string>,
): string => {
  if (typeof query === 'string') {
    const mapped = searchMbids.get(query);
    if (mapped !== undefined) return mapped;
    if (query === 'overlap') return testMbid(999);
  }
  return testMbid(1);
};

describe('Track association outbox (e2e)', () => {
  let catalog: FakeMusicCatalog;
  let testApp: TestApp;
  let associationOutage = false;
  let associationCalls = 0;
  let projectedTrackIds = new Map<string, string>();
  let searchMbids = new Map<string, string>();

  const createWorker = async () => {
    const upsertJobScheduler = vi.fn().mockResolvedValue(undefined);
    const workerModule: TestingModule = await Test.createTestingModule({
      providers: [
        TrackAssociationProcessor,
        {
          provide: TrackAssociationService,
          useValue: testApp.app.get(TrackAssociationService),
        },
        {
          provide: getQueueToken(TRACK_ASSOCIATION_QUEUE),
          useValue: { upsertJobScheduler },
        },
      ],
    }).compile();
    const processor = workerModule.get(TrackAssociationProcessor);
    await processor.onModuleInit();
    return {
      close: () => workerModule.close(),
      processor,
      upsertJobScheduler,
    };
  };

  const signedInClient = async (user: User): Promise<AuthClient> => {
    const client = createAuthClient(testApp);
    await signIn(client, {
      email: user.email,
      password: DEFAULT_PASSWORD,
    }).expect(200);
    return client;
  };

  beforeAll(async () => {
    catalog = await startFakeMusicCatalog((payload) => {
      if ('trackId' in payload) {
        const association =
          musicCatalogTrackAssociationPayloadSchema.parse(payload);
        associationCalls += 1;
        if (associationOutage) {
          return { error: { code: 'REIMPORT_SWITCHING', message: 'Retry.' } };
        }
        recordProjectedAssociation(
          projectedTrackIds,
          association.mbid,
          association.trackId,
        );
        return { result: {} };
      }
      if ('query' in payload) {
        const mbid = searchMbid(payload.query, searchMbids);
        const recording = recordingFixture({ mbid });
        return {
          result: {
            results: [
              {
                mbid: recording.mbid,
                title: recording.title,
                artistCredit: recording.artistCredit.name,
                coverUrl: recording.releases[0]?.coverArtUrl ?? null,
                trackId: projectedTrackIds.get(mbid) ?? null,
              },
            ],
          },
        };
      }
      return { result: recordingFixture({ mbid: String(payload.mbid) }) };
    });
    testApp = await createTestApp({
      env: {
        MUSIC_CATALOG_URL: catalog.url,
        MUSIC_CATALOG_API_KEY: FAKE_CATALOG_API_KEY,
        MUSIC_CATALOG_REQUEST_TIMEOUT_MS: 1_000,
      },
    });
  });

  afterAll(async () => {
    await testApp.close();
    await catalog.close();
  });

  beforeEach(async () => {
    await resetDatabase(testApp.db);
    associationOutage = false;
    associationCalls = 0;
    projectedTrackIds = new Map();
    searchMbids = new Map();
  });

  it('links the Track in compact catalog search after delivery', async () => {
    const user = await createPasswordUser(testApp.db);
    const response = await (await signedInClient(user))
      .post('/v1/tracks')
      .send({ recordingMbid: testMbid(1), locale: 'en' })
      .expect(202);
    const { trackId } = createTrackResultSchema.parse(response.body);
    const client = testApp.app.get(MusicCatalogClient);

    expect(
      (
        await client.search({
          query: 'Bohemian Rhapsody',
          limit: 20,
          offset: 0,
        })
      ).results[0]?.trackId,
    ).toBeNull();
    await testApp.app.get(TrackAssociationService).dispatchPending();
    expect(
      (
        await client.search({
          query: 'Bohemian Rhapsody',
          limit: 20,
          offset: 0,
        })
      ).results[0]?.trackId,
    ).toBe(trackId);
    expect(catalog.seenAuth).toContain(`Bearer ${FAKE_CATALOG_API_KEY}`);
    const [event] = await testApp.db.select().from(trackAssociationEvents);
    expect(event?.deliveredAt).toBeInstanceOf(Date);
  });

  it('atomically publishes score increases and decreases, while stale completion cannot acknowledge a newer revision', async () => {
    const user = await createPasswordUser(testApp.db);
    const response = await (await signedInClient(user))
      .post('/v1/tracks')
      .send({ recordingMbid: testMbid(1), locale: 'en' })
      .expect(202);
    const { trackId } = createTrackResultSchema.parse(response.body);
    const repository = testApp.app.get(TracksRepository);
    const events = testApp.app.get(TrackAssociationEventRepository);
    const [initial] = await events.claimPending(
      new Date(Date.now() + 1_000),
      new Date(Date.now() + 30_000),
      1,
    );
    if (initial === undefined) throw new Error('Expected initial event claim');
    expect(initial).toMatchObject({ businessScore: 1, revision: 1 });

    await repository.setTrendingScore(trackId, 8);
    const [revisionTwo] = await events.claimPending(
      new Date(Date.now() + 1_000),
      new Date(Date.now() + 30_000),
      1,
    );
    if (revisionTwo === undefined)
      throw new Error('Expected revision two claim');
    expect(revisionTwo).toMatchObject({ businessScore: 9, revision: 2 });
    const [claimedRevisionTwo] = await testApp.db
      .select()
      .from(trackAssociationEvents);
    await events.enqueueSynchronizationPage([
      {
        id: trackId,
        recordingMbid: testMbid(1),
        businessScore: 1,
        revision: 1,
      },
    ]);
    const [queued] = await testApp.db.select().from(trackAssociationEvents);
    expect(queued).toMatchObject({ businessScore: 9, revision: 2 });
    expect(queued?.claimedUntil).toEqual(claimedRevisionTwo?.claimedUntil);
    expect(queued?.nextAttemptAt).toEqual(claimedRevisionTwo?.nextAttemptAt);

    await events.markDelivered(initial.id, initial.revision, new Date());
    await events.scheduleRetry(
      initial.id,
      initial.revision,
      new Date(Date.now() + 60_000),
    );
    let [latest] = await testApp.db.select().from(trackAssociationEvents);
    expect(latest).toMatchObject({
      businessScore: 9,
      revision: 2,
      deliveredAt: null,
    });
    await events.markDelivered(
      revisionTwo.id,
      revisionTwo.revision,
      new Date(),
    );
    await events.enqueueSynchronizationPage([
      {
        id: trackId,
        recordingMbid: testMbid(1),
        businessScore: 9,
        revision: 2,
      },
    ]);
    [latest] = await testApp.db.select().from(trackAssociationEvents);
    expect(latest).toMatchObject({
      businessScore: 9,
      revision: 2,
      deliveredAt: null,
    });

    await repository.setTrendingScore(trackId, 0);
    [latest] = await testApp.db.select().from(trackAssociationEvents);
    expect(latest).toMatchObject({ businessScore: 1, revision: 3 });
    const [track] = await testApp.db
      .select({
        trendingScore: tracks.trendingScore,
        revision: tracks.associationRevision,
      })
      .from(tracks)
      .where(eq(tracks.id, trackId));
    expect(track).toEqual({ trendingScore: 0, revision: 3 });

    if (latest === undefined) throw new Error('Expected a score event');
    await events.markDelivered(latest.id, latest.revision, new Date());
    expect(
      await events.deleteDeliveredBefore(new Date(Date.now() + 1_000), 10),
    ).toBe(1);
    await repository.setTrendingScore(trackId, 8);
    [latest] = await testApp.db.select().from(trackAssociationEvents);
    expect(latest).toMatchObject({ businessScore: 9, revision: 4 });
    const [afterCleanup] = await testApp.db
      .select({ revision: tracks.associationRevision })
      .from(tracks)
      .where(eq(tracks.id, trackId));
    expect(afterCleanup?.revision).toBe(4);
  });

  it('retries a committed event after catalog delivery becomes available', async () => {
    associationOutage = true;
    const user = await createPasswordUser(testApp.db);
    await (await signedInClient(user))
      .post('/v1/tracks')
      .send({ recordingMbid: testMbid(1), locale: 'en' })
      .expect(202);
    const firstAttemptAt = new Date(Date.now() + 1_000);
    const retryAt = new Date(firstAttemptAt.getTime() + 5_000);
    await testApp.app
      .get(TrackAssociationService)
      .dispatchPending(firstAttemptAt);
    let [event] = await testApp.db.select().from(trackAssociationEvents);
    expect(event).toMatchObject({ deliveredAt: null, attempts: 1 });
    expect(event?.nextAttemptAt).toEqual(retryAt);
    associationOutage = false;
    await testApp.app.get(TrackAssociationService).dispatchPending(retryAt);
    [event] = await testApp.db.select().from(trackAssociationEvents);
    expect(event?.deliveredAt).toBeInstanceOf(Date);
    expect(associationCalls).toBe(2);
  });

  it('re-registers polling and delivers a pending event after processor restart', async () => {
    const user = await createPasswordUser(testApp.db);
    const response = await (await signedInClient(user))
      .post('/v1/tracks')
      .send({ recordingMbid: testMbid(1), locale: 'en' })
      .expect(202);
    const { trackId } = createTrackResultSchema.parse(response.body);
    const [pending] = await testApp.db.select().from(trackAssociationEvents);
    expect(pending).toMatchObject({ trackId, deliveredAt: null });

    const previousWorker = await createWorker();
    expect(previousWorker.upsertJobScheduler).toHaveBeenCalledWith(
      TRACK_ASSOCIATION_SCHEDULER_ID,
      { every: TRACK_ASSOCIATION_POLL_INTERVAL_MS },
      { name: DELIVER_TRACK_ASSOCIATIONS_JOB, data: {} },
    );
    await previousWorker.close();

    const restartedWorker = await createWorker();
    expect(restartedWorker.upsertJobScheduler).toHaveBeenCalledWith(
      TRACK_ASSOCIATION_SCHEDULER_ID,
      { every: TRACK_ASSOCIATION_POLL_INTERVAL_MS },
      { name: DELIVER_TRACK_ASSOCIATIONS_JOB, data: {} },
    );
    await restartedWorker.processor.process({
      name: DELIVER_TRACK_ASSOCIATIONS_JOB,
      data: {},
    } as Job<unknown>);
    await restartedWorker.close();

    expect(associationCalls).toBe(1);
    const [delivered] = await testApp.db.select().from(trackAssociationEvents);
    expect(delivered?.deliveredAt).toBeInstanceOf(Date);
  });

  it('redelivers after the catalog acknowledges before the outbox acknowledgment', async () => {
    const user = await createPasswordUser(testApp.db);
    const response = await (await signedInClient(user))
      .post('/v1/tracks')
      .send({ recordingMbid: testMbid(1), locale: 'en' })
      .expect(202);
    const { trackId } = createTrackResultSchema.parse(response.body);
    const now = new Date(Date.now() + 1_000);
    const events = testApp.app.get(TrackAssociationEventRepository);
    const [claimed] = await events.claimPending(
      now,
      new Date(now.getTime() + TRACK_ASSOCIATION_CLAIM_LEASE_MS),
      1,
    );
    expect(claimed?.trackId).toBe(trackId);
    await testApp.app
      .get(MusicCatalogClient)
      .associateTrack({ mbid: testMbid(1), trackId });
    await testApp.app
      .get(TrackAssociationService)
      .dispatchPending(
        new Date(now.getTime() + TRACK_ASSOCIATION_CLAIM_LEASE_MS),
      );
    expect(associationCalls).toBe(2);
    expect(projectedTrackIds.get(testMbid(1))).toBe(trackId);
    const [event] = await testApp.db.select().from(trackAssociationEvents);
    expect(event?.deliveredAt).toBeInstanceOf(Date);
  });

  it('synchronizes every Track in bounded pages and restores links on rerun', async () => {
    const seededTracks = Array.from({ length: 251 }, (_, index) => ({
      recordingMbid: testMbid(index + 1),
      title: `Seeded ${index + 1}`,
    }));
    const inserted = await testApp.db
      .insert(tracks)
      .values(seededTracks)
      .returning();
    const sync = testApp.app.get(TrackAssociationSyncService);
    const syncRepository = testApp.app.get(TrackAssociationSyncRepository);
    const originalFindAndEnqueuePage =
      syncRepository.findAndEnqueuePage.bind(syncRepository);
    let overlapTrackId: string | undefined;
    const findAndEnqueuePage = vi
      .spyOn(syncRepository, 'findAndEnqueuePage')
      .mockImplementation(async (afterId, limit, enqueue) => {
        const page = await originalFindAndEnqueuePage(afterId, limit, enqueue);
        if (page.length === 0 && overlapTrackId === undefined) {
          const [track] = await testApp.db
            .insert(tracks)
            .values({
              id: 'zzzzzzzzzzzzzzzzzzzzzzzz',
              recordingMbid: testMbid(999),
              title: 'Created during synchronization',
            })
            .returning();
          if (track === undefined) {
            throw new Error('Track insert returned no row');
          }
          overlapTrackId = track.id;
          await testApp.db.insert(trackAssociationEvents).values({
            trackId: track.id,
            recordingMbid: track.recordingMbid,
          });
        }
        return page;
      });

    await sync.synchronize();
    expect(projectedTrackIds.size).toBe(252);
    const search = await testApp.http
      .get('/v1/search')
      .query({ query: 'Bohemian Rhapsody' })
      .expect(200);
    expect(search.body.results[0]?.trackId).toBe(
      inserted.find((track) => track.recordingMbid === testMbid(1))?.id,
    );
    const overlapSearch = await testApp.http
      .get('/v1/search')
      .query({ query: 'overlap' })
      .expect(200);
    expect(overlapSearch.body.results[0]?.trackId).toBe(overlapTrackId);

    projectedTrackIds.clear();
    await sync.synchronize();
    expect(projectedTrackIds.size).toBe(252);
    const events = await testApp.db.select().from(trackAssociationEvents);
    expect(events).toHaveLength(252);
    expect(events.every((event) => event.deliveredAt instanceof Date)).toBe(
      true,
    );
    findAndEnqueuePage.mockRestore();
  }, 60_000);

  it('recovers search links after sync interruption', async () => {
    const inserted = await testApp.db
      .insert(tracks)
      .values(
        Array.from({ length: 51 }, (_, index) => ({
          id: `sync-track-${String(index + 1).padStart(3, '0')}`,
          recordingMbid: testMbid(index + 1),
          title: `Interrupted sync ${index + 1}`,
        })),
      )
      .returning();
    const associations = testApp.app.get(TrackAssociationService);
    const dispatchPending = associations.dispatchPending.bind(associations);
    const interruptedDispatch = vi
      .spyOn(associations, 'dispatchPending')
      .mockImplementation(async (now) => {
        await dispatchPending(now);
        throw new Error('Simulated sync process interruption');
      });
    const sync = testApp.app.get(TrackAssociationSyncService);

    try {
      await expect(sync.synchronize()).rejects.toThrow(
        'Simulated sync process interruption',
      );
    } finally {
      interruptedDispatch.mockRestore();
    }
    expect(associationCalls).toBe(50);

    const linked = inserted.find(
      (track) => projectedTrackIds.get(track.recordingMbid) === track.id,
    );
    const pending = inserted.find(
      (track) => !projectedTrackIds.has(track.recordingMbid),
    );
    expect(linked).toBeDefined();
    expect(pending).toBeDefined();
    if (linked === undefined || pending === undefined) return;

    searchMbids.set('sync-linked', linked.recordingMbid);
    searchMbids.set('sync-pending', pending.recordingMbid);
    const searchTrackId = async (query: string) => {
      const response = await testApp.http
        .get('/v1/search')
        .query({ query })
        .expect(200);
      return response.body.results[0]?.trackId;
    };
    expect(await searchTrackId('sync-linked')).toBe(linked.id);
    expect(await searchTrackId('sync-pending')).toBeNull();

    await sync.synchronize();

    expect(await searchTrackId('sync-linked')).toBe(linked.id);
    expect(await searchTrackId('sync-pending')).toBe(pending.id);
    expect(projectedTrackIds.size).toBe(51);
  }, 60_000);

  it('rolls the outbox event back with a failed Track creation transaction', async () => {
    const user = await createPasswordUser(testApp.db);
    const client = await signedInClient(user);
    const insertion = vi
      .spyOn(
        testApp.app.get(TrackProcessingRepository),
        'insertQueuedProcessing',
      )
      .mockRejectedValue(new Error('Simulated processing insert failure'));
    await client
      .post('/v1/tracks')
      .send({ recordingMbid: testMbid(1), locale: 'en' })
      .expect(500);
    expect(
      await testApp.db
        .select()
        .from(tracks)
        .where(eq(tracks.recordingMbid, testMbid(1))),
    ).toEqual([]);
    expect(await testApp.db.select().from(trackAssociationEvents)).toEqual([]);
    insertion.mockRestore();
  });
});
