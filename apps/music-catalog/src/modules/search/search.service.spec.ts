import { CatalogError } from '../../errors/catalog-error.js';
import type { MeilisearchIndex } from '../../integrations/meilisearch/meilisearch-index.js';
import type { RecordingDocument } from '../../lib/recordings-index.js';
import type { Logger } from '../../logger.js';
import { SearchService } from './search.service.js';
import { SearchReadiness } from './search-readiness.js';

const document = (mbid: string): RecordingDocument => ({
  mbid,
  title: `Title of ${mbid}`,
  artistCredit: 'Artist',
  primaryReleaseMbid: null,
  artistAliases: [],
  releaseTitles: [],
  workTitles: [],
  genres: [],
  disambiguation: '',
});

const params = {
  query: 'hello',
  limit: 10,
  offset: 20,
} as const;

const setup = (
  options: { hits?: RecordingDocument[]; notReady?: boolean } = {},
) => {
  const callOrder: string[] = [];
  const readiness = {
    assertReady: vi.fn(() => {
      callOrder.push('assertReady');
      if (options.notReady) {
        throw new CatalogError('CATALOG_NOT_READY', 'still importing');
      }
    }),
  };
  const index = {
    search: vi.fn(async () => {
      callOrder.push('index');
      return options.hits ?? [];
    }),
  };
  const service = new SearchService({
    readiness: readiness as unknown as SearchReadiness,
    index: index as unknown as MeilisearchIndex<RecordingDocument>,
  });
  return { service, readiness, index, callOrder };
};

describe('SearchService', () => {
  it('searches the bounded display fields directly in the index', async () => {
    const { service, index, callOrder } = setup({
      hits: [document('a'), document('b')],
    });

    await service.search(params);

    expect(index.search).toHaveBeenCalledExactlyOnceWith(
      'hello',
      {
        limit: 10,
        offset: 20,
      },
      ['mbid', 'title', 'artistCredit', 'primaryReleaseMbid', 'trackId'],
    );
    expect(callOrder).toEqual(['assertReady', 'index']);
  });

  it('does not hydrate indexed hits from a summary repository', async () => {
    const { readiness, index } = setup({ hits: [document('a')] });
    const findByMbids = vi.fn(() => {
      throw new Error('search must not hydrate summaries from Postgres');
    });
    const serviceWithSummarySentinel = new SearchService({
      readiness: readiness as unknown as SearchReadiness,
      index: index as unknown as MeilisearchIndex<RecordingDocument>,
      summaries: { findByMbids },
    } as unknown as ConstructorParameters<typeof SearchService>[0]);

    await expect(
      serviceWithSummarySentinel.search(params),
    ).resolves.toMatchObject({
      results: [{ mbid: 'a' }],
    });
    expect(readiness.assertReady).toHaveBeenCalledOnce();
    expect(findByMbids).not.toHaveBeenCalled();
  });

  it('returns compact items in the order the index ranked them', async () => {
    const { service } = setup({
      hits: [document('c'), document('a'), document('b')],
    });

    const { results } = await service.search(params);

    expect(results.map((result) => result.mbid)).toEqual(['c', 'a', 'b']);
  });

  it('derives the cover URL from the indexed primary-release MBID', async () => {
    const indexed = {
      ...document('a'),
      primaryReleaseMbid: '00000000-0000-4000-8000-000000000050',
    };
    const { service } = setup({ hits: [indexed] });

    await expect(service.search(params)).resolves.toMatchObject({
      results: [
        {
          mbid: 'a',
          title: 'Title of a',
          artistCredit: 'Artist',
          coverUrl:
            'https://assets.vozzify.com/cover-art-archive/release/00000000-0000-4000-8000-000000000050/front-500',
          trackId: null,
        },
      ],
    });
  });

  it('treats a pre-upgrade document without a release MBID as a null cover', async () => {
    const legacyDocument: RecordingDocument = { ...document('a') };
    delete legacyDocument.primaryReleaseMbid;
    const { service } = setup({ hits: [legacyDocument] });

    await expect(service.search(params)).resolves.toMatchObject({
      results: [{ mbid: 'a', coverUrl: null, trackId: null }],
    });
  });

  it('returns no results when the index finds nothing', async () => {
    const { service } = setup();

    await expect(service.search(params)).resolves.toEqual({ results: [] });
  });

  it('propagates Meilisearch failures instead of returning an empty result', async () => {
    const { service, index } = setup();
    const failure = new Error('Meilisearch unavailable');
    index.search.mockRejectedValueOnce(failure);

    await expect(service.search(params)).rejects.toBe(failure);
  });

  it('checks readiness before reaching the index when the catalog is not ready', async () => {
    const { service, index } = setup({ notReady: true });

    await expect(service.search(params)).rejects.toMatchObject({
      code: 'CATALOG_NOT_READY',
    });
    expect(index.search).not.toHaveBeenCalled();
  });

  it('never reads readiness from its source during search requests', async () => {
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const readReadyPhase = vi.fn(async () => 'ready' as const);
    const readiness = new SearchReadiness({
      readPhase: readReadyPhase,
      refreshIntervalMs: 60_000,
      logger: logger as unknown as Logger,
    });
    await readiness.start();
    readReadyPhase.mockClear();
    const index = {
      search: vi
        .fn()
        .mockResolvedValueOnce([document('a')])
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new Error('Meilisearch unavailable')),
    };
    const service = new SearchService({
      readiness,
      index: index as unknown as MeilisearchIndex<RecordingDocument>,
    });

    try {
      await expect(service.search(params)).resolves.toMatchObject({
        results: [{ mbid: 'a' }],
      });
      await expect(service.search(params)).resolves.toEqual({ results: [] });
      await expect(service.search(params)).rejects.toThrow(
        'Meilisearch unavailable',
      );
      expect(readReadyPhase).not.toHaveBeenCalled();

      const notReadyRead = vi.fn(async () => 'indexing' as const);
      const notReady = new SearchReadiness({
        readPhase: notReadyRead,
        refreshIntervalMs: 60_000,
        logger: logger as unknown as Logger,
      });
      await notReady.start();
      notReadyRead.mockClear();
      const notReadyService = new SearchService({
        readiness: notReady,
        index: index as unknown as MeilisearchIndex<RecordingDocument>,
      });
      await expect(notReadyService.search(params)).rejects.toMatchObject({
        code: 'CATALOG_NOT_READY',
      });
      expect(notReadyRead).not.toHaveBeenCalled();
      await notReady.stop();
    } finally {
      await readiness.stop();
    }
  });
});
