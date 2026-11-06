import { Test } from '@nestjs/testing';
import type { HomeRow, HomeTrack } from '@vozzify/contracts';
import { StreaksService } from '../streaks/streaks.service.js';
import { UsersService } from '../users/users.service.js';
import { HomeFeedService } from './home-feed.service.js';
import {
  PersonalHomeRepository,
  type UserFavoriteSignal,
  type UserTrackSignal,
} from './home-personal.repository.js';
import { PersonalHomeBuilder } from './home-personal-builder.service.js';
import { PersonalHomeTasteRowsService } from './home-personal-taste-rows.service.js';

const track = (id: string, overrides: Partial<HomeTrack> = {}): HomeTrack => ({
  id,
  title: `Track ${id}`,
  coverUrl: `https://cdn.example/${id}.webp`,
  artistCredit: [{ name: `Artist ${id}`, joinPhrase: '' }],
  durationMs: 180_000,
  vocalRange: { lowest: 60, highest: 72 },
  ...overrides,
});

const TRACK_IDS = ['t1', 't2', 't3', 't4', 't5', 't6', 't7'];

const publicFeedOf = (ids: string[]) => ({
  feed: {
    audience: 'public' as const,
    locale: 'en' as const,
    version: 'public-version-1',
    algorithmVersion: 1,
    rows: [
      { id: 'hero', layout: 'hero', track: track(ids[0] ?? 't1') },
      {
        id: 'trending-today',
        layout: 'standard',
        title: { key: 'home.rows.trendingToday', params: {} },
        items: ids.map((id) => track(id)),
      },
    ] as HomeRow[],
  },
  cacheable: true,
});

const signal = (
  trackId: string,
  overrides: Partial<UserTrackSignal> = {},
): UserTrackSignal => ({
  trackId,
  attempts: 1,
  bestAccuracy: 0.5,
  lastAttemptAt: new Date('2026-10-20T10:00:00.000Z'),
  genres: ['rock'],
  artistKey: `Artist ${trackId}`,
  title: `Track ${trackId}`,
  coverUrl: `https://cdn.example/${trackId}.webp`,
  artistCredit: [{ name: `Artist ${trackId}`, joinPhrase: '' }],
  durationMs: 180_000,
  vocalRangeLowest: 60,
  vocalRangeHighest: 72,
  ...overrides,
});

const statusOf = (overrides = {}) => ({
  day: '2026-10-20',
  listenedSeconds: 120,
  targetSeconds: 300,
  completedToday: false,
  currentStreakDays: 4,
  ...overrides,
});

const feeds = { currentPublic: vi.fn() };
const personal = {
  findUserTrackSignals: vi.fn(),
  findUserFavoriteSignals: vi.fn(),
  findDiscoveryTracks: vi.fn(),
};
const tasteRows = {
  findUserTasteActivities: vi.fn(),
  build: vi.fn(),
  explorationRow: vi.fn(),
};
const streaks = { getStatus: vi.fn() };
const users = {
  getPracticeSettings: vi.fn().mockResolvedValue({
    dailyPracticeTargetSeconds: 300,
    timeZone: 'America/Sao_Paulo',
    lastPracticeHeartbeatAt: null,
  }),
};

const discoveryOf = (ids: string[], scores: Record<string, number>) =>
  new Map(
    ids.map((id, index) => [
      id,
      {
        trendingScore: scores[id] ?? 10 - index,
        genres: ['rock'],
        artistKey: `Artist ${id}`,
      },
    ]),
  );

const createBuilder = async (): Promise<PersonalHomeBuilder> => {
  const moduleRef = await Test.createTestingModule({
    providers: [
      PersonalHomeBuilder,
      { provide: HomeFeedService, useValue: feeds },
      { provide: PersonalHomeRepository, useValue: personal },
      { provide: PersonalHomeTasteRowsService, useValue: tasteRows },
      { provide: StreaksService, useValue: streaks },
      { provide: UsersService, useValue: users },
    ],
  }).compile();
  return moduleRef.get(PersonalHomeBuilder);
};

const build = async (): Promise<{
  audience: string;
  version: string;
  rows: HomeRow[];
}> => {
  return createBuilder().then((builder) => builder.build('user-1', 'en'));
};

const resetWith = (options: {
  publicIds?: string[];
  signals?: UserTrackSignal[];
  favorites?: UserFavoriteSignal[];
  scores?: Record<string, number>;
  status?: Record<string, number | boolean | string>;
}) => {
  const ids = options.publicIds ?? TRACK_IDS;
  feeds.currentPublic.mockResolvedValue(publicFeedOf(ids));
  personal.findUserTrackSignals.mockResolvedValue(options.signals ?? []);
  personal.findUserFavoriteSignals.mockResolvedValue(options.favorites ?? []);
  tasteRows.findUserTasteActivities.mockResolvedValue([]);
  personal.findDiscoveryTracks.mockResolvedValue(
    discoveryOf(ids, options.scores ?? {}),
  );
  streaks.getStatus.mockResolvedValue(statusOf(options.status));
};

const rowById = (rows: HomeRow[], id: string) =>
  rows.find((row) => row.id === id);

const itemIdsOf = (row: HomeRow | undefined): string[] =>
  row?.layout === 'standard' ? row.items.map((item) => item.id) : [];

describe('PersonalHomeBuilder', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    tasteRows.build.mockResolvedValue([]);
    tasteRows.findUserTasteActivities.mockResolvedValue([]);
    tasteRows.explorationRow.mockResolvedValue(undefined);
    users.getPracticeSettings.mockResolvedValue({
      dailyPracticeTargetSeconds: 300,
      timeZone: 'America/Sao_Paulo',
      lastPracticeHeartbeatAt: null,
    });
  });

  it('answers the public rows for a User with no data, plus the strip', async () => {
    resetWith({});

    const feed = await build();

    expect(feed.audience).toBe('personal');
    expect(feed.version).toMatch(/^[0-9a-f]{16}$/);
    expect(feed.version).not.toBe('public-version-1');
    expect(rowById(feed.rows, 'hero')).toMatchObject({
      layout: 'hero',
      track: { id: 't1' },
    });
    expect(itemIdsOf(rowById(feed.rows, 'trending-today'))).toEqual(
      TRACK_IDS.slice(1),
    );
    expect(rowById(feed.rows, 'daily-target')).toMatchObject({
      layout: 'daily-target',
      secondsLeft: 180,
      targetSeconds: 300,
      streakDays: 4,
      completedToday: false,
    });
  });

  it('names a version per User', async () => {
    resetWith({});
    const first = await build();

    const second = await (await createBuilder()).build('user-2', 'en');

    expect(second.version).not.toBe(first.version);
  });

  it('separates one started Track from one mastered Track', async () => {
    const ids = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'];
    resetWith({
      publicIds: ids,
      signals: ids.map((id, index) =>
        signal(id, {
          bestAccuracy: index === 0 ? 0.95 : 0.5 + index * 0.01,
          lastAttemptAt: new Date(Date.now() - index * 1000),
        }),
      ),
    });

    const feed = await build();
    const rowIds = feed.rows.map((row) => row.id);

    expect(rowIds.slice(0, 4)).toEqual([
      'daily-target',
      'continue-singing',
      'sing-again',
    ]);
    // The mastered Track leaves continue-singing but leads sing-again.
    expect(itemIdsOf(rowById(feed.rows, 'continue-singing'))).toEqual([
      's2',
      's3',
      's4',
      's5',
      's6',
      's7',
    ]);
    expect(itemIdsOf(rowById(feed.rows, 'sing-again'))[0]).toBe('s1');
  });

  it('keeps mastered Tracks out of the discovery rows', async () => {
    const ids = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
    resetWith({
      publicIds: ids,
      signals: [signal('s1', { bestAccuracy: 0.9, attempts: 60 })],
      scores: { s1: 100 },
    });

    const feed = await build();
    const discovery = feed.rows.filter((row) => row.id === 'trending-today');

    expect(JSON.stringify(discovery)).not.toContain('"s1"');
  });

  it('keeps a Continue singing row with only two started Tracks', async () => {
    resetWith({ signals: [signal('t1'), signal('t2')] });

    const feed = await build();

    expect(itemIdsOf(rowById(feed.rows, 'continue-singing'))).toEqual([
      't1',
      't2',
    ]);
    expect(rowById(feed.rows, 'sing-again')).toBeUndefined();
    expect(rowById(feed.rows, 'daily-target')).toBeDefined();
  });

  it('re-ranks discovery by the User taste once they have enough signals', async () => {
    // t1 is hot but tasteless; t8 is cold and matches the User's taste.
    // t7 remains in resume, while t8 proves discovery still follows affinity.
    const ids = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'];
    resetWith({
      publicIds: ids,
      signals: [signal('t7', { attempts: 60, genres: ['jazz'] })],
      scores: { t1: 100, t8: 1 },
    });
    tasteRows.findUserTasteActivities.mockResolvedValue(
      Array.from({ length: 60 }, () => ({
        genres: ['jazz'],
        artistKey: 'Artist t7',
        createdAt: new Date(),
      })),
    );
    personal.findDiscoveryTracks.mockResolvedValue(
      new Map(
        ids.map((id) => [
          id,
          {
            trendingScore: id === 't1' ? 100 : 1,
            genres: [id === 't8' ? 'jazz' : 'rock'],
            artistKey: `Artist ${id}`,
          },
        ]),
      ),
    );

    const feed = await build();

    expect(rowById(feed.rows, 'hero')).toMatchObject({
      track: { id: 't8' },
    });
  });

  it('reads the strip from the completed day', async () => {
    resetWith({ status: { completedToday: true, currentStreakDays: 6 } });

    const feed = await build();

    expect(rowById(feed.rows, 'daily-target')).toMatchObject({
      secondsLeft: 0,
      completedToday: true,
      streakDays: 6,
    });
  });
});
