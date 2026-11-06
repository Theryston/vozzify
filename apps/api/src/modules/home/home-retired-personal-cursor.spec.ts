import { Test } from '@nestjs/testing';
import type { HomeRow, HomeTrack } from '@vozzify/contracts';
import { StreaksService } from '../streaks/streaks.service.js';
import { UsersService } from '../users/users.service.js';
import { HomeService } from './home.service.js';
import { encodeHomeCursor } from './home-cursor.js';
import type { StoredPersonalHomeFeed } from './home-feed.js';
import { HomeFeedService } from './home-feed.service.js';
import {
  PersonalHomeRepository,
  type UserFavoriteSignal,
  type UserTrackSignal,
} from './home-personal.repository.js';
import { PersonalHomeStore } from './home-personal.store.js';
import { PersonalHomeBuilder } from './home-personal-builder.service.js';
import { PersonalHomeTasteRowsService } from './home-personal-taste-rows.service.js';

describe('HomeService retired personal cursors', () => {
  it('serves an actual linked retired snapshot only to its hashed owner', async () => {
    const track: HomeTrack = {
      id: 'track-1',
      title: 'Song',
      coverUrl: null,
      artistCredit: [{ name: 'Singer', joinPhrase: '' }],
      durationMs: 180_000,
      vocalRange: null,
    };
    const rawRow: HomeRow = {
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
          rows: [],
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
    };
    const tasteRows = {
      findUserTasteActivities: vi.fn().mockResolvedValue([]),
      build: vi.fn().mockResolvedValue([rawRow]),
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
    const linkedRow = built.rows.find((row) => row.id === 'new-tracks');
    expect(linkedRow?.layout).toBe('standard');
    if (linkedRow?.layout !== 'standard') {
      throw new Error('Builder did not produce the expected linked row');
    }
    expect(linkedRow.items[0]?.artistCredit[0]?.artistId).toBe('artist-1');

    const retired: StoredPersonalHomeFeed = built;
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
    expect(page.page.rows).toContainEqual(linkedRow);
    await expect(service.getPage(cursor, 'en', 'user-b')).rejects.toMatchObject(
      {
        code: 'NOT_FOUND',
      },
    );
  });
});
