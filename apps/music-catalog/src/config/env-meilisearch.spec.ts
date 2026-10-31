import { parseEnv, parseServerEnv, parseWorkerEnv } from './env.js';

const KEY = 'k'.repeat(32);
const base = {
  DATABASE_URL: 'postgres://user:pass@localhost:5433/db',
  API_KEYS: KEY,
  CATALOG_DATASET: 'tiny',
};
const SEARCH_KEY = 'search-key';
const WRITE_KEY = 'write-key';
const server = {
  ...base,
  MEILISEARCH_URL: 'http://localhost:7700',
  MEILISEARCH_SEARCH_API_KEY: SEARCH_KEY,
};
const worker = {
  ...base,
  MEILISEARCH_URL: 'http://localhost:7700',
  MEILISEARCH_WRITE_API_KEY: WRITE_KEY,
};

describe('parseServerEnv', () => {
  it('reads the Meilisearch URL and the search key next to the shared settings', () => {
    expect(parseServerEnv(server)).toMatchObject({
      MEILISEARCH_URL: 'http://localhost:7700',
      MEILISEARCH_SEARCH_API_KEY: SEARCH_KEY,
      DATABASE_URL: base.DATABASE_URL,
    });
  });

  it('does not ask for the write key, which the server must not have', () => {
    expect(parseServerEnv(server)).not.toHaveProperty(
      'MEILISEARCH_WRITE_API_KEY',
    );
  });

  it.each([
    ['MEILISEARCH_URL', undefined],
    ['MEILISEARCH_URL', 'not a url'],
    ['MEILISEARCH_URL', 'ftp://localhost:7700'],
    ['MEILISEARCH_URL', 'ahttp://localhost:7700'],
    ['MEILISEARCH_URL', 'httpx://localhost:7700'],
    ['MEILISEARCH_SEARCH_API_KEY', undefined],
    ['MEILISEARCH_SEARCH_API_KEY', ''],
  ])('rejects %s=%s', (name, value) => {
    expect(() => parseServerEnv({ ...server, [name]: value })).toThrow(name);
  });

  it('accepts an HTTPS URL', () => {
    expect(
      parseServerEnv({ ...server, MEILISEARCH_URL: 'https://search.internal' })
        .MEILISEARCH_URL,
    ).toBe('https://search.internal');
  });

  it('keeps failing on the shared settings', () => {
    expect(() => parseServerEnv({ ...server, API_KEYS: 'short' })).toThrow(
      'API_KEYS',
    );
  });
});

describe('parseWorkerEnv', () => {
  it('reads the Meilisearch URL and the write key, with a default batch size', () => {
    expect(parseWorkerEnv(worker)).toMatchObject({
      MEILISEARCH_URL: 'http://localhost:7700',
      MEILISEARCH_WRITE_API_KEY: WRITE_KEY,
      INDEXING_BATCH_SIZE: 50_000,
    });
  });

  it('does not ask for the search key', () => {
    expect(parseWorkerEnv(worker)).not.toHaveProperty(
      'MEILISEARCH_SEARCH_API_KEY',
    );
  });

  it('takes the batch size from INDEXING_BATCH_SIZE', () => {
    expect(
      parseWorkerEnv({ ...worker, INDEXING_BATCH_SIZE: '500' })
        .INDEXING_BATCH_SIZE,
    ).toBe(500);
  });

  it.each(['25000', '50000'])(
    'accepts a larger indexing task of %s documents',
    (size) => {
      expect(
        parseWorkerEnv({ ...worker, INDEXING_BATCH_SIZE: size })
          .INDEXING_BATCH_SIZE,
      ).toBe(Number(size));
    },
  );

  it.each([
    ['MEILISEARCH_URL', undefined],
    ['MEILISEARCH_WRITE_API_KEY', undefined],
    ['MEILISEARCH_WRITE_API_KEY', ''],
    ['INDEXING_BATCH_SIZE', '0'],
    ['INDEXING_BATCH_SIZE', '50001'],
    ['INDEXING_BATCH_SIZE', 'many'],
  ])('rejects %s=%s', (name, value) => {
    expect(() => parseWorkerEnv({ ...worker, [name]: value })).toThrow(name);
  });
});

describe('parseEnv', () => {
  it('still needs no Meilisearch setting, so migrations run without one', () => {
    expect(() => parseEnv(base)).not.toThrow();
  });
});
