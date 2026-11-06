import type { HomeRow, HomeTrack } from '@vozzify/contracts';
import request from 'supertest';
import type { ComposableTrack } from '../src/modules/home/home-feed-composer.js';
import { homeFixtureGuardrails } from '../src/modules/home/home-fixture-guardrails.js';
import { CacheService } from '../src/redis/cache.service.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';
import { resetDatabase } from './utils/database.js';
import { createArtist } from './utils/factories.js';
import { createCompletedTrack } from './utils/track-processing-factories.js';

const selectedTrack = (track: HomeTrack): ComposableTrack => ({
  id: track.id,
  artistKey: track.artistCredit[0]?.name ?? track.id,
  hasCover: track.coverUrl !== null,
  isCompleted: true,
});

const selectedRowsOf = (
  rows: readonly HomeRow[],
): { id: string; items: ComposableTrack[] }[] =>
  rows.flatMap((row) => {
    if (row.layout === 'hero') {
      return [{ id: row.id, items: [selectedTrack(row.track)] }];
    }
    if (
      row.layout === 'standard' ||
      row.layout === 'ranked' ||
      row.layout === 'vocal-range'
    ) {
      return [{ id: row.id, items: row.items.map(selectedTrack) }];
    }
    return [];
  });

describe('Home API fixture guardrails (e2e)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({
      override: (builder) =>
        builder.overrideProvider(CacheService).useValue({
          get: async () => undefined,
          set: async () => undefined,
          acquire: async () => true,
          del: async () => undefined,
        }),
    });
  });

  afterAll(async () => {
    await testApp.close();
  });

  beforeEach(async () => {
    await resetDatabase(testApp.db);
  });

  it('measures bounded catalog coverage and filtered rows through Home', async () => {
    const artists = await Promise.all(
      Array.from({ length: 7 }, (_, index) =>
        createArtist(testApp.db, { name: `Guardrail artist ${index}` }),
      ),
    );
    const seeded = await Promise.all(
      Array.from({ length: 13 }, (_, index) => {
        const artist = artists[Math.floor(index / 2)];
        if (artist === undefined) throw new Error('Missing fixture Artist');
        return createCompletedTrack(testApp.db, {
          title: `Guardrail Track ${index}`,
          coverUrl: `https://cdn.example/guardrail-${index}.webp`,
          trendingScore: 100 - index,
          artistCredit: [
            { name: artist.name, joinPhrase: '', mbid: artist.mbid },
          ],
        });
      }),
    );
    const candidateTracks = seeded.map((track, index) => ({
      id: track.id,
      artistKey: artists[Math.floor(index / 2)]?.name ?? track.id,
      hasCover: true,
      isCompleted: true,
    }));
    const candidates = [
      { items: candidateTracks },
      { items: candidateTracks },
      { items: [] },
      { items: [] },
      { items: [] },
      { items: candidateTracks },
    ];

    const startedAt = performance.now();
    const response = await request(testApp.app.getHttpServer())
      .get('/v1/home')
      .expect(200);
    const selectionLatencyMs = performance.now() - startedAt;
    const selectedRows = selectedRowsOf(response.body.rows as HomeRow[]);
    const guardrails = homeFixtureGuardrails({
      candidates,
      selectedRows,
      selectionLatencyMs,
    });

    expect(selectedRows.map((row) => row.id)).toEqual([
      'hero',
      'trending-today',
    ]);
    expect(guardrails).toMatchObject({
      candidateCoverage: 1,
      duplicateExposure: 0,
      maximumArtistShare: 2 / 13,
      discardedRows: 4,
    });
    expect(Number.isFinite(guardrails.selectionLatencyMs)).toBe(true);
  });
});
