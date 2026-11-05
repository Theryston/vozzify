import type { HomeRow } from '@vozzify/contracts';
import request from 'supertest';
import {
  albumDiscs,
  albums,
  albumTracks,
} from '../src/database/schema/albums.js';
import {
  createAlbumDisc,
  placeAlbumTrack,
} from './utils/album-track-factories.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';
import { resetDatabase } from './utils/database.js';
import { createAlbum, testMbid } from './utils/factories.js';
import { createCompletedTrack } from './utils/track-processing-factories.js';

type AvailableTrack = Awaited<ReturnType<typeof createCompletedTrack>>;

const getHome = (testApp: TestApp) =>
  request(testApp.app.getHttpServer()).get('/v1/home');

const trackAt = (tracks: AvailableTrack[], index: number): AvailableTrack => {
  const track = tracks[index];
  if (!track) throw new Error(`Missing fixture Track at index ${index}`);
  return track;
};

const createRelease = async (
  testApp: TestApp,
  title: string,
  tracks: AvailableTrack[],
  metadata: {
    secondaryTypes?: string[];
    coverArtUrl?: string | null;
    year?: number | null;
  } = {},
) => {
  const album = await createAlbum(testApp.db, { title, ...metadata });
  await createAlbumDisc(testApp.db, album.id, 1);
  for (const [index, track] of tracks.entries()) {
    await placeAlbumTrack(testApp.db, {
      albumId: album.id,
      trackId: track.id,
      discPosition: 1,
      trackPosition: index + 1,
    });
  }
  return album;
};

const createDuplicateReleases = async (
  testApp: TestApp,
  trackId: string,
  count: number,
) => {
  const records = await testApp.db
    .insert(albums)
    .values(
      Array.from({ length: count }, (_, index) => ({
        mbid: testMbid(5000 + index),
        title: `Duplicate ${index}`,
      })),
    )
    .returning({ id: albums.id });
  await testApp.db
    .insert(albumDiscs)
    .values(records.map(({ id }) => ({ albumId: id, position: 1 })));
  await testApp.db.insert(albumTracks).values(
    records.map(({ id }) => ({
      albumId: id,
      trackId,
      discPosition: 1,
      trackPosition: 1,
    })),
  );
  return records;
};

const albumRowOf = (rows: HomeRow[]) =>
  rows.find((row) => row.id === 'featured-albums');

describe('Home Album content selection (e2e)', () => {
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

  it('omits equivalent and subset content while retaining useful overlap', async () => {
    const tracks = await Promise.all(
      [300, 100, 50, 40, 30, 20, 10, 5, 1].map((trendingScore, index) =>
        createCompletedTrack(testApp.db, {
          title: `Album content ${index}`,
          trendingScore,
        }),
      ),
    );
    const top = await createRelease(testApp, 'Best Album', tracks.slice(0, 3), {
      coverArtUrl: 'https://cdn.example/best.webp',
      year: 1990,
    });
    const duplicate = await createRelease(
      testApp,
      'Compilation duplicate',
      tracks.slice(0, 3),
      { secondaryTypes: ['Compilation'] },
    );
    const subset = await createRelease(
      testApp,
      'Subset single',
      tracks.slice(0, 1),
    );
    const independent = [];
    for (let index = 3; index < 8; index += 1) {
      independent.push(
        await createRelease(testApp, `Independent ${index}`, [
          trackAt(tracks, index),
        ]),
      );
    }
    const partial = await createRelease(testApp, 'Partial overlap', [
      trackAt(tracks, 0),
      trackAt(tracks, 1),
      trackAt(tracks, 8),
    ]);

    const { body } = await getHome(testApp).expect(200);
    const row = albumRowOf(body.rows);

    expect(row?.layout).toBe('albums');
    if (row?.layout === 'albums') {
      const ids = row.items.map(({ id }) => id);
      expect(ids).toContain(top.id);
      expect(ids).toContain(partial.id);
      expect(ids).not.toContain(duplicate.id);
      expect(ids).not.toContain(subset.id);
      expect(ids).toEqual(
        expect.arrayContaining(independent.map(({ id }) => id)),
      );
    }
  });

  it('replenishes bounded candidate pages after equivalent Albums are skipped', async () => {
    const shared = await createCompletedTrack(testApp.db, {
      title: 'Shared recording',
      trendingScore: 100,
    });
    const duplicateAlbums = await createDuplicateReleases(
      testApp,
      shared.id,
      61,
    );
    const usefulAlbums = [];
    for (let index = 0; index < 5; index += 1) {
      const track = await createCompletedTrack(testApp.db, {
        title: `Distinct recording ${index}`,
        trendingScore: 10 - index,
      });
      usefulAlbums.push(
        await createRelease(testApp, `Useful ${index}`, [track]),
      );
    }

    const { body } = await getHome(testApp).expect(200);
    const row = albumRowOf(body.rows);

    expect(row?.layout).toBe('albums');
    if (row?.layout === 'albums') {
      const ids = row.items.map(({ id }) => id);
      expect(ids).toHaveLength(6);
      expect(
        ids.filter((id) => duplicateAlbums.some((album) => album.id === id)),
      ).toHaveLength(1);
      expect(ids).toEqual(
        expect.arrayContaining(usefulAlbums.map(({ id }) => id)),
      );
    }
  });
});
