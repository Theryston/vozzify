import type { TestingModuleBuilder } from '@nestjs/testing';
import type { HomeRow } from '@vozzify/contracts';
import { artists, trackArtists } from '../src/database/schema/artists.js';
import { practiceAttempts } from '../src/database/schema/practice-attempts.js';
import { trackFavorites } from '../src/database/schema/track-favorites.js';
import { trackProcessings } from '../src/database/schema/track-processings.js';
import { tracks } from '../src/database/schema/tracks.js';
import { isMasteredTrack } from '../src/modules/home/home-personal.js';
import { PersonalHomeRepository } from '../src/modules/home/home-personal.repository.js';
import { PersonalHomeStore } from '../src/modules/home/home-personal.store.js';
import { PersonalHomeBuilder } from '../src/modules/home/home-personal-builder.service.js';
import {
  decayedTaste,
  tasteMatch,
} from '../src/modules/home/home-personal-recommendations.js';
import { CacheService } from '../src/redis/cache.service.js';
import { createAuthClient, signIn } from './utils/auth.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';
import {
  createCredentialAccount,
  createTrack,
  createUser,
  DEFAULT_PASSWORD,
  testMbid,
} from './utils/factories.js';

class MemoryCache {
  private readonly entries = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.entries.get(key) as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.entries.set(key, value);
  }

  async acquire(): Promise<boolean> {
    return true;
  }

  async del(key: string): Promise<void> {
    this.entries.delete(key);
  }
}

const withMemoryCache = (builder: TestingModuleBuilder) =>
  builder.overrideProvider(CacheService).useValue(new MemoryCache());

const run = {
  difficulty: 'NORMAL' as const,
  octaveMode: 'ANY' as const,
  transposeSemitones: 0,
  speed: 1,
  accuracy: 0.7,
  coverage: 0.95,
  forwardSkip: false,
  bleedSuspected: false,
  startedAt: new Date('2026-10-20T10:00:00.000Z'),
  endedAt: new Date('2026-10-20T10:04:00.000Z'),
};

const rowsOf = (body: { rows: unknown }): HomeRow[] => body.rows as HomeRow[];

describe('Personal home taste rows (e2e)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({
      override: (builder) => withMemoryCache(builder),
    });
  });

  afterAll(async () => {
    await testApp?.close();
  });

  const clientFor = async (email: string) => {
    const client = createAuthClient(testApp);
    await signIn(client, {
      email,
      password: DEFAULT_PASSWORD,
    }).expect(200);
    return client;
  };

  const signInAs = async (username: string, email: string) => {
    const user = await createUser(testApp.db, { username, email });
    await createCredentialAccount(testApp.db, user);
    const client = await clientFor(user.email);
    return { user, client };
  };

  const insertAttempts = (
    userId: string,
    trackIds: string[],
    accuracies: number[] = [],
    startedAt: Date = run.startedAt,
  ) =>
    testApp.db.insert(practiceAttempts).values(
      trackIds.map((trackId, index) => ({
        userId,
        trackId,
        ...run,
        startedAt,
        endedAt: new Date(startedAt.getTime() + 4 * 60 * 1_000),
        accuracy: accuracies[index] ?? run.accuracy,
        createdAt: new Date(startedAt.getTime() + index * 1_000),
      })),
    );

  const seedTracks = async () => {
    const inserted = await testApp.db
      .insert(tracks)
      .values(
        Array.from({ length: 60 }, (_, index) => ({
          recordingMbid: testMbid(5000 + index),
          title: `Taste track ${index}`,
          lengthMs: 180_000,
          disambiguation: '',
          video: false,
          isrcs: [],
          genres: [index < 36 ? 'rock' : index < 42 ? 'jazz' : 'metal'],
          coverUrl: `https://cdn.example/taste-${index}.webp`,
          trendingScore: 100 - index,
        })),
      )
      .returning();
    await testApp.db.insert(trackProcessings).values(
      inserted.map((track) => ({
        trackId: track.id,
        status: 'COMPLETED' as const,
      })),
    );
    return inserted.sort(
      (first, second) =>
        Number(first.title.slice('Taste track '.length)) -
        Number(second.title.slice('Taste track '.length)),
    );
  };

  const refresh = async (userId: string) => {
    const feed = await testApp.app.get(PersonalHomeBuilder).build(userId, 'en');
    await testApp.app
      .get(PersonalHomeStore)
      .writeCurrent(userId, feed.locale, feed);
  };

  const seedTasteData = async (viewerId: string) => {
    const signalStartedAt = new Date(Date.now() - 14 * 24 * 60 * 60 * 1_000);
    const artistRows = await testApp.db
      .insert(artists)
      .values(
        Array.from({ length: 6 }, (_, index) => ({
          mbid: testMbid(6000 + index),
          name: `Taste artist ${index}`,
          genres: ['rock'],
        })),
      )
      .returning();
    const seededTracks = await seedTracks();
    const links = artistRows.flatMap((artist, index) => {
      const track = seededTracks[index];
      return track ? [{ trackId: track.id, artistId: artist.id }] : [];
    });
    await testApp.db.insert(trackArtists).values(links);
    const source = seededTracks[23];
    if (!source) throw new Error('No source Track was seeded');
    await insertAttempts(
      viewerId,
      seededTracks.slice(0, 24).map(({ id }) => id),
      Array.from({ length: 24 }, (_, index) => (index < 12 ? 0.95 : 0.7)),
      signalStartedAt,
    );

    const targets = seededTracks.slice(36, 42).map(({ id }) => id);
    for (let index = 0; index < 2; index += 1) {
      const cohort = await createUser(testApp.db, {
        username: `taste_cohort_${index}`,
        email: `taste-cohort-${index}@example.com`,
      });
      await insertAttempts(
        cohort.id,
        [source.id, ...targets],
        [],
        signalStartedAt,
      );
      if (index === 1) {
        await testApp.db.insert(trackFavorites).values(
          targets.map((trackId) => ({
            userId: cohort.id,
            trackId,
            createdAt: new Date(signalStartedAt),
          })),
        );
      }
    }

    const repository = testApp.app.get(PersonalHomeRepository);
    await testApp.app.get(PersonalHomeBuilder).refreshCommunityCooccurrence();
    return { source, tracks: seededTracks, repository };
  };

  const expectDistributedExploration = async (
    rows: HomeRow[],
    repository: PersonalHomeRepository,
    taste: ReturnType<typeof decayedTaste>,
    signals: Awaited<
      ReturnType<PersonalHomeRepository['findUserTrackSignals']>
    >,
  ) => {
    const discoveryIds = rows
      .filter(
        ({ id }) =>
          id !== 'top-10-week' &&
          id !== 'continue-singing' &&
          id !== 'sing-again',
      )
      .flatMap((row) =>
        row.layout === 'hero'
          ? [row.track.id]
          : row.layout === 'standard' || row.layout === 'vocal-range'
            ? row.items.map(({ id }) => id)
            : [],
      );
    expect(new Set(discoveryIds).size).toBe(discoveryIds.length);

    const signalsByTrack = new Map(
      signals.map((signal) => [signal.trackId, signal]),
    );
    expect(
      discoveryIds.filter((id) =>
        isMasteredTrack(signalsByTrack.get(id)?.bestAccuracy ?? 0),
      ),
    ).toEqual([]);

    const metadata = await repository.findDiscoveryTracks(discoveryIds);
    const unfamiliarIds = discoveryIds.filter((id) => {
      const track = metadata.get(id);
      return (
        track !== undefined &&
        tasteMatch(track.genres, track.artistKey, taste) === 0
      );
    });
    expect(unfamiliarIds.length).toBeGreaterThan(0);
  };

  it('serves taste and community rows with unfamiliar discovery Tracks', async () => {
    const { user: viewer, client } = await signInAs(
      'taste_user',
      'taste-user@example.com',
    );
    const { source, repository } = await seedTasteData(viewer.id);
    await refresh(viewer.id);

    const firstPage = await client.get('/v1/home').expect(200);
    const rows = [...rowsOf(firstPage.body)];
    let cursor = firstPage.body.nextCursor as string | null;
    while (cursor) {
      const page = await client.get(`/v1/home?cursor=${cursor}`).expect(200);
      rows.push(...rowsOf(page.body));
      cursor = page.body.nextCursor as string | null;
    }
    const because = rows.find((row) => row.id === 'because-you-sang');
    expect(because).toMatchObject({
      title: {
        key: 'home.rows.becauseYouSang',
        params: { trackTitle: source.title },
      },
    });
    expect(rows.map((row) => row.id)).toContain('more-of-your-genres');
    expect(rows.map((row) => row.id)).toContain('your-most-sung-artists');
    const signals = await repository.findUserTrackSignals(viewer.id);
    const taste = decayedTaste(
      signals.map((signal) => ({
        genres: signal.genres,
        artistKey: signal.artistKey,
        weight: signal.attempts,
        lastSignalAt: signal.lastAttemptAt,
      })),
    );
    await expectDistributedExploration(rows, repository, taste, signals);
  });

  it('keeps weak taste rows out for a User with little data', async () => {
    const lowData = await signInAs(
      'taste_low_data',
      'taste-low-data@example.com',
    );
    const track = await createTrack(testApp.db, {
      recordingMbid: testMbid(9_000_000_000),
      genres: ['jazz'],
    });
    await testApp.db.insert(trackProcessings).values({
      trackId: track.id,
      status: 'COMPLETED',
    });
    await insertAttempts(lowData.user.id, [track.id]);
    await refresh(lowData.user.id);
    const response = await lowData.client.get('/v1/home').expect(200);
    const lowDataRowIds = rowsOf(response.body).map((row) => row.id);
    expect(lowDataRowIds).not.toContain('because-you-sang');
    expect(lowDataRowIds).not.toContain('more-of-your-genres');
    expect(lowDataRowIds).not.toContain('your-most-sung-artists');
    expect(lowDataRowIds).not.toContain('explore');
  });
});
