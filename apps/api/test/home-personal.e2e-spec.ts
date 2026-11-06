import {
  type HomeFeedPage,
  type HomeRow,
  type HomeTrack,
  homeFeedPageSchema,
} from '@vozzify/contracts';
import request from 'supertest';
import {
  PERSONAL_HOME_FEED_QUEUE,
  REFRESH_PERSONAL_HOME_FEED_JOB,
  REFRESH_PERSONAL_NIGHTLY_JOB,
  REFRESH_PERSONAL_NIGHTLY_USER_JOB,
} from '../src/modules/home/home-personal.job.js';
import { PersonalHomeProcessor } from '../src/modules/home/home-personal.processor.js';
import { PersonalHomeRepository } from '../src/modules/home/home-personal.repository.js';
import { PersonalHomeStore } from '../src/modules/home/home-personal.store.js';
import { PersonalHomeBuilder } from '../src/modules/home/home-personal-builder.service.js';
import { PersonalHomeQueueService } from '../src/modules/home/home-personal-queue.service.js';
import {
  PRIVATE_HOME_CACHE_CONTROL,
  PUBLIC_HOME_CACHE_CONTROL,
} from '../src/modules/home/home-rules.js';
import type { FakeQueue } from './redis-test-overrides.js';
import { createAuthClient, signIn } from './utils/auth.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';
import { resetDatabase } from './utils/database.js';
import {
  createCredentialAccount,
  createUser,
  DEFAULT_PASSWORD,
} from './utils/factories.js';
import { verifyPersonalCategoryReplenishment } from './utils/home-personal-discovery-scenario.js';
import { MemoryCache, withMemoryCache } from './utils/memory-cache.js';
import { createCompletedTrack } from './utils/track-processing-factories.js';

const VERSION_PATTERN = /^[0-9a-f]{16}$/;

const memoryCache = new MemoryCache();

const personalQueueOf = (testApp: TestApp): FakeQueue => {
  const queue = testApp.queues[PERSONAL_HOME_FEED_QUEUE];
  if (!queue) {
    throw new Error(`No fake "${PERSONAL_HOME_FEED_QUEUE}" queue`);
  }
  return queue;
};

/** Jobs of one name added since `seen`, in order. */
const addedSince = (
  queue: FakeQueue,
  name: string,
  seen: number,
): { data: unknown; options: unknown }[] =>
  queue.added
    .map((added, index) => ({ ...added, options: queue.options[index] }))
    .filter((job, index) => index >= seen && job.name === name);

const rowIdsOf = (body: { rows: unknown }) =>
  (body.rows as HomeRow[]).map((row) => row.id);

const itemIdsOf = (body: { rows: unknown }, rowId: string): string[] => {
  const row = (body.rows as HomeRow[]).find(
    (candidate) => candidate.id === rowId,
  );
  return row?.layout === 'standard'
    ? row.items.map((item: HomeTrack) => item.id)
    : [];
};

const _readEveryPage = async (
  fetchPage: (cursor?: string) => Promise<{ body: unknown }>,
): Promise<HomeFeedPage[]> => {
  const pages: HomeFeedPage[] = [];
  let cursor: string | undefined;
  do {
    const response = await fetchPage(cursor);
    const page = homeFeedPageSchema.parse(response.body);
    pages.push(page);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return pages;
};

const _layoutsAcross = (pages: HomeFeedPage[]) => [
  ...new Set(
    pages.flatMap((page) =>
      (page.rows as HomeRow[]).map((row: HomeRow) => row.layout),
    ),
  ),
];

const run = {
  difficulty: 'NORMAL',
  octaveMode: 'ANY',
  transposeSemitones: 0,
  speed: 1,
  accuracy: 0.5,
  coverage: 0.95,
  forwardSkip: false,
  bleedSuspected: false,
  startedAt: '2026-10-20T10:00:00.000Z',
  endedAt: '2026-10-20T10:04:00.000Z',
} as const;

describe('Personal home feed (e2e)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({
      override: (builder) => withMemoryCache(builder, memoryCache),
    });
  });

  afterAll(async () => {
    await testApp.close();
  });

  beforeEach(async () => {
    memoryCache.clear();
    await resetDatabase(testApp.db);
  });

  const signInAs = async (username: string, email: string) => {
    const user = await createUser(testApp.db, { username, email });
    await createCredentialAccount(testApp.db, user);
    const client = createAuthClient(testApp);
    await signIn(client, {
      email: user.email,
      password: DEFAULT_PASSWORD,
    }).expect(200);
    return { user, client };
  };

  // Eight hot Tracks with covers, and eight newer, quiet ones: the hero,
  // the trending row and the new-tracks row all survive the composer, like the
  // public feed's own e2e.
  const seedTracks = async (hot = 8, quiet = 8) => {
    const ids: string[] = [];
    for (let index = 0; index < hot; index += 1) {
      const track = await createCompletedTrack(testApp.db, {
        title: `Personal hot ${index + 1}`,
        coverUrl: `https://cdn.example/personal-hot-${index + 1}.webp`,
        trendingScore: 100 - (index + 1),
      });
      ids.push(track.id);
    }
    for (let index = 0; index < quiet; index += 1) {
      const track = await createCompletedTrack(testApp.db, {
        title: `Personal quiet ${index + 1}`,
        coverUrl: `https://cdn.example/personal-quiet-${index + 1}.webp`,
      });
      ids.push(track.id);
    }
    return ids;
  };

  // The processor is stubbed by the e2e Redis overrides (its worker never
  // starts), so the spec drives a real one with the app's own providers:
  // the snapshot is rebuilt against the real database, like production.
  const realProcessor = () =>
    new PersonalHomeProcessor(
      testApp.app.get(PersonalHomeBuilder),
      testApp.app.get(PersonalHomeStore),
      testApp.app.get(PersonalHomeRepository),
      testApp.app.get(PersonalHomeQueueService),
    );

  const refreshJob = (name: string, data: unknown) =>
    ({ name, data }) as Parameters<PersonalHomeProcessor['process']>[0];

  const refreshUser = (userId: string, locale = 'en') =>
    realProcessor().process(
      refreshJob(REFRESH_PERSONAL_HOME_FEED_JOB, { userId, locale }),
    );

  const refreshNightly = () =>
    new PersonalHomeProcessor(
      testApp.app.get(PersonalHomeBuilder),
      testApp.app.get(PersonalHomeStore),
      testApp.app.get(PersonalHomeRepository),
      testApp.app.get(PersonalHomeQueueService),
    ).process(refreshJob(REFRESH_PERSONAL_NIGHTLY_JOB, {}));

  it('answers a signed-in visitor with the personal feed and private headers', async () => {
    await seedTracks();
    const { client } = await signInAs('personal_1', 'personal-1@example.com');

    const response = await client.get('/v1/home').expect(200);

    expect(response.body.audience).toBe('personal');
    expect(response.body.version).toMatch(VERSION_PATTERN);
    expect(response.headers['cache-control']).toBe(PRIVATE_HOME_CACHE_CONTROL);
    // No snapshot yet: the public rows go out at once, while the rebuild runs.
    expect(rowIdsOf(response.body)).toEqual([
      'hero',
      'trending-today',
      'new-tracks',
    ]);
    const queue = personalQueueOf(testApp);
    const jobs = queue.added.filter(
      (job) => job.name === REFRESH_PERSONAL_HOME_FEED_JOB,
    );
    // One rebuild of the locale the visitor reads.
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      data: { userId: expect.any(String), locale: 'en' },
    });
  });

  it('gives a User with no data the public contents', async () => {
    await seedTracks(7, 0);
    const { user, client } = await signInAs(
      'personal_2',
      'personal-2@example.com',
    );

    const anonymous = await request(testApp.app.getHttpServer())
      .get('/v1/home')
      .expect(200);
    const signedIn = await client.get('/v1/home').expect(200);

    expect(anonymous.body.audience).toBe('public');
    expect(anonymous.headers['cache-control']).toBe(PUBLIC_HOME_CACHE_CONTROL);
    // λ = 0: the same rows in the same order, as the personal answer.
    expect(signedIn.body.rows).toEqual(anonymous.body.rows);

    await refreshUser(user.id);
    const rebuilt = await client.get('/v1/home').expect(200);
    expect(rowIdsOf(rebuilt.body).slice(0, 2)).toEqual([
      'hero',
      'daily-target',
    ]);
  });

  it('preserves public categories across every page for sparse and established Users', async () => {
    await verifyPersonalCategoryReplenishment({
      testApp,
      signInAs,
      refreshUser,
    });
  });
  it('serves the rebuilt snapshot with resume rows and the strip', async () => {
    const ids = (await seedTracks(7, 0)).slice(0, 7);
    const { user, client } = await signInAs(
      'personal_3',
      'personal-3@example.com',
    );
    const [started, ...rest] = ids;
    if (!started) throw new Error('No tracks seeded');
    for (const trackId of ids) {
      await client.post(`/v1/tracks/${trackId}/attempts`).send(run).expect(201);
    }
    await client
      .post(`/v1/tracks/${started}/attempts`)
      .send({ ...run, accuracy: 0.95 })
      .expect(201);
    await client.put(`/v1/me/favorites/${rest[0]}`).expect(204);

    await refreshUser(user.id);

    const response = await client.get('/v1/home').expect(200);
    expect(response.body.audience).toBe('personal');
    expect(rowIdsOf(response.body).slice(0, 4)).toEqual([
      'hero',
      'daily-target',
      'continue-singing',
      'sing-again',
    ]);
    // The mastered Track leaves continue-singing but leads sing-again.
    expect(itemIdsOf(response.body, 'continue-singing')).toHaveLength(6);
    expect(itemIdsOf(response.body, 'continue-singing')).not.toContain(started);
    expect(itemIdsOf(response.body, 'sing-again')[0]).toBe(started);
    // ... and stays out of the discovery rows.
    const discovery = (response.body.rows as HomeRow[]).filter(
      ({ id }) =>
        !['continue-singing', 'sing-again', 'top-10-week'].includes(id),
    );
    expect(JSON.stringify(discovery)).not.toContain(started);
    expect(
      (response.body.rows as HomeRow[]).find((row) => row.id === 'top-10-week'),
    ).toMatchObject({
      layout: 'ranked',
      items: expect.arrayContaining([expect.objectContaining({ id: started })]),
    });
    expect(response.body.rows[1]).toMatchObject({
      layout: 'daily-target',
      title: { key: 'home.rows.dailyTarget', params: {} },
      secondsLeft: 300,
      targetSeconds: 300,
      streakDays: 0,
      completedToday: false,
    });
  });

  it('serves a stale snapshot while its rebuild is queued', async () => {
    await seedTracks(7, 0);
    const { user, client } = await signInAs(
      'personal_4',
      'personal-4@example.com',
    );
    await refreshUser(user.id);
    const first = await client.get('/v1/home').expect(200);
    const store = testApp.app.get(PersonalHomeStore);
    const snapshot = await store.readCurrent(user.id, 'en');
    if (!snapshot) throw new Error('No snapshot stored');
    await store.writeCurrent(user.id, 'en', {
      ...snapshot,
      generatedAt: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(),
    });
    const queue = personalQueueOf(testApp);
    const seen = queue.added.length;

    const response = await client.get('/v1/home').expect(200);

    expect(response.body.version).toBe(first.body.version);
    expect(
      addedSince(queue, REFRESH_PERSONAL_HOME_FEED_JOB, seen),
    ).toHaveLength(1);
  });

  it('queues a debounced rebuild after a finished Attempt', async () => {
    const ids = (await seedTracks(2, 0)).slice(0, 2);
    const { client } = await signInAs('personal_5', 'personal-5@example.com');
    const queue = personalQueueOf(testApp);
    const seen = queue.added.length;

    await client.post(`/v1/tracks/${ids[0]}/attempts`).send(run).expect(201);
    await client.post(`/v1/tracks/${ids[1]}/attempts`).send(run).expect(201);

    const jobs = addedSince(queue, REFRESH_PERSONAL_HOME_FEED_JOB, seen);
    expect(jobs).toHaveLength(4);
    for (const job of jobs) {
      const options = job.options as { delay?: number; jobId?: string };
      expect(options.delay).toBeGreaterThan(0);
      expect(options.jobId).toContain('personal-home-');
    }
    // Two Attempts in one slot share the job, per locale.
    const jobIds = new Set(
      jobs.map((job) => (job.options as { jobId: string }).jobId),
    );
    expect(jobIds.size).toBe(2);
  });

  it('queues a debounced rebuild after a favorite', async () => {
    const ids = (await seedTracks(1, 0)).slice(0, 1);
    const { client } = await signInAs('personal_6', 'personal-6@example.com');
    const queue = personalQueueOf(testApp);
    const seen = queue.added.length;

    await client.put(`/v1/me/favorites/${ids[0]}`).expect(204);

    const jobs = addedSince(queue, REFRESH_PERSONAL_HOME_FEED_JOB, seen);
    expect(jobs).toHaveLength(2);
  });

  it('rebuilds only recently active Users on the nightly batch', async () => {
    const ids = (await seedTracks(2, 0)).slice(0, 2);
    const runner = await signInAs('personal_7', 'personal-7@example.com');
    await runner.client
      .post(`/v1/tracks/${ids[0]}/attempts`)
      .send(run)
      .expect(201);
    const { user: humming } = await signInAs(
      'personal_8',
      'personal-8@example.com',
    );
    const hummingClient = createAuthClient(testApp);
    await signIn(hummingClient, {
      email: humming.email,
      password: DEFAULT_PASSWORD,
    }).expect(200);
    await hummingClient
      .post('/v1/me/streak/heartbeat')
      .send({ elapsedSeconds: 5, timeZone: 'UTC' })
      .expect(200);
    const { user: quiet } = await signInAs(
      'personal_9',
      'personal-9@example.com',
    );
    const queue = personalQueueOf(testApp);
    const seen = queue.added.length;

    await refreshNightly();

    const jobs = addedSince(queue, REFRESH_PERSONAL_NIGHTLY_USER_JOB, seen);
    const users = new Set(
      jobs.map((job) => (job.data as { userId: string }).userId),
    );
    expect(users).toEqual(new Set([runner.user.id, humming.id]));
    expect(users.has(quiet.id)).toBe(false);
  });

  it('never serves personal rows to an anonymous visitor', async () => {
    const ids = (await seedTracks(1, 0)).slice(0, 1);
    const { client } = await signInAs('personal_10', 'personal-10@example.com');
    await client.post(`/v1/tracks/${ids[0]}/attempts`).send(run).expect(201);

    const response = await request(testApp.app.getHttpServer())
      .get('/v1/home')
      .expect(200);

    expect(response.body.audience).toBe('public');
    expect(response.headers['cache-control']).toBe(PUBLIC_HOME_CACHE_CONTROL);
    expect(JSON.stringify(response.body.rows)).not.toContain(
      'continue-singing',
    );
    expect(JSON.stringify(response.body.rows)).not.toContain('daily-target');
  });
});
