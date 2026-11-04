# Import legacy Users and personal data

`import:legacy-users` imports Users and password/Google identities.
`import:legacy-personal-data` runs that stage first, then imports Practice days
and supported Profile visibility choices. `plan:legacy-recordings` runs the
User stage first, then resolves legacy Tracks to Music catalog Recordings
without starting Processing. The personal and recording stages are independent
of each other. Run each stage separately and review its report before
proceeding.

## Prepare

1. Freeze the legacy PostgreSQL source. Prefer a restored backup on a separate
   database with a dedicated read-only role, access to `users` and `accounts`
   and `SELECT` privileges only. Later stages also require
   `daily_practice_streaks`, `user_section_visibilities`, `tracks`, `albums`,
   `artists`, `track_artists`, `user_favorite_tracks` and `track_views`. Keep
   this snapshot unchanged across retries.
2. Create the destination, apply the committed API migrations, and back it up.
   User, account and application-data tables must be empty on the first import.
   The reference plan catalog tables (`benefits`, `plan_benefits`,
   `plan_prices`, `plans`) and Drizzle migration ledger may contain their
   migration-seeded rows; the importer preserves those rows. Run migrations as
   a separate step using the API's usual environment (`nub run db:migrate` from
   `apps/api`).
3. Keep application traffic and other writers off the destination during the
   import. Only one importer may run against a destination at a time. Run the
   User stage before either the personal-data stage or the recording plan.
4. Build from the repository root:

   ```sh
   nub run build --filter=api
   ```

The importer uses the actual compiled Nest application service and database
module. It opens no HTTP listener, starts no workers and requires no User,
admin session, Redis server or external provider credentials. Never run its
Nest bootstrap through `tsx`, which does not emit decorator metadata.

## Run

From `apps/api`, set these environment variables through your shell or secret
manager (use actual URLs in place of the placeholders):

```sh
export LEGACY_DATABASE_URL='<read-only frozen legacy PostgreSQL URL>'
export DATABASE_URL='<new vozzify PostgreSQL URL>'
nub run import:legacy-users
nub run import:legacy-personal-data
nub run plan:legacy-recordings
```

Both database variables are required and validated as PostgreSQL URLs. The
recording plan also requires `MUSIC_CATALOG_URL` and `MUSIC_CATALOG_API_KEY`;
personal data does not boot the Music catalog client. The importer
reads the process environment, not `apps/api/.env`. Alternatively use Node's
`--env-file` with a private, uncommitted file:

```sh
node --env-file=/secure/path/import.env dist/main.js --import-legacy-users
```

`NODE_ENV` is optional (`development` by default); `production` enables JSON
logging. No other application environment variables are required by the User
or personal-data commands. Use TLS connection parameters appropriate for your servers. The
source connection runs a repeatable-read, read-only transaction, even if the
provided role has broader permissions. The source must expose the legacy
snake_case `users` and `accounts` tables through its search path.

## Results and recovery

The User report includes source User/account totals, committed totals and
`errors`. The personal report includes committed Practice-day totals. The
recording report includes source Tracks, planned and skipped Tracks, affected
favorites/views and initial contributors. An incomplete stage exits with code
**1**; wait for it to complete before starting the next stage. Reports never
print passwords, hashes, OAuth tokens or connection URLs. Keep reports private
as operational User data.

Preflight validates the entire source before inserting any User. It reports
up to 100 errors, including email/Username case collisions, malformed password
hashes, unsupported providers, missing sign-in identities and orphan accounts.
Case collisions require a maintainer decision; the command never silently
merges or renames Users. Correct invalid data in a separately prepared source
snapshot before the first successful import. A source change after progress
exists is refused (`SOURCE_CHANGED`), so retain the original frozen snapshot.

`legacy_user_imports` holds the source SHA-256 fingerprint, last committed
User ID, counts and stage status. User and account inserts commit together
with that cursor. `legacy_personal_imports` holds a separate fingerprint and
Practice-day cursor. Existing day rows are not overwritten, and a completed
personal stage skips visibility writes on replay. Restart the same stage with
the same source and destination to resume after interruption. Successfully imported Users are skipped, including
passwords already upgraded by a new-app login or subsequently changed. Replays
also preserve tokens updated by Google login. A new run marks the stage
incomplete until it validates and finishes again.

`DESTINATION_NOT_EMPTY` refuses the initial import without deleting anything.
`IMPORT_ALREADY_RUNNING` refuses a concurrent importer. `USER_IMPORT_FAILED`
is a sanitized operational failure: check source/destination connectivity,
permissions and schema, then rerun. The progress counts identify how much
committed before the failure. A hard process termination may leave the last
progress log marked incomplete; rerunning determines completion durably.

To abandon an import, restore/recreate the dedicated destination from its
pre-import backup and apply migrations again. The command never resets a
nonempty destination. Do not delete the cursor to restart an existing import,
and do not restore the destination after accepting new-app writes without a
separate recovery plan.

## Field mappings

- Preserve User IDs, roles, timestamps, Avatar URL and daily practice target.
  Prisma timestamps without a time zone are interpreted as UTC.
- Keep the original Daily target integer in storage, including non-preset
  legacy values. API/Profile reads continue to expose only supported presets
  and their existing fallback behavior.
- Import Practice days by their legacy UTC date, preserving listened seconds,
  completion and timestamps; no local-day conversion is inferred.
- Map `FAVORITE_TRACKS` to current Favorites visibility and
  `ADDED_TRACKS`/`PROCESSING_TRACKS` to current summary visibility. Legacy has
  no direct Practice-history control. An unknown private section such as
  `RECENT_VIEWS` conservatively hides current Profile sections. For duplicate
  visibility rows, any `ME_ONLY` value wins.
- Lowercase emails and Usernames as authentication does. A null Name falls
  back to the normalized Username, then the original email's local part.
- Convert `email_verified_at` to a boolean; a linked Google account also marks
  the User verified. Preserve an unverified password-only User as unverified.
- Keep new-app defaults: `pt-BR` locale, null visitor and practice-clock
  fields. Apply direct legacy Profile visibility choices and preserve privacy
  conservatively when a private section has no current equivalent.
- Copy bcrypt hashes unchanged to a `credential` account whose `accountId`
  is the User ID. Normal successful login upgrades the hash to scrypt.
- Map Google `provider`/`provider_account_id` to `providerId`/`accountId`.
  Preserve access/refresh/ID tokens and scope, convert `expires_at` seconds
  to a timestamp, preserve account timestamps, and generate new account IDs.
  Drop NextAuth-only account fields. Import both accounts for dual-login Users.

The e2e harness creates a tiny legacy-shaped schema in the disposable test
Postgres, imports through the real Nest module/compiled command, and verifies
password and mocked Google sign-in through real authentication endpoints.

## Reprocess one planned Recording

After the correspondence plan is complete (#458), build the API and apply its
latest destination migrations. These commands use the normal API environment
(`DATABASE_URL`, Redis, Music catalog, storage and integration configuration);
they read the durable plan, so they do not need `LEGACY_DATABASE_URL`. Keep the
frozen plan unchanged. Use a destination isolated from live User writes during
the migration. Never use production paid credentials for a rehearsal.

From `apps/api`, with the Recording MBID selected from `legacy_recording_plans`:

```sh
nub run prepare:legacy-recording <recording-mbid>
# Inspect Track, initial Processing, Contributors and legacy_track_ids first.
nub run start:legacy-recording <recording-mbid>
```

Preparation creates one queued Track, its initial Processing, every accepted
legacy ID map, and only the earliest legacy creator's Contributor and CREATE
Contribution (ordered by creation date, then legacy ID). The Contribution and
Contributor retain their historical date; the new Processing has current dates.
The existing metadata import is queued independently. Preparation does not start
a Processing worker or enqueue its first step. Starting explicitly enqueues the
existing pipeline; run the normal API workers against the same database/Redis
to consume it. Paid work begins there. Completion of the command acknowledges
enqueueing, not completion of Processing. Inspect the ordinary Processing read
endpoint by the returned new Track ID for status, failure code and retryability.
Mapped legacy IDs already return `RESOURCE_MOVED` while the Track is queued or
running; skipped/unmapped IDs remain ordinary `NOT_FOUND` responses.

Repeat preparation after an interrupted command or metadata enqueue failure;
it recovers committed rows and refuses incompatible existing attribution or ID
maps. Repeat start after a queue failure. A completed/running attempt is not
restarted. A known external job is polled by the existing pipeline on replay.
`legacy_recording_imports` records the group acknowledgement and current attempt;
`legacy_processing_origins` marks each migration attempt durably. Do not delete
these records to restart work.

For a retryable migration failure, explicitly run:

```sh
nub run retry:legacy-recording <recording-mbid>
```

This preserves existing outputs through the ordinary retry plan and starts a new
migration attempt. If enqueueing fails after the retry commits, use `start` to
resume that queued attempt. If acknowledgement fails before enqueueing, repeat
`retry` to recover that attempt. Final failures remain final; optional exhausted
lyrics can complete without lyrics. Failures retain Track, maps and attribution.
Migration attempts send no Contributor success/failure emails and consume no
active/daily-new-Track quota. User locale and role are untouched. A later retry
through the public API follows normal attribution, quota and email behavior;
the operator cannot resume that User attempt. No public historical-User override
or admin elevation is added. This stage handles one group only; batch pacing and
subsequent personal Track-dependent data restoration are separate stages.
