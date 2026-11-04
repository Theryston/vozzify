import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Test, type TestingModule } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { inject } from 'vitest';
import { ENV, loadEnv } from '../src/config/env.js';
import { accounts } from '../src/database/schema/auth.js';
import { users } from '../src/database/schema/users.js';
import { LegacyImportModule } from '../src/modules/legacy-import/legacy-import.module.js';
import { LegacyImportService } from '../src/modules/legacy-import/legacy-import.service.js';
import { createAuthClient, signIn } from './utils/auth.js';
import { useAuthSpec } from './utils/auth-spec.js';

// A separate schema in the throwaway e2e Postgres models the frozen source.
const SOURCE_SCHEMA = 'legacy_user_fixture';

describe('legacy User import (e2e)', () => {
  const spec = useAuthSpec({
    env: { GOOGLE_CLIENT_ID: 'google-id', GOOGLE_CLIENT_SECRET: 'secret' },
  });
  const source = new Pool({ connectionString: inject('databaseUrl') });
  let importer: TestingModule;
  let service: LegacyImportService;
  let sourceUrl: string;

  beforeAll(async () => {
    const url = new URL(inject('databaseUrl'));
    url.searchParams.set('options', `-c search_path=${SOURCE_SCHEMA}`);
    sourceUrl = url.toString();
    await promisify(execFile)(process.execPath, [
      fileURLToPath(import.meta.resolve('@nestjs/cli/bin/nest.js')),
      'build',
    ]);
    importer = await Test.createTestingModule({ imports: [LegacyImportModule] })
      .overrideProvider(ENV)
      .useValue({ ...loadEnv(), LEGACY_DATABASE_URL: url.toString() })
      .compile();
    await importer.init();
    service = importer.get(LegacyImportService);
  });

  afterAll(async () => {
    await importer?.close();
    await source.query(`drop schema if exists ${SOURCE_SCHEMA} cascade`);
    await source.end();
  });

  beforeEach(async () => {
    await source.query(`drop schema if exists ${SOURCE_SCHEMA} cascade`);
    await source.query(`create schema ${SOURCE_SCHEMA}`);
    await source.query(`create table ${SOURCE_SCHEMA}.users (
      id text primary key, role text not null default 'USER', name text,
      email text not null unique, username text unique, password text,
      email_verified_at timestamp, image_url text,
      daily_practice_target_seconds integer,
      created_at timestamp not null default '2020-01-02',
      updated_at timestamp not null default '2021-03-04'
    )`);
    await source.query(`create table ${SOURCE_SCHEMA}.accounts (
      user_id text not null references ${SOURCE_SCHEMA}.users(id),
      provider text not null, provider_account_id text not null,
      access_token text, refresh_token text, id_token text, scope text,
      expires_at integer, created_at timestamp not null default '2020-01-02',
      updated_at timestamp not null default '2021-03-04',
      primary key(provider, provider_account_id)
    )`);
  });

  it('imports the original password, signs in and preserves the rehash on replay', async () => {
    const hash = await bcrypt.hash('legacy-password', 4);
    await source.query(
      `insert into ${SOURCE_SCHEMA}.users
        (id, email, username, password, role, email_verified_at, image_url)
       values ('old-user', 'Ada@Example.com', 'Ada', $1, 'ADMIN', now(),
         'https://example.com/avatar.jpg')`,
      [hash],
    );

    expect(await service.run()).toMatchObject({
      status: 'complete',
      importedUsers: 1,
      importedAccounts: 1,
      errors: [],
    });
    const [user] = await spec.testApp.db.select().from(users);
    expect(user).toMatchObject({
      id: 'old-user',
      email: 'ada@example.com',
      username: 'ada',
      name: 'ada',
      role: 'ADMIN',
      emailVerified: true,
      locale: 'pt-BR',
      image: 'https://example.com/avatar.jpg',
      dailyPracticeTargetSeconds: null,
      createdAt: new Date('2020-01-02T00:00:00Z'),
      updatedAt: new Date('2021-03-04T00:00:00Z'),
    });
    expect((await spec.testApp.db.select().from(accounts))[0]?.password).toBe(
      hash,
    );
    await signIn(spec.client, {
      email: 'ada@example.com',
      password: 'legacy-password',
    }).expect(200);
    const [credential] = await spec.testApp.db.select().from(accounts);
    expect(credential?.password).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    await service.run();
    expect((await spec.testApp.db.select().from(accounts))[0]?.password).toBe(
      credential?.password,
    );
    await signIn(createAuthClient(spec.testApp), {
      email: 'ada@example.com',
      password: 'legacy-password',
    }).expect(200);
    expect(
      (await source.query(`select password from ${SOURCE_SCHEMA}.users`))
        .rows[0]?.password,
    ).toBe(hash);
  });
  it('rejects email and Username case collisions before importing anyone', async () => {
    await source.query(`insert into ${SOURCE_SCHEMA}.users
      (id, email, username) values
      ('a', 'Ada@example.com', 'Ada'), ('b', 'ada@example.com', 'ada')`);
    const report = await service.run();
    expect(report.status).toBe('incomplete');
    expect(report.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('EMAIL_CASE_COLLISION'),
        expect.stringContaining('USERNAME_CASE_COLLISION'),
      ]),
    );
    expect(await spec.testApp.db.select().from(users)).toEqual([]);
  });

  it('refuses a nonempty initial destination without deleting anything', async () => {
    await spec.testApp.db.insert(users).values({
      id: 'existing',
      name: 'Existing',
      email: 'existing@example.com',
    });
    expect(await service.run()).toMatchObject({
      status: 'incomplete',
      errors: ['DESTINATION_NOT_EMPTY'],
    });
    expect(
      (await spec.testApp.db.select().from(users)).map((user) => user.id),
    ).toEqual(['existing']);
  });

  it('reports unsupported, missing and malformed required identities as incomplete', async () => {
    await source.query(`insert into ${SOURCE_SCHEMA}.users
      (id, email, password) values
      ('a', 'a@example.com', 'not-a-hash'),
      ('b', 'b@example.com', null), ('c', 'c@example.com', null)`);
    await source.query(`insert into ${SOURCE_SCHEMA}.accounts
      (user_id, provider, provider_account_id) values ('c', 'unknown', 'sub')`);
    const report = await service.run();
    expect(report.status).toBe('incomplete');
    expect(report.errors).toHaveLength(3);
    expect(report.sourceUsers).toBe(3);
    expect(report.sourceAccounts).toBe(2);
    expect(
      report.errors.every((code) =>
        code.startsWith('INVALID_USER_OR_IDENTITY'),
      ),
    ).toBe(true);
    expect(await spec.testApp.db.select().from(users)).toEqual([]);
  });

  it('resumes after an interrupted User transaction and rejects a changed source', async () => {
    await source.query(`insert into ${SOURCE_SCHEMA}.users
      (id, email) values ('a', 'a@example.com'), ('b', 'b@example.com')`);
    await source.query(`insert into ${SOURCE_SCHEMA}.accounts
      (user_id, provider, provider_account_id) values
      ('a', 'google', 'sub-a'), ('b', 'google', 'sub-b')`);
    await source.query(`create function ${SOURCE_SCHEMA}.interrupt_import()
      returns trigger language plpgsql as $$ begin
      if new.user_id = 'b' then raise exception 'simulated interruption'; end if;
      return new; end $$`);
    await source.query(`create trigger interrupt_import before insert on public.accounts
      for each row execute function ${SOURCE_SCHEMA}.interrupt_import()`);
    try {
      expect(await service.run()).toMatchObject({
        status: 'incomplete',
        importedUsers: 1,
        importedAccounts: 1,
        errors: ['USER_IMPORT_FAILED'],
      });
    } finally {
      await source.query('drop trigger interrupt_import on public.accounts');
    }
    expect(await service.run()).toMatchObject({
      status: 'complete',
      importedUsers: 2,
      importedAccounts: 2,
      errors: [],
    });
    expect(await service.run()).toMatchObject({
      status: 'complete',
      importedUsers: 2,
      importedAccounts: 2,
    });
    await source.query(
      `update ${SOURCE_SCHEMA}.users set name = 'Changed' where id = 'a'`,
    );
    expect(await service.run()).toMatchObject({
      status: 'incomplete',
      errors: ['SOURCE_CHANGED'],
    });
    expect(await spec.testApp.db.select().from(users)).toHaveLength(2);
    expect(await spec.testApp.db.select().from(accounts)).toHaveLength(2);
  });

  it('imports Google-only and dual identities with null fields and defaults', async () => {
    const hash = await bcrypt.hash('legacy-password', 4);
    await source.query(
      `insert into ${SOURCE_SCHEMA}.users
      (id, email, password, daily_practice_target_seconds) values
      ('google-only', 'Google@Example.com', null, null),
      ('dual', 'Dual@Example.com', $1, 120)`,
      [hash],
    );
    await source.query(`insert into ${SOURCE_SCHEMA}.accounts
      (user_id, provider, provider_account_id, access_token, expires_at) values
      ('google-only', 'google', 'google-sub', 'old-access-token', 1600000000),
      ('dual', 'google', 'dual-sub', null, null)`);
    expect(await service.run()).toMatchObject({
      status: 'complete',
      importedUsers: 2,
      importedAccounts: 3,
    });
    const imported = await spec.testApp.db.select().from(users);
    expect(imported.find((user) => user.id === 'google-only')).toMatchObject({
      name: 'Google',
      email: 'google@example.com',
      username: null,
      emailVerified: true,
      image: null,
      locale: 'pt-BR',
      timeZone: null,
      showSummarySection: true,
      showPracticeHistorySection: true,
      showFavoritesSection: true,
      dailyPracticeTargetSeconds: null,
    });
    expect(imported.find((user) => user.id === 'dual')).toMatchObject({
      name: 'Dual',
      dailyPracticeTargetSeconds: 120,
    });
    const linked = await spec.testApp.db.select().from(accounts);
    expect(
      linked.find((account) => account.accountId === 'google-sub'),
    ).toMatchObject({
      userId: 'google-only',
      providerId: 'google',
      accessToken: 'old-access-token',
      accessTokenExpiresAt: new Date(1600000000000),
      password: null,
    });
    expect(linked.filter((account) => account.userId === 'dual')).toHaveLength(
      2,
    );
    await signIn(spec.client, {
      email: 'dual@example.com',
      password: 'legacy-password',
    }).expect(200);
  });
  it('runs through the compiled operator command with real Nest metadata', async () => {
    await source.query(`insert into ${SOURCE_SCHEMA}.users
      (id, email) values ('compiled-user', 'compiled@example.com')`);
    await source.query(`insert into ${SOURCE_SCHEMA}.accounts
      (user_id, provider, provider_account_id) values
      ('compiled-user', 'google', 'compiled-sub')`);
    const result = await promisify(execFile)(
      process.execPath,
      ['dist/main.js', '--import-legacy-users'],
      {
        env: {
          DATABASE_URL: inject('databaseUrl'),
          LEGACY_DATABASE_URL: sourceUrl,
        },
      },
    );
    expect(result.stdout).toContain('"status":"complete"');
    expect(result.stdout).toContain('"importedUsers":1');
    expect((await spec.testApp.db.select().from(users))[0]?.id).toBe(
      'compiled-user',
    );
    await source.query(`update ${SOURCE_SCHEMA}.users set name = 'Changed'`);
    await expect(
      promisify(execFile)(
        process.execPath,
        ['dist/main.js', '--import-legacy-users'],
        {
          env: {
            DATABASE_URL: inject('databaseUrl'),
            LEGACY_DATABASE_URL: sourceUrl,
          },
        },
      ),
    ).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining('SOURCE_CHANGED'),
    });
    // Two cold Node/Nest processes run sequentially against real Postgres.
  }, 30_000);

  it('blocks writes attempted while reading the frozen source', async () => {
    await source.query(
      `create table ${SOURCE_SCHEMA}.write_probe (value text)`,
    );
    await source.query(`create function ${SOURCE_SCHEMA}.attempt_write()
      returns text language plpgsql as $$ begin
      insert into ${SOURCE_SCHEMA}.write_probe values ('unexpected');
      return 'Name'; end $$`);
    await source.query(
      `alter table ${SOURCE_SCHEMA}.users rename to original_users`,
    );
    await source.query(`create view ${SOURCE_SCHEMA}.users as
      select id, role, ${SOURCE_SCHEMA}.attempt_write() as name, email,
      username, password, email_verified_at, image_url,
      daily_practice_target_seconds, created_at, updated_at
      from ${SOURCE_SCHEMA}.original_users`);
    await source.query(`insert into ${SOURCE_SCHEMA}.original_users
      (id, email) values ('readonly-user', 'readonly@example.com')`);
    expect(await service.run()).toMatchObject({
      status: 'incomplete',
      errors: ['USER_IMPORT_FAILED'],
    });
    expect(
      (await source.query(`select * from ${SOURCE_SCHEMA}.write_probe`)).rows,
    ).toEqual([]);
    expect(await spec.testApp.db.select().from(users)).toEqual([]);
  });

  it('reports a lost source connection instead of hanging during cleanup', async () => {
    await source.query(
      `alter table ${SOURCE_SCHEMA}.users rename to original_users`,
    );
    await source.query(`create view ${SOURCE_SCHEMA}.users as
      select id, role, pg_terminate_backend(pg_backend_pid())::text as name,
      email, username, password, email_verified_at, image_url,
      daily_practice_target_seconds, created_at, updated_at
      from ${SOURCE_SCHEMA}.original_users`);
    await source.query(`insert into ${SOURCE_SCHEMA}.original_users
      (id, email) values ('lost-connection', 'lost@example.com')`);
    expect(await service.run()).toMatchObject({
      status: 'incomplete',
      errors: ['USER_IMPORT_FAILED'],
    });
    expect(await spec.testApp.db.select().from(users)).toEqual([]);
  });

  it('signs in with the imported Google identity without creating another User', async () => {
    await source.query(`insert into ${SOURCE_SCHEMA}.users
      (id, email, username) values ('google-user', 'google@example.com', 'google_user')`);
    await source.query(`insert into ${SOURCE_SCHEMA}.accounts
      (user_id, provider, provider_account_id) values
      ('google-user', 'google', 'imported-sub')`);
    expect((await service.run()).status).toBe('complete');
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    const token = [
      encode({ alg: 'RS256', typ: 'JWT' }),
      encode({
        sub: 'imported-sub',
        name: 'Google User',
        email: 'google@example.com',
        email_verified: true,
      }),
      'signature',
    ].join('.');
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url !== 'https://oauth2.googleapis.com/token')
        return realFetch(input, init);
      return Promise.resolve(
        Response.json({
          access_token: 'new-google-token',
          id_token: token,
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'openid email profile',
        }),
      );
    });
    try {
      const start = await spec.client
        .post('/v1/auth/sign-in/social')
        .send({ provider: 'google', callbackURL: 'http://localhost:3000/en' })
        .expect(200);
      const state = new URL(start.body.url).searchParams.get('state');
      await spec.client
        .get('/v1/auth/callback/google')
        .query({ code: 'google-code', state })
        .expect(302);
      const me = await spec.client.get('/v1/me').expect(200);
      expect(me.body.id).toBe('google-user');
      expect(await spec.testApp.db.select().from(users)).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
