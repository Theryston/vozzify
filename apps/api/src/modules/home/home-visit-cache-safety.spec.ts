import { Test } from '@nestjs/testing';
import type { HomeRow } from '@vozzify/contracts';
import { HomeService } from './home.service.js';
import type { StoredHomeFeed } from './home-feed.js';
import { HomeFeedService } from './home-feed.service.js';
import { HomeVisitService } from './home-visit.service.js';

const rows: HomeRow[] = Array.from({ length: 8 }, (_, index) => ({
  id: `row-${index}`,
  layout: 'standard',
  title: { key: 'home.rows.newTracks', params: {} },
  items: [],
}));

describe('HomeService visit cache safety', () => {
  it('does not mark a page cacheable when visit freezing fails', async () => {
    const feed: StoredHomeFeed = {
      audience: 'public',
      version: 'a1b2c3d4e5f60718',
      algorithmVersion: 1,
      rows,
    };
    const feeds = {
      currentPublic: vi.fn().mockResolvedValue({ feed, cacheable: true }),
    };
    const visits = { create: vi.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        HomeService,
        { provide: HomeFeedService, useValue: feeds },
        { provide: HomeVisitService, useValue: visits },
      ],
    }).compile();

    const { cacheable } = await moduleRef.get(HomeService).getPage(undefined);

    expect(visits.create).toHaveBeenCalledOnce();
    expect(cacheable).toBe(false);
  });
});
