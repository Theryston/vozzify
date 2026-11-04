import { Inject, Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { eq, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import {
  DATABASE_POOL,
  type DatabaseAdapter,
} from '../../database/database.js';
import { accounts } from '../../database/schema/auth.js';
import { legacyUserImports } from '../../database/schema/legacy-user-imports.js';
import { users } from '../../database/schema/users.js';
import {
  importedAccountValues,
  importedUserValues,
  type LegacyUser,
} from './legacy-user.js';

const IMPORT_ID = 'legacy-users-v1';

@Injectable()
export class LegacyImportRepository {
  constructor(
    private readonly txHost: TransactionHost<DatabaseAdapter>,
    @Inject(DATABASE_POOL) private readonly pool: Pool,
  ) {}

  private get db() {
    return this.txHost.tx;
  }

  async locked<T>(run: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      const result = await client.query<{ locked: boolean }>(
        'select pg_try_advisory_lock(456, 1) as locked',
      );
      if (!result.rows[0]?.locked) throw new Error('IMPORT_ALREADY_RUNNING');
      try {
        return await run();
      } finally {
        await client.query('select pg_advisory_unlock(456, 1)');
      }
    } finally {
      client.release();
    }
  }

  async resume() {
    const [progress] = await this.db
      .update(legacyUserImports)
      .set({
        status: 'incomplete',
        updatedAt: new Date(),
      })
      .where(eq(legacyUserImports.id, IMPORT_ID))
      .returning();
    return progress;
  }

  async prepare(sourceDigest: string) {
    const [existing] = await this.db
      .select()
      .from(legacyUserImports)
      .where(eq(legacyUserImports.id, IMPORT_ID));
    if (existing) {
      if (existing.sourceDigest !== sourceDigest)
        throw new Error('SOURCE_CHANGED');
      return existing;
    }
    await this.assertEmpty();
    const [created] = await this.db
      .insert(legacyUserImports)
      .values({ id: IMPORT_ID, sourceDigest })
      .returning();
    if (!created) throw new Error('IMPORT_PROGRESS_NOT_CREATED');
    return created;
  }

  private async assertEmpty(): Promise<void> {
    const tables = await this.db.execute<{ table_name: string }>(sql`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
        and table_name <> '__drizzle_migrations'
    `);
    for (const { table_name: table } of tables.rows) {
      const found = await this.db.execute(sql`
        select 1 from ${sql.identifier(table)} limit 1
      `);
      if (found.rows.length > 0) throw new Error('DESTINATION_NOT_EMPTY');
    }
  }

  async importUser(user: LegacyUser): Promise<void> {
    const identities = importedAccountValues(user);
    await this.db.insert(users).values(importedUserValues(user));
    await this.db.insert(accounts).values(identities);
    await this.db
      .update(legacyUserImports)
      .set({
        lastUserId: user.id,
        importedUsers: sql`${legacyUserImports.importedUsers} + 1`,
        importedAccounts: sql`${legacyUserImports.importedAccounts} + ${identities.length}`,
        status: 'incomplete',
        updatedAt: new Date(),
      })
      .where(eq(legacyUserImports.id, IMPORT_ID));
  }

  async complete(): Promise<void> {
    await this.db
      .update(legacyUserImports)
      .set({
        status: 'complete',
        updatedAt: new Date(),
      })
      .where(eq(legacyUserImports.id, IMPORT_ID));
  }
}
