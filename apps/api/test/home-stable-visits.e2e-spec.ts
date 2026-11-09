import type { TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import { trackProcessings } from '../src/database/schema/track-processings.js';
import { tracks } from '../src/database/schema/tracks.js';
import { HomeFeedService } from '../src/modules/home/home-feed.service.js';
import { encodeHomeRowItemsCursor } from '../src/modules/home/home-row-items-cursor.js';
import {
  HOME_ROW_SOURCES,
  type HomeCandidate,
  type HomeRowSource,
} from '../src/modules/home/home-row-sources.js';
import { HomeVisitStore } from '../src/modules/home/home-visit.store.js';
import { createAuthClient } from './utils/auth.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';
import { resetDatabase } from './utils/database.js';
import {
  heroPinBody,
  rowPinBody,
  signInPinsAdmin,
} from './utils/editorial-pin-factories.js';
import { createArtist, testMbid } from './utils/factories.js';
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

let sourceRowCount = 8;

const sourcesFor = (generation: () => number): HomeRowSource[] =>
  Array.from({ length: 8 }, (_, row) => ({
    id: `visit-row-${row}`,
    layout: 'standard',
    title: { key: 'home.rows.newTracks', params: {} },
    load: async () =>
      row < sourceRowCount ? candidatesFor(generation(), row) : [],
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
    sourceRowCount = 8;
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

  it('pages a 24-Track Row through bounded HTTP pages in one frozen visit', async () => {
    sourceRowCount = 0;
    const trackIds: string[] = [];
    for (let index = 0; index < 24; index += 1) {
      const track = await createCompletedTrack(testApp.db, {
        title: `Horizontal ${index}`,
      });
      trackIds.push(track.id);
    }
    const created = await client
      .post('/v1/admin/home-pins')
      .send(rowPinBody(trackIds, { position: 1 }))
      .expect(201);

    const first = await request(testApp.app.getHttpServer())
      .get('/v1/home?locale=en')
      .expect(200);
    const row = first.body.rows.find(
      (candidate: { id: string; layout: string }) =>
        candidate.layout === 'standard' && candidate.id.startsWith('pin-'),
    );
    expect(row.items).toHaveLength(12);
    expect(row.nextItemsCursor).toEqual(expect.any(String));
    expect(first.body.nextCursor).toBeNull();
    expect(first.headers['cache-control']).toContain('public');

    await request(testApp.app.getHttpServer())
      .get(
        `/v1/home/rows/wrong-row/items?cursor=${encodeURIComponent(row.nextItemsCursor)}`,
      )
      .expect(404);

    const second = await request(testApp.app.getHttpServer())
      .get(
        `/v1/home/rows/${row.id}/items?cursor=${encodeURIComponent(row.nextItemsCursor)}`,
      )
      .expect(200);
    expect(second.body.rowId).toBe(row.id);
    expect(second.body.items).toHaveLength(12);
    expect(second.body.nextCursor).toBeNull();
    expect(second.body.items.map((item: { id: string }) => item.id)).toEqual(
      trackIds.slice(12),
    );
    const signedInPublicPage = await client
      .get(
        `/v1/home/rows/${row.id}/items?cursor=${encodeURIComponent(row.nextItemsCursor)}`,
      )
      .expect(200);
    expect(signedInPublicPage.headers['cache-control']).toBe(
      'private, no-store',
    );
    const personalFirst = await client.get('/v1/home?locale=en').expect(200);
    const personalRow = personalFirst.body.rows.find(
      (candidate: { id: string }) => candidate.id === row.id,
    );
    expect(personalFirst.headers['cache-control']).toBe('private, no-store');
    expect(personalRow.items).toHaveLength(12);
    const personalSecond = await client
      .get(
        `/v1/home/rows/${row.id}/items?cursor=${encodeURIComponent(personalRow.nextItemsCursor)}`,
      )
      .expect(200);
    expect(personalSecond.headers['cache-control']).toBe('private, no-store');
    expect(
      personalSecond.body.items.map((item: { id: string }) => item.id),
    ).toEqual(trackIds.slice(12));

    sourceRowCount = 8;
    await testApp.app.get(HomeFeedService).refreshPublic('en');
    const mixedFirst = await request(testApp.app.getHttpServer())
      .get('/v1/home?locale=en')
      .expect(200);
    const mixedRow = mixedFirst.body.rows.find(
      (candidate: { id: string }) => candidate.id === row.id,
    );
    expect(mixedFirst.body.nextCursor).toEqual(expect.any(String));
    expect(mixedRow.nextItemsCursor).toEqual(expect.any(String));
    generation = 1;
    await testApp.app.get(HomeFeedService).refreshPublic('en');
    await request(testApp.app.getHttpServer())
      .get(
        `/v1/home/rows/${mixedRow.id}/items?cursor=${encodeURIComponent(mixedRow.nextItemsCursor)}`,
      )
      .expect(200);
    const mixedVertical = await request(testApp.app.getHttpServer())
      .get(
        `/v1/home?cursor=${encodeURIComponent(mixedFirst.body.nextCursor as string)}`,
      )
      .expect(200);
    expect(mixedVertical.body.version).toBe(mixedFirst.body.version);
    expect(mixedVertical.body.rows).toHaveLength(3);
    expect(mixedVertical.body.rows[0]?.items[0]?.id).toBe(
      'visit-0-row-5-track-0',
    );

    await client
      .patch(`/v1/admin/home-pins/${created.body.id}`)
      .send({ audience: 'visitors' })
      .expect(200);
    const hiddenPin = await client
      .get(
        `/v1/home/rows/${mixedRow.id}/items?cursor=${encodeURIComponent(mixedRow.nextItemsCursor)}`,
      )
      .expect(404);
    expect(hiddenPin.body.details.reason).toBe('FEED_VERSION_EXPIRED');
    await client
      .patch(`/v1/admin/home-pins/${created.body.id}`)
      .send({ audience: 'everyone' })
      .expect(200);
    await client
      .patch(`/v1/admin/home-pins/${created.body.id}`)
      .send({ sponsored: true })
      .expect(200);
    const sponsoredChange = await request(testApp.app.getHttpServer())
      .get(
        `/v1/home/rows/${mixedRow.id}/items?cursor=${encodeURIComponent(mixedRow.nextItemsCursor)}`,
      )
      .expect(404);
    expect(sponsoredChange.body.details.reason).toBe('FEED_VERSION_EXPIRED');

    await client.delete(`/v1/admin/home-pins/${created.body.id}`).expect(204);
    const expired = await request(testApp.app.getHttpServer())
      .get(
        `/v1/home/rows/${row.id}/items?cursor=${encodeURIComponent(row.nextItemsCursor)}`,
      )
      .expect(404);
    expect(expired.body.details.reason).toBe('FEED_VERSION_EXPIRED');
  });

  it('keeps hero-overlapping Pin rows readable across horizontal pages', async () => {
    const createdTracks = await testApp.db
      .insert(tracks)
      .values(
        Array.from({ length: 24 }, (_, index) => ({
          recordingMbid: testMbid(5000 + index),
          title: `Overlapping ${index}`,
          lengthMs: 180_000,
          disambiguation: '',
          video: false,
          isrcs: [],
          genres: [],
          ...(index === 0
            ? { coverUrl: 'https://cdn.example/overlapping.webp' }
            : {}),
        })),
      )
      .returning();
    await testApp.db.insert(trackProcessings).values(
      createdTracks.map((track) => ({
        trackId: track.id,
        status: 'COMPLETED' as const,
      })),
    );
    const trackIds = createdTracks.map((track) => track.id);
    const hero = await client
      .post('/v1/admin/home-pins')
      .send(heroPinBody(trackIds[0] ?? ''))
      .expect(201);
    const row = await client
      .post('/v1/admin/home-pins')
      .send(rowPinBody(trackIds, { position: 1 }))
      .expect(201);

    const first = await request(testApp.app.getHttpServer())
      .get('/v1/home?locale=en')
      .expect(200);
    const frozenRow = first.body.rows.find(
      (candidate: { id: string }) => candidate.id === `pin-${row.body.id}`,
    );
    expect(first.body.rows[0]?.id).toBe(`pin-${hero.body.id as string}`);
    expect(frozenRow.items).toHaveLength(12);
    expect(frozenRow.nextItemsCursor).toEqual(expect.any(String));

    const later = await request(testApp.app.getHttpServer())
      .get(
        `/v1/home/rows/${frozenRow.id}/items?cursor=${encodeURIComponent(frozenRow.nextItemsCursor)}`,
      )
      .expect(200);

    expect(later.body.items).toHaveLength(11);
    expect(later.body.items.map((item: { id: string }) => item.id)).toEqual(
      trackIds.slice(13),
    );
    expect(later.body.nextCursor).toBeNull();
  });

  it('links Artist credits on horizontal pages after the first twelve items', async () => {
    const artist = await createArtist(testApp.db, { name: 'Paging Artist' });
    const tracks = await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        createCompletedTrack(testApp.db, {
          title: `Paging track ${index}`,
          artistCredit:
            index === 12
              ? [{ name: artist.name, joinPhrase: '', mbid: artist.mbid }]
              : [{ name: `Paging ${index}`, joinPhrase: '' }],
        }),
      ),
    );
    const pin = await client
      .post('/v1/admin/home-pins')
      .send(
        rowPinBody(
          tracks.map((track) => track.id),
          { position: 0 },
        ),
      )
      .expect(201);
    const first = await request(testApp.app.getHttpServer())
      .get('/v1/home?locale=en')
      .expect(200);
    const row = first.body.rows.find(
      (entry: { id: string }) => entry.id === `pin-${pin.body.id as string}`,
    );
    expect(row.items[0].artistCredit[0]).toMatchObject({ artistId: null });

    const later = await request(testApp.app.getHttpServer())
      .get(
        `/v1/home/rows/${row.id}/items?cursor=${encodeURIComponent(row.nextItemsCursor)}`,
      )
      .expect(200);
    expect(later.body.items[0].id).toBe(tracks[12]?.id);
    expect(later.body.items[0].artistCredit[0]).toMatchObject({
      artistId: artist.id,
    });
  });

  it('serves required Vocal Range data in bounded horizontal pages', async () => {
    const row = {
      id: 'vocal-range-row',
      layout: 'vocal-range' as const,
      title: { key: 'home.rows.higherVoices', params: {} },
      items: Array.from({ length: 48 }, (_, index) => ({
        id: `vocal-track-${index}`,
        title: `Vocal Track ${index}`,
        coverUrl: null,
        artistCredit: [],
        durationMs: null,
        vocalRange: { lowest: 45, highest: 70 },
      })),
    };
    const visit = await testApp.app.get(HomeVisitStore).create({
      audience: 'public',
      version: 'vocal-source-version',
      algorithmVersion: 1,
      rows: [row],
      locale: 'en',
    });
    if (!visit) throw new Error('Expected a frozen public visit');
    const cursor = encodeHomeRowItemsCursor({
      version: visit.version,
      rowId: row.id,
      position: 12,
      locale: 'en',
    });
    const wrongLocaleCursor = encodeHomeRowItemsCursor({
      version: visit.version,
      rowId: row.id,
      position: 12,
      locale: 'pt-BR',
    });
    await request(testApp.app.getHttpServer())
      .get(
        `/v1/home/rows/${row.id}/items?cursor=${encodeURIComponent(wrongLocaleCursor)}`,
      )
      .expect(404);
    const page = await request(testApp.app.getHttpServer())
      .get(`/v1/home/rows/${row.id}/items?cursor=${encodeURIComponent(cursor)}`)
      .expect(200);
    expect(page.body.layout).toBe('vocal-range');
    expect(page.body.items).toHaveLength(12);
    expect(
      page.body.items.every((item: { vocalRange: unknown }) => item.vocalRange),
    ).toBe(true);
    expect(page.body.nextCursor).toEqual(expect.any(String));
  });

  it('rejects a personal item cursor without its owner', async () => {
    const track = (id: string) => ({
      id,
      title: id,
      coverUrl: null,
      artistCredit: [],
      durationMs: null,
      vocalRange: null,
    });
    const row = {
      id: 'private-row',
      layout: 'standard' as const,
      title: { key: 'home.rows.newTracks', params: {} },
      items: Array.from({ length: 13 }, (_, index) => track(`track-${index}`)),
    };
    const visit = await testApp.app.get(HomeVisitStore).create(
      {
        audience: 'personal',
        version: 'a1b2c3d4e5f60718',
        algorithmVersion: 1,
        rows: [row],
        locale: 'en',
      },
      'another-user',
    );
    if (!visit) throw new Error('Expected a frozen personal visit');
    const cursor = encodeHomeRowItemsCursor({
      version: visit.version,
      rowId: row.id,
      position: 12,
      locale: 'en',
    });
    await request(testApp.app.getHttpServer())
      .get(`/v1/home/rows/${row.id}/items?cursor=${encodeURIComponent(cursor)}`)
      .expect(404);
    await client
      .get(`/v1/home/rows/${row.id}/items?cursor=${encodeURIComponent(cursor)}`)
      .expect(404);
  });
});
