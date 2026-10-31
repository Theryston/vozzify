import { loadEnv, loadServerEnv, loadWorkerEnv } from './env.js';

const KEY = 'k'.repeat(32);

// The vitest run has NODE_ENV=test, so no .env file is read: the process
// environment is all these loaders see.
const stubValidEnv = () => {
  vi.stubEnv('DATABASE_URL', 'postgres://user:pass@localhost:5433/db');
  vi.stubEnv('API_KEYS', KEY);
  vi.stubEnv('CATALOG_DATASET', 'tiny');
  vi.stubEnv('MEILISEARCH_URL', 'http://localhost:7700');
  vi.stubEnv('MEILISEARCH_SEARCH_API_KEY', 'search-key');
  vi.stubEnv('MEILISEARCH_WRITE_API_KEY', 'write-key');
};

describe('the env loaders', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('loadServerEnv reads the server set from the process environment', () => {
    stubValidEnv();

    expect(loadServerEnv()).toMatchObject({
      MEILISEARCH_URL: 'http://localhost:7700',
      MEILISEARCH_SEARCH_API_KEY: 'search-key',
      API_KEYS: [KEY],
    });
  });

  it('loadWorkerEnv reads the worker set from the process environment', () => {
    stubValidEnv();

    expect(loadWorkerEnv()).toMatchObject({
      MEILISEARCH_URL: 'http://localhost:7700',
      MEILISEARCH_WRITE_API_KEY: 'write-key',
      INDEXING_BATCH_SIZE: 50_000,
    });
  });

  it('fails fast, naming the variable, when what the process needs is missing', () => {
    stubValidEnv();
    vi.stubEnv('MEILISEARCH_SEARCH_API_KEY', '');
    vi.stubEnv('MEILISEARCH_WRITE_API_KEY', '');

    expect(() => loadServerEnv()).toThrow('MEILISEARCH_SEARCH_API_KEY');
    expect(() => loadWorkerEnv()).toThrow('MEILISEARCH_WRITE_API_KEY');
  });

  it('loadEnv needs no Meilisearch variable, and reads the environment only once', () => {
    stubValidEnv();
    vi.stubEnv('MEILISEARCH_URL', '');
    const first = loadEnv();
    vi.stubEnv('CATALOG_DATASET', 'full');

    expect(loadEnv()).toBe(first);
    expect(first.CATALOG_DATASET).toBe('tiny');
  });
});
