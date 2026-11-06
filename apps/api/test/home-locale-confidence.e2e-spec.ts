import { homeFeedPageSchema } from '@vozzify/contracts';
import request from 'supertest';
import { trackViews } from '../src/database/schema/track-views.js';
import { HomePopularityRepository } from '../src/modules/home/home-popularity.repository.js';
import { TrackLocaleTrendingService } from '../src/modules/tracks/track-locale-trending.service.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';
import { resetDatabase } from './utils/database.js';
import {
  seedLocalePractice,
  seedLocaleUsers,
  seedLocaleViews,
  utcPracticeDay,
} from './utils/home-locale-confidence-fixtures.js';
import { MemoryCache, withMemoryCache } from './utils/memory-cache.js';
import { createCompletedTrack } from './utils/track-processing-factories.js';

const heroId = (body: unknown): string | undefined => {
  const hero = homeFeedPageSchema
    .parse(body)
    .rows.find((row) => row.layout === 'hero');
  return hero?.layout === 'hero' ? hero.track.id : undefined;
};

describe('Home locale practice confidence (e2e)', () => {
  let testApp: TestApp;
  const cache = new MemoryCache();

  beforeAll(async () => {
    testApp = await createTestApp({
      override: (builder) => withMemoryCache(builder, cache),
    });
  });

  afterAll(async () => {
    await testApp.close();
  });

  beforeEach(async () => {
    cache.clear();
    await resetDatabase(testApp.db);
  });

  it('counts valid singers and UTC practice days, switching Home to local ranking at 20 singers across 5 days', async () => {
    const global = await createCompletedTrack(testApp.db, {
      title: 'Global leader',
      coverUrl: 'https://cdn.example/global-leader.webp',
      trendingScore: 1_000_000,
      artistCredit: [{ name: 'Global artist', joinPhrase: '' }],
    });
    const local = await createCompletedTrack(testApp.db, {
      title: 'Local leader',
      coverUrl: 'https://cdn.example/local-leader.webp',
      artistCredit: [{ name: 'Local artist', joinPhrase: '' }],
    });
    const users = await seedLocaleUsers(testApp.db);
    const singers = users.slice(0, 19);
    const [twentieth, skipped, bleed, english, viewer, unlinked] =
      users.slice(19);
    const repeated = singers[0];
    if (
      !twentieth ||
      !skipped ||
      !bleed ||
      !english ||
      !viewer ||
      !unlinked ||
      !repeated
    ) {
      throw new Error('Missing locale fixture User');
    }
    const base = { trackId: local.id, locale: 'pt-BR' as const };
    await seedLocalePractice(testApp.db, [
      ...singers.map((userId, index) => ({
        ...base,
        userId,
        createdAt: utcPracticeDay((index % 5) + 1),
      })),
      // Same UTC date at opposite ends of the day remains one active day.
      {
        ...base,
        userId: repeated,
        createdAt: new Date(utcPracticeDay(1).getTime() - 11.5 * 3_600_000),
      },
      {
        ...base,
        userId: repeated,
        createdAt: new Date(utcPracticeDay(1).getTime() + 11.5 * 3_600_000),
      },
      {
        ...base,
        userId: skipped,
        createdAt: utcPracticeDay(7),
        forwardSkip: true,
      },
      {
        ...base,
        userId: bleed,
        createdAt: utcPracticeDay(8),
        bleedSuspected: true,
      },
      { ...base, userId: english, locale: 'en', createdAt: utcPracticeDay(9) },
      {
        ...base,
        userId: unlinked,
        createdAt: utcPracticeDay(10),
        linked: false,
      },
      {
        ...base,
        userId: twentieth,
        createdAt: new Date('2000-01-01T12:00:00Z'),
      },
    ]);
    await testApp.db.insert(trackViews).values({
      trackId: local.id,
      userId: viewer,
      locale: 'pt-BR',
    });
    const popularity = testApp.app.get(HomePopularityRepository);
    const since = utcPracticeDay(28);
    expect(await popularity.localePracticeEvidence('pt-BR', since)).toEqual({
      distinctUsers: 19,
      activeDays: 5,
    });
    const insufficient = await request(testApp.app.getHttpServer())
      .get('/v1/home?locale=pt-BR')
      .expect(200);
    expect(heroId(insufficient.body)).toBe(global.id);

    await seedLocalePractice(testApp.db, [
      { ...base, userId: twentieth, createdAt: utcPracticeDay(1) },
    ]);
    expect(await popularity.localePracticeEvidence('pt-BR', since)).toEqual({
      distinctUsers: 20,
      activeDays: 5,
    });
    cache.clear();
    const confident = await request(testApp.app.getHttpServer())
      .get('/v1/home?locale=pt-BR')
      .expect(200);
    const fallback = await request(testApp.app.getHttpServer())
      .get('/v1/home?locale=en')
      .expect(200);
    expect(heroId(confident.body)).toBe(local.id);
    expect(heroId(fallback.body)).toBe(global.id);

    const ranked = await testApp.app
      .get(TrackLocaleTrendingService)
      .rank('pt-BR');
    expect(ranked).toBeDefined();
    const scores = await popularity.popularityScoresForTracks(
      [global.id, local.id],
      since,
      'pt-BR',
      new Map((ranked ?? []).map((entry) => [entry.trackId, entry.score])),
    );
    expect(scores.find((entry) => entry.trackId === global.id)?.score).toBe(0);
    expect(
      scores.find((entry) => entry.trackId === local.id)?.score,
    ).toBeGreaterThan(0);
    const globalScores = await popularity.popularityScoresForTracks(
      [global.id],
      since,
    );
    expect(globalScores[0]?.score).toBeGreaterThan(100_000);
  });

  it('scores a candidate subset against the whole locale, including viewed Tracks outside the subset', async () => {
    const first = await createCompletedTrack(testApp.db);
    const second = await createCompletedTrack(testApp.db);
    const outside = await createCompletedTrack(testApp.db);
    const now = new Date();
    await seedLocaleViews(testApp.db, {
      trackId: first.id,
      count: 4,
      createdAt: now,
    });
    await seedLocaleViews(testApp.db, {
      trackId: second.id,
      count: 9,
      createdAt: now,
    });
    const ranking = testApp.app.get(TrackLocaleTrendingService);
    const ids = [first.id, second.id];
    const isolated = await ranking.rank('pt-BR', now, ids);
    await seedLocaleViews(testApp.db, {
      trackId: outside.id,
      count: 80,
      createdAt: now,
    });

    const full = await ranking.rank('pt-BR', now);
    const subset = await ranking.rank('pt-BR', now, ids);
    expect(full).toHaveLength(3);
    expect(subset).toHaveLength(2);
    expect(subset).toEqual(
      full?.filter((entry) => ids.includes(entry.trackId)),
    );
    expect(subset).not.toEqual(isolated);
  });
});
