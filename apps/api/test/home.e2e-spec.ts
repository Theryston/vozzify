import type { TestingModuleBuilder } from '@nestjs/testing';
import { cacheTags, type HomeRow } from '@vozzify/contracts';
import request from 'supertest';
import type { z } from 'zod';
import type { Database } from '../src/database/database.js';
import { trackProcessings } from '../src/database/schema/track-processings.js';
import { tracks } from '../src/database/schema/tracks.js';
import { WEB_REVALIDATION_QUEUE } from '../src/integrations/web-revalidation/web-revalidation.job.js';
import { HomeFeedService } from '../src/modules/home/home-feed.service.js';
import {
  HOME_ROW_SOURCES,
  type HomeCandidate,
  type HomeRowSource,
} from '../src/modules/home/home-row-sources.js';
import {
  HOME_ALGORITHM_VERSION,
  PRIVATE_HOME_CACHE_CONTROL,
  PUBLIC_HOME_CACHE_CONTROL,
} from '../src/modules/home/home-rules.js';
import { CacheService } from '../src/redis/cache.service.js';
import { signIn } from './utils/auth.js';
import { useAuthSpec } from './utils/auth-spec.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';
import { resetDatabase } from './utils/database.js';
import {
  createCredentialAccount,
  createUser,
  DEFAULT_PASSWORD,
  testMbid,
} from './utils/factories.js';
import { createCompletedTrack } from './utils/track-processing-factories.js';

const VERSION_PATTERN = /^[0-9a-f]{16}$/;
const ROW_SOURCE_COUNT = 9;

// Six unique Tracks per row, so the composer keeps every row and the order of
// the feed is known.
const candidatesOf = (row: number): HomeCandidate[] =>
  Array.from({ length: 6 }, (_, i) => ({
    id: `row-${row}-track-${i}`,
    title: `Row ${row} Track ${i}`,
    coverUrl: null,
    artistCredit: [{ name: `Artist ${row}-${i}`, joinPhrase: '' }],
    durationMs: null,
    vocalRange: null,
    artistKey: `artist-${row}-${i}`,
    hasCover: false,
    isCompleted: true,
  }));

type RowState = { rows: number; loads: number };

// Nine standard row sources. The state decides how many of them have Tracks,
// so a test regenerates the feed by changing the state and refreshing it.
const rowSources = (state: RowState): HomeRowSource[] =>
  Array.from({ length: ROW_SOURCE_COUNT }, (_, row) => ({
    id: `row-${row}`,
    layout: 'standard',
    title: { key: 'home.rows.newTracks', params: {} },
    load: async () => {
      state.loads += 1;
      return row < state.rows ? candidatesOf(row) : [];
    },
  }));

/** An in-memory stand-in for the shared cache, with the lock's NX semantics. */
class InMemoryCache {
  private readonly values = new Map<string, unknown>();
  private readonly locks = new Set<string>();

  async get<T>(key: string, schema: z.ZodType<T>): Promise<T | undefined> {
    const parsed = schema.safeParse(this.values.get(key));
    return parsed.success ? parsed.data : undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }

  async acquire(key: string): Promise<boolean> {
    if (this.locks.has(key)) {
      return false;
    }
    this.locks.add(key);
    return true;
  }

  async del(key: string): Promise<void> {
    this.values.delete(key);
    this.locks.delete(key);
  }
}

/** Replaces the Redis-backed cache, so stored feeds persist across requests. */
const withInMemoryCache = (builder: TestingModuleBuilder) =>
  builder.overrideProvider(CacheService).useValue(new InMemoryCache());

const getHome = (testApp: TestApp, cursor?: string) =>
  request(testApp.app.getHttpServer()).get(
    cursor === undefined ? '/v1/home' : `/v1/home?cursor=${cursor}`,
  );

const rowIdsOf = (body: { rows: unknown }) =>
  (body.rows as HomeRow[]).map((row) => row.id);

type TrackStatus = 'COMPLETED' | 'QUEUED';

type TrackSeed = {
  title: string;
  coverUrl?: string;
  trendingScore?: number;
  processing?: TrackStatus;
};

let seededTracks = 0;

/**
 * Inserts Tracks with one statement per table. A factory call per Track costs
 * a round trip per row, which is too slow for a feed of two dozen Tracks.
 */
const insertTracks = async (
  db: Database,
  seeds: TrackSeed[],
): Promise<void> => {
  const statusByMbid = new Map<string, TrackStatus>();
  const rows = seeds.map((seed) => {
    seededTracks += 1;
    const recordingMbid = testMbid(seededTracks);
    statusByMbid.set(recordingMbid, seed.processing ?? 'COMPLETED');
    return {
      recordingMbid,
      title: seed.title,
      coverUrl: seed.coverUrl ?? null,
      trendingScore: seed.trendingScore ?? 0,
      artistCredit: [{ name: `${seed.title} artist`, joinPhrase: '' }],
      vocalRangeLowest: 60,
      vocalRangeHighest: 72,
    };
  });
  const inserted = await db
    .insert(tracks)
    .values(rows)
    .returning({ id: tracks.id, recordingMbid: tracks.recordingMbid });
  await db.insert(trackProcessings).values(
    inserted.map(({ id, recordingMbid }) => ({
      trackId: id,
      status: statusByMbid.get(recordingMbid) ?? 'COMPLETED',
    })),
  );
};

const waitFor = async (condition: () => boolean): Promise<void> => {
  for (let i = 0; i < 400; i += 1) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('condition not reached');
};

describe('Home feed (e2e)', () => {
  describe('the public feed', () => {
    let testApp: TestApp;

    beforeAll(async () => {
      testApp = await createTestApp();
    });

    afterAll(async () => {
      await testApp.close();
    });

    beforeEach(async () => {
      await resetDatabase(testApp.db);
    });

    /** Eight hot Tracks with covers, and eight newer, quiet ones. */
    const seedTracks = async () => {
      await insertTracks(testApp.db, [
        ...Array.from({ length: 8 }, (_, i) => ({
          title: `Hot ${i + 1}`,
          coverUrl: `https://cdn.example/hot-${i + 1}.webp`,
          trendingScore: 100 - (i + 1),
        })),
        ...Array.from({ length: 8 }, (_, i) => ({
          title: `Quiet ${i + 1}`,
          coverUrl: `https://cdn.example/quiet-${i + 1}.webp`,
        })),
      ]);
    };

    it('answers a visitor with a hero, the trending Tracks and the new Tracks', async () => {
      await seedTracks();

      const response = await getHome(testApp).expect(200);

      expect(response.body).toMatchObject({
        audience: 'public',
        algorithmVersion: HOME_ALGORITHM_VERSION,
        nextCursor: null,
      });
      expect(response.body.version).toMatch(VERSION_PATTERN);
      const rows = response.body.rows as HomeRow[];
      expect(rowIdsOf(response.body)).toEqual([
        'hero',
        'trending-today',
        'new-tracks',
      ]);
      expect(rows[0]).toMatchObject({
        layout: 'hero',
        track: { title: 'Hot 1' },
      });
      const trending = rows[1];
      expect(trending).toMatchObject({
        layout: 'standard',
        title: { key: 'home.rows.trendingToday', params: {} },
      });
      expect(trending?.layout === 'standard' && trending.items).toHaveLength(7);
    });

    it('never shows a Track whose Processing is not completed, nor a hero without a cover', async () => {
      await insertTracks(testApp.db, [
        {
          title: 'Still processing',
          coverUrl: 'https://cdn.example/pending.webp',
          trendingScore: 500,
          processing: 'QUEUED',
        },
        // Hotter than every covered Track, so only the cover rule keeps it out
        // of the hero.
        { title: 'No cover', trendingScore: 400 },
        ...Array.from({ length: 7 }, (_, i) => ({
          title: `Covered ${i + 1}`,
          coverUrl: `https://cdn.example/covered-${i + 1}.webp`,
          trendingScore: 100 - (i + 1),
        })),
      ]);

      const response = await getHome(testApp).expect(200);

      const rows = response.body.rows as HomeRow[];
      expect(rows[0]).toMatchObject({
        layout: 'hero',
        track: { title: 'Covered 1' },
      });
      expect(JSON.stringify(rows)).not.toContain('Still processing');
    });

    it('serves public cache headers and no personal data', async () => {
      await seedTracks();

      const response = await getHome(testApp).expect(200);

      expect(response.headers['cache-control']).toBe(PUBLIC_HOME_CACHE_CONTROL);
      expect(Object.keys(response.body).sort()).toEqual([
        'algorithmVersion',
        'audience',
        'nextCursor',
        'rows',
        'version',
      ]);
    });

    it('answers 400 for a malformed cursor', async () => {
      const response = await getHome(testApp, 'not-a-cursor').expect(400);

      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });

  describe('signed in', () => {
    const spec = useAuthSpec();

    it('gets the personal feed, with no personal data in it', async () => {
      const viewer = await createUser(spec.testApp.db, {
        username: 'home-viewer',
        email: 'home-viewer@example.com',
      });
      await createCredentialAccount(spec.testApp.db, viewer);
      await signIn(spec.client, {
        email: viewer.email,
        password: DEFAULT_PASSWORD,
      }).expect(200);
      await createCompletedTrack(spec.testApp.db, {
        title: 'Shared hot track',
        coverUrl: 'https://cdn.example/shared.webp',
        trendingScore: 10,
      });

      const response = await spec.client.get('/v1/home').expect(200);

      // A User with no snapshot gets the public rows at once, as the personal
      // answer, while the snapshot rebuilds (#340).
      expect(response.body.audience).toBe('personal');
      // Private, not public: the signed-in body omits the visitors-only pins,
      // so no shared cache may keep it (the PR's "signed-in private" decision).
      expect(response.headers['cache-control']).toBe(
        PRIVATE_HOME_CACHE_CONTROL,
      );
      expect(response.text).not.toContain(viewer.email);
      expect(response.text).not.toContain(viewer.id);
      expect(response.text).not.toContain('home-viewer');
    });
  });

  describe('paging', () => {
    const state: RowState = { rows: 8, loads: 0 };
    let testApp: TestApp;

    beforeAll(async () => {
      testApp = await createTestApp({
        override: (builder) =>
          withInMemoryCache(builder)
            .overrideProvider(HOME_ROW_SOURCES)
            .useValue(rowSources(state)),
      });
    });

    afterAll(async () => {
      await testApp.close();
    });

    it('answers six rows and a cursor, then the rest on the next page', async () => {
      const first = await getHome(testApp).expect(200);

      expect(rowIdsOf(first.body)).toEqual([
        'row-0',
        'row-1',
        'row-2',
        'row-3',
        'row-4',
        'row-5',
      ]);
      expect(first.body.nextCursor).toEqual(expect.any(String));

      const second = await getHome(testApp, first.body.nextCursor).expect(200);

      expect(rowIdsOf(second.body)).toEqual(['row-6', 'row-7']);
      expect(second.body.version).toBe(first.body.version);
      expect(second.body.nextCursor).toBeNull();
    });

    it('answers 404 with the expired reason for a version that is no longer served', async () => {
      const forged = Buffer.from(
        JSON.stringify(['0000000000000000', '6']),
      ).toString('base64url');

      const response = await getHome(testApp, forged).expect(404);

      expect(response.body).toMatchObject({
        code: 'NOT_FOUND',
        details: { reason: 'FEED_VERSION_EXPIRED' },
      });
    });
  });

  describe('regeneration and the cache', () => {
    it('keeps a visit on the version it started with, after the feed is regenerated', async () => {
      const state: RowState = { rows: 8, loads: 0 };
      const testApp = await createTestApp({
        override: (builder) =>
          withInMemoryCache(builder)
            .overrideProvider(HOME_ROW_SOURCES)
            .useValue(rowSources(state)),
      });
      try {
        const first = await getHome(testApp).expect(200);
        const cursor = first.body.nextCursor as string;

        state.rows = 9;
        await testApp.app.get(HomeFeedService).refreshPublic();

        const resumed = await getHome(testApp, cursor).expect(200);
        expect(resumed.body.version).toBe(first.body.version);
        expect(rowIdsOf(resumed.body)).toEqual(['row-6', 'row-7']);

        const fresh = await getHome(testApp).expect(200);
        expect(fresh.body.version).not.toBe(first.body.version);
      } finally {
        await testApp.close();
      }
    });

    it('revalidates the web home tag only when the content changed', async () => {
      const state: RowState = { rows: 8, loads: 0 };
      const testApp = await createTestApp({
        override: (builder) =>
          withInMemoryCache(builder)
            .overrideProvider(HOME_ROW_SOURCES)
            .useValue(rowSources(state)),
      });
      try {
        const feeds = testApp.app.get(HomeFeedService);
        const revalidations = () =>
          testApp.queues[WEB_REVALIDATION_QUEUE]?.added ?? [];

        await feeds.refreshPublic('en');
        expect(revalidations()).toEqual([
          { name: 'revalidate', data: { tags: [cacheTags.home('en')] } },
        ]);

        await feeds.refreshPublic('en');
        expect(revalidations()).toHaveLength(1);

        state.rows = 9;
        await feeds.refreshPublic('en');
        expect(revalidations()).toHaveLength(2);
      } finally {
        await testApp.close();
      }
    });

    it('builds a missing feed once: a request during the build gets the uncached minimal home', async () => {
      const state: RowState = { rows: 8, loads: 0 };
      let started = 0;
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const gated = rowSources(state).map((source) => ({
        ...source,
        load: async () => {
          started += 1;
          await gate;
          return source.load();
        },
      }));
      const testApp = await createTestApp({
        override: (builder) =>
          withInMemoryCache(builder)
            .overrideProvider(HOME_ROW_SOURCES)
            .useValue(gated),
      });
      try {
        // A supertest request is sent only when it is awaited, so `then` starts
        // this one while the test goes on to send the concurrent request.
        const building = getHome(testApp).then((response) => response);
        await waitFor(() => started > 0);

        const concurrent = await getHome(testApp).expect(200);
        expect(concurrent.body.rows).toEqual([]);
        expect(concurrent.headers['cache-control']).toBe('no-store');

        release();
        const built = await building;
        expect(built.status).toBe(200);
        expect(built.body.rows).toHaveLength(6);
        expect(state.loads).toBe(ROW_SOURCE_COUNT);
      } finally {
        release();
        await testApp.close();
      }
    });

    it('serves the stored feed to later requests without rebuilding it', async () => {
      const state: RowState = { rows: 8, loads: 0 };
      const testApp = await createTestApp({
        override: (builder) =>
          withInMemoryCache(builder)
            .overrideProvider(HOME_ROW_SOURCES)
            .useValue(rowSources(state)),
      });
      try {
        await getHome(testApp).expect(200);
        await getHome(testApp).expect(200);

        expect(state.loads).toBe(ROW_SOURCE_COUNT);
      } finally {
        await testApp.close();
      }
    });
  });
});
