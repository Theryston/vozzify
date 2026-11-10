import { type HomeRow, homeFeedPageSchema } from '@vozzify/contracts';
import { inArray } from 'drizzle-orm';
import request from 'supertest';
import { practiceAttempts } from '../src/database/schema/practice-attempts.js';
import { trackFavorites } from '../src/database/schema/track-favorites.js';
import { tracks } from '../src/database/schema/tracks.js';
import { HomeGenreRepository } from '../src/modules/home/home-genre.repository.js';
import { PersonalHomeStore } from '../src/modules/home/home-personal.store.js';
import { PersonalHomeBuilder } from '../src/modules/home/home-personal-builder.service.js';
import {
  HOME_ROW_SOURCES,
  type HomeCandidate,
  toHomeCandidate,
} from '../src/modules/home/home-row-sources.js';
import { createAuthClient, signIn } from './utils/auth.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';
import { resetDatabase } from './utils/database.js';
import {
  rowPinBody,
  signInPinsAdmin,
} from './utils/editorial-pin-factories.js';
import {
  createCredentialAccount,
  createUser,
  DEFAULT_PASSWORD,
} from './utils/factories.js';
import { seedGenreTracks } from './utils/home-genre-fixtures.js';
import { attemptValue } from './utils/home-personal-discovery-fixtures.js';
import {
  sharedInMemoryCache,
  withInMemoryCache,
} from './utils/in-memory-cache.js';

let existingCandidates: HomeCandidate[] = [];
const source = {
  id: 'trending-today',
  layout: 'standard' as const,
  title: { key: 'home.rows.trendingToday', params: {} },
  load: async () => existingCandidates,
  loadPage: async () => ({ items: existingCandidates, hasMore: false }),
};

const genres = (rows: HomeRow[]) =>
  rows.filter(
    (row) =>
      row.layout === 'standard' && row.title.key === 'home.rows.popularGenre',
  );

describe('personal dynamic genre Rows (e2e)', () => {
  let testApp: TestApp;
  beforeAll(async () => {
    testApp = await createTestApp({
      override: (builder) =>
        withInMemoryCache(builder)
          .overrideProvider(HOME_ROW_SOURCES)
          .useValue([
            source,
            { ...source, id: 'most-sung' },
            { ...source, id: 'new-tracks' },
          ]),
    });
  });
  afterAll(async () => testApp.close());
  beforeEach(async () => {
    sharedInMemoryCache.clear();
    existingCandidates = [];
    await resetDatabase(testApp.db);
  });

  it('appends independent, quality-gated personal genres and delivers private item pages', async () => {
    const records = await seedGenreTracks(
      testApp.db,
      Array.from({ length: 320 }, (_, index) => ({
        score: index < 80 ? 100 : 1,
      })),
    );
    const user = await createUser(testApp.db, {
      username: 'genre_singer',
      email: 'genres@example.com',
    });
    await createCredentialAccount(testApp.db, user);
    const client = createAuthClient(testApp);
    await signIn(client, {
      email: user.email,
      password: DEFAULT_PASSWORD,
    }).expect(200);
    const favorite = records[0];
    if (!favorite) throw new Error('Missing fixture');
    await testApp.db
      .insert(trackFavorites)
      .values({ userId: user.id, trackId: favorite.id });
    const snapshot = await testApp.app
      .get(PersonalHomeBuilder)
      .build(user.id, 'en');
    await testApp.app
      .get(PersonalHomeStore)
      .writeCurrent(user.id, 'en', snapshot);
    expect(genres(snapshot.rows)).toHaveLength(1);
    expect(snapshot.rows.at(-1)?.id).toBe(genres(snapshot.rows)[0]?.id);
    const pageResponse = await client.get('/v1/home?locale=en').expect(200);
    expect(pageResponse.headers['cache-control']).toBe('private, no-store');
    const page = homeFeedPageSchema.parse(pageResponse.body);
    const row = genres(page.rows)[0];
    if (row?.layout !== 'standard' || !row.nextItemsCursor)
      throw new Error('Expected paged personal genre');
    expect(row.items).toHaveLength(12);
    const next = await client
      .get(
        `/v1/home/rows/${row.id}/items?cursor=${encodeURIComponent(row.nextItemsCursor)}`,
      )
      .expect(200);
    expect(next.headers['cache-control']).toBe('private, no-store');
    const allowed = new Set(records.slice(0, 80).map(({ id }) => id));
    expect(
      [...row.items, ...next.body.items].every((track: { id: string }) =>
        allowed.has(track.id),
      ),
    ).toBe(true);
    const stranger = createAuthClient(testApp);
    await stranger
      .get(
        `/v1/home/rows/${row.id}/items?cursor=${encodeURIComponent(row.nextItemsCursor)}`,
      )
      .expect(404);
  });
  const refresh = async (userId: string) => {
    const snapshot = await testApp.app
      .get(PersonalHomeBuilder)
      .build(userId, 'en');
    await testApp.app
      .get(PersonalHomeStore)
      .writeCurrent(userId, 'en', snapshot);
    return snapshot;
  };

  it('can select a quality-gated genre absent from rendered public Rows after established taste changes existing allocations', async () => {
    const records = await seedGenreTracks(
      testApp.db,
      Array.from({ length: 480 }, (_, index) => ({
        score: index < 36 ? 100 : index < 120 ? 90 : 1,
        genres: index < 36 ? ['public-hidden'] : ['preferred'],
      })),
    );
    existingCandidates = records.slice(0, 120).map(toHomeCandidate);
    const client = createAuthClient(testApp);
    const user = await signInPinsAdmin(testApp.db, client);
    await testApp.db.insert(trackFavorites).values(
      records.slice(130, 154).map((record, index) => ({
        userId: user.id,
        trackId: record.id,
        createdAt: new Date(Date.now() - index * 86400000),
      })),
    );
    const publicResponse = await request(testApp.app.getHttpServer())
      .get('/v1/home')
      .expect(200);
    expect(
      genres(publicResponse.body.rows).some(
        (row) =>
          row.layout === 'standard' &&
          row.title.params.genre === 'public-hidden',
      ),
    ).toBe(false);
    const pool = vi.spyOn(
      testApp.app.get(HomeGenreRepository),
      'findCollectiveGenrePool',
    );
    try {
      const snapshot = await refresh(user.id);
      const hidden = genres(snapshot.rows).find(
        (row) =>
          row.layout === 'standard' &&
          row.title.params.genre === 'public-hidden',
      );
      expect(hidden?.layout).toBe('standard');
      if (hidden?.layout !== 'standard')
        throw new Error('Missing independent personal genre');
      const allowed = new Set(records.slice(0, 36).map((item) => item.id));
      expect(hidden.items.length).toBeGreaterThanOrEqual(12);
      expect(hidden.items.every((item) => allowed.has(item.id))).toBe(true);
      expect(pool).not.toHaveBeenCalled();
      const personalResponse = await client.get('/v1/home').expect(200);
      expect(personalResponse.headers['cache-control']).toBe(
        'private, no-store',
      );
    } finally {
      pool.mockRestore();
    }
  });

  it('keeps no-history fallback and drops a personal genre when mastered residuals or live Pins underfill it', async () => {
    const records = await seedGenreTracks(
      testApp.db,
      Array.from({ length: 192 }, (_, index) => ({
        score: index < 48 ? 100 : 1,
      })),
    );
    const client = createAuthClient(testApp);
    const user = await signInPinsAdmin(testApp.db, client);
    const fallback = await client.get('/v1/home').expect(200);
    expect(genres(fallback.body.rows)).toHaveLength(1);
    expect(fallback.headers['cache-control']).toBe('private, no-store');
    await testApp.db
      .insert(practiceAttempts)
      .values(
        records
          .slice(0, 37)
          .map((record, index) =>
            attemptValue(
              user.id,
              record.id,
              0.95,
              new Date(Date.now() - index * 86400000),
            ),
          ),
      );
    const mastered = await refresh(user.id);
    expect(genres(mastered.rows)).toEqual([]);
    expect(mastered.genreCandidates?.[0]?.items).toHaveLength(11);
    sharedInMemoryCache.clear();
    await testApp.db.delete(practiceAttempts);
    const before = await refresh(user.id);
    const genre = genres(before.rows)[0];
    if (genre?.layout !== 'standard')
      throw new Error('Missing genre before Pin');
    await client
      .post('/v1/admin/home-pins')
      .send(rowPinBody(genre.items.map((item) => item.id)))
      .expect(201);
    const response = await client.get('/v1/home').expect(200);
    expect(genres(response.body.rows)).toEqual([]);
    expect(
      response.body.rows.some((row: HomeRow) => row.id.startsWith('pin-')),
    ).toBe(true);
    expect(response.headers['cache-control']).toBe('private, no-store');
  });
  it('uses established voice evidence to prioritize strong fitting genres through the personal HTTP feed', async () => {
    const records = await seedGenreTracks(
      testApp.db,
      Array.from({ length: 640 }, (_, index) => ({
        score: index < 80 ? 100 : index < 160 ? 90 : 1,
        genres:
          index < 80 ? ['outside'] : index < 160 ? ['within'] : ['history'],
      })),
    );
    await testApp.db
      .update(tracks)
      .set({ vocalRangeLowest: 30, vocalRangeHighest: 90 })
      .where(
        inArray(
          tracks.id,
          records.slice(0, 80).map((record) => record.id),
        ),
      );
    await testApp.db
      .update(tracks)
      .set({ vocalRangeLowest: 60, vocalRangeHighest: 72 })
      .where(
        inArray(
          tracks.id,
          records.slice(80).map((record) => record.id),
        ),
      );
    const client = createAuthClient(testApp);
    const user = await signInPinsAdmin(testApp.db, client);
    await testApp.db
      .insert(practiceAttempts)
      .values(
        records
          .slice(300, 312)
          .map((record, index) =>
            attemptValue(
              user.id,
              record.id,
              0.95,
              new Date(Date.now() - index * 86400000),
            ),
          ),
      );
    const snapshot = await refresh(user.id);
    const selected = genres(snapshot.rows);
    expect(selected).toHaveLength(2);
    expect(selected[0]).toMatchObject({
      title: { params: { genre: 'within' } },
    });
    const allowed = new Set(records.slice(0, 160).map((record) => record.id));
    for (const row of selected) {
      if (row.layout !== 'standard') throw new Error('Missing standard genre');
      expect(row.items.every((item) => allowed.has(item.id))).toBe(true);
    }
    const response = await client.get('/v1/home').expect(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    let page = homeFeedPageSchema.parse(response.body);
    const visible = [...page.rows];
    while (page.nextCursor) {
      page = homeFeedPageSchema.parse(
        (
          await client
            .get(`/v1/home?cursor=${encodeURIComponent(page.nextCursor)}`)
            .expect(200)
        ).body,
      );
      visible.push(...page.rows);
    }
    expect(genres(visible)[0]).toMatchObject({
      title: { params: { genre: 'within' } },
    });
  });
});
