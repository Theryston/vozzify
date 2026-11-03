import { catalogTracksPageSchema } from '@vozzify/contracts';
import { createTestApp, type TestApp } from './utils/create-test-app.js';
import { resetDatabase } from './utils/database.js';
import {
  createArtist,
  createTrackRelease,
  linkTrackArtist,
  testMbid,
} from './utils/factories.js';
import { createCompletedTrack } from './utils/track-processing-factories.js';

describe('Artist tracks with many releases (e2e)', () => {
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

  it.each([31, 84])(
    'returns every release when a recording has %i releases',
    async (releaseCount) => {
      const artist = await createArtist(testApp.db, { name: 'Ed Sheeran' });
      const track = await createCompletedTrack(testApp.db, {
        title: 'Perfect',
      });
      await linkTrackArtist(testApp.db, track.id, artist.id);
      const releases = [];
      for (let index = releaseCount; index > 0; index--) {
        const release = {
          mbid: testMbid(index),
          title: `Release ${String(index).padStart(3, '0')}`,
          year: 2017,
          coverArtUrl: null,
        };
        await createTrackRelease(testApp.db, track.id, release);
        releases.unshift(release);
      }

      const response = await testApp.http
        .get(`/v1/artists/${artist.id}/tracks?limit=20`)
        .expect(200);

      const page = catalogTracksPageSchema.parse(response.body);
      expect(page.items).toHaveLength(1);
      expect(page.items[0]?.id).toBe(track.id);
      expect(page.items[0]?.releases).toEqual(releases);
      expect(page.nextCursor).toBeNull();
    },
  );
});
