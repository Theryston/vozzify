import { PersonalHomeTasteRepository } from '../src/modules/home/home-personal-taste.repository.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';
import { resetDatabase } from './utils/database.js';
import { createCompletedTrack } from './utils/track-processing-factories.js';

describe('personal voice candidate query (e2e)', () => {
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

  it('filters fit and challenge eligibility before applying the candidate limit', async () => {
    const tooWide = await createCompletedTrack(testApp.db, {
      title: 'Unusable wide range',
      coverUrl: 'https://cdn.example/too-wide.webp',
      vocalRangeLowest: 40,
      vocalRangeHighest: 90,
      trendingScore: 1_000,
    });
    const fit = await createCompletedTrack(testApp.db, {
      title: 'Fitting range',
      coverUrl: 'https://cdn.example/fit.webp',
      vocalRangeLowest: 57,
      vocalRangeHighest: 69,
      trendingScore: 10,
    });
    const challenge = await createCompletedTrack(testApp.db, {
      title: 'Reachable challenge',
      coverUrl: 'https://cdn.example/challenge.webp',
      vocalRangeLowest: 60,
      vocalRangeHighest: 75,
      trendingScore: 5,
    });
    const repository = testApp.app.get(PersonalHomeTasteRepository);

    const results = await repository.findVoiceCandidates(
      { lowest: 60, highest: 72 },
      2,
    );

    expect(results.map(({ id }) => id)).toEqual([fit.id, challenge.id]);
    expect(results.map(({ id }) => id)).not.toContain(tooWide.id);
  });

  it('replenishes past ineligible high-popularity ranges before the limit', async () => {
    await createCompletedTrack(testApp.db, {
      title: 'Too wide to fit',
      coverUrl: 'https://cdn.example/too-wide.webp',
      vocalRangeLowest: 40,
      vocalRangeHighest: 90,
      trendingScore: 1_000,
    });
    const fitting = await createCompletedTrack(testApp.db, {
      title: 'Fit behind wide range',
      coverUrl: 'https://cdn.example/fit.webp',
      vocalRangeLowest: 57,
      vocalRangeHighest: 69,
      trendingScore: 10,
    });

    const [candidate] = await testApp.app
      .get(PersonalHomeTasteRepository)
      .findVoiceCandidates({ lowest: 60, highest: 72 }, 1);

    expect(candidate?.id).toBe(fitting.id);
  });
});
