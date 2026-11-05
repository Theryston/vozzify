import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import request from 'supertest';
import { inject } from 'vitest';
import { dailyPracticeStreaks } from '../src/database/schema/daily-practice-streaks.js';
import {
  benefits,
  planBenefits,
  planPrices,
  plans,
} from '../src/database/schema/plans.js';
import { users } from '../src/database/schema/users.js';
import { createAuthClient, signIn } from './utils/auth.js';
import { useAuthSpec } from './utils/auth-spec.js';
import {
  createCredentialAccount,
  createUser,
  DEFAULT_PASSWORD,
} from './utils/factories.js';

const SOURCE_SCHEMA = 'legacy_personal_fixture';

describe('legacy personal-data import (e2e)', () => {
  const spec = useAuthSpec();
  const source = new Pool({ connectionString: inject('databaseUrl') });
  let sourceUrl: string;

  beforeAll(async () => {
    const url = new URL(inject('databaseUrl'));
    url.searchParams.set('options', `-c search_path=${SOURCE_SCHEMA}`);
    sourceUrl = url.toString();
    await promisify(execFile)(process.execPath, [
      fileURLToPath(import.meta.resolve('@nestjs/cli/bin/nest.js')),
      'build',
    ]);
  });

  afterAll(async () => {
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
    await source.query(`create table ${SOURCE_SCHEMA}.daily_practice_streaks (
      id text primary key, user_id text not null references ${SOURCE_SCHEMA}.users(id),
      day date not null, listened_seconds integer not null default 0,
      is_completed boolean not null default false, completed_at timestamp,
      last_heartbeat_at timestamp,
      created_at timestamp not null, updated_at timestamp not null
    )`);
    await source.query(`create table ${SOURCE_SCHEMA}.user_section_visibilities (
      id text primary key, user_id text not null references ${SOURCE_SCHEMA}.users(id),
      key text not null, value text not null,
      created_at timestamp not null, updated_at timestamp not null
    )`);
  });

  it('imports UTC practice days and private sections and preserves the raw Daily target on replay', async () => {
    await spec.testApp.db.insert(plans).values({
      id: 'reference-pro',
      kind: 'paid',
      copy: {
        en: { name: 'Pro', description: 'Support singing.' },
        'pt-BR': { name: 'Pro', description: 'Apoie o canto.' },
      },
      published: true,
    });
    await spec.testApp.db.insert(benefits).values({
      id: 'reference-benefit',
      copy: {
        en: { name: 'Catalog', description: 'Catalog access.' },
        'pt-BR': { name: 'Catálogo', description: 'Acesso ao catálogo.' },
      },
      status: 'available',
    });
    await spec.testApp.db.insert(planBenefits).values({
      id: 'reference-plan-benefit',
      planId: 'reference-pro',
      benefitId: 'reference-benefit',
      position: 0,
    });
    await spec.testApp.db.insert(planPrices).values({
      id: 'reference-price',
      planId: 'reference-pro',
      cycle: 'monthly',
      currency: 'BRL',
      amount: 1990,
    });
    const referenceRows = {
      plans: await spec.testApp.db.select().from(plans),
      benefits: await spec.testApp.db.select().from(benefits),
      planBenefits: await spec.testApp.db.select().from(planBenefits),
      planPrices: await spec.testApp.db.select().from(planPrices),
    };
    const password = 'legacy-password';
    const hash = await bcrypt.hash(password, 4);
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000)
      .toISOString()
      .slice(0, 10);
    await source.query(
      `insert into ${SOURCE_SCHEMA}.users
      (id, email, username, password, email_verified_at, daily_practice_target_seconds)
      values ('legacy-ada', 'ada@example.com', 'ada', $1, now(), 420)`,
      [hash],
    );
    await source.query(
      `insert into ${SOURCE_SCHEMA}.daily_practice_streaks
      (id, user_id, day, listened_seconds, is_completed, completed_at,
       last_heartbeat_at, created_at, updated_at) values
      ('complete-day', 'legacy-ada', $1::date, 420, true,
       $1::date, $1::date, $1::date, $1::date),
      ('incomplete-day', 'legacy-ada', $2::date, 30, false,
       null, $2::date, $2::date, $2::date)`,
      [today, yesterday],
    );
    await source.query(`insert into ${SOURCE_SCHEMA}.user_section_visibilities
      (id, user_id, key, value, created_at, updated_at) values
      ('private-favorites', 'legacy-ada', 'FAVORITE_TRACKS', 'ME_ONLY', now(), now()),
      ('public-favorites', 'legacy-ada', 'FAVORITE_TRACKS', 'PUBLIC', now(), now())`);

    await source.query(`create function public.interrupt_personal_import()
      returns trigger language plpgsql as $$ begin
      if new.id = 'incomplete-day' then raise exception 'simulated interruption'; end if;
      return new; end $$`);
    await source.query(`create trigger interrupt_personal_import
      before insert on public.daily_practice_streaks
      for each row execute function public.interrupt_personal_import()`);

    await expect(
      promisify(execFile)(
        process.execPath,
        ['dist/main.js', '--import-legacy-personal-data'],
        {
          env: {
            NODE_ENV: 'test',
            DATABASE_URL: inject('databaseUrl'),
            LEGACY_DATABASE_URL: sourceUrl,
          },
        },
      ),
    ).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining('PERSONAL_IMPORT_FAILED'),
    });
    await source.query(
      'drop trigger interrupt_personal_import on public.daily_practice_streaks',
    );
    await source.query('drop function public.interrupt_personal_import()');
    const firstImport = await spec.testApp.db
      .select()
      .from(dailyPracticeStreaks);
    expect(firstImport).toHaveLength(1);

    const result = await promisify(execFile)(
      process.execPath,
      ['dist/main.js', '--import-legacy-personal-data'],
      {
        env: {
          NODE_ENV: 'test',
          DATABASE_URL: inject('databaseUrl'),
          LEGACY_DATABASE_URL: sourceUrl,
        },
      },
    );
    expect(result.stdout).toContain('"status":"complete"');

    const [imported] = await spec.testApp.db.select().from(users);
    expect(imported).toMatchObject({
      id: 'legacy-ada',
      dailyPracticeTargetSeconds: 420,
      showFavoritesSection: false,
      updatedAt: new Date('2021-03-04T00:00:00Z'),
    });
    const owner = createAuthClient(spec.testApp);
    await signIn(owner, { email: 'ada@example.com', password }).expect(200);
    await owner.get('/v1/users/ada/favorites').expect(200);
    await owner
      .get('/v1/me/profile-visibility')
      .expect(200)
      .expect(({ body }) => {
        expect(body.favorites).toBe(false);
      });
    const streak = await owner.get('/v1/me/streak?timeZone=UTC').expect(200);
    expect(streak.body.targetSeconds).toBe(300);
    expect(streak.body.completedToday).toBe(true);
    expect(streak.body.currentStreakDays).toBe(1);
    expect(await spec.testApp.db.select().from(dailyPracticeStreaks)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'complete-day',
          day: today,
          listenedSeconds: 420,
          completed: true,
          completedAt: new Date(`${today}T00:00:00Z`),
          createdAt: new Date(`${today}T00:00:00Z`),
          updatedAt: new Date(`${today}T00:00:00Z`),
        }),
        expect.objectContaining({
          id: 'incomplete-day',
          day: yesterday,
          listenedSeconds: 30,
          completed: false,
          completedAt: null,
          lastHeartbeatAt: new Date(`${yesterday}T00:00:00Z`),
        }),
      ]),
    );
    await request(spec.testApp.app.getHttpServer())
      .get('/v1/users/ada/favorites')
      .expect(404);
    const viewer = await createUser(spec.testApp.db, {
      username: 'viewer',
      email: 'viewer@example.com',
    });
    await createCredentialAccount(spec.testApp.db, viewer);
    const visitor = createAuthClient(spec.testApp);
    await signIn(visitor, {
      email: viewer.email,
      password: DEFAULT_PASSWORD,
    }).expect(200);
    await visitor.get('/v1/users/ada/favorites').expect(404);
    await request(spec.testApp.app.getHttpServer())
      .get('/v1/users/ada/summary')
      .expect(200)
      .expect(({ body }) => {
        expect(body.streakDays).toBe(1);
      });

    expect(
      await spec.testApp.db.select().from(dailyPracticeStreaks),
    ).toHaveLength(2);
    await spec.testApp.db
      .update(users)
      .set({ showFavoritesSection: true })
      .where(eq(users.id, 'legacy-ada'));
    await spec.testApp.db
      .update(dailyPracticeStreaks)
      .set({ listenedSeconds: 999 })
      .where(eq(dailyPracticeStreaks.id, 'complete-day'));
    const replay = await promisify(execFile)(
      process.execPath,
      ['dist/main.js', '--import-legacy-personal-data'],
      {
        env: {
          NODE_ENV: 'test',
          DATABASE_URL: inject('databaseUrl'),
          LEGACY_DATABASE_URL: sourceUrl,
        },
      },
    );
    expect(replay.stdout).toContain('"status":"complete"');
    expect({
      plans: await spec.testApp.db.select().from(plans),
      benefits: await spec.testApp.db.select().from(benefits),
      planBenefits: await spec.testApp.db.select().from(planBenefits),
      planPrices: await spec.testApp.db.select().from(planPrices),
    }).toEqual(referenceRows);
    const [replayedUser] = await spec.testApp.db
      .select()
      .from(users)
      .where(eq(users.id, 'legacy-ada'));
    expect(replayedUser).toMatchObject({
      dailyPracticeTargetSeconds: 420,
      showFavoritesSection: true,
    });
    const [changedDay] = await spec.testApp.db
      .select({ listenedSeconds: dailyPracticeStreaks.listenedSeconds })
      .from(dailyPracticeStreaks)
      .where(eq(dailyPracticeStreaks.id, 'complete-day'));
    expect(changedDay?.listenedSeconds).toBe(999);
  }, 30_000);
});
