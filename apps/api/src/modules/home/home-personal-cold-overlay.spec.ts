import { Test } from '@nestjs/testing';
import type { EditorialPin, HomeRow, HomeTrack } from '@vozzify/contracts';
import { EditorialPinsService } from '../editorial-pins/editorial-pins.service.js';
import { HomeRepository } from './home.repository.js';
import { HomeService } from './home.service.js';
import { homeGenreCandidatesSchema } from './home-composition-candidates.js';
import { encodeHomeCursor } from './home-cursor.js';
import { HomeFeedService } from './home-feed.service.js';
import { genreRowId } from './home-genre-rows.js';
import { PersonalHomeStore } from './home-personal.store.js';
import { HomePinOverlayService } from './home-pin-overlay.service.js';
import { HomePublicOverlayCache } from './home-public-overlay-cache.js';
import { PRIVATE_HOME_CACHE_CONTROL } from './home-rules.js';
import { HomeSocialService } from './home-social.service.js';
import { HomeVisitService } from './home-visit.service.js';

const version = 'a1b2c3d4e5f60718';
const track = (index: number): HomeTrack => ({
  id: `track-${index}`,
  title: `Track ${index}`,
  artistCredit: [
    { name: index % 12 < 2 ? 'Shared' : `Artist ${index}`, joinPhrase: '' },
  ],
  coverUrl: null,
  durationMs: null,
  vocalRange: null,
});
const items = Array.from({ length: 48 }, (_, index) => track(index));
const publicRow: HomeRow = {
  id: 'trending-today',
  layout: 'standard',
  title: { key: 'home.rows.trendingToday', params: {} },
  items,
};
const pin: EditorialPin = {
  id: 'live',
  kind: 'row',
  layout: 'standard',
  position: 0,
  priority: 0,
  source: { type: 'tracks', trackIds: ['track-2'] },
  audience: 'everyone',
  locale: null,
  startsAt: null,
  endsAt: null,
  titles: { en: 'Pinned' },
  sponsored: false,
  createdBy: null,
  updatedBy: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

const assertFullRow = (composed: HomeRow[]) => {
  const full = composed.find(({ id }) => id === publicRow.id);
  if (full?.layout !== 'standard')
    throw new Error('Expected full standard Row');
  expect(full.items).toHaveLength(47);
  expect(new Set(full.items.map(({ id }) => id)).size).toBe(47);
  expect(full.items.some(({ id }) => id === 'track-2')).toBe(false);
  for (let start = 0; start < full.items.length; start += 12) {
    expect(
      full.items
        .slice(start, start + 12)
        .filter((item) => item.artistCredit[0]?.name === 'Shared').length,
    ).toBeLessThanOrEqual(2);
  }
};

const assertGenreRow = (
  composed: HomeRow[],
  genreCandidate: { id: string; items: { id: string }[] },
) => {
  const genreRow = composed.find(({ id }) => id === genreCandidate.id);
  expect(genreRow?.layout).toBe('standard');
  if (genreRow?.layout !== 'standard') throw new Error('Expected genre Row');
  expect(genreRow.items).toHaveLength(24);
  expect(genreRow.items.map(({ id }) => id)).toEqual(
    genreCandidate.items.slice(1).map(({ id }) => id),
  );
  for (const item of genreRow.items) {
    expect(item).not.toHaveProperty('artistKey');
    expect(item).not.toHaveProperty('artistKeys');
    expect(item).not.toHaveProperty('collectiveScore');
    expect(item).not.toHaveProperty('personalTasteScore');
  }
};

describe('private visits inheriting public composition', () => {
  it.each(['cold', 'retained'] as const)(
    'recomposes %s fallback after Pin exclusions without using shared overlay caches',
    async (mode) => {
      const genreCandidate = {
        id: genreRowId('integration'),
        genre: 'integration',
        layout: 'standard' as const,
        title: {
          key: 'home.rows.popularGenre' as const,
          params: { genre: 'integration' },
        },
        personalExplorationSeed: 'integration-seed',
        items: Array.from({ length: 25 }, (_, index) => ({
          ...track(index),
          id: index === 0 ? 'track-2' : `genre-${index}`,
          artistCredit: [{ name: 'Homonymous Artist', joinPhrase: '' }],
          artistKey: `canonical-${index}`,
          artistKeys: [`canonical-${index}`],
          hasCover: false,
          isCompleted: true,
          collectiveScore: 100 - index,
          personalTasteScore: index,
        })),
      };
      // Both independently introduced metadata fields survive snapshot parsing.
      expect(homeGenreCandidatesSchema.parse([genreCandidate])).toEqual([
        genreCandidate,
      ]);
      const feed = {
        audience: 'public',
        version,
        locale: 'en',
        algorithmVersion: 7,
        rows: [publicRow],
        genreCandidates: [genreCandidate],
        compositionCandidates: [
          {
            ...publicRow,
            items: items.map((item) => ({
              ...item,
              artistKey: item.artistCredit[0]?.name ?? '',
              hasCover: false,
              isCompleted: true,
            })),
          },
        ],
      };
      const sharedCache = { read: vi.fn(), resolve: vi.fn() };
      const social = {
        rowsFor: vi.fn(
          async (userId: string): Promise<HomeRow[]> => [
            {
              id: 'social-friends',
              layout: 'people',
              title: { key: 'home.rows.newTracks', params: {} },
              items: [
                {
                  id: `profile-${userId}`,
                  username: userId,
                  name: userId,
                  image: null,
                  commonTracks: 1,
                },
              ],
            },
          ],
        ),
      };
      const visits = {
        personalVersion: vi.fn(),
        publicVersion: vi.fn(),
        create: vi.fn(async (source, rows, locale, ownerId) => ({
          ...source,
          rows,
          locale,
          ownerId,
          version: 'f1b2c3d4e5f60718',
        })),
      };
      const moduleRef = await Test.createTestingModule({
        providers: [
          HomeService,
          HomePinOverlayService,
          {
            provide: HomeFeedService,
            useValue: {
              currentPublic: vi
                .fn()
                .mockResolvedValue({ feed, cacheable: true }),
              publicVersion: vi.fn().mockResolvedValue(feed),
            },
          },
          {
            provide: PersonalHomeStore,
            useValue: { readCurrent: vi.fn(), readRetired: vi.fn() },
          },
          {
            provide: EditorialPinsService,
            useValue: { findLivePins: vi.fn().mockResolvedValue([pin]) },
          },
          {
            provide: HomeRepository,
            useValue: {
              findCompletedTracksByIds: vi.fn().mockResolvedValue([
                {
                  id: 'track-2',
                  title: 'Track 2',
                  artistCredit: items[2]?.artistCredit,
                  coverUrl: null,
                  lengthMs: null,
                  vocalRangeLowest: null,
                  vocalRangeHighest: null,
                },
              ]),
            },
          },
          { provide: HomePublicOverlayCache, useValue: sharedCache },
          { provide: HomeSocialService, useValue: social },
          { provide: HomeVisitService, useValue: visits },
        ],
      }).compile();
      try {
        const overlay = vi.spyOn(moduleRef.get(HomePinOverlayService), 'apply');
        const service = moduleRef.get(HomeService);
        for (const userId of ['user-a', 'user-b']) {
          const response = await service.getPage(
            mode === 'cold'
              ? undefined
              : encodeHomeCursor({ version, position: 0 }),
            'en',
            userId,
          );
          expect(response.cacheControl).toBe(PRIVATE_HOME_CACHE_CONTROL);
          expect(response.page.audience).toBe('personal');
          const row = response.page.rows.find(({ id }) => id === publicRow.id);
          expect(row?.layout).toBe('standard');
          if (row?.layout !== 'standard')
            throw new Error('Expected standard Row');
          expect(row.items).toHaveLength(12);
          expect(row.nextItemsCursor).toBeTruthy();
          const composed = (await overlay.mock.results.at(-1)
            ?.value) as HomeRow[];
          assertFullRow(composed);
          assertGenreRow(composed, genreCandidate);
          if (mode === 'cold') {
            expect(visits.create).toHaveBeenLastCalledWith(
              expect.objectContaining({ audience: 'personal' }),
              composed,
              'en',
              userId,
            );
            expect(
              composed.find(({ id }) => id === 'social-friends'),
            ).toMatchObject({ items: [{ id: `profile-${userId}` }] });
          }
        }
        expect(sharedCache.read).not.toHaveBeenCalled();
        expect(sharedCache.resolve).not.toHaveBeenCalled();
      } finally {
        await moduleRef.close();
      }
    },
  );
});
