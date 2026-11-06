import { Test } from '@nestjs/testing';
import type { HomeRow, HomeTrack } from '@vozzify/contracts';
import { AttemptsService } from '../attempts/attempts.service.js';
import { StreaksService } from '../streaks/streaks.service.js';
import { UsersService } from '../users/users.service.js';
import { HomeService } from './home.service.js';
import { encodeHomeCursor } from './home-cursor.js';
import type { StoredPersonalHomeFeed } from './home-feed.js';
import { HomeFeedService } from './home-feed.service.js';
import {
  PersonalHomeRepository,
  type PersonalTrackCandidate,
  type UserFavoriteSignal,
  type UserTrackSignal,
} from './home-personal.repository.js';
import { PersonalHomeStore } from './home-personal.store.js';
import { PersonalHomeBuilder } from './home-personal-builder.service.js';
import {
  decayedTaste,
  type TasteSignal,
} from './home-personal-recommendations.js';
import { PersonalHomeTasteRepository } from './home-personal-taste.repository.js';
import { PersonalHomeTasteRowsService } from './home-personal-taste-rows.service.js';
import { personalHomeVersionFromStoredRows } from './home-personal-version.js';

describe('HomeService retired personal taste cursors', () => {
  it('verifies linked taste and raw public credits for the correct owner', async () => {
    const track: HomeTrack = {
      id: 'public-track',
      title: 'Public song',
      coverUrl: null,
      artistCredit: [{ name: 'Singer', joinPhrase: '' }],
      durationMs: 180_000,
      vocalRange: null,
    };
    const publicRow: HomeRow = {
      id: 'new-tracks',
      layout: 'standard',
      title: { key: 'home.rows.newTracks', params: {} },
      items: [track],
    };
    const feeds = {
      currentPublic: vi.fn().mockResolvedValue({
        feed: {
          audience: 'public',
          locale: 'en',
          version: 'public-version',
          algorithmVersion: 1,
          rows: [publicRow],
        },
        cacheable: true,
      }),
      withArtistLinks: vi.fn(async (rows: HomeRow[]) =>
        rows.map((row) =>
          row.layout === 'standard'
            ? {
                ...row,
                items: row.items.map((item) => ({
                  ...item,
                  artistCredit: item.artistCredit.map((credit) => ({
                    ...credit,
                    artistId: 'artist-1',
                  })),
                })),
              }
            : row,
        ),
      ),
      publicVersion: vi.fn().mockResolvedValue(undefined),
    };
    const personal = {
      findUserTrackSignals: vi
        .fn<() => Promise<UserTrackSignal[]>>()
        .mockResolvedValue([]),
      findUserFavoriteSignals: vi
        .fn<() => Promise<UserFavoriteSignal[]>>()
        .mockResolvedValue([]),
      findDiscoveryTracks: vi.fn().mockResolvedValue(new Map()),
      findUserSungTrackSources: vi.fn().mockResolvedValue([]),
      findCommunityCooccurrence: vi.fn().mockResolvedValue([]),
      findTracksOutsideGenres: vi.fn().mockResolvedValue([]),
    };
    const tasteCards: PersonalTrackCandidate[] = Array.from(
      { length: 12 },
      (_, index) => ({
        id: `taste-track-${index}`,
        title: `Taste song ${index}`,
        coverUrl: `https://cdn.example/${index}.webp`,
        artistCredit: [{ name: `Singer ${index}`, joinPhrase: '' }],
        durationMs: 180_000,
        vocalRangeLowest: null,
        vocalRangeHighest: null,
        genres: ['rock'],
        trendingScore: 3 - index,
      }),
    );
    const tasteRepository = {
      findTracksForGenres: vi.fn().mockResolvedValue(tasteCards),
      findUserTasteActivities: vi.fn().mockResolvedValue([]),
    };
    const attempts = {
      mostSungArtistActivities: vi.fn().mockResolvedValue([]),
    };
    const tasteSignals: TasteSignal[] = Array.from({ length: 4 }, () => ({
      genres: ['rock'],
      artistKey: 'singer',
      weight: 1,
      lastSignalAt: new Date(),
    }));
    const tasteRowsModule = await Test.createTestingModule({
      providers: [
        PersonalHomeTasteRowsService,
        { provide: PersonalHomeRepository, useValue: personal },
        { provide: PersonalHomeTasteRepository, useValue: tasteRepository },
        { provide: AttemptsService, useValue: attempts },
      ],
    }).compile();
    const generatedTasteRows = await tasteRowsModule
      .get(PersonalHomeTasteRowsService)
      .build({
        userId: 'user-a',
        signals: [],
        tasteSignals,
        taste: decayedTaste(tasteSignals),
        mastered: new Set(),
        usedTrackIds: new Set(),
        publicRows: [publicRow],
      });
    expect(generatedTasteRows.map((row) => row.id)).toContain(
      'more-of-your-genres',
    );
    const tasteRows = {
      findUserTasteActivities: vi.fn().mockResolvedValue([]),
      build: vi.fn().mockResolvedValue(generatedTasteRows),
      explorationRow: vi.fn().mockResolvedValue(undefined),
    };
    const users = {
      getPracticeSettings: vi.fn().mockResolvedValue({
        dailyPracticeTargetSeconds: 300,
        timeZone: 'UTC',
        lastPracticeHeartbeatAt: null,
      }),
    };
    const streaks = {
      getStatus: vi.fn().mockResolvedValue({
        day: '2026-10-20',
        listenedSeconds: 0,
        targetSeconds: 300,
        completedToday: false,
        currentStreakDays: 0,
      }),
    };
    const builderModule = await Test.createTestingModule({
      providers: [
        PersonalHomeBuilder,
        { provide: HomeFeedService, useValue: feeds },
        { provide: PersonalHomeRepository, useValue: personal },
        { provide: PersonalHomeTasteRowsService, useValue: tasteRows },
        { provide: StreaksService, useValue: streaks },
        { provide: UsersService, useValue: users },
      ],
    }).compile();
    const built = await builderModule
      .get(PersonalHomeBuilder)
      .build('user-a', 'en');
    const linkedTaste = built.rows.find(
      (row) => row.id === 'more-of-your-genres',
    );
    expect(linkedTaste?.layout).toBe('standard');
    if (linkedTaste?.layout !== 'standard') {
      throw new Error('Builder did not produce the expected taste row');
    }
    expect(linkedTaste.items[0]?.artistCredit[0]?.artistId).toBe('artist-1');

    const retired: StoredPersonalHomeFeed = built;
    expect(
      personalHomeVersionFromStoredRows(
        'user-a',
        built.locale,
        built.algorithmVersion,
        built.rows,
      ),
    ).toBe(built.version);
    const snapshots = {
      readCurrent: vi.fn().mockResolvedValue(undefined),
      readRetired: vi.fn().mockResolvedValue(retired),
    };
    const serviceModule = await Test.createTestingModule({
      providers: [
        HomeService,
        { provide: HomeFeedService, useValue: feeds },
        { provide: PersonalHomeStore, useValue: snapshots },
      ],
    }).compile();
    const service = serviceModule.get(HomeService);
    const cursor = encodeHomeCursor({ version: built.version, position: 0 });

    const page = await service.getPage(cursor, 'en', 'user-a');
    expect(page.page.rows).toContainEqual(linkedTaste);
    await expect(service.getPage(cursor, 'en', 'user-b')).rejects.toMatchObject(
      { code: 'NOT_FOUND' },
    );
  });
});
