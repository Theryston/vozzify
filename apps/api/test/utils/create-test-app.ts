import type { INestApplication, Type } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { ENV, type Env, loadEnv } from '../../src/config/env.js';
import { DATABASE, type Database } from '../../src/database/database.js';
import { configureApp } from '../../src/setup-app.js';
import {
  type FakeQueue,
  overrideRedisProviders,
} from '../redis-test-overrides.js';

export type CreateTestAppOptions = {
  /** Extra controllers mounted next to AppModule (e.g. test-only probes). */
  controllers?: Type[];
  imports?: Type[];
  /** Values merged over the parsed env (e.g. a lower rate limit). */
  env?: Partial<Env>;
  /**
   * Further provider overrides, applied after the Redis ones (so they win),
   * e.g. mocked integration services.
   */
  override?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
};

export type TestApp = {
  app: INestApplication<App>;
  /** Supertest agent bound to the app (keeps cookies between requests). */
  http: ReturnType<typeof request.agent>;
  /** The app's own Drizzle client, on the e2e database. */
  db: Database;
  /** Fake BullMQ queues keyed by queue name, to assert enqueued jobs. */
  queues: Record<string, FakeQueue>;
  close: () => Promise<void>;
};

/**
 * Boots the real AppModule for e2e specs: Redis-backed providers replaced
 * (see redis-test-overrides.ts), the database from the global setup, and the
 * same global HTTP setup as `main.ts`.
 */
export const createTestApp = async (
  options: CreateTestAppOptions = {},
): Promise<TestApp> => {
  const { builder: redisFree, queues } = overrideRedisProviders(
    Test.createTestingModule({
      imports: [AppModule, ...(options.imports ?? [])],
      controllers: options.controllers ?? [],
    }),
  );
  let builder = redisFree;
  if (options.env) {
    builder = builder
      .overrideProvider(ENV)
      .useValue({ ...loadEnv(), ...options.env });
  }
  if (options.override) {
    builder = options.override(builder);
  }
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication<INestApplication<App>>();
  configureApp(app);
  await app.init();

  return {
    app,
    http: request.agent(app.getHttpServer()),
    db: app.get<Database>(DATABASE),
    queues,
    close: () => app.close(),
  };
};
