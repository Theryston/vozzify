import { type HomeRow, type Locale } from '@vozzify/contracts';
import request from 'supertest';
import { trackViews } from '../src/database/schema/track-views.js';
import { WEB_REVALIDATION_QUEUE } from '../src/integrations/web-revalidation/web-revalidation.job.js';
import { HomeFeedService } from '../src/modules/home/home-feed.service.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';
import { resetDatabase } from './utils/database.js';
import {
  seedLocalePractice,
  seedLocaleUsers,
  utcPracticeDay,
} from './utils/home-locale-confidence-fixtures.js';
import { createCompletedTrack } from './utils/track-processing-factories.js';

const getHome = (testApp: TestApp, locale?: string) =>
  request(testApp.app.getHttpServer()).get(
    locale === undefined ? '/v1/home' : `/v1/home?locale=${locale}`,
  );

/** The title of the hero, the first row of every feed. */
const heroTitleOf = (body: { rows: unknown }): string | undefined => {
  const [hero] = body.rows as HomeRow[];
  return hero?.layout === 'hero' ? hero.track.title : undefined;
};

/** Views a Track gets in one locale in these tests. */
const VIEWS = 3;

/** Views of one Track in one locale, recorded now unless a date is given. */
const recordViews = async (
  testApp: TestApp,
  views: { trackId: string; locale: Locale; count: number; createdAt?: Date },
): Promise<void> => {
  await testApp.db.insert(trackViews).values(
    Array.from({ length: views.count }, () => ({
      trackId: views.trackId,
      locale: views.locale,
      userId: null,
      createdAt: views.createdAt ?? new Date(),
    })),
  );
};

const seedLocalePracticeCohort = async (
  testApp: TestApp,
  tracks: { trackId: string; locale: Locale }[],
): Promise<void> => {
  const userIds = (await seedLocaleUsers(testApp.db)).slice(0, 20);
  const seeds = tracks.flatMap(({ trackId, locale }) =>
    userIds.flatMap((userId) =>
      Array.from({ length: 5 }, (_, day) => ({
        userId,
        trackId,
        locale,
        createdAt: utcPracticeDay(day),
      })),
    ),
  );
  await seedLocalePractice(testApp.db, seeds);
};

describe('Home feed by locale (e2e)', () => {
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

  it('ranks each locale by the views of its own locale', async () => {
    const english = await createCompletedTrack(testApp.db, {
      title: 'English favorite',
      coverUrl: 'https://cdn.example/english.webp',
    });
    const portuguese = await createCompletedTrack(testApp.db, {
      title: 'Favorita brasileira',
      coverUrl: 'https://cdn.example/portuguese.webp',
    });
    await recordViews(testApp, {
      trackId: english.id,
      locale: 'en',
      count: VIEWS,
    });
    await recordViews(testApp, {
      trackId: portuguese.id,
      locale: 'pt-BR',
      count: VIEWS,
    });
    await seedLocalePracticeCohort(testApp, [
      { trackId: english.id, locale: 'en' },
      { trackId: portuguese.id, locale: 'pt-BR' },
    ]);

    const en = await getHome(testApp, 'en').expect(200);
    const ptBr = await getHome(testApp, 'pt-BR').expect(200);

    expect(heroTitleOf(en.body)).toBe('English favorite');
    expect(heroTitleOf(ptBr.body)).toBe('Favorita brasileira');
  });

  it('serves the English feed when no locale is named', async () => {
    const english = await createCompletedTrack(testApp.db, {
      title: 'English favorite',
      coverUrl: 'https://cdn.example/english.webp',
    });
    await recordViews(testApp, {
      trackId: english.id,
      locale: 'en',
      count: VIEWS,
    });
    await seedLocalePracticeCohort(testApp, [
      { trackId: english.id, locale: 'en' },
    ]);

    const response = await getHome(testApp).expect(200);

    expect(heroTitleOf(response.body)).toBe('English favorite');
  });

  it('falls back to global ranking when locale practice evidence is insufficient', async () => {
    const global = await createCompletedTrack(testApp.db, {
      title: 'Global hot',
      coverUrl: 'https://cdn.example/global.webp',
      trendingScore: 500,
    });
    const english = await createCompletedTrack(testApp.db, {
      title: 'English favorite',
      coverUrl: 'https://cdn.example/english.webp',
    });
    await recordViews(testApp, {
      trackId: english.id,
      locale: 'en',
      count: VIEWS,
    });
    // Pt-BR views from last year are outside this month's window.
    await recordViews(testApp, {
      trackId: global.id,
      locale: 'pt-BR',
      count: VIEWS,
      createdAt: new Date('2000-01-15T12:00:00Z'),
    });

    const ptBr = await getHome(testApp, 'pt-BR').expect(200);

    expect(heroTitleOf(ptBr.body)).toBe('Global hot');
  });

  it('falls back to the global figures for a locale with no views at all', async () => {
    await createCompletedTrack(testApp.db, {
      title: 'Global hot',
      coverUrl: 'https://cdn.example/global.webp',
      trendingScore: 500,
    });

    const ptBr = await getHome(testApp, 'pt-BR').expect(200);

    expect(heroTitleOf(ptBr.body)).toBe('Global hot');
  });

  it('refuses an unsupported locale with a validation error', async () => {
    const response = await getHome(testApp, 'fr').expect(400);

    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('revalidates each locale on its own tag', async () => {
    const feeds = testApp.app.get(HomeFeedService);
    const queue = testApp.queues[WEB_REVALIDATION_QUEUE];
    // The app is shared by the tests of this file: start from an empty queue.
    if (queue) {
      queue.added.length = 0;
    }
    const revalidations = () => queue?.added ?? [];

    await feeds.refreshPublic('en');
    await feeds.refreshPublic('pt-BR');

    expect(revalidations()).toEqual([
      { name: 'revalidate', data: { tags: ['home:en'] } },
      { name: 'revalidate', data: { tags: ['home:pt-BR'] } },
    ]);
  });
});
