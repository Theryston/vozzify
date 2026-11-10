import type { HomeRow } from '@vozzify/contracts';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { trackFavorites } from '../src/database/schema/track-favorites.js';
import { tracks } from '../src/database/schema/tracks.js';
import { HomeFeedService } from '../src/modules/home/home-feed.service.js';
import { PersonalHomeStore } from '../src/modules/home/home-personal.store.js';
import { PersonalHomeBuilder } from '../src/modules/home/home-personal-builder.service.js';
import {
  HOME_ROW_SOURCES,
  type HomeCandidate,
  type HomeRowSource,
  toHomeCandidate,
} from '../src/modules/home/home-row-sources.js';
import { createAuthClient } from './utils/auth.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';
import { resetDatabase } from './utils/database.js';
import {
  rowPinBody,
  signInPinsAdmin,
} from './utils/editorial-pin-factories.js';
import { testMbid } from './utils/factories.js';
import { seedGenreTracks } from './utils/home-genre-fixtures.js';
import {
  sharedInMemoryCache,
  withInMemoryCache,
} from './utils/in-memory-cache.js';
import { createCompletedTrack } from './utils/track-processing-factories.js';

let existingCandidates: HomeCandidate[] = [];
const existingSources: HomeRowSource[] = [
  {
    id: 'trending-today',
    layout: 'standard',
    title: { key: 'home.rows.trendingToday', params: {} },
    loadPage: async () => ({ items: existingCandidates, hasMore: false }),
    load: async () => existingCandidates,
  },
];

const genreRows = (rows: HomeRow[]) =>
  rows.filter(
    (row) =>
      row.layout === 'standard' && row.title.key === 'home.rows.popularGenre',
  );

describe('public dynamic genre Rows (e2e)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({
      override: (builder) =>
        withInMemoryCache(builder)
          .overrideProvider(HOME_ROW_SOURCES)
          .useValue(existingSources),
    });
  });
  afterAll(async () => testApp.close());
  beforeEach(async () => {
    sharedInMemoryCache.clear();
    existingCandidates = [];
    existingSources.splice(1);
    await resetDatabase(testApp.db);
  });

  it('serves twelve diverse strong Tracks in a stable, unsponsored genre Row', async () => {
    const strongIds: string[] = [];
    for (let index = 0; index < 48; index += 1) {
      const strong = index < 12;
      const track = await createCompletedTrack(testApp.db, {
        title: `Genre Track ${index}`,
        genres: ['pop'],
        trendingScore: strong ? 100 - index : 1,
        artistCredit: [{ name: `Artist ${index}`, joinPhrase: '' }],
      });
      if (strong) strongIds.push(track.id);
    }
    const home = await request(testApp.app.getHttpServer())
      .get('/v1/home?locale=en')
      .expect(200);
    const genre = (home.body.rows as HomeRow[]).find(
      (row) =>
        row.layout === 'standard' && row.title.key === 'home.rows.popularGenre',
    );
    expect(genre?.layout).toBe('standard');
    if (genre?.layout !== 'standard') throw new Error('Expected genre Row');
    expect(genre.title.params).toEqual({ genre: 'pop' });
    expect(genre.items.map(({ id }) => id)).toEqual(strongIds);
    expect(genre.sponsored).not.toBe(true);
    expect(genre.nextItemsCursor ?? null).toBeNull();
    const again = await request(testApp.app.getHttpServer())
      .get('/v1/home?locale=pt-BR')
      .expect(200);
    expect((again.body.rows as HomeRow[]).map(({ id }) => id)).toContain(
      genre.id,
    );
  });
  it.each([
    { count: 44, expected: 0 },
    { count: 45, expected: 1 },
  ])(
    'uses ceil(N/4): $count positives qualify $expected genre Rows',
    async ({ count, expected }) => {
      await seedGenreTracks(
        testApp.db,
        Array.from({ length: count }, () => ({ score: 1 })),
      );
      const home = await request(testApp.app.getHttpServer())
        .get('/v1/home')
        .expect(200);
      const genres = genreRows(home.body.rows as HomeRow[]);
      expect(genres).toHaveLength(expected);
      if (expected === 1) {
        const [row] = genres;
        if (row?.layout !== 'standard') throw new Error('Expected genre Row');
        expect(row.items.map(({ id }) => id)).toEqual(
          Array.from(
            { length: 12 },
            (_, index) => `genre-track-${index.toString().padStart(4, '0')}`,
          ),
        );
      }
    },
  );

  it('excludes zero scores and incomplete Tracks from the collective reference', async () => {
    await seedGenreTracks(testApp.db, [
      ...Array.from({ length: 44 }, () => ({ score: 10 })),
      ...Array.from({ length: 24 }, () => ({ score: 0 })),
      ...Array.from({ length: 24 }, () => ({ score: 1000, completed: false })),
    ]);
    const home = await request(testApp.app.getHttpServer())
      .get('/v1/home')
      .expect(200);
    expect(genreRows(home.body.rows as HomeRow[])).toEqual([]);
  });

  it('protects genre candidates beyond the first sixty and appends after existing Rows', async () => {
    const inserted = await seedGenreTracks(
      testApp.db,
      Array.from({ length: 304 }, (_, index) => ({
        score: 1000 - index,
        genres: index >= 64 && index < 76 ? ['deep-genre'] : [],
      })),
    );
    existingCandidates = inserted.slice(0, 100).map(toHomeCandidate);
    const home = await request(testApp.app.getHttpServer())
      .get('/v1/home')
      .expect(200);
    const rows = home.body.rows as HomeRow[];
    const [row] = genreRows(rows);
    if (row?.layout !== 'standard') throw new Error('Expected deep genre Row');
    expect(row.items.map(({ id }) => id)).toEqual(
      inserted.slice(64, 76).map(({ id }) => id),
    );
    expect(rows.at(-1)?.id).toBe(row.id);
    const first = rows.find(({ id }) => id === 'trending-today');
    expect(first?.layout).toBe('standard');
    if (first?.layout !== 'standard') throw new Error('Expected current Row');
    expect(first.items).toHaveLength(12);
    expect(first.nextItemsCursor).toBeTypeOf('string');
  });

  it('delivers only strong genre expansion, including a short last item page', async () => {
    const inserted = await seedGenreTracks(
      testApp.db,
      Array.from({ length: 100 }, (_, index) => ({
        score: index < 25 ? 100 : 1,
      })),
    );
    const home = await request(testApp.app.getHttpServer())
      .get('/v1/home')
      .expect(200);
    const [row] = genreRows(home.body.rows as HomeRow[]);
    if (row?.layout !== 'standard') throw new Error('Expected genre Row');
    const pages = [row.items.length];
    const ids = row.items.map(({ id }) => id);
    let cursor = row.nextItemsCursor;
    while (cursor) {
      const next = await request(testApp.app.getHttpServer())
        .get(
          `/v1/home/rows/${row.id}/items?cursor=${encodeURIComponent(cursor)}`,
        )
        .expect(200);
      pages.push(next.body.items.length);
      ids.push(...next.body.items.map((item: { id: string }) => item.id));
      cursor = next.body.nextCursor as string | null;
    }
    expect(pages).toEqual([12, 12, 1]);
    expect(ids).toEqual(inserted.slice(0, 25).map(({ id }) => id));
    expect(new Set(ids).size).toBe(25);
  });

  it('requalifies after a live Pin removes one of the twelve initial Tracks', async () => {
    const inserted = await seedGenreTracks(
      testApp.db,
      Array.from({ length: 48 }, () => ({ score: 1 })),
    );
    const before = await request(testApp.app.getHttpServer())
      .get('/v1/home')
      .expect(200);
    expect(genreRows(before.body.rows as HomeRow[])).toHaveLength(1);
    const client = createAuthClient(testApp);
    await signInPinsAdmin(testApp.db, client);
    const first = inserted[0];
    if (!first) throw new Error('Missing fixture Track');
    await client
      .post('/v1/admin/home-pins')
      .send(rowPinBody([first.id]))
      .expect(201);
    const after = await request(testApp.app.getHttpServer())
      .get('/v1/home')
      .expect(200);
    expect(genreRows(after.body.rows as HomeRow[])).toEqual([]);
    expect(
      (after.body.rows as HomeRow[]).some(({ id }) => id.startsWith('pin-')),
    ).toBe(true);
    const feed = await testApp.app
      .get(HomeFeedService)
      .storedPublicForPreview('en');
    expect(feed.genreCandidates?.[0]?.items).toHaveLength(12);
  });

  it('does not force genre presence for an empty collective reference', async () => {
    const home = await request(testApp.app.getHttpServer())
      .get('/v1/home')
      .expect(200);
    expect(genreRows(home.body.rows as HomeRow[])).toEqual([]);
  });

  it('includes favorite-only collective popularity when views are zero', async () => {
    const inserted = await seedGenreTracks(
      testApp.db,
      Array.from({ length: 48 }, () => ({ score: 0 })),
    );
    const client = createAuthClient(testApp);
    const user = await signInPinsAdmin(testApp.db, client);
    await testApp.db
      .insert(trackFavorites)
      .values(inserted.map(({ id }) => ({ userId: user.id, trackId: id })));
    const home = await request(testApp.app.getHttpServer())
      .get('/v1/home')
      .expect(200);
    expect(genreRows(home.body.rows as HomeRow[])).toHaveLength(1);
  });

  it('keeps public fallback private and omits public-selected genres from established personal snapshots', async () => {
    const inserted = await seedGenreTracks(
      testApp.db,
      Array.from({ length: 48 }, () => ({ score: 1 })),
    );
    const client = createAuthClient(testApp);
    const user = await signInPinsAdmin(testApp.db, client);
    const fallback = await client.get('/v1/home').expect(200);
    expect(fallback.headers['cache-control']).toBe('private, no-store');
    expect(genreRows(fallback.body.rows as HomeRow[])).toHaveLength(1);
    const first = inserted[0];
    if (!first) throw new Error('Missing favorite fixture');
    await testApp.db
      .insert(trackFavorites)
      .values({ userId: user.id, trackId: first.id });
    const snapshot = await testApp.app
      .get(PersonalHomeBuilder)
      .build(user.id, 'en');
    await testApp.app
      .get(PersonalHomeStore)
      .writeCurrent(user.id, 'en', snapshot);
    const personal = await client.get('/v1/home').expect(200);
    expect(personal.body.audience).toBe('personal');
    expect(personal.headers['cache-control']).toBe('private, no-store');
    expect(genreRows(personal.body.rows as HomeRow[])).toEqual([]);
  });

  it('retains canonical same-name Artists across both frozen axes, regeneration and ended Pins', async () => {
    const inserted = await seedGenreTracks(
      testApp.db,
      Array.from({ length: 100 }, (_, index) => ({
        score: index < 25 ? 100 : 1,
        artist: 'Same public name',
        artistMbid: testMbid(index + 1000),
      })),
    );
    for (let rowIndex = 0; rowIndex < 5; rowIndex += 1) {
      existingSources.push({
        id: `retained-source-${rowIndex}`,
        layout: 'standard',
        title: { key: 'home.rows.newTracks', params: {} },
        load: async () =>
          inserted
            .slice(30 + rowIndex * 6, 36 + rowIndex * 6)
            .map(toHomeCandidate),
        loadPage: async () => ({
          items: inserted
            .slice(30 + rowIndex * 6, 36 + rowIndex * 6)
            .map(toHomeCandidate),
          hasMore: false,
        }),
      });
    }
    const client = createAuthClient(testApp);
    await signInPinsAdmin(testApp.db, client);
    const firstTrack = inserted[0];
    const changedTrack = inserted[1];
    if (!firstTrack || !changedTrack)
      throw new Error('Missing canonical fixture');
    const pin = await client
      .post('/v1/admin/home-pins')
      .send(rowPinBody([firstTrack.id]))
      .expect(201);
    const first = await request(testApp.app.getHttpServer())
      .get('/v1/home')
      .expect(200);
    expect(first.body.nextCursor).toBeTypeOf('string');
    const second = await request(testApp.app.getHttpServer())
      .get(`/v1/home?cursor=${encodeURIComponent(first.body.nextCursor)}`)
      .expect(200);
    const [genre] = genreRows(second.body.rows as HomeRow[]);
    if (genre?.layout !== 'standard' || !genre.nextItemsCursor)
      throw new Error('Expected paged canonical-Artist genre');
    expect(genre.items).toHaveLength(12);
    expect(genre.items.map(({ id }) => id)).toEqual(
      inserted.slice(1, 13).map(({ id }) => id),
    );
    await testApp.db
      .update(tracks)
      .set({ trendingScore: 0 })
      .where(eq(tracks.id, changedTrack.id));
    await testApp.app.get(HomeFeedService).refreshPublic('en');
    await client.delete(`/v1/admin/home-pins/${pin.body.id}`).expect(204);
    const retainedVertical = await request(testApp.app.getHttpServer())
      .get(`/v1/home?cursor=${encodeURIComponent(first.body.nextCursor)}`)
      .expect(200);
    expect(genreRows(retainedVertical.body.rows as HomeRow[])).toEqual([genre]);
    const retainedHorizontal = await request(testApp.app.getHttpServer())
      .get(
        `/v1/home/rows/${genre.id}/items?cursor=${encodeURIComponent(genre.nextItemsCursor)}`,
      )
      .expect(200);
    expect(
      retainedHorizontal.body.items.map((track: { id: string }) => track.id),
    ).toEqual(inserted.slice(13, 25).map(({ id }) => id));
    for (const track of [...genre.items, ...retainedHorizontal.body.items]) {
      expect(track).not.toHaveProperty('artistKeys');
      expect(track).not.toHaveProperty('collectiveScore');
      expect(track.artistCredit[0]).not.toHaveProperty('mbid');
    }
  });
});
