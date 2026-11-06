import type { HomeRow } from '@vozzify/contracts';
import request from 'supertest';
import type { Database } from '../src/database/database.js';
import { practiceAttempts } from '../src/database/schema/practice-attempts.js';
import { trackFavorites } from '../src/database/schema/track-favorites.js';
import { trackProcessings } from '../src/database/schema/track-processings.js';
import { tracks } from '../src/database/schema/tracks.js';
import { users } from '../src/database/schema/users.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';
import { resetDatabase } from './utils/database.js';
import { testMbid } from './utils/factories.js';

const getHome = (testApp: TestApp) =>
  request(testApp.app.getHttpServer()).get('/v1/home');

const rowById = (body: { rows: unknown }, id: string): HomeRow | undefined =>
  (body.rows as HomeRow[]).find((row) => row.id === id);

const itemIdsOf = (row: HomeRow | undefined): string[] => {
  if (row?.layout === 'hero') return [row.track.id];
  // The entity rows (genres, artists, albums) carry no Tracks, so they
  // contribute no ids here. They never reach this helper's callers, which
  // only read Track rows, but the union demands every layout be handled.
  if (
    row?.layout === 'genres' ||
    row?.layout === 'artists' ||
    row?.layout === 'albums'
  ) {
    return [];
  }
  return row && 'items' in row ? row.items.map((item) => item.id) : [];
};

let seedTrackSeq = 0;
let seedUserSeq = 0;

/** Bulk-inserts verified users, returning their ids in seed order. */
const seedUsers = async (db: Database, count: number): Promise<string[]> => {
  const rows = Array.from({ length: count }, () => {
    seedUserSeq += 1;
    return {
      name: `Singer ${seedUserSeq}`,
      email: `singer-${seedUserSeq}@example.com`,
      emailVerified: true,
      username: `singer_${seedUserSeq}`,
    };
  });
  const inserted = await db.insert(users).values(rows).returning({
    id: users.id,
  });
  return inserted.map(({ id }) => id);
};

type SeedTrack = {
  title: string;
  coverUrl?: string;
  trendingScore?: number;
};

/** Bulk-inserts completed Tracks, returning their ids in seed order. */
const seedTracks = async (
  db: Database,
  seeds: SeedTrack[],
): Promise<string[]> => {
  const rows = seeds.map((seed) => {
    seedTrackSeq += 1;
    return {
      recordingMbid: testMbid(10_000 + seedTrackSeq),
      title: seed.title,
      coverUrl: seed.coverUrl ?? null,
      trendingScore: seed.trendingScore ?? 0,
      artistCredit: [{ name: `${seed.title} artist`, joinPhrase: '' }],
    };
  });
  const inserted = await db
    .insert(tracks)
    .values(rows)
    .returning({ id: tracks.id });
  await db
    .insert(trackProcessings)
    .values(
      inserted.map(({ id }) => ({ trackId: id, status: 'COMPLETED' as const })),
    );
  return inserted.map(({ id }) => id);
};

type SeedAttempt = {
  userId: string;
  trackId: string;
  forwardSkip?: boolean;
  bleedSuspected?: boolean;
  createdAt?: Date;
};

/** Bulk-inserts valid-unless-overridden practice runs. */
const seedAttempts = async (db: Database, seeds: SeedAttempt[]) => {
  await db.insert(practiceAttempts).values(
    seeds.map((seed) => ({
      userId: seed.userId,
      trackId: seed.trackId,
      difficulty: 'NORMAL' as const,
      octaveMode: 'ANY' as const,
      transposeSemitones: 0,
      speed: 1,
      accuracy: 0.9,
      coverage: 0.95,
      forwardSkip: seed.forwardSkip ?? false,
      bleedSuspected: seed.bleedSuspected ?? false,
      startedAt: new Date('2026-10-01T10:00:00Z'),
      endedAt: new Date('2026-10-01T10:03:00Z'),
      ...(seed.createdAt ? { createdAt: seed.createdAt } : {}),
    })),
  );
};

/** Bulk-inserts favorites. */
const seedFavorites = async (
  db: Database,
  seeds: { userId: string; trackId: string }[],
) => {
  if (seeds.length > 0) {
    await db.insert(trackFavorites).values(seeds);
  }
};

const seedChartFavorites = async (db: Database, userId: string) => {
  const chartFavorites = await seedTracks(
    db,
    Array.from({ length: 10 }, (_, i) => ({
      title: `Chart favorite ${i + 1}`,
      coverUrl: `https://cdn.example/chart-favorite-${i + 1}.webp`,
      trendingScore: 300 - i,
    })),
  );
  await seedFavorites(
    db,
    chartFavorites.map((trackId) => ({ userId, trackId })),
  );
};

const seedTrendingDecoys = async (db: Database) => {
  await seedTracks(
    db,
    Array.from({ length: 13 }, (_, i) => ({
      title: `Trending decoy ${i + 1}`,
      coverUrl: `https://cdn.example/trending-decoy-${i + 1}.webp`,
      trendingScore: 400 - i,
    })),
  );
};

describe('Home feed singing signal (e2e)', () => {
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

  it('shows Most sung, Most favorited and the weekly Top 10, each ordered by its signal', async () => {
    const [singer, ...fanIds] = await seedUsers(testApp.db, 7);
    if (!singer) throw new Error('seed singer missing');
    // Thirteen hotter decoys: one takes the hero and twelve fill the
    // trending row, so the signal Tracks stay free for the later rows.
    await seedTracks(
      testApp.db,
      Array.from({ length: 13 }, (_, i) => ({
        title: `Decoy ${i + 1}`,
        coverUrl: `https://cdn.example/decoy-${i + 1}.webp`,
        trendingScore: 2_000 - (i + 1),
      })),
    );
    // Thirteen sung Tracks: the first twelve fill the Most sung row, and the
    // thirteenth carries too little to matter anywhere but the chart.
    const sung = await seedTracks(
      testApp.db,
      Array.from({ length: 13 }, (_, i) => ({
        title: `Song ${i + 1}`,
        coverUrl: `https://cdn.example/song-${i + 1}.webp`,
        trendingScore: i === 12 ? 0 : 100 - (i + 1),
      })),
    );
    await seedAttempts(
      testApp.db,
      sung.flatMap((trackId, i) =>
        Array.from({ length: 13 - i }, () => ({
          userId: singer,
          trackId,
        })),
      ),
    );
    await seedFavorites(
      testApp.db,
      sung.flatMap((trackId, i) =>
        fanIds.slice(0, 6 - i).map((userId) => ({ userId, trackId })),
      ),
    );
    // The chart Tracks outrank Songs in the chart but stay below decoys in
    // trending. Their single runs still trail every Song in Most sung.
    const chart = await seedTracks(
      testApp.db,
      Array.from({ length: 10 }, (_, i) => ({
        title: `Chart ${i + 1}`,
        coverUrl: `https://cdn.example/chart-${i + 1}.webp`,
        trendingScore: 1_000 - (i + 1),
      })),
    );
    await seedAttempts(
      testApp.db,
      chart.map((trackId) => ({ userId: singer, trackId })),
    );
    // Six favorited-only Tracks (no views score, so they trail the chart).
    const favorited = await seedTracks(
      testApp.db,
      Array.from({ length: 6 }, (_, i) => ({
        title: `Loved ${i + 1}`,
        coverUrl: `https://cdn.example/loved-${i + 1}.webp`,
      })),
    );
    await seedFavorites(
      testApp.db,
      favorited.flatMap((trackId, i) =>
        fanIds.slice(0, 6 - i).map((userId) => ({ userId, trackId })),
      ),
    );
    // Six fresh ones so the new-Tracks row survives the dedupe.
    await seedTracks(
      testApp.db,
      Array.from({ length: 6 }, (_, i) => ({
        title: `Fresh ${i + 1}`,
        coverUrl: `https://cdn.example/fresh-${i + 1}.webp`,
      })),
    );

    const response = await getHome(testApp).expect(200);

    expect(rowById(response.body, 'most-sung')).toMatchObject({
      layout: 'standard',
      title: { key: 'home.rows.mostSung', params: {} },
    });
    expect(rowById(response.body, 'most-favorited')).toMatchObject({
      layout: 'standard',
      title: { key: 'home.rows.mostFavorited', params: {} },
    });
    expect(rowById(response.body, 'top-10-week')).toMatchObject({
      layout: 'ranked',
      title: { key: 'home.rows.top10Week', params: {} },
    });
    // Each signal row follows its own signal: the Most sung row takes the
    // twelve most sung Tracks (the thirteenth charts instead), the Most
    // favorited row takes the six loved Tracks.
    expect(itemIdsOf(rowById(response.body, 'most-sung'))).toEqual(
      sung.slice(0, 12),
    );
    expect(itemIdsOf(rowById(response.body, 'most-favorited'))).toEqual(
      favorited,
    );
    // The chart blends every signal: the ten chart Tracks fill it, in
    // trending order, behind the Songs the earlier rows already took.
    expect(itemIdsOf(rowById(response.body, 'top-10-week'))).toEqual(chart);
    // The first request also warms the feed on a cold runner, so this seed
    // gets longer than the default timeout.
  }, 30_000);

  it('ranks a Track people sing above one that was only viewed, in Most sung', async () => {
    const [singer] = await seedUsers(testApp.db, 1);
    if (!singer) throw new Error('seed singer missing');
    const [viewed] = await seedTracks(testApp.db, [
      {
        title: 'Viewed only',
        coverUrl: 'https://cdn.example/viewed-only.webp',
        trendingScore: 500,
      },
    ]);
    const sung = await seedTracks(
      testApp.db,
      Array.from({ length: 6 }, (_, i) => ({
        title: `Sung ${i + 1}`,
        coverUrl: `https://cdn.example/sung-${i + 1}.webp`,
      })),
    );
    await seedAttempts(
      testApp.db,
      sung.map((trackId) => ({ userId: singer, trackId })),
    );
    await seedTrendingDecoys(testApp.db);
    await seedChartFavorites(testApp.db, singer);

    const response = await getHome(testApp).expect(200);

    // The hot viewed-only Track takes the hero, but Most sung only sings.
    expect(itemIdsOf(rowById(response.body, 'hero'))).toEqual([viewed]);
    expect(itemIdsOf(rowById(response.body, 'most-sung'))).toHaveLength(6);
    expect(itemIdsOf(rowById(response.body, 'most-sung'))).not.toContain(
      viewed,
    );
    for (const id of sung) {
      expect(itemIdsOf(rowById(response.body, 'most-sung'))).toContain(id);
    }
  });

  it('ignores Attempts with a forward skip, a suspected bleed or outside the window', async () => {
    const [singer] = await seedUsers(testApp.db, 1);
    if (!singer) throw new Error('seed singer missing');
    const tracks = await seedTracks(
      testApp.db,
      Array.from({ length: 6 }, (_, i) => ({
        title: `Counted song ${i + 1}`,
        coverUrl: `https://cdn.example/counted-${i + 1}.webp`,
      })),
    );
    const [first, ...rest] = tracks;
    if (!first || rest.length !== 5) throw new Error('seed tracks missing');
    await seedAttempts(testApp.db, [
      ...tracks.map((trackId) => ({ userId: singer, trackId })),
      // A second valid run on every other Track, so each outranks the first.
      ...rest.map((trackId) => ({ userId: singer, trackId })),
      // Fifty invalid runs on the first Track: none of them count.
      ...Array.from({ length: 25 }, () => ({
        userId: singer,
        trackId: first,
        forwardSkip: true,
      })),
      ...Array.from({ length: 25 }, () => ({
        userId: singer,
        trackId: first,
        bleedSuspected: true,
      })),
      // One ancient run: outside the window, so it does not count either.
      {
        userId: singer,
        trackId: first,
        createdAt: new Date('2020-01-01T00:00:00Z'),
      },
    ]);
    await seedTrendingDecoys(testApp.db);
    await seedChartFavorites(testApp.db, singer);

    const response = await getHome(testApp).expect(200);

    const sungIds = itemIdsOf(rowById(response.body, 'most-sung'));
    expect(sungIds).toHaveLength(6);
    expect(sungIds[sungIds.length - 1]).toBe(first);
    expect(sungIds[0]).not.toBe(first);
  });

  it('never repeats a Track across rows', async () => {
    const [singer] = await seedUsers(testApp.db, 1);
    if (!singer) throw new Error('seed singer missing');
    await seedTracks(
      testApp.db,
      Array.from({ length: 7 }, (_, i) => ({
        title: `Decoy ${i + 1}`,
        coverUrl: `https://cdn.example/decoy-${i + 1}.webp`,
        trendingScore: 300 - (i + 1),
      })),
    );
    const sung = await seedTracks(
      testApp.db,
      Array.from({ length: 6 }, (_, i) => ({
        title: `Song ${i + 1}`,
        coverUrl: `https://cdn.example/song-${i + 1}.webp`,
        trendingScore: 100 - (i + 1),
      })),
    );
    await seedAttempts(
      testApp.db,
      sung.map((trackId) => ({ userId: singer, trackId })),
    );

    const response = await getHome(testApp).expect(200);

    const ids = (response.body.rows as HomeRow[]).flatMap(itemIdsOf);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('hides the singing rows when fewer than 3 Tracks carry the signal', async () => {
    const [singer] = await seedUsers(testApp.db, 1);
    if (!singer) throw new Error('seed singer missing');
    const tracks = await seedTracks(
      testApp.db,
      Array.from({ length: 6 }, (_, i) => ({
        title: `Quiet song ${i + 1}`,
        coverUrl: `https://cdn.example/quiet-${i + 1}.webp`,
      })),
    );
    await seedAttempts(
      testApp.db,
      tracks.slice(0, 2).map((trackId) => ({ userId: singer, trackId })),
    );

    const response = await getHome(testApp).expect(200);

    const ids = (response.body.rows as HomeRow[]).map((row) => row.id);
    expect(ids).toContain('new-tracks');
    expect(ids).not.toContain('most-sung');
    expect(ids).not.toContain('most-favorited');
    expect(ids).not.toContain('top-10-week');
  });
});
