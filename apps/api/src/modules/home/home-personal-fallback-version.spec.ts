import { Test } from '@nestjs/testing';
import type { HomeFeedPage, HomeRow, HomeTrack } from '@vozzify/contracts';
import { HomeService } from './home.service.js';
import { HomeFeedService } from './home-feed.service.js';
import { PersonalHomeStore } from './home-personal.store.js';
import { PersonalHomeQueueService } from './home-personal-queue.service.js';
import { HomeSocialService } from './home-social.service.js';

const track: HomeTrack = {
  id: 'track-1',
  title: 'Song',
  coverUrl: null,
  artistCredit: [{ name: 'Singer', joinPhrase: '' }],
  durationMs: 180_000,
  vocalRange: null,
};

const publicRows: HomeRow[] = [
  {
    id: 'new-tracks',
    layout: 'standard',
    title: { key: 'home.rows.newTracks', params: {} },
    items: [track],
  },
];

const socialRow = (userId: string): HomeRow => ({
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
});

describe('HomeService personal fallback version', () => {
  it.each([true, false])(
    'uses distinct User versions when the public fallback is cacheable=%s',
    async (cacheable) => {
      const feeds = {
        currentPublic: vi.fn().mockResolvedValue({
          feed: {
            audience: 'public',
            locale: 'en',
            version: 'public-feed-version',
            algorithmVersion: 1,
            rows: publicRows,
          },
          cacheable,
        }),
      };
      const snapshots = { readCurrent: vi.fn().mockResolvedValue(undefined) };
      const refresh = { requestRefresh: vi.fn().mockResolvedValue(undefined) };
      const social = {
        rowsFor: vi.fn(async (userId: string) => [socialRow(userId)]),
      };
      const moduleRef = await Test.createTestingModule({
        providers: [
          HomeService,
          { provide: HomeFeedService, useValue: feeds },
          { provide: PersonalHomeStore, useValue: snapshots },
          { provide: PersonalHomeQueueService, useValue: refresh },
          { provide: HomeSocialService, useValue: social },
        ],
      }).compile();
      const service = moduleRef.get(HomeService);

      const pageA = (await service.getPage(undefined, 'en', 'user-a'))
        .page as HomeFeedPage;
      const pageB = (await service.getPage(undefined, 'en', 'user-b'))
        .page as HomeFeedPage;

      expect(pageA.audience).toBe('personal');
      expect(pageA.version).not.toBe('public-feed-version');
      expect(pageA.version).not.toBe(pageB.version);
      expect(pageA.rows[1]?.id).toBe('social-friends');
      expect(pageB.rows[1]?.id).toBe('social-friends');
      expect(pageA.rows[1]).not.toEqual(pageB.rows[1]);
    },
  );
});
