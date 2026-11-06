import { Test } from '@nestjs/testing';
import type { HomeRow } from '@vozzify/contracts';
import { HomeService } from './home.service.js';
import type { StoredPersonalHomeFeed } from './home-feed.js';
import { HomeFeedService } from './home-feed.service.js';
import { PersonalHomeStore } from './home-personal.store.js';
import { PersonalHomeQueueService } from './home-personal-queue.service.js';
import { HOME_ALGORITHM_VERSION } from './home-rules.js';

const rows: HomeRow[] = [
  {
    id: 'snapshot-row',
    layout: 'standard',
    title: { key: 'home.rows.newTracks', params: {} },
    items: [],
  },
];

const snapshot = (algorithmVersion: number): StoredPersonalHomeFeed => ({
  audience: 'personal',
  locale: 'en',
  version: '1234567890abcdef',
  algorithmVersion,
  rows,
  generatedAt: new Date().toISOString(),
});

describe('HomeService algorithm refresh', () => {
  const feeds = { currentPublic: vi.fn(), publicVersion: vi.fn() };
  const snapshots = { readCurrent: vi.fn(), readRetired: vi.fn() };
  const refresh = { requestRefresh: vi.fn() };
  let service: HomeService;

  beforeEach(async () => {
    vi.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        HomeService,
        { provide: HomeFeedService, useValue: feeds },
        { provide: PersonalHomeStore, useValue: snapshots },
        { provide: PersonalHomeQueueService, useValue: refresh },
      ],
    }).compile();
    service = moduleRef.get(HomeService);
  });

  it('serves an older snapshot safely and queues an algorithm rebuild', async () => {
    snapshots.readCurrent.mockResolvedValue(
      snapshot(HOME_ALGORITHM_VERSION - 1),
    );

    const { page } = await service.getPage(undefined, 'en', 'user-1');

    expect(page.rows).toEqual(rows);
    expect(refresh.requestRefresh).toHaveBeenCalledWith('user-1', 'en');
  });

  it('does not queue a rebuild for a snapshot on the current algorithm', async () => {
    snapshots.readCurrent.mockResolvedValue(snapshot(HOME_ALGORITHM_VERSION));

    await service.getPage(undefined, 'en', 'user-1');

    expect(refresh.requestRefresh).not.toHaveBeenCalled();
  });
});
