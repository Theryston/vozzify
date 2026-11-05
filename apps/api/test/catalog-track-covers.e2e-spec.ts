import { catalogTracksPageSchema } from '@vozzify/contracts';
import { trackFavorites } from '../src/database/schema/track-favorites.js';
import {
  createAlbumDisc,
  placeAlbumTrack,
} from './utils/album-track-factories.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';
import { resetDatabase } from './utils/database.js';
import {
  createAlbum,
  createArtist,
  createTrackRelease,
  createUser,
  linkTrackArtist,
} from './utils/factories.js';
import { createCompletedTrack } from './utils/track-processing-factories.js';

describe('Stored Track covers in catalog lists (e2e)', () => {
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

  it.each(['https://storage.test/track-cover.webp', null])(
    'returns the stored cover %s in albums, artists and favorites',
    async (coverUrl) => {
      const artist = await createArtist(testApp.db);
      const album = await createAlbum(testApp.db);
      const user = await createUser(testApp.db, { username: 'cover_listener' });
      const track = await createCompletedTrack(testApp.db, { coverUrl });
      await linkTrackArtist(testApp.db, track.id, artist.id);
      await createTrackRelease(testApp.db, track.id, {
        title: 'A different release',
        coverArtUrl: 'https://archive.test/different-cover.jpg',
      });
      await createAlbumDisc(testApp.db, album.id, 1);
      await placeAlbumTrack(testApp.db, {
        albumId: album.id,
        trackId: track.id,
        discPosition: 1,
        trackPosition: 1,
      });
      await testApp.db.insert(trackFavorites).values({
        userId: user.id,
        trackId: track.id,
      });

      for (const path of [
        `/v1/albums/${album.id}/tracks`,
        `/v1/artists/${artist.id}/tracks`,
        `/v1/users/${user.username}/favorites`,
      ]) {
        const response = await testApp.http.get(path).expect(200);
        const page = catalogTracksPageSchema.parse(response.body);
        expect(page.items).toHaveLength(1);
        expect(page.items[0]).toMatchObject({ id: track.id, coverUrl });
        expect(response.body.items[0].coverUrl).toBe(coverUrl);
      }
    },
  );
});
