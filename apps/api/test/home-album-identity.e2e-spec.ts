import type { HomeRow } from '@vozzify/contracts';
import request from 'supertest';
import {
  createAlbumDisc,
  placeAlbumTrack,
} from './utils/album-track-factories.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';
import { resetDatabase } from './utils/database.js';
import { createAlbum, createLegacyAlbumId } from './utils/factories.js';
import { createCompletedTrack } from './utils/track-processing-factories.js';

const getHome = (testApp: TestApp) =>
  request(testApp.app.getHttpServer()).get('/v1/home');

const createAlbumWithTrack = async (
  testApp: TestApp,
  title: string,
  trackId: string,
) => {
  const album = await createAlbum(testApp.db, { title });
  await createAlbumDisc(testApp.db, album.id, 1);
  await placeAlbumTrack(testApp.db, {
    albumId: album.id,
    trackId,
    discPosition: 1,
    trackPosition: 1,
  });
  return album;
};

const albumRowOf = (rows: HomeRow[]) =>
  rows.find((row) => row.id === 'featured-albums');

describe('Home Album identity preservation (e2e)', () => {
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

  it('keeps duplicate-content Albums and their public and legacy routes', async () => {
    const shared = await createCompletedTrack(testApp.db, {
      title: 'Shared recording',
      trendingScore: 100,
    });
    const firstDuplicate = await createAlbumWithTrack(
      testApp,
      'Same content first',
      shared.id,
    );
    const secondDuplicate = await createAlbumWithTrack(
      testApp,
      'Same content second',
      shared.id,
    );
    const uniqueAlbums = [];
    for (let index = 0; index < 3; index += 1) {
      const track = await createCompletedTrack(testApp.db, {
        title: `Distinct content ${index}`,
        trendingScore: 50 - index,
      });
      uniqueAlbums.push(
        await createAlbumWithTrack(testApp, `Unique Album ${index}`, track.id),
      );
    }
    await createLegacyAlbumId(
      testApp.db,
      firstDuplicate.id,
      'legacy-album-first',
    );
    await createLegacyAlbumId(
      testApp.db,
      secondDuplicate.id,
      'legacy-album-second',
    );
    const { body } = await getHome(testApp).expect(200);
    const row = albumRowOf(body.rows);

    expect(row?.layout).toBe('albums');
    if (row?.layout === 'albums') {
      const ids = row.items.map(({ id }) => id);
      expect(
        ids.filter((id) =>
          [firstDuplicate.id, secondDuplicate.id].includes(id),
        ),
      ).toHaveLength(1);
      expect(ids).toEqual(
        expect.arrayContaining(uniqueAlbums.map(({ id }) => id)),
      );
    }

    for (const album of [firstDuplicate, secondDuplicate, ...uniqueAlbums]) {
      await request(testApp.app.getHttpServer())
        .get(`/v1/albums/${album.id}`)
        .expect(200)
        .expect(({ body: albumBody }) => {
          expect(albumBody).toMatchObject({ id: album.id, title: album.title });
        });
    }
    for (const [legacyId, album] of [
      ['legacy-album-first', firstDuplicate],
      ['legacy-album-second', secondDuplicate],
    ] as const) {
      await request(testApp.app.getHttpServer())
        .get(`/v1/albums/${legacyId}`)
        .expect(404)
        .expect(({ body: error }) => {
          expect(error).toMatchObject({
            code: 'RESOURCE_MOVED',
            details: { id: album.id },
          });
        });
    }
  });
});
