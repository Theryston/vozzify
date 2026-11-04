import type { Type } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { overrideRedisProviders } from '../../../test/redis-test-overrides.js';
import { AppModule } from '../../app.module.js';
import { ENV, parseEnv } from '../../config/env.js';
import { DATABASE, DATABASE_POOL } from '../../database/database.js';
import { TrackMigrationModule } from '../tracks/track-migration.module.js';
import { TrackMigrationService } from '../tracks/track-migration.service.js';
import { LegacyProcessingBacklogModule } from './legacy-processing-backlog.module.js';
import { LegacyProcessingBacklogService } from './legacy-processing-backlog.service.js';

const env = parseEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test',
  REDIS_URL: 'redis://127.0.0.1:1',
  S3_REGION: 'test-region',
  S3_BUCKET: 'test-bucket',
  S3_ACCESS_KEY_ID: 'test-access-key',
  S3_SECRET_ACCESS_KEY: 'test-secret-key',
  S3_PUBLIC_URL: 'http://127.0.0.1/test-bucket',
});

const database = {
  transaction: async (run: (client: unknown) => unknown) => run({}),
};
const pool = { end: async () => undefined };

const compileWithOperatorProviders = async (imports: Type<unknown>[]) => {
  const { builder } = overrideRedisProviders(
    Test.createTestingModule({ imports }),
  );
  return builder
    .overrideProvider(ENV)
    .useValue(env)
    .overrideProvider(DATABASE)
    .useValue(database)
    .overrideProvider(DATABASE_POOL)
    .useValue(pool)
    .compile();
};

describe('LegacyProcessingBacklogModule', () => {
  it('uses the worker-free migration module for operator enqueueing', () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      LegacyProcessingBacklogModule,
    );
    const providers: unknown[] =
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, TrackMigrationModule) ??
      [];
    const providerNames = providers.map((provider) =>
      typeof provider === 'function' ? provider.name : '',
    );

    expect(imports).toContain(TrackMigrationModule);
    expect(providerNames).not.toContain('TrackProcessingProcessor');
    expect(providerNames).not.toContain('TrackMp3Processor');
  });

  it('boots in both the full API and standalone operator contexts', async () => {
    const api = await compileWithOperatorProviders([AppModule]);
    try {
      expect(api.get(TrackMigrationService)).toBeDefined();
    } finally {
      await api.close();
    }

    const operator = await compileWithOperatorProviders([
      LegacyProcessingBacklogModule,
    ]);
    try {
      expect(operator.get(LegacyProcessingBacklogService)).toBeDefined();
      expect(operator.get(TrackMigrationService)).toBeDefined();
    } finally {
      await operator.close();
    }
  });
});
