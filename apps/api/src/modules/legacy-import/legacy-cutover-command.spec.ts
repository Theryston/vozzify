import { fileURLToPath } from 'node:url';
import { Logger } from '@nestjs/common';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import {
  FAKE_CATALOG_API_KEY,
  type FakeMusicCatalog,
  startFakeMusicCatalog,
} from '../../../test/utils/fake-music-catalog.js';
import { createCutoverSource } from '../../../test/utils/legacy-cutover-source.js';
import { runLegacyCutover } from './legacy-cutover-command.js';

// Exercise orchestration in-process for coverage, with real stage services and
// disposable infrastructure. The larger e2e scenario also executes dist/main.js.
describe('legacy cutover operator boundary', () => {
  let postgres: StartedPostgreSqlContainer;
  let redis: StartedTestContainer;
  let source: Awaited<ReturnType<typeof createCutoverSource>>;
  let catalog: FakeMusicCatalog;
  const logs = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:17-alpine').start();
    redis = await new GenericContainer('redis:8-alpine')
      .withExposedPorts(6379)
      .start();
    const pool = new Pool({ connectionString: postgres.getConnectionUri() });
    try {
      await migrate(drizzle({ client: pool }), {
        migrationsFolder: fileURLToPath(
          new URL('../../../drizzle', import.meta.url),
        ),
      });
    } finally {
      await pool.end();
    }
    source = await createCutoverSource(postgres.getConnectionUri());
    await source.db.query(
      'truncate track_views, user_favorite_tracks, track_artists, tracks, albums, artists',
    );
    catalog = await startFakeMusicCatalog(() => ({ result: { results: [] } }));
    for (const [key, value] of Object.entries({
      NODE_ENV: 'test',
      DATABASE_URL: postgres.getConnectionUri(),
      LEGACY_DATABASE_URL: source.url,
      REDIS_URL: `redis://127.0.0.1:${redis.getMappedPort(6379)}`,
      MUSIC_CATALOG_URL: catalog.url,
      MUSIC_CATALOG_API_KEY: FAKE_CATALOG_API_KEY,
      S3_ENDPOINT: 'http://127.0.0.1:1',
      S3_PUBLIC_URL: 'http://127.0.0.1:1/test',
      S3_BUCKET: 'test',
      S3_REGION: 'us-east-1',
      S3_ACCESS_KEY_ID: 'test',
      S3_SECRET_ACCESS_KEY: 'test',
    }))
      vi.stubEnv(key, value);
  }, 120_000);

  afterAll(async () => {
    await catalog?.close();
    await source?.close();
    await redis?.stop();
    await postgres?.stop();
    logs.mockRestore();
    vi.unstubAllEnvs();
  });

  const report = () => {
    const json = logs.mock.calls
      .map(([value]) => value)
      .filter(
        (value): value is string =>
          typeof value === 'string' && value.startsWith('{"cutover":true'),
      )
      .at(-1);
    if (!json) throw new Error('Missing operator report');
    const result: unknown = JSON.parse(json);
    return result;
  };

  it('refuses premature continuation then prepares and completes an empty catalog without Processing', async () => {
    expect(await runLegacyCutover(['--legacy-cutover', 'continue'])).toBe(
      false,
    );
    expect(report()).toMatchObject({
      ready: false,
      finished: false,
      errors: ['CUTOVER_NOT_READY'],
    });
    expect(await runLegacyCutover(['--legacy-cutover', 'prepare'])).toBe(true);
    expect(report()).toMatchObject({
      ready: true,
      finished: true,
      source: { users: 2, accounts: 2, practiceDays: 1, tracks: [] },
      recordings: { imported: 0, skipped: 0, pending: 0 },
    });
    expect(await runLegacyCutover(['--legacy-cutover', 'continue'])).toBe(true);
    expect(await runLegacyCutover(['--legacy-cutover', 'status'])).toBe(true);
    expect(report()).toMatchObject({ ready: true, finished: true });
    // A changed independent-data snapshot must invalidate the readiness result.
    await source.db.query(
      'update daily_practice_streaks set listened_seconds = 421',
    );
    expect(await runLegacyCutover(['--legacy-cutover', 'status'])).toBe(true);
    expect(report()).toMatchObject({
      ready: false,
      finished: false,
      source: { errors: ['SOURCE_CHANGED'] },
    });
    await source.db.query(
      'update daily_practice_streaks set listened_seconds = 420',
    );
    expect(await runLegacyCutover(['--legacy-cutover', 'prepare'])).toBe(true);
  }, 30_000);
});
