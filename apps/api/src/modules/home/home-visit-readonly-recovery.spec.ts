import { Test } from '@nestjs/testing';
import { WebRevalidationService } from '../../integrations/web-revalidation/web-revalidation.service.js';
import { HomeFeedService } from './home-feed.service.js';
import { HomeFeedStore } from './home-feed.store.js';
import { HomeFeedBuilder } from './home-feed-builder.service.js';
import { HomeVisitService } from './home-visit.service.js';
import { HomeVisitStore } from './home-visit.store.js';

describe('HomeVisitService expired cursor recovery', () => {
  it('rejects an unknown cursor without building any public locale on request', async () => {
    const feedStore = {
      readCurrent: vi.fn().mockResolvedValue(undefined),
      acquireLock: vi.fn(),
      releaseLock: vi.fn(),
    };
    const builder = { build: vi.fn() };
    const visitStore = {
      read: vi.fn().mockResolvedValue(undefined),
      create: vi.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        HomeFeedService,
        HomeVisitService,
        { provide: HomeFeedStore, useValue: feedStore },
        { provide: HomeFeedBuilder, useValue: builder },
        { provide: WebRevalidationService, useValue: {} },
        { provide: HomeVisitStore, useValue: visitStore },
      ],
    }).compile();

    await expect(
      moduleRef.get(HomeVisitService).publicVersion('0000000000000000', false),
    ).resolves.toBeUndefined();

    expect(builder.build).not.toHaveBeenCalled();
    expect(feedStore.acquireLock).not.toHaveBeenCalled();
    expect(visitStore.create).not.toHaveBeenCalled();
  });
});
