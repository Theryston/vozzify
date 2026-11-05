import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ClsPluginTransactional } from '@nestjs-cls/transactional';
import { TransactionalAdapterDrizzleOrm } from '@nestjs-cls/transactional-adapter-drizzle-orm';
import { ClsModule } from 'nestjs-cls';
import type { Pool } from 'pg';
import { ENV, type Env } from '../config/env.js';
import {
  createDatabase,
  createPool,
  DATABASE,
  DATABASE_POOL,
} from './database.js';

/**
 * Owns the connection pool. node-postgres connects lazily on the first query,
 * so booting the app (e.g. in e2e tests without a database) opens no
 * connection.
 */
@Global()
@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      inject: [ENV],
      useFactory: (env: Env) => createPool(env.DATABASE_URL),
    },
    {
      provide: DATABASE,
      inject: [DATABASE_POOL],
      useFactory: createDatabase,
    },
  ],
  exports: [DATABASE, DATABASE_POOL],
})
class DatabaseClientModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * Global database access: the Drizzle client under {@link DATABASE} and
 * `TransactionHost` / `@Transactional()` from `@nestjs-cls/transactional`.
 */
@Module({
  imports: [
    DatabaseClientModule,
    ClsModule.forRoot({
      global: true,
      // Every HTTP request gets its own CLS context, which transactions use.
      middleware: { mount: true },
      plugins: [
        new ClsPluginTransactional({
          imports: [DatabaseClientModule],
          adapter: new TransactionalAdapterDrizzleOrm({
            drizzleInstanceToken: DATABASE,
          }),
        }),
      ],
    }),
  ],
})
export class DatabaseModule {}
