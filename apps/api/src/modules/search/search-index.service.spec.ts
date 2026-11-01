import { Test } from '@nestjs/testing';
import { AppException } from '../../common/errors/app-exception.js';
import { SonicService } from '../../integrations/sonic/sonic.service.js';
import { TracksSearchService } from '../tracks/tracks-search.service.js';
import { SearchIndexService } from './search-index.service.js';

describe('SearchIndexService', () => {
  const tracks = { findSearchIndexPage: vi.fn() };
  const sonic = {
    markIndexNotReady: vi.fn(),
    indexTrack: vi.fn(),
    markIndexReady: vi.fn(),
  };
  let service: SearchIndexService;

  beforeEach(async () => {
    vi.resetAllMocks();
    sonic.markIndexNotReady.mockResolvedValue(undefined);
    sonic.indexTrack.mockResolvedValue(undefined);
    sonic.markIndexReady.mockResolvedValue(undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [
        SearchIndexService,
        { provide: TracksSearchService, useValue: tracks },
        { provide: SonicService, useValue: sonic },
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

    await service.rebuild();

    expect(sonic.markIndexNotReady).toHaveBeenCalledOnce();
    expect(tracks.findSearchIndexPage).toHaveBeenNthCalledWith(
      1,
      undefined,
      200,
    );
    expect(tracks.findSearchIndexPage).toHaveBeenNthCalledWith(2, 'a', 200);
    expect(sonic.indexTrack).toHaveBeenCalledWith('a', 'Song Singer feat. ');
    expect(sonic.markIndexReady).toHaveBeenCalledOnce();
  });

  it('does not mark an interrupted rebuild ready and permits a safe rerun', async () => {
    tracks.findSearchIndexPage.mockReset();
    tracks.findSearchIndexPage
      .mockResolvedValueOnce([{ id: 'a', title: 'Song A', artistCredit: [] }])
      .mockRejectedValueOnce(new AppException('INTERNAL_ERROR', 'db failed'))
      .mockResolvedValueOnce([{ id: 'a', title: 'Song A', artistCredit: [] }])
      .mockResolvedValueOnce([]);
    await expect(service.rebuild()).rejects.toThrow('db failed');
    expect(sonic.markIndexReady).not.toHaveBeenCalled();
    sonic.indexTrack.mockResolvedValue(undefined);
    await service.rebuild();

    expect(sonic.markIndexNotReady).toHaveBeenCalledTimes(2);
    expect(sonic.markIndexReady).toHaveBeenCalledOnce();
  });
});
