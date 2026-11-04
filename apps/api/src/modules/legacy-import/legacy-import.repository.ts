import { Inject, Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { eq, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import {
  DATABASE_POOL,
  type DatabaseAdapter,
} from '../../database/database.js';
import { accounts } from '../../database/schema/auth.js';
import { dailyPracticeStreaks } from '../../database/schema/daily-practice-streaks.js';
import { legacyPersonalImports } from '../../database/schema/legacy-personal-imports.js';
import { legacyUserImports } from '../../database/schema/legacy-user-imports.js';
import { users } from '../../database/schema/users.js';
import {
  importedPracticeDayValues,
  type LegacyPracticeDay,
} from './legacy-personal.js';
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
    // Fresh migrations seed read-only plan catalog reference rows; they are
    // never modified by this import and do not represent application data.
    const tables = await this.db.execute<{ table_name: string }>(sql`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
        and table_name <> '__drizzle_migrations'
        and table_name not in ('benefits', 'plan_benefits', 'plan_prices', 'plans')
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

  async personalProgress(sourceDigest: string) {
    const [progress] = await this.db
      .select()
      .from(legacyPersonalImports)
      .where(eq(legacyPersonalImports.id, 'legacy-personal-v1'));
    if (progress) {
      if (progress.sourceDigest !== sourceDigest)
        throw new Error('PERSONAL_SOURCE_CHANGED');
      return progress;
    }
    const [created] = await this.db
      .insert(legacyPersonalImports)
      .values({
        id: 'legacy-personal-v1',
        sourceDigest,
      })
      .returning();
    if (!created) throw new Error('PERSONAL_PROGRESS_NOT_CREATED');
    return created;
  }

  async importPracticeDay(day: LegacyPracticeDay): Promise<void> {
    await this.db
      .insert(dailyPracticeStreaks)
      .values(importedPracticeDayValues(day))
      .onConflictDoNothing({
        target: [dailyPracticeStreaks.userId, dailyPracticeStreaks.day],
      });
    await this.db
      .update(legacyPersonalImports)
      .set({
        lastPracticeId: day.id,
        importedPracticeDays: sql`${legacyPersonalImports.importedPracticeDays} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(legacyPersonalImports.id, 'legacy-personal-v1'));
  }

  async updateLegacyVisibility(
    userId: string,
    values: {
      showSummarySection?: boolean;
      showPracticeHistorySection?: boolean;
      showFavoritesSection?: boolean;
    },
  ): Promise<void> {
    const [user] = await this.db
      .select({ updatedAt: users.updatedAt })
      .from(users)
      .where(eq(users.id, userId));
    if (!user) return;
    await this.db
      .update(users)
      .set({ ...values, updatedAt: user.updatedAt })
      .where(eq(users.id, userId));
  }

  async completePersonal(): Promise<void> {
    await this.db
      .update(legacyPersonalImports)
      .set({ status: 'complete', updatedAt: new Date() })
      .where(eq(legacyPersonalImports.id, 'legacy-personal-v1'));
  }
}
