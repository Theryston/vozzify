import type { InjectionToken, ValueProvider } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { HomeRow, HomeTrack } from '@vozzify/contracts';
import { AttemptsService } from '../attempts/attempts.service.js';
import { StreaksService } from '../streaks/streaks.service.js';
import { TrackLocaleTrendingService } from '../tracks/track-locale-trending.service.js';
import { UsersService } from '../users/users.service.js';
import { HomeRepository } from './home.repository.js';
import { HomeFeedService } from './home-feed.service.js';
import { PersonalHomeRepository } from './home-personal.repository.js';
import { PersonalHomeBuilder } from './home-personal-builder.service.js';
import { PersonalHomeTasteRowsService } from './home-personal-taste-rows.service.js';
import { HomeSocialService } from './home-social.service.js';

describe('PersonalHomeBuilder row composition', () => {
  it('includes the daily target and each resume row once', async () => {
    const tracks = Array.from(
      { length: 18 },
      (_, index) =>
        ({
          id: `song_${index}`,
          title: `Song ${index}`,
          coverUrl: null,
          artistCredit: [{ name: `Performer ${index}`, joinPhrase: '' }],
          durationMs: null,
          vocalRange: { lowest: 60, highest: 72 },
        }) satisfies HomeTrack,
    );
    const firstTrack = tracks[0];
    if (!firstTrack) throw new Error('No public Track fixture');
    const publicRows: HomeRow[] = [
      { id: 'hero', layout: 'hero', track: firstTrack },
      {
        id: 'trending',
        layout: 'standard',
        title: { key: 'home.rows.trendingToday', params: {} },
        items: tracks,
      },
    ];
    const feeds = {
      currentPublic: vi.fn().mockResolvedValue({
        feed: {
          audience: 'public',
          locale: 'en',
          version: 'public',
          algorithmVersion: 1,
          rows: publicRows,
        },
        cacheable: true,
      }),
    };
    const signals = tracks.slice(0, 6).map((item, index) => ({
      trackId: item.id,
      attempts: 1,
      bestAccuracy: index === 1 ? 0.95 : 0.7,
      lastAttemptAt: new Date('2026-10-20T10:00:00.000Z'),
      genres: ['rock'],
      artistKey: item.artistCredit[0]?.name ?? item.id,
      title: item.title,
      coverUrl: item.coverUrl,
      artistCredit: item.artistCredit,
      durationMs: item.durationMs,
      vocalRangeLowest: null,
      vocalRangeHighest: null,
    }));
    const personal = {
      findUserTrackSignals: vi.fn().mockResolvedValue(signals),
      findUserFavoriteSignals: vi.fn().mockResolvedValue([]),
      findDiscoveryTracks: vi.fn().mockResolvedValue(
        new Map(
          tracks.map((item, index) => [
            item.id,
            {
              trendingScore: tracks.length - index,
              genres: ['rock'],
              artistKey: item.artistCredit[0]?.name ?? item.id,
              artistKeys: [],
            },
          ]),
        ),
      ),
    };
    const tasteRows = {
      findDiscoveryCandidates: vi.fn().mockResolvedValue({
        tracks: [],
        byRow: {},
      }),
      findUserTasteActivities: vi.fn().mockResolvedValue([]),
      build: vi.fn(async ({ usedTrackIds }: { usedTrackIds: Set<string> }) => {
        const items = tracks.slice(6, 12);
        for (const item of items) usedTrackIds.add(item.id);
        return [
          {
            id: 'because-you-sang',
            layout: 'standard' as const,
            title: { key: 'home.rows.becauseYouSang', params: {} },
            items,
          },
        ];
      }),
      explorationRow: vi.fn().mockResolvedValue(undefined),
    };
    const streaks = {
      practiceDayOf: StreaksService.prototype.practiceDayOf,
      getStatus: vi.fn().mockResolvedValue({
        completedToday: false,
        targetSeconds: 300,
        listenedSeconds: 120,
        currentStreakDays: 2,
      }),
    };
    const users = {
      getPracticeSettings: vi.fn().mockResolvedValue({
        dailyPracticeTargetSeconds: 300,
        timeZone: 'UTC',
        lastPracticeHeartbeatAt: null,
      }),
    };
    const attempts = {
      vocalRange: vi.fn().mockResolvedValue(null),
      vocalRangeEvidenceCount: vi.fn().mockResolvedValue(0),
    };
    const homeRepository = {
      popularityScoresForTracks: vi.fn().mockResolvedValue([]),
      findPopularAlbums: vi.fn().mockResolvedValue([]),
      findAlbumTrackSignals: vi.fn().mockResolvedValue([]),
      localePracticeEvidence: vi.fn().mockResolvedValue({
        distinctUsers: 0,
        activeDays: 0,
      }),
    };
    const localeTrending = { rank: vi.fn().mockResolvedValue(undefined) };
    attempts.vocalRange.mockResolvedValue({ lowest: 60, highest: 72 });
    const social = {
      rowsFor: vi.fn().mockResolvedValue([
        {
          id: 'people-who-sing-what-you-sing',
          layout: 'people',
          title: { key: 'home.rows.peopleWhoSingWhatYouSing', params: {} },
          items: Array.from({ length: 6 }, (_, index) => ({
            id: `person_${index}`,
            username: `singer_${index}`,
            name: `Singer ${index}`,
            image: null,
            commonTracks: 3,
          })),
        },
      ]),
    };
    const testProviders = new Map<InjectionToken, unknown>([
      [HomeFeedService, feeds],
      [PersonalHomeRepository, personal],
      [HomeRepository, homeRepository],
      [TrackLocaleTrendingService, localeTrending],
      [PersonalHomeTasteRowsService, tasteRows],
      [StreaksService, streaks],
      [UsersService, users],
      [AttemptsService, attempts],
      [HomeSocialService, social],
    ]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        PersonalHomeBuilder,
        ...[...testProviders].map(
          ([provide, useValue]): ValueProvider => ({ provide, useValue }),
        ),
      ],
    }).compile();

    const feed = await moduleRef.get(PersonalHomeBuilder).build('user-1', 'en');
    const rowIds = feed.rows.map((row) => row.id);

    expect(new Set(rowIds).size).toBe(rowIds.length);
    expect(rowIds.filter((id) => id === 'daily-target')).toHaveLength(1);
    expect(rowIds.filter((id) => id === 'continue-singing')).toHaveLength(1);
    expect(rowIds.filter((id) => id === 'sing-again')).toHaveLength(1);
    expect(rowIds.slice(0, 4)).toEqual([
      'daily-target',
      'continue-singing',
      'sing-again',
      'people-who-sing-what-you-sing',
    ]);
    const continueRow = feed.rows.find((row) => row.id === 'continue-singing');
    const singAgainRow = feed.rows.find((row) => row.id === 'sing-again');
    if (
      continueRow?.layout !== 'standard' ||
      singAgainRow?.layout !== 'standard'
    ) {
      throw new Error('Resume rows were not composed as standard rows');
    }
    expect(continueRow.items.map((item) => item.id)).toHaveLength(5);
    expect(singAgainRow.items.map((item) => item.id)).toEqual(['song_1']);
    expect(continueRow.items.map((item) => item.id)).not.toContain('song_1');
    expect(
      rowIds.filter((id) => id === 'people-who-sing-what-you-sing'),
    ).toHaveLength(1);
    expect(rowIds).toContain('within-your-voice');
    expect(rowIds).toContain('because-you-sang');
  });
});
