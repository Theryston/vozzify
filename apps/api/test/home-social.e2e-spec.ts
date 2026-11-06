import { eq } from 'drizzle-orm';
import request from 'supertest';
import { trackFavorites } from '../src/database/schema/track-favorites.js';
import { users } from '../src/database/schema/users.js';
import { PersonalHomeStore } from '../src/modules/home/home-personal.store.js';
import { PersonalHomeBuilder } from '../src/modules/home/home-personal-builder.service.js';
import { HomeSocialService } from '../src/modules/home/home-social.service.js';
import { createAuthClient, signIn } from './utils/auth.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';
import { resetDatabase } from './utils/database.js';
import {
  createCredentialAccount,
  createUser,
  DEFAULT_PASSWORD,
} from './utils/factories.js';
import {
  sharedInMemoryCache,
  withInMemoryCache,
} from './utils/in-memory-cache.js';
import { createCompletedTrack } from './utils/track-processing-factories.js';

describe('Personal home social rows (e2e)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({ override: withInMemoryCache });
  });

  afterAll(async () => {
    await testApp.close();
  });

  beforeEach(async () => {
    sharedInMemoryCache.clear();
    await resetDatabase(testApp.db);
  });

  it('requires three common Tracks and excludes Profiles that hide both sections', async () => {
    const tracks = await Promise.all(
      Array.from({ length: 3 }, (_, index) =>
        createCompletedTrack(testApp.db, { title: `Social track ${index}` }),
      ),
    );
    const viewer = await createUser(testApp.db, {
      username: 'social_viewer',
      email: 'social-viewer@example.com',
    });
    await createCredentialAccount(testApp.db, viewer);
    const addFavorites = (userId: string, trackIds: string[]) =>
      testApp.db
        .insert(trackFavorites)
        .values(trackIds.map((trackId) => ({ userId, trackId })));
    await addFavorites(
      viewer.id,
      tracks.map((track) => track.id),
    );
    const client = createAuthClient(testApp);
    await signIn(client, {
      email: viewer.email,
      password: DEFAULT_PASSWORD,
    }).expect(200);

    const people = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        createUser(testApp.db, {
          username: `social_person_${index}`,
          email: `social-person-${index}@example.com`,
        }),
      ),
    );
    const hidden = await createUser(testApp.db, {
      username: 'social_hidden',
      email: 'social-hidden@example.com',
    });
    // Newer unrelated accounts must not crowd older people with overlap out
    // of the bounded batch candidate pool.
    await testApp.db.insert(users).values(
      Array.from({ length: 500 }, (_, index) => ({
        name: `Unrelated user ${index}`,
        email: `unrelated-${index}@example.com`,
        username: `unrelated_${index}`,
        emailVerified: true,
        updatedAt: new Date('2099-01-01T00:00:00.000Z'),
      })),
    );
    const trackIds = tracks.map((track) => track.id);
    await Promise.all(
      [...people, hidden].map((person) => addFavorites(person.id, trackIds)),
    );
    const tooFew = await createUser(testApp.db, {
      username: 'social_too_few',
      email: 'social-too-few@example.com',
    });
    await addFavorites(tooFew.id, trackIds.slice(0, 2));
    await testApp.app.get(HomeSocialService).refreshFor(viewer.id);
    await testApp.db
      .update(users)
      .set({ showPracticeHistorySection: false, showFavoritesSection: false })
      .where(eq(users.id, hidden.id));

    const response = await client.get('/v1/home').expect(200);
    const rows = response.body.rows as {
      id: string;
      layout: string;
      items?: { username: string; commonTracks: number }[];
    }[];
    const peopleRows = rows.filter((row) => row.layout === 'people');

    expect(peopleRows).toHaveLength(1);
    expect(peopleRows[0]).toMatchObject({
      id: 'people-who-sing-what-you-sing',
      layout: 'people',
    });
    expect(peopleRows[0]?.items).toHaveLength(6);
    expect(
      peopleRows[0]?.items?.every((person) => person.commonTracks === 3),
    ).toBe(true);
    expect(
      peopleRows[0]?.items?.some(
        (person) => person.username === 'social_hidden',
      ),
    ).toBe(false);
    expect(
      peopleRows[0]?.items?.some(
        (person) => person.username === 'social_too_few',
      ),
    ).toBe(false);
    expect(
      peopleRows[0]?.items?.some(
        (person) => person.username === 'social_viewer',
      ),
    ).toBe(false);
  });

  it('keeps the only quality people category on the first Home page', async () => {
    const tracks = await Promise.all(
      Array.from({ length: 48 }, (_, index) =>
        createCompletedTrack(testApp.db, {
          title: `People placement track ${index}`,
          trendingScore: 100 - index,
          vocalRangeLowest: 48,
          vocalRangeHighest: 53,
        }),
      ),
    );
    const viewer = await createUser(testApp.db, {
      username: 'placement_viewer',
      email: 'placement-viewer@example.com',
    });
    await createCredentialAccount(testApp.db, viewer);
    const commonTrackIds = tracks.slice(0, 3).map((track) => track.id);
    const addFavorites = (userId: string) =>
      testApp.db
        .insert(trackFavorites)
        .values(commonTrackIds.map((trackId) => ({ userId, trackId })));
    await addFavorites(viewer.id);
    const client = createAuthClient(testApp);
    await signIn(client, {
      email: viewer.email,
      password: DEFAULT_PASSWORD,
    }).expect(200);

    const people = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        createUser(testApp.db, {
          username: `placement_person_${index}`,
          email: `placement-person-${index}@example.com`,
        }),
      ),
    );
    await Promise.all(people.map((person) => addFavorites(person.id)));
    await testApp.app.get(HomeSocialService).refreshFor(viewer.id);
    let publicResponse = await request(testApp.app.getHttpServer())
      .get('/v1/home')
      .expect(200);
    const publicRows = [...(publicResponse.body.rows as { id: string }[])];
    while (publicResponse.body.nextCursor) {
      publicResponse = await request(testApp.app.getHttpServer())
        .get(`/v1/home?cursor=${publicResponse.body.nextCursor as string}`)
        .expect(200);
      publicRows.push(...(publicResponse.body.rows as { id: string }[]));
    }
    expect(publicRows.map((row) => row.id)).toContain('by-voice-lower-voices');
    const snapshot = await testApp.app
      .get(PersonalHomeBuilder)
      .build(viewer.id, 'en');
    await testApp.app
      .get(PersonalHomeStore)
      .writeCurrent(viewer.id, 'en', snapshot);

    let response = await client.get('/v1/home').expect(200);
    const rows = [
      ...(response.body.rows as {
        id: string;
        layout: string;
        items?: { id: string }[];
      }[]),
    ];
    const firstPageRows = rows.slice();
    while (response.body.nextCursor) {
      response = await client
        .get(`/v1/home?cursor=${response.body.nextCursor as string}`)
        .expect(200);
      rows.push(...(response.body.rows as (typeof rows)[number][]));
    }
    const peopleIndex = firstPageRows.findIndex(
      (row) => row.layout === 'people',
    );

    expect(firstPageRows.map((row) => row.id)).toContain(
      'people-who-sing-what-you-sing',
    );
    expect(rows.map((row) => row.id)).toContain('by-voice-lower-voices');
    expect(peopleIndex).toBeGreaterThanOrEqual(0);
    const voiceTrackIds = new Set(
      rows
        .find((row) => row.layout === 'vocal-range')
        ?.items?.map((item) => item.id) ?? [],
    );
    const discoveryTrackIds = rows
      .filter((row) => row.layout === 'standard')
      .flatMap((row) => row.items?.map((item) => item.id) ?? []);
    expect(discoveryTrackIds.some((id) => voiceTrackIds.has(id))).toBe(false);
  });
});
