import { Test } from '@nestjs/testing';
import { searchResultSchema } from '@vozzify/contracts';
import { testMbid } from '../../../test/utils/factories.js';
import { recordingSummary } from '../../../test/utils/recording-summaries.js';
import { AppException } from '../../common/errors/app-exception.js';
import { MusicCatalogClient } from '../../integrations/music-catalog/music-catalog.client.js';
import { SonicService } from '../../integrations/sonic/sonic.service.js';
import { TracksSearchService } from '../tracks/tracks-search.service.js';
import { SearchService } from './search.service.js';

describe('SearchService', () => {
  const catalog = {
    searchIfConnected: vi.fn(),
    searchRoutingState: vi.fn(),
    onSearchConnectionClosed: vi.fn(),
  };
  const sonic = { search: vi.fn() };
  const tracks = { findSearchResults: vi.fn() };
  let service: SearchService;
  let reportClose: (() => void) | undefined;

  beforeEach(async () => {
    reportClose = undefined;
    catalog.searchIfConnected.mockReset();
    catalog.onSearchConnectionClosed
      .mockReset()
      .mockImplementation((listener) => {
        reportClose = listener;
        return vi.fn();
      });
    catalog.searchRoutingState.mockReturnValue({
      connected: true,
      generation: 0,
    });
    sonic.search.mockReset();
    tracks.findSearchResults.mockReset();
    const moduleRef = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: MusicCatalogClient, useValue: catalog },
        { provide: SonicService, useValue: sonic },
        { provide: TracksSearchService, useValue: tracks },
      ],
    }).compile();
    service = moduleRef.get(SearchService);
    service.onModuleInit();
  });

  afterEach(() => service.onModuleDestroy());

  it('forwards catalog associations and ranking without PostgreSQL hydration', async () => {
    const result = {
      results: [
        { ...recordingSummary(testMbid(2), 'Second'), trackId: 'track-2' },
        { ...recordingSummary(testMbid(1), 'First'), trackId: null },
      ],
    };
    catalog.searchIfConnected.mockResolvedValue(result);

    await expect(
      service.search({ query: 'song', limit: 20, offset: 0 }),
    ).resolves.toEqual({ ...result, source: 'music-catalog' });
    expect(searchResultSchema.parse(result)).toEqual(result);
    expect(sonic.search).not.toHaveBeenCalled();
    expect(tracks.findSearchResults).not.toHaveBeenCalled();
  });

  it('returns successful empty results from the catalog', async () => {
    catalog.searchIfConnected.mockResolvedValue({ results: [] });
    await expect(
      service.search({ query: 'none', limit: 20, offset: 0 }),
    ).resolves.toEqual({ results: [], source: 'music-catalog' });
  });

  it('falls back for the interrupted request and bypasses the catalog afterward', async () => {
    catalog.searchIfConnected.mockRejectedValue(
      new AppException('SERVICE_UNAVAILABLE', 'catalog down'),
    );
    sonic.search.mockResolvedValue(['track-1']);
    tracks.findSearchResults.mockResolvedValue([
      { ...recordingSummary(testMbid(1), 'Song'), trackId: 'track-1' },
    ]);

    await expect(
      service.search({ query: 'song', limit: 20, offset: 0 }),
    ).resolves.toMatchObject({ source: 'sonic' });

    catalog.searchIfConnected.mockClear();
    await service.search({ query: 'song', limit: 20, offset: 0 });
    expect(catalog.searchIfConnected).not.toHaveBeenCalled();
    expect(sonic.search).toHaveBeenCalledTimes(2);
  });

  it('bypasses a catalog disconnected while no visitor request is running', async () => {
    catalog.searchRoutingState.mockReturnValue({
      connected: false,
      generation: 1,
    });
    sonic.search.mockResolvedValue([]);
    tracks.findSearchResults.mockResolvedValue([]);

    await expect(
      service.search({ query: 'song', limit: 20, offset: 0 }),
    ).resolves.toEqual({ results: [], source: 'sonic' });
    expect(catalog.searchIfConnected).not.toHaveBeenCalled();
  });

  it('keeps using Sonic after an idle disconnect even if the socket reconnects', async () => {
    catalog.searchRoutingState
      .mockReturnValueOnce({ connected: true, generation: 0 })
      .mockReturnValueOnce({ connected: true, generation: 0 })
      .mockReturnValueOnce({ connected: true, generation: 1 })
      .mockReturnValue({ connected: true, generation: 1 });
    catalog.searchIfConnected.mockResolvedValue({ results: [] });
    sonic.search.mockResolvedValue([]);
    tracks.findSearchResults.mockResolvedValue([]);

    await service.search({ query: 'first', limit: 20, offset: 0 });
    reportClose?.();
    await service.search({ query: 'second', limit: 20, offset: 0 });

    expect(catalog.searchIfConnected).toHaveBeenCalledTimes(1);
    expect(sonic.search).toHaveBeenCalledTimes(1);
  });

  it('probes a recovered catalog in the background without visitors', async () => {
    vi.useFakeTimers();
    catalog.searchRoutingState
      .mockReturnValueOnce({ connected: true, generation: 0 })
      .mockReturnValueOnce({ connected: true, generation: 0 })
      .mockReturnValue({ connected: true, generation: 1 });
    sonic.search.mockResolvedValue([]);
    tracks.findSearchResults.mockResolvedValue([]);
    catalog.searchIfConnected.mockResolvedValue({ results: [] });
    await service.search({ query: 'song', limit: 20, offset: 0 });
    reportClose?.();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(catalog.searchIfConnected).toHaveBeenCalledWith({
      query: 'vozzify primary health check',
      limit: 1,
      offset: 0,
    });
    await expect(
      service.search({ query: 'song', limit: 20, offset: 0 }),
    ).resolves.toMatchObject({ source: 'music-catalog' });
    vi.useRealTimers();
  });

  it('does not restore primary routing when shutdown overlaps a successful probe', async () => {
    vi.useFakeTimers();
    let finishProbe: ((value: { results: [] }) => void) | undefined;
    catalog.searchRoutingState.mockReturnValue({
      connected: false,
      generation: 1,
    });
    sonic.search.mockResolvedValue([]);
    tracks.findSearchResults.mockResolvedValue([]);
    await service.search({ query: 'song', limit: 20, offset: 0 });

    catalog.searchRoutingState.mockReturnValue({
      connected: true,
      generation: 0,
    });
    catalog.searchIfConnected.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishProbe = resolve;
        }),
    );
    await vi.advanceTimersByTimeAsync(3_000);
    service.onModuleDestroy();
    finishProbe?.({ results: [] });
    await vi.runAllTimersAsync();

    catalog.searchIfConnected.mockClear();
    await service.search({ query: 'song', limit: 20, offset: 0 });
    expect(catalog.searchIfConnected).not.toHaveBeenCalled();
    expect(sonic.search).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('does not classify unrelated catalog errors as availability failures', async () => {
    catalog.searchIfConnected.mockRejectedValue(new Error('bad protocol'));
    await expect(
      service.search({ query: 'song', limit: 20, offset: 0 }),
    ).rejects.toThrow('bad protocol');
    expect(sonic.search).not.toHaveBeenCalled();
  });

  it('does not hide an internal catalog protocol failure with Sonic', async () => {
    catalog.searchIfConnected.mockRejectedValue(
      new AppException('INTERNAL_ERROR', 'invalid response'),
    );
    await expect(
      service.search({ query: 'song', limit: 20, offset: 0 }),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(sonic.search).not.toHaveBeenCalled();
  });
});
