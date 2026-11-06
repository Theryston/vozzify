import type { HomeRow } from '@vozzify/contracts';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/database/database.js';
import {
  albumDiscs,
  albums,
  albumTracks,
} from '../src/database/schema/albums.js';
import { HomeFeedService } from '../src/modules/home/home-feed.service.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';
import { resetDatabase } from './utils/database.js';
import { createAlbum } from './utils/factories.js';
import { createCompletedTrack } from './utils/track-processing-factories.js';

const getHome = (testApp: TestApp) =>
  request(testApp.app.getHttpServer()).get('/v1/home');

const rowOf = (rows: HomeRow[]) =>
  rows.find((row) => row.id === 'featured-albums');

const createAlbumWithTrack = async (
  db: Database,
  title: string,
  trackIndex: number,
) => {
  const track = await createCompletedTrack(db, {
    title: `Album row Track ${trackIndex}`,
    trendingScore: 30 - trackIndex,
  });
  const album = await createAlbum(db, { title });
  await db.insert(albumDiscs).values({ albumId: album.id, position: 1 });
  await db.insert(albumTracks).values({
    albumId: album.id,
    trackId: track.id,
    discPosition: 1,
    trackPosition: 1,
  });
  return album;
};

describe('Home Album row minimum (e2e)', () => {
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

  it('returns three Albums and omits the row when only two remain', async () => {
    const candidates = await Promise.all(
      Array.from({ length: 3 }, (_, index) =>
        createAlbumWithTrack(testApp.db, `Album ${index}`, index),
      ),
    );
    const feed = testApp.app.get(HomeFeedService);
    await feed.refreshPublic();

    const threeAlbums = await getHome(testApp).expect(200);
    const row = rowOf(threeAlbums.body.rows);
    expect(row?.layout).toBe('albums');
    if (row?.layout === 'albums') {
      expect(row.items).toHaveLength(3);
    }

    const lastAlbum = candidates[2];
    if (!lastAlbum) throw new Error('Missing third Album fixture');
    await testApp.db.delete(albums).where(eq(albums.id, lastAlbum.id));
    await feed.refreshPublic();

    const twoAlbums = await getHome(testApp).expect(200);
    expect(rowOf(twoAlbums.body.rows)).toBeUndefined();
  });
});
