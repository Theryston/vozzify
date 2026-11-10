import { Test } from '@nestjs/testing';
import type { EditorialPin } from '@vozzify/contracts';
import type { z } from 'zod';
import { CacheService } from '../../redis/cache.service.js';
import { EditorialPinsService } from '../editorial-pins/editorial-pins.service.js';
import { HomeRepository } from './home.repository.js';
import { HomeFeedService } from './home-feed.service.js';
import { HomeFeedBuilder } from './home-feed-builder.service.js';
import { HomePinOverlayService } from './home-pin-overlay.service.js';
import { HomePublicOverlayCache } from './home-public-overlay-cache.js';
import {
  HOME_ROW_SOURCES,
  type HomeCandidate,
  type HomeRowSource,
} from './home-row-sources.js';
import { HomeVisitService } from './home-visit.service.js';
import { HomeVisitStore } from './home-visit.store.js';

const tracks: HomeCandidate[] = Array.from({ length: 120 }, (_, index) => ({
  id: `track-${index}`,
  title: `Track ${index}`,
  coverUrl: null,
  artistCredit: [{ name: `Artist ${index}`, joinPhrase: '' }],
  durationMs: null,
  vocalRange: null,
  artistKey: `artist-${index}`,
  isCompleted: true,
  hasCover: false,
}));

const pin = (index: number): EditorialPin => ({
  id: `pin-${index}`,
  kind: 'row',
  layout: 'standard',
  source: {
    type: 'tracks',
    trackIds: tracks.slice(index * 24, (index + 1) * 24).map(({ id }) => id),
  },
  position: index,
  priority: 0,
  audience: 'everyone',
  locale: null,
  startsAt: null,
  endsAt: null,
  titles: { en: `Pin ${index}` },
  sponsored: false,
  createdBy: null,
  updatedBy: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
});

const openVisit = async () => {
  const loadPage = vi.fn(async (_locale?: string, offset = 0) => ({
    items: tracks.slice(offset, offset + 60),
    hasMore: offset + 60 < tracks.length,
  }));
  const source: HomeRowSource = {
    id: 'trending-today',
    layout: 'standard',
    title: { key: 'home.rows.trendingToday', params: {} },
    load: async (_locale, offset = 0) =>
      (await loadPage(_locale, offset)).items,
    loadPage,
  };
  const feed = await new HomeFeedBuilder([source]).build();
  const values = new Map<string, unknown>();
  const cache = {
    get: vi.fn(
      async <T>(key: string, schema: z.ZodType<T>): Promise<T | undefined> => {
        const parsed = schema.safeParse(values.get(key));
        return parsed.success ? parsed.data : undefined;
      },
    ),
    set: vi.fn(async (key: string, value: unknown) => {
      values.set(key, value);
    }),
    acquire: vi.fn().mockResolvedValue(true),
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      HomeVisitService,
      HomeVisitStore,
      HomePinOverlayService,
      HomePublicOverlayCache,
      { provide: CacheService, useValue: cache },
      {
        provide: EditorialPinsService,
        useValue: { findLivePins: vi.fn().mockResolvedValue([pin(0), pin(1)]) },
      },
      {
        provide: HomeRepository,
        useValue: {
          findCompletedTracksByIds: vi.fn(async (ids: string[]) =>
            tracks
              .filter(({ id }) => ids.includes(id))
              .map((track) => ({
                ...track,
                lengthMs: null,
                vocalRangeLowest: null,
                vocalRangeHighest: null,
              })),
          ),
        },
      },
      { provide: HOME_ROW_SOURCES, useValue: [source] },
      {
        provide: HomeFeedService,
        useValue: {
          currentPublic: vi.fn(async (locale: string) => ({
            feed,
            cacheable: locale === 'en',
          })),
        },
      },
    ],
  }).compile();
  const rows = await moduleRef.get(HomePinOverlayService).apply(
    feed.rows,
    {
      locale: 'en',
      signedIn: false,
      sourceVersion: feed.version,
    },
    feed.compositionCandidates,
  );
  const service = moduleRef.get(HomeVisitService);
  const visit = await service.create(feed, rows, 'en');
  if (!visit) throw new Error('expected frozen visit');
  loadPage.mockClear();
  cache.set.mockClear();
  return { moduleRef, service, values, cache, loadPage, visit };
};

it('expires cold Pin cursor recovery without reading recommendation sources or caching a partial overlay', async () => {
  const { moduleRef, service, values, cache, loadPage, visit } =
    await openVisit();
  values.clear();
  try {
    await expect(
      service.rowItemsVersion(visit.version, 'trending-today', undefined, 'en'),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      details: { reason: 'FEED_VERSION_EXPIRED' },
    });
    await expect(
      service.publicVersion(visit.version, false),
    ).resolves.toBeUndefined();
    expect(loadPage).not.toHaveBeenCalled();
    expect(
      cache.set.mock.calls.some(([key]) =>
        key.startsWith('home:public-overlay:'),
      ),
    ).toBe(false);
  } finally {
    await moduleRef.close();
  }
});

it('recreates the exact pinned visit from a warm overlay without reading sources', async () => {
  const { moduleRef, service, values, loadPage, visit } = await openVisit();
  for (const key of values.keys())
    if (key.startsWith('home:visit:')) values.delete(key);
  try {
    const row = await service.rowItemsVersion(
      visit.version,
      'trending-today',
      undefined,
      'en',
    );
    expect(row?.layout).toBe('standard');
    if (row?.layout !== 'standard')
      throw new Error('expected complete standard Row');
    expect(row.items).toHaveLength(48);
    expect(row.items.map(({ id }) => id)).toEqual(
      tracks.slice(48, 96).map(({ id }) => id),
    );
    expect(loadPage).not.toHaveBeenCalled();
  } finally {
    await moduleRef.close();
  }
});
