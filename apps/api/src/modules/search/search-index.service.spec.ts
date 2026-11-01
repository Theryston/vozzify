import { Test } from '@nestjs/testing';
import { AppException } from '../../common/errors/app-exception.js';
import { SonicService } from '../../integrations/sonic/sonic.service.js';
import { TrackSearchIndexService } from '../tracks/track-search-index.service.js';
import { TracksSearchService } from '../tracks/tracks-search.service.js';
import { SearchIndexService } from './search-index.service.js';

describe('SearchIndexService', () => {
  const tracks = { findSearchIndexPage: vi.fn() };
  const sonic = {
    markIndexNotReady: vi.fn(),
    markIndexReady: vi.fn(),
  };
  const delivery = {
    enqueueBackfillPage: vi.fn(),
    countPending: vi.fn(),
    dispatchPending: vi.fn(),
  };
  let service: SearchIndexService;

  beforeEach(async () => {
    vi.resetAllMocks();
    sonic.markIndexNotReady.mockResolvedValue(undefined);
    sonic.markIndexReady.mockResolvedValue(undefined);
    delivery.enqueueBackfillPage.mockResolvedValue(undefined);
    delivery.countPending.mockResolvedValue(0);
    delivery.dispatchPending.mockResolvedValue(1);
    const moduleRef = await Test.createTestingModule({
      providers: [
        SearchIndexService,
        { provide: TracksSearchService, useValue: tracks },
        { provide: SonicService, useValue: sonic },
        { provide: TrackSearchIndexService, useValue: delivery },
      ],
    }).compile();
    service = moduleRef.get(SearchIndexService);
  });

  it('keeps the search unavailable until every keyset page is indexed', async () => {
    tracks.findSearchIndexPage
      .mockResolvedValueOnce([
        {
          id: 'a',
          title: 'Song',
          artistCredit: [{ name: 'Singer', joinPhrase: ' feat. ' }],
        },
      ])
      .mockResolvedValueOnce([]);
    delivery.countPending.mockResolvedValueOnce(1).mockResolvedValue(0);

    await service.rebuild();

    expect(sonic.markIndexNotReady).toHaveBeenCalledOnce();
    expect(tracks.findSearchIndexPage).toHaveBeenNthCalledWith(
      1,
      undefined,
      200,
    );
    expect(tracks.findSearchIndexPage).toHaveBeenNthCalledWith(2, 'a', 200);
    expect(delivery.enqueueBackfillPage).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'a',
        title: 'Song',
        artistCredit: [{ name: 'Singer', joinPhrase: ' feat. ' }],
      }),
    ]);
    expect(delivery.dispatchPending).toHaveBeenCalledOnce();
    expect(sonic.markIndexReady).toHaveBeenCalledOnce();
  });

  it('does not mark an interrupted rebuild ready and permits a safe rerun', async () => {
    tracks.findSearchIndexPage.mockReset();
    tracks.findSearchIndexPage
      .mockResolvedValueOnce([{ id: 'a', title: 'Song A', artistCredit: [] }])
      .mockRejectedValueOnce(new AppException('INTERNAL_ERROR', 'db failed'))
      .mockResolvedValueOnce([{ id: 'a', title: 'Song A', artistCredit: [] }])
      .mockResolvedValueOnce([]);
    delivery.countPending.mockResolvedValueOnce(1).mockResolvedValue(0);
    await expect(service.rebuild()).rejects.toThrow('db failed');
    expect(sonic.markIndexReady).not.toHaveBeenCalled();
    await service.rebuild();

    expect(sonic.markIndexNotReady).toHaveBeenCalledTimes(2);
    expect(sonic.markIndexReady).toHaveBeenCalledOnce();
  });
});
