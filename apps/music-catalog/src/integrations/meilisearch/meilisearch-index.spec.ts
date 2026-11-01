import { MeilisearchApiError } from 'meilisearch';
import {
  createMeilisearchIndex,
  type IndexSettings,
  MeilisearchIndex,
} from './meilisearch-index.js';

type Doc = { mbid: string; title: string };

const SETTINGS: IndexSettings = {
  searchableAttributes: ['title', 'artist'],
  rankingRules: [
    'words',
    'typo',
    'proximity',
    'attributeRank',
    'sort',
    'wordPosition',
    'exactness',
  ],
  pagination: { maxTotalHits: 1000 },
};

const apiError = (status: number, code: string) =>
  new MeilisearchApiError(new Response(null, { status }), {
    message: code,
    code,
    type: 'invalid_request',
    link: '',
  });

// What the SDK returns for a write: a promise of the enqueued task that also
// knows how to wait for it.
const enqueued = (task: Record<string, unknown>) =>
  Object.assign(Promise.resolve({ taskUid: 7 }), {
    waitTask: vi.fn(async () => ({
      uid: 7,
      type: 'documentAdditionOrUpdate',
      status: 'succeeded',
      error: null,
      ...task,
    })),
  });

const setup = (
  options: {
    getRawIndex?: () => Promise<unknown>;
    currentSettings?: Record<string, unknown>;
    searchHits?: Record<string, unknown>[];
    document?: Doc;
    task?: Record<string, unknown>;
  } = {},
) => {
  const index = {
    getSettings: vi.fn(async () => ({
      searchableAttributes: SETTINGS.searchableAttributes,
      rankingRules: SETTINGS.rankingRules,
      pagination: { maxTotalHits: 1000 },
      ...options.currentSettings,
    })),
    updateSettings: vi.fn(() => enqueued(options.task ?? {})),
    addDocuments: vi.fn(() => enqueued(options.task ?? {})),
    updateDocuments: vi.fn(() => enqueued(options.task ?? {})),
    search: vi.fn(async () => ({ hits: options.searchHits ?? [] })),
    getDocument: vi.fn(async () => {
      if (options.document === undefined) {
        throw apiError(404, 'document_not_found');
      }
      return options.document;
    }),
  };
  const client = {
    getRawIndex: vi.fn(options.getRawIndex ?? (async () => ({}))),
    createIndex: vi.fn(() => enqueued(options.task ?? {})),
    index: vi.fn(() => index),
  };
  const meili = new MeilisearchIndex<Doc>(
    client as never,
    'recordings',
    'mbid',
  );
  return { meili, client, index };
};

describe('MeilisearchIndex', () => {
  describe('ensure', () => {
    it('creates a missing index with its primary key, then applies the settings', async () => {
      const { meili, client, index } = setup({
        getRawIndex: async () => {
          throw apiError(404, 'index_not_found');
        },
        currentSettings: { searchableAttributes: ['*'] },
      });

      await meili.ensure(SETTINGS);

      expect(client.createIndex).toHaveBeenCalledExactlyOnceWith('recordings', {
        primaryKey: 'mbid',
      });
      expect(index.updateSettings).toHaveBeenCalledExactlyOnceWith(SETTINGS);
    });

    it('leaves an index that is already up to date alone', async () => {
      const { meili, client, index } = setup();

      await meili.ensure(SETTINGS);
      await meili.ensure(SETTINGS);

      expect(client.createIndex).not.toHaveBeenCalled();
      expect(index.updateSettings).not.toHaveBeenCalled();
    });

    it.each([
      [
        'the attributes are in another order',
        { searchableAttributes: ['artist', 'title'] },
      ],
      ['an attribute is missing', { searchableAttributes: ['title'] }],
      [
        'the pagination window is another',
        { pagination: { maxTotalHits: 50 } },
      ],
      ['there is no pagination setting', { pagination: undefined }],
    ])('applies the settings when %s', async (_label, currentSettings) => {
      const { meili, index } = setup({ currentSettings });

      await meili.ensure(SETTINGS);

      expect(index.updateSettings).toHaveBeenCalledExactlyOnceWith(SETTINGS);
    });

    it('does not hide a failure that is not a missing index', async () => {
      const { meili, client } = setup({
        getRawIndex: async () => {
          throw apiError(403, 'invalid_api_key');
        },
      });

      await expect(meili.ensure(SETTINGS)).rejects.toThrow('invalid_api_key');
      expect(client.createIndex).not.toHaveBeenCalled();
    });

    it('does not take an API error that says nothing for a missing index', async () => {
      const { meili, client } = setup({
        getRawIndex: async () => {
          throw new MeilisearchApiError(new Response(null, { status: 502 }));
        },
      });

      await expect(meili.ensure(SETTINGS)).rejects.toThrow('502');
      expect(client.createIndex).not.toHaveBeenCalled();
    });

    it('does not take any other error for a missing index', async () => {
      const { meili } = setup({
        getRawIndex: async () => {
          throw new Error('connect ECONNREFUSED');
        },
      });

      await expect(meili.ensure(SETTINGS)).rejects.toThrow('ECONNREFUSED');
    });

    it('fails when Meilisearch could not apply the settings', async () => {
      const { meili } = setup({
        currentSettings: { searchableAttributes: ['*'] },
        task: {
          type: 'settingsUpdate',
          status: 'failed',
          error: { message: 'boom' },
        },
      });

      await expect(meili.ensure(SETTINGS)).rejects.toThrow(
        'Meilisearch task 7 (settingsUpdate) failed: boom',
      );
    });
  });

  describe('waiting for a task', () => {
    it('allows far longer than the SDK does by default, and polls often', async () => {
      const { meili, index } = setup();
      const waited = index.addDocuments;

      await meili.upsert([{ mbid: 'a', title: 'A' }]);

      const task = waited.mock.results[0]?.value as {
        waitTask: ReturnType<typeof vi.fn>;
      };
      const [options] = task.waitTask.mock.calls[0] as [
        { timeout: number; interval: number },
      ];
      // The SDK gives up after 5 seconds, too soon for a big batch.
      expect(options.timeout).toBeGreaterThan(60_000);
      expect(options.interval).toBeLessThanOrEqual(250);
    });
  });

  describe('upsert', () => {
    it('sends the documents and waits until they are indexed', async () => {
      const { meili, index } = setup();
      const documents = [{ mbid: 'a', title: 'A' }];

      await meili.upsert(documents);

      expect(index.addDocuments).toHaveBeenCalledExactlyOnceWith(documents);
    });

    it('sends nothing for no documents', async () => {
      const { meili, index } = setup();

      await meili.upsert([]);

      expect(index.addDocuments).not.toHaveBeenCalled();
    });

    it.each(['failed', 'canceled'])(
      'fails when the task ends %s, saying why',
      async (status) => {
        const { meili } = setup({
          task: {
            status,
            error: status === 'failed' ? { message: 'too big' } : null,
          },
        });

        await expect(meili.upsert([{ mbid: 'a', title: 'A' }])).rejects.toThrow(
          new RegExp(
            `Meilisearch task 7 \\(documentAdditionOrUpdate\\) ${status}`,
          ),
        );
      },
    );

    it('says so when a failed task gave no details', async () => {
      const { meili } = setup({ task: { status: 'failed', error: null } });

      await expect(meili.upsert([{ mbid: 'a', title: 'A' }])).rejects.toThrow(
        'failed: no details',
      );
    });
  });

  describe('search', () => {
    it('asks for the selected fields only and returns hits in Meilisearch order', async () => {
      const { meili, index } = setup({
        searchHits: [
          { mbid: 'c', title: 'C' },
          { mbid: 'a', title: 'A' },
          { mbid: 'b', title: 'B' },
        ],
      });

      const hits = await meili.search('hello', { limit: 10, offset: 20 }, [
        'mbid',
        'title',
      ]);

      expect(hits).toEqual([
        { mbid: 'c', title: 'C' },
        { mbid: 'a', title: 'A' },
        { mbid: 'b', title: 'B' },
      ]);
      expect(index.search).toHaveBeenCalledExactlyOnceWith('hello', {
        limit: 10,
        offset: 20,
        attributesToRetrieve: ['mbid', 'title'],
      });
    });

    it('returns no ids when nothing matches', async () => {
      const { meili } = setup();

      await expect(
        meili.search('nothing', { limit: 5, offset: 0 }, ['mbid']),
      ).resolves.toEqual([]);
    });

    it('fails on a hit without the primary key instead of passing it on', async () => {
      const { meili } = setup({ searchHits: [{ title: 'No key' }] });

      await expect(
        meili.search('hello', { limit: 5, offset: 0 }, ['mbid']),
      ).rejects.toThrow('without its mbid');
    });
  });

  describe('getDocument', () => {
    it('returns the document when it exists', async () => {
      const { meili, index } = setup({ document: { mbid: 'a', title: 'A' } });

      await expect(meili.getDocument('a')).resolves.toEqual({
        mbid: 'a',
        title: 'A',
      });
      expect(index.getDocument).toHaveBeenCalledExactlyOnceWith('a');
    });

    it('returns undefined when the document is absent', async () => {
      const { meili } = setup();

      await expect(meili.getDocument('missing')).resolves.toBeUndefined();
    });

    it('does not hide errors other than a missing document or index', async () => {
      const index = {
        getDocument: vi.fn(async () => {
          throw apiError(403, 'invalid_api_key');
        }),
      };
      const client = { index: vi.fn(() => index) };
      const failing = new MeilisearchIndex<Doc>(
        client as never,
        'recordings',
        'mbid',
      );

      await expect(failing.getDocument('a')).rejects.toThrow('invalid_api_key');
    });
  });

  describe('createMeilisearchIndex', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('talks to the given Meilisearch and index, with the given API key', async () => {
      const fetchMock = vi.fn(
        async () =>
          new Response(JSON.stringify({ hits: [{ mbid: 'a' }] }), {
            headers: { 'Content-Type': 'application/json' },
          }),
      );
      vi.stubGlobal('fetch', fetchMock);
      const index = createMeilisearchIndex<Doc>({
        url: 'http://meili.test:7700',
        apiKey: 'a-search-key',
        uid: 'things',
        primaryKey: 'mbid',
      });

      await expect(
        index.search('q', { limit: 1, offset: 0 }, ['mbid']),
      ).resolves.toEqual([{ mbid: 'a' }]);

      const [url, init] = fetchMock.mock.calls[0] as unknown as [
        URL | string,
        RequestInit,
      ];
      expect(String(url)).toBe('http://meili.test:7700/indexes/things/search');
      expect(new Headers(init.headers).get('Authorization')).toBe(
        'Bearer a-search-key',
      );
    });
  });
});
