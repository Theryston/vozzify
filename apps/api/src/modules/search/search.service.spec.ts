import { Test } from '@nestjs/testing';
import { searchResultSchema } from '@vozzify/contracts';
import { testMbid } from '../../../test/utils/factories.js';
import { recordingSummary } from '../../../test/utils/recording-summaries.js';
import { MusicCatalogClient } from '../../integrations/music-catalog/music-catalog.client.js';
import { SearchService } from './search.service.js';

describe('SearchService', () => {
  const catalog = { search: vi.fn() };
  let service: SearchService;

  beforeEach(async () => {
    catalog.search.mockReset();
    const moduleRef = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: MusicCatalogClient, useValue: catalog },
      ],
    }).compile();
    service = moduleRef.get(SearchService);
  });

  it('forwards catalog associations and relevance order without database hydration', async () => {
    const result = {
      results: [
        { ...recordingSummary(testMbid(2), 'Second'), trackId: 'track-2' },
        { ...recordingSummary(testMbid(1), 'First'), trackId: null },
      ],
    };
    catalog.search.mockResolvedValue(result);

    await expect(
      service.search({ query: 'song', limit: 20, offset: 0 }),
    ).resolves.toEqual({ ...result, source: 'music-catalog' });
    expect(searchResultSchema.parse(result)).toEqual(result);
  });

  it('returns successful empty results from the catalog', async () => {
    catalog.search.mockResolvedValue({ results: [] });
    await expect(
      service.search({ query: 'none', limit: 20, offset: 0 }),
    ).resolves.toEqual({ results: [], source: 'music-catalog' });
  });

  it('preserves catalog errors', async () => {
    catalog.search.mockRejectedValue(new Error('catalog down'));
    await expect(
      service.search({ query: 'song', limit: 20, offset: 0 }),
    ).rejects.toThrow('catalog down');
  });
});
