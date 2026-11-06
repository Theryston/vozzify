import type { TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import { HomeFeedService } from '../src/modules/home/home-feed.service.js';
import {
  HOME_ROW_SOURCES,
  type HomeCandidate,
  type HomeRowSource,
} from '../src/modules/home/home-row-sources.js';
import { createAuthClient } from './utils/auth.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';
import { resetDatabase } from './utils/database.js';
import {
  rowPinBody,
  signInPinsAdmin,
} from './utils/editorial-pin-factories.js';
import {
  sharedInMemoryCache,
  withInMemoryCache,
} from './utils/in-memory-cache.js';
import { createCompletedTrack } from './utils/track-processing-factories.js';

const candidatesFor = (generation: number, row: number): HomeCandidate[] =>
  Array.from({ length: 6 }, (_, item) => ({
    id: `visit-${generation}-row-${row}-track-${item}`,
    title: `Visit ${generation} row ${row} track ${item}`,
    coverUrl: null,
    artistCredit: [{ name: `Artist ${row}-${item}`, joinPhrase: '' }],
    durationMs: null,
    vocalRange: null,
    artistKey: `artist-${row}-${item}`,
    hasCover: false,
    isCompleted: true,
  }));

const sourcesFor = (generation: () => number): HomeRowSource[] =>
  Array.from({ length: 8 }, (_, row) => ({
    id: `visit-row-${row}`,
    layout: 'standard',
    title: { key: 'home.rows.newTracks', params: {} },
    load: async () => candidatesFor(generation(), row),
  }));

const withControlledSources = (
  builder: TestingModuleBuilder,
  generation: () => number,
) =>
  withInMemoryCache(builder)
    .overrideProvider(HOME_ROW_SOURCES)
    .useValue(sourcesFor(generation));

describe('Home stable visit paging (e2e)', () => {
  let testApp: TestApp;
  let generation = 0;
  let pinIds: string[] = [];
  let client: ReturnType<typeof createAuthClient>;

  beforeAll(async () => {
    testApp = await createTestApp({
      override: (builder) => withControlledSources(builder, () => generation),
    });
  });

  afterAll(async () => testApp.close());

  beforeEach(async () => {
    await resetDatabase(testApp.db);
    sharedInMemoryCache.clear();
    generation = 0;
    client = createAuthClient(testApp);
    await signInPinsAdmin(testApp.db, client);
    pinIds = [];
    for (let index = 0; index < 6; index += 1) {
      const track = await createCompletedTrack(testApp.db, {
        title: `Pinned ${index}`,
      });
      pinIds.push(track.id);
    }
  });

  it('keeps later slots across Pin removal and feed regeneration', async () => {
    const created = await client
      .post('/v1/admin/home-pins')
      .send(rowPinBody(pinIds, { position: 6 }))
      .expect(201);

    const first = await request(testApp.app.getHttpServer())
      .get('/v1/home?locale=en')
      .expect(200);
    expect(first.body.rows).toHaveLength(6);
    expect(first.body.nextCursor).toEqual(expect.any(String));

    const cursor = encodeURIComponent(first.body.nextCursor as string);
    const beforeRemoval = await request(testApp.app.getHttpServer())
      .get(`/v1/home?cursor=${cursor}`)
      .expect(200);
    expect(
      beforeRemoval.body.rows.map((row: { id: string }) => row.id),
    ).toEqual([
      `pin-${created.body.id as string}`,
      'visit-row-6',
      'visit-row-7',
    ]);

    generation = 1;
    await testApp.app.get(HomeFeedService).refreshPublic('en');
    await client.delete(`/v1/admin/home-pins/${created.body.id}`).expect(204);

    const later = await request(testApp.app.getHttpServer())
      .get(`/v1/home?cursor=${cursor}`)
      .expect(200);

    expect(later.body.version).toBe(first.body.version);
    expect(later.body.rows.map((row: { id: string }) => row.id)).toEqual([
      'visit-row-6',
      'visit-row-7',
    ]);
  });

  it('masks a visitors-only Pin when a public cursor is reused after sign-in', async () => {
    const created = await client
      .post('/v1/admin/home-pins')
      .send(rowPinBody(pinIds, { audience: 'visitors', position: 6 }))
      .expect(201);
    const first = await request(testApp.app.getHttpServer())
      .get('/v1/home?locale=en')
      .expect(200);
    const cursor = encodeURIComponent(first.body.nextCursor as string);

    const publicPage = await request(testApp.app.getHttpServer())
      .get(`/v1/home?cursor=${cursor}`)
      .expect(200);
    expect(publicPage.body.rows[0]?.id).toBe(
      `pin-${created.body.id as string}`,
    );

    const signedInPage = await client
      .get(`/v1/home?cursor=${cursor}`)
      .expect(200);

    expect(signedInPage.body.rows.map((row: { id: string }) => row.id)).toEqual(
      ['visit-row-6', 'visit-row-7'],
    );
    expect(signedInPage.headers['cache-control']).toContain('private');
  });
});
