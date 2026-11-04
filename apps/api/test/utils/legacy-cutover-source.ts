import bcrypt from 'bcryptjs';
import { Pool } from 'pg';

const SCHEMA = 'legacy_cutover_463_fixture';
const dates =
  "created_at timestamp default '2020-01-02', updated_at timestamp default '2021-03-04'";
const definitions = {
  users: `id text primary key, role text default 'USER', name text, email text unique,
    username text unique, password text, email_verified_at timestamp,
    image_url text, daily_practice_target_seconds integer, ${dates}`,
  accounts: `user_id text, provider text, provider_account_id text,
    access_token text, refresh_token text, id_token text, scope text, expires_at integer, ${dates}`,
  daily_practice_streaks: `id text primary key, user_id text, day date,
    listened_seconds integer, is_completed boolean, completed_at timestamp,
    last_heartbeat_at timestamp, ${dates}`,
  user_section_visibilities: `id text primary key, user_id text, key text, value text, ${dates}`,
  artists: 'id text primary key, name text, yt_id text',
  albums: 'id text primary key, name text, yt_id text',
  tracks: `id text primary key, yt_id text, title text, duration text, duration_seconds integer,
    album_id text, creator_id text, ${dates}`,
  track_artists: 'id text primary key, artist_id text, track_id text',
  user_favorite_tracks: `id text primary key, user_id text, track_id text, ${dates}`,
  track_views: `id text primary key, user_id text, track_id text, ${dates}`,
};

export const createCutoverSource = async (databaseUrl: string) => {
  const admin = new Pool({ connectionString: databaseUrl });
  await admin.query(`drop schema if exists ${SCHEMA} cascade`);
  await admin.query(`create schema ${SCHEMA}`);
  const url = new URL(databaseUrl);
  url.searchParams.set('options', `-c search_path=${SCHEMA} -c timezone=UTC`);
  const db = new Pool({ connectionString: url.toString() });
  for (const [table, fields] of Object.entries(definitions)) {
    await db.query(`create table ${table} (${fields})`);
  }
  await seed(db);
  return {
    db,
    url: url.toString(),
    close: async () => {
      await db.end();
      await admin.query(`drop schema if exists ${SCHEMA} cascade`);
      await admin.end();
    },
  };
};

const seed = async (db: Pool) => {
  await db.query(
    `insert into users (id,email,username,password,email_verified_at,daily_practice_target_seconds)
    values ('ada','ada@example.com','ada',$1,'2020-01-02',420),
    ('bea','bea@example.com','bea',$1,'2020-01-02',300)`,
    [await bcrypt.hash('original-password', 4)],
  );
  await db.query(`insert into daily_practice_streaks (id,user_id,day,listened_seconds,is_completed,completed_at)
    values ('practice','ada',CURRENT_DATE,420,true,CURRENT_DATE)`);
  await db.query(`insert into user_section_visibilities (id,user_id,key,value)
    values ('privacy','ada','FAVORITE_TRACKS','ME_ONLY')`);
  await db.query(
    `insert into artists values ('queen','Queen','queen-video'),('orphan-artist','Missing Artist','missing')`,
  );
  await db.query(
    `insert into albums values ('opera','A Night at the Opera','opera-video'),('orphan-album','Missing Album','missing')`,
  );
  await db.query(`insert into tracks (id,title,yt_id,duration,duration_seconds,album_id,creator_id,created_at)
    values ('a-original','Delayed song','video','5:54',354,'opera','ada','2020-01-01'),
    ('b-duplicate','Delayed song','video','5:54',354,'opera','bea','2021-01-01'),
    ('c-failure','Failed song','video','5:54',354,'opera','bea','2020-01-02'),
    ('d-unmatched','Unknown song','video','5:54',354,null,'ada','2020-01-03')`);
  await db.query(`insert into track_artists values ('ta','queen','a-original'),
    ('tb','queen','b-duplicate'),('tc','queen','c-failure')`);
  await db.query(`insert into user_favorite_tracks (id,user_id,track_id) values
    ('f1','ada','a-original'),('f2','ada','b-duplicate'),('f3','ada','c-failure'),('f4','ada','d-unmatched')`);
  await db.query(`insert into track_views (id,user_id,track_id) values
    ('v1','ada','a-original'),('v2',null,'c-failure'),('v3','ada','d-unmatched')`);
};
