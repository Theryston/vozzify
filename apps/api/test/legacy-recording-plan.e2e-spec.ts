import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { type Recording, recordingSchema } from '@vozzify/contracts';
import { Pool } from 'pg';
import { inject } from 'vitest';
import { legacyRecordingPlans } from '../src/database/schema/legacy-recording-plans.js';
import { runLegacyRecordingPlan } from '../src/modules/legacy-import/legacy-import-command.js';
import { connectTestDatabase, resetDatabase } from './utils/database.js';
import { testMbid } from './utils/factories.js';
import {
  FAKE_CATALOG_API_KEY,
  type FakeMusicCatalog,
  startFakeMusicCatalog,
} from './utils/fake-music-catalog.js';
import { recordingFixture } from './utils/recording-fixtures.js';

const SOURCE_SCHEMA = 'legacy_recording_plan_fixture';
const ARTIST_MBID = testMbid(200);
const MATCHES = new Map<string, Recording>();
const SEARCH_MBIDS = new Map<string, string[]>();
let source: Pool;

describe('legacy recording plan command (e2e)', () => {
  const destination = connectTestDatabase();
  let catalog: FakeMusicCatalog;
  let sourceUrl: string;
  let catalogOutage = false;
  let queryCount = 0;

  beforeAll(async () => {
    await promisify(execFile)(process.execPath, [
      fileURLToPath(import.meta.resolve('@nestjs/cli/bin/nest.js')),
      'build',
    ]);
    source = new Pool({ connectionString: inject('databaseUrl') });
    catalog = await startFakeMusicCatalog((payload) => {
      if ('query' in payload) {
        queryCount++;
        if (catalogOutage) {
          return {
            error: { code: 'CATALOG_NOT_READY', message: 'Not ready' },
          };
        }
        const ids = SEARCH_MBIDS.get(String(payload.query)) ?? [];
        return {
          result: {
            results: ids.map((mbid) => {
              const recording = MATCHES.get(mbid);
              return {
                mbid,
                title: recording?.title ?? '',
                artistCredit: recording?.artistCredit.name ?? '',
                coverUrl: null,
                trackId: null,
              };
            }),
          },
        };
      }
      const requested = String(payload.mbid);
      const moved = new Map([[testMbid(50), testMbid(51)]]).get(requested);
      if (moved !== undefined) {
        return {
          error: {
            code: 'RECORDING_MOVED',
            message: 'Recording was merged',
            newMbid: moved,
          },
        };
      }
      const recording = MATCHES.get(requested);
      return recording === undefined
        ? { error: { code: 'RECORDING_NOT_FOUND', message: 'Not found' } }
        : { result: recording };
    });
    const url = new URL(inject('databaseUrl'));
    url.searchParams.set('options', `-c search_path=${SOURCE_SCHEMA}`);
    sourceUrl = url.toString();
    vi.stubEnv('LEGACY_DATABASE_URL', sourceUrl);
    vi.stubEnv('MUSIC_CATALOG_URL', catalog.url);
    vi.stubEnv('MUSIC_CATALOG_API_KEY', FAKE_CATALOG_API_KEY);
    vi.stubEnv('MUSIC_CATALOG_REQUEST_TIMEOUT_MS', '1000');
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await source.query(`drop schema if exists ${SOURCE_SCHEMA} cascade`);
    await source.end();
    await destination.close();
    await catalog.close();
  });

  beforeEach(async () => {
    await resetDatabase(destination.db);
    await source.query(`drop schema if exists ${SOURCE_SCHEMA} cascade`);
    await source.query(`create schema ${SOURCE_SCHEMA}`);
    await createLegacyTables();
    MATCHES.clear();
    SEARCH_MBIDS.clear();
    catalogOutage = false;
    queryCount = 0;
    await seedCatalog();
    await seedLegacyTracks();
  });

  it('plans acceptable, merged and duplicate Recordings once and reports durable skips', async () => {
    expect(await runLegacyRecordingPlan()).toBe(true);
    const plans = await destination.db.select().from(legacyRecordingPlans);
    expect(plans).toHaveLength(8);
    expect(plans.filter((plan) => plan.status === 'planned')).toHaveLength(6);
    expect(
      plans
        .filter((plan) => plan.status === 'skipped')
        .sort((left, right) =>
          left.legacyTrackId.localeCompare(right.legacyTrackId),
        ),
    ).toMatchObject([
      {
        legacyTrackId: 'acoustic',
        skipReason: 'NO_ACCEPTABLE_RECORDING',
      },
      {
        legacyTrackId: 'ghost',
        skipReason: 'NO_ACCEPTABLE_RECORDING',
      },
    ]);
    expect(
      plans.find((plan) => plan.legacyTrackId === 'live')?.recordingMbid,
    ).toBe(testMbid(53));
    expect(
      plans.find((plan) => plan.legacyTrackId === 'merged')?.recordingMbid,
    ).toBe(testMbid(51));
    expect(
      plans
        .filter((plan) => plan.initialContributor)
        .map((plan) => plan.legacyTrackId)
        .sort(),
    ).toEqual(['z-dup-earliest', 'tie-a', 'live', 'merged'].sort());
    expect(
      plans.find((plan) => plan.legacyTrackId === 'acoustic')?.source,
    ).toMatchObject({
      dependentFavorites: 2,
      dependentViews: 3,
    });
    const previousQueryCount = queryCount;

    expect(await runLegacyRecordingPlan()).toBe(true);
    expect(queryCount).toBe(previousQueryCount);
    expect(
      await destination.db.select().from(legacyRecordingPlans),
    ).toHaveLength(8);
  });

  it('leaves a catalog outage incomplete and resumes without saving a skip', async () => {
    catalogOutage = true;

    expect(await runLegacyRecordingPlan()).toBe(false);
    expect(await destination.db.select().from(legacyRecordingPlans)).toEqual(
      [],
    );

    catalogOutage = false;
    expect(await runLegacyRecordingPlan()).toBe(true);
    expect(
      await destination.db.select().from(legacyRecordingPlans),
    ).toHaveLength(8);
  });

  it('rejects a changed frozen Track inventory after the completed plan', async () => {
    expect(await runLegacyRecordingPlan()).toBe(true);
    await source.query(
      `update ${SOURCE_SCHEMA}.tracks set title = 'Changed' where id = 'ghost'`,
    );

    expect(await runLegacyRecordingPlan()).toBe(false);
  });
});

const createLegacyTables = async (): Promise<void> => {
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
    id text primary key, user_id text not null, day date not null,
    listened_seconds integer not null default 0, is_completed boolean not null default false,
    completed_at timestamp, last_heartbeat_at timestamp,
    created_at timestamp not null default '2020-01-02',
    updated_at timestamp not null default '2021-03-04'
  )`);
  await source.query(`create table ${SOURCE_SCHEMA}.user_section_visibilities (
    id text primary key, user_id text not null, key text not null, value text not null,
    created_at timestamp not null default '2020-01-02',
    updated_at timestamp not null default '2021-03-04'
  )`);
  await source.query(`create table ${SOURCE_SCHEMA}.albums (
    id text primary key, name text not null, yt_id text not null
  )`);
  await source.query(`create table ${SOURCE_SCHEMA}.artists (
    id text primary key, name text not null, yt_id text not null
  )`);
  await source.query(`create table ${SOURCE_SCHEMA}.tracks (
    id text primary key, yt_id text, title text, duration text,
    duration_seconds integer, album_id text, creator_id text not null,
    created_at timestamp not null, updated_at timestamp not null
  )`);
  await source.query(`create table ${SOURCE_SCHEMA}.track_artists (
    id text primary key, artist_id text not null, track_id text not null
  )`);
  await source.query(`create table ${SOURCE_SCHEMA}.user_favorite_tracks (
    id text primary key, user_id text not null, track_id text not null
  )`);
  await source.query(`create table ${SOURCE_SCHEMA}.track_views (
    id text primary key, track_id text not null, user_id text,
    created_at timestamp not null default now()
  )`);
};

const seedCatalog = async (): Promise<void> => {
  const match = (
    mbid: string,
    title: string,
    overrides: Partial<Recording> = {},
  ): void => {
    const recording = recordingSchema.parse(
      recordingFixture({
        mbid,
        title,
        lengthMs: 180_000,
        disambiguation: '',
        artistCredit: {
          name: 'Example Artist',
          artists: [
            {
              mbid: ARTIST_MBID,
              name: 'Example Artist',
              creditedName: 'Example Artist',
              joinPhrase: '',
            },
          ],
        },
        ...overrides,
      }),
    );
    MATCHES.set(mbid, recording);
  };
  const addSearch = (query: string, ...mbids: string[]): void => {
    SEARCH_MBIDS.set(query, mbids);
  };
  match(testMbid(52), 'Duplicate');
  match(testMbid(54), 'Tie');
  match(testMbid(53), 'Song');
  match(testMbid(50), 'Merged');
  match(testMbid(51), 'Merged');
  match(testMbid(55), 'Ghost');
  match(testMbid(56), 'Acoustic track (Acoustic)', {
    disambiguation: 'acoustic version',
  });
  addSearch('Duplicate Example Artist', testMbid(52));
  addSearch('Tie Example Artist', testMbid(54));
  addSearch('Song (Live) Example Artist', testMbid(53));
  addSearch('Acoustic track Example Artist', testMbid(56));
  addSearch('Merged Example Artist', testMbid(50));
  addSearch('Ghost Example Artist');
};

const seedLegacyTracks = async (): Promise<void> => {
  await source.query(`insert into ${SOURCE_SCHEMA}.users
    (id, email, username) values
    ('contributor-a', 'a@example.com', 'a'),
    ('contributor-b', 'b@example.com', 'b')`);
  await source.query(`insert into ${SOURCE_SCHEMA}.accounts
    (user_id, provider, provider_account_id) values
    ('contributor-a', 'google', 'google-a'),
    ('contributor-b', 'google', 'google-b')`);
  await source.query(`insert into ${SOURCE_SCHEMA}.artists (id, name, yt_id)
    values ('artist', 'Example Artist', 'artist-video')`);
  const tracks = [
    ['a-dup-later', 'Duplicate', 'contributor-b', '2021-01-01T00:00:00Z'],
    ['z-dup-earliest', 'Duplicate', 'contributor-a', '2020-01-01T00:00:00Z'],
    ['tie-z', 'Tie', 'contributor-b', '2022-01-01T00:00:00Z'],
    ['tie-a', 'Tie', 'contributor-a', '2022-01-01T00:00:00Z'],
    ['live', 'Song (Live)', 'contributor-a', '2023-01-01T00:00:00Z'],
    ['merged', 'Merged', 'contributor-b', '2024-01-01T00:00:00Z'],
    ['acoustic', 'Acoustic track', 'contributor-b', '2025-01-01T00:00:00Z'],
    ['ghost', 'Ghost', 'contributor-a', '2026-01-01T00:00:00Z'],
  ];
  for (const [id, title, creatorId, createdAt] of tracks) {
    await source.query(
      `insert into ${SOURCE_SCHEMA}.tracks
        (id, yt_id, title, duration, duration_seconds, creator_id,
         created_at, updated_at)
       values ($1, 'youtube12345', $2, '3:00', 180, $3, $4, $4)`,
      [id, title, creatorId, createdAt],
    );
    await source.query(
      `insert into ${SOURCE_SCHEMA}.track_artists
      (id, artist_id, track_id) values ($1, 'artist', $2)`,
      [`artist-${id}`, id],
    );
  }
  await source.query(`insert into ${SOURCE_SCHEMA}.user_favorite_tracks
    (id, user_id, track_id) values ('f1', 'contributor-a', 'acoustic'),
    ('f2', 'contributor-b', 'acoustic')`);
  await source.query(`insert into ${SOURCE_SCHEMA}.track_views
    (id, track_id, user_id) values ('v1', 'acoustic', 'contributor-a'),
    ('v2', 'acoustic', 'contributor-b'), ('v3', 'acoustic', null)`);
};
