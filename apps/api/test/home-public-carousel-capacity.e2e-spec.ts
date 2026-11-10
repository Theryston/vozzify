import type { TestingModuleBuilder } from '@nestjs/testing';
import { homePinPreviewResponseSchema } from '@vozzify/contracts';
import request from 'supertest';
import {
  HOME_ROW_SOURCES,
  type HomeCandidate,
  type HomeRowSource,
} from '../src/modules/home/home-row-sources.js';
import { createAuthClient } from './utils/auth.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';
import { resetDatabase } from './utils/database.js';
import {
  rowPinBody,
  signInPinsAdmin,
} from './utils/editorial-pin-factories.js';
import {
  sharedInMemoryCache,
  withInMemoryCache,
} from './utils/in-memory-cache.js';
import { createCompletedTrack } from './utils/track-processing-factories.js';

const makeCandidates = (count: number): HomeCandidate[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `capacity-track-${index}`,
    title: `Capacity Track ${index}`,
    coverUrl: null,
    artistCredit: [{ name: `Artist ${index}`, joinPhrase: '' }],
    durationMs: 180_000,
    vocalRange: { lowest: 48, highest: 72 },
    artistKey: `artist-${index}`,
    hasCover: true,
    isCompleted: true,
    hasVocalRange: true,
  }));

let candidateCount = 25;

const sources = (): HomeRowSource[] => {
  const page = (offset: number) =>
    makeCandidates(candidateCount).slice(offset, offset + 60);
  return [
    {
      id: 'trending-today',
      layout: 'standard',
      title: { key: 'home.rows.trendingToday', params: {} },
      candidatePageSize: 60,
      load: async (_locale, offset = 0) => page(offset),
      loadPage: async (_locale, offset = 0) => ({
        items: page(offset),
        hasMore: offset + 60 < candidateCount,
      }),
    },
  ];
};

const overrideSources = (builder: TestingModuleBuilder) =>
  withInMemoryCache(builder)
    .overrideProvider(HOME_ROW_SOURCES)
    .useFactory({ factory: sources });

describe('public carousel capacity (e2e)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({ override: overrideSources });
  });

  afterAll(async () => testApp.close());

  beforeEach(async () => {
    candidateCount = 25;
    sharedInMemoryCache.clear();
    await resetDatabase(testApp.db);
  });

  it.each([
    { total: 25, pages: [12, 12, 1] },
    { total: 48, pages: [12, 12, 12, 12] },
  ])(
    'pages a $total-Track public carousel in bounded HTTP pages',
    async ({ total, pages }) => {
      candidateCount = total;
      const first = await request(testApp.app.getHttpServer())
        .get('/v1/home?locale=en')
        .expect(200);
      const row = first.body.rows.find(
        (candidate: { id: string }) => candidate.id === 'trending-today',
      );
      expect(row.items).toHaveLength(12);

      const observedPages = [row.items.length];
      const ids = row.items.map((item: { id: string }) => item.id);
      let cursor = row.nextItemsCursor as string | null;
      while (cursor !== null) {
        const page = await request(testApp.app.getHttpServer())
          .get(
            `/v1/home/rows/${row.id}/items?cursor=${encodeURIComponent(cursor)}`,
          )
          .expect(200);
        expect(page.body.items.length).toBeLessThanOrEqual(12);
        observedPages.push(page.body.items.length);
        ids.push(...page.body.items.map((item: { id: string }) => item.id));
        cursor = page.body.nextCursor as string | null;
      }

      expect(observedPages).toEqual(pages);
      expect(ids).toHaveLength(total);
      expect(new Set(ids).size).toBe(total);
      expect(ids).toEqual(makeCandidates(total).map(({ id }) => id));
    },
  );

  it('returns a complete 48-Track carousel in the admin preview only', async () => {
    candidateCount = 48;
    await request(testApp.app.getHttpServer())
      .get('/v1/home?locale=en')
      .expect(200);
    const client = createAuthClient(testApp);
    await signInPinsAdmin(testApp.db, client);
    const pinnedTrack = await createCompletedTrack(testApp.db, {
      title: 'Preview pin',
    });

    const preview = await client
      .post('/v1/admin/home-pins/preview')
      .send({
        pin: rowPinBody([pinnedTrack.id]),
        locale: 'en',
        audience: 'visitor',
      })
      .expect(200);

    const parsed = homePinPreviewResponseSchema.parse(preview.body);
    const row = parsed.rows.find(({ id }) => id === 'trending-today');
    expect(row?.layout).toBe('standard');
    if (row?.layout !== 'standard') {
      throw new Error('expected the complete standard preview Row');
    }
    expect(row.items).toHaveLength(48);
  });
});
