import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import { ENV, type LegacyImportEnv } from '../../config/env.js';
import { type LegacyUser, legacyUserSchema } from './legacy-user.js';

const PAGE_SIZE = 200;

// Explicit projections keep sessions and short-lived verification codes out.
const USER_QUERY = `select u.id, u.role, u.name, u.email, u.username, u.password,
  u.email_verified_at at time zone 'UTC' as "emailVerifiedAt", u.image_url as image,
  u.daily_practice_target_seconds as "dailyPracticeTargetSeconds",
  u.created_at at time zone 'UTC' as "createdAt",
  u.updated_at at time zone 'UTC' as "updatedAt",
  coalesce((select json_agg(a order by a.provider, a."accountId") from (
    select provider, provider_account_id as "accountId",
      access_token as "accessToken", refresh_token as "refreshToken",
      id_token as "idToken", scope, expires_at as "expiresAt",
      created_at at time zone 'UTC' as "createdAt",
      updated_at at time zone 'UTC' as "updatedAt"
    from accounts where user_id = u.id
  ) a), '[]'::json) as accounts
  from users u where ($1::text is null or u.id collate "C" > $1 collate "C")
  order by u.id collate "C" limit $2`;

export type SourceValidation = {
  digest: string;
  users: number;
  accounts: number;
  errors: string[];
};

export class LegacySourceSnapshot {
  constructor(private readonly client: PoolClient) {}

  async page(cursor: string | null): Promise<LegacyUser[]> {
    const result = await this.client.query(USER_QUERY, [cursor, PAGE_SIZE]);
    return result.rows.map((row: unknown) => legacyUserSchema.parse(row));
  }

  async validate(): Promise<SourceValidation> {
    const hash = createHash('sha256');
    const errors = await this.conflicts();
    let cursor: string | null = null;
    let users = 0;
    const totals = await this.client.query<{ accounts: number }>(`
      select ((select count(*) from accounts) +
        (select count(*) from users where password is not null))::int as accounts
    `);
    const accounts = totals.rows[0]?.accounts ?? 0;
    for (;;) {
      const result = await this.client.query(USER_QUERY, [cursor, PAGE_SIZE]);
      if (result.rows.length === 0) break;
      for (const row of result.rows) {
        hash.update(JSON.stringify(row));
        const parsed = legacyUserSchema.safeParse(row);
        if (!parsed.success) {
          if (errors.length < 100)
            errors.push(`INVALID_USER_OR_IDENTITY:${sourceCursor(row)}`);
        }
        users++;
      }
      cursor = sourceCursor(result.rows.at(-1));
    }
    return { digest: hash.digest('hex'), users, accounts, errors };
  }

  private async conflicts(): Promise<string[]> {
    const result = await this.client.query<{ code: string }>(`
      select 'EMAIL_CASE_COLLISION:' || string_agg(id, ',' order by id) as code from users
      group by lower(email) having count(*) > 1
      union all
      select 'USERNAME_CASE_COLLISION:' || string_agg(id, ',' order by id) from users where username is not null
      group by lower(username) having count(*) > 1
      union all
      select 'ORPHAN_IDENTITY:' || a.user_id from accounts a
      where not exists (select 1 from users u where u.id = a.user_id)
      limit 100
    `);
    return result.rows.map((row) => row.code);
  }
}

const sourceCursor = (row: unknown): string => {
  if (
    typeof row !== 'object' ||
    row === null ||
    !('id' in row) ||
    typeof row.id !== 'string'
  ) {
    throw new Error('INVALID_SOURCE_CURSOR');
  }
  return row.id;
};

@Injectable()
export class LegacySourceRepository {
  constructor(@Inject(ENV) private readonly env: LegacyImportEnv) {}

  async snapshot<T>(
    read: (source: LegacySourceSnapshot) => Promise<T>,
  ): Promise<T> {
    if (!this.env.LEGACY_DATABASE_URL)
      throw new Error('LEGACY_DATABASE_URL_REQUIRED');
    const pool = new Pool({
      connectionString: this.env.LEGACY_DATABASE_URL,
      options: '-c default_transaction_read_only=on -c timezone=UTC',
      max: 1,
    });
    try {
      const client = await pool.connect();
      let disconnected = false;
      // pg removes the pool's idle error listener while a client is checked out.
      // A server disconnect also emits an event after rejecting its query.
      client.on('error', () => {
        disconnected = true;
      });
      try {
        await client.query('begin isolation level repeatable read read only');
        const result = await read(new LegacySourceSnapshot(client));
        if (disconnected) throw new Error('SOURCE_DISCONNECTED');
        return result;
      } finally {
        try {
          await client.query('rollback');
        } finally {
          client.release(true);
        }
      }
    } finally {
      await pool.end();
    }
  }
}
