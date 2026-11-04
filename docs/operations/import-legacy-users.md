# Import legacy Users and sign-in identities

Issue #456 imports Users and their password/Google accounts only. It does
not import sessions, verification/reset codes, practice history, section
visibility overrides, favorites or catalog records, and starts no Processing.

## Prepare

1. Freeze the legacy PostgreSQL source. Prefer a restored backup on a separate
   database with a dedicated read-only role, access to `users` and `accounts`
   and `SELECT` privileges only. Keep this snapshot unchanged across retries.
2. Create the destination, apply the committed API migrations, and back it up.
   Every application table must be empty on the first import; do not seed it.
   The Drizzle migrations ledger is allowed. Run migrations as a separate step
   using the API's usual environment (`nub run db:migrate` from `apps/api`).
3. Keep application traffic and other writers off the destination during the
   import. Only one importer may run against a destination at a time.
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
```

Both variables are required and validated as PostgreSQL URLs. The importer
reads the process environment, not `apps/api/.env`. Alternatively use Node's
`--env-file` with a private, uncommitted file:

```sh
node --env-file=/secure/path/import.env dist/main.js --import-legacy-users
```

`NODE_ENV` is optional (`development` by default); `production` enables JSON
logging. No other application environment variables are required by this
command. Use TLS connection parameters appropriate for your servers. The
source connection runs a repeatable-read, read-only transaction, even if the
provided role has broader permissions. The source must expose the legacy
snake_case `users` and `accounts` tables through its search path.

## Results and recovery

The final report includes `status`, source User/account totals, committed
User/account totals, and `errors`. Progress is also logged after each committed
User. Exit code **0** and `status: "complete"` mean the User stage succeeded;
exit code **1** or `status: "incomplete"` means it did not. Neither outcome
starts the catalog stage. Reports never print passwords, hashes, OAuth tokens
or connection URLs. Validation errors include legacy User IDs where relevant;
keep the output private as operational User data.

Preflight validates the entire source before inserting any User. It reports
up to 100 errors, including email/Username case collisions, malformed password
hashes, unsupported providers, missing sign-in identities and orphan accounts.
Case collisions require a maintainer decision; the command never silently
merges or renames Users. Correct invalid data in a separately prepared source
snapshot before the first successful import. A source change after progress
exists is refused (`SOURCE_CHANGED`), so retain the original frozen snapshot.

`legacy_user_imports` holds the source SHA-256 fingerprint, last committed
User ID, counts and stage status. User and account inserts commit together
with that cursor. Restart the same command with the same source and destination
to resume after interruption. Successfully imported Users are skipped, including
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
- Lowercase emails and Usernames as authentication does. A null Name falls
  back to the normalized Username, then the original email's local part.
- Convert `email_verified_at` to a boolean; a linked Google account also marks
  the User verified. Preserve an unverified password-only User as unverified.
- Keep new-app defaults: `pt-BR` locale, visible profile sections, null visitor
  and practice-clock fields. Historical section overrides belong to a later
  data-import slice, together with other User-owned data.
- Copy bcrypt hashes unchanged to a `credential` account whose `accountId`
  is the User ID. Normal successful login upgrades the hash to scrypt.
- Map Google `provider`/`provider_account_id` to `providerId`/`accountId`.
  Preserve access/refresh/ID tokens and scope, convert `expires_at` seconds
  to a timestamp, preserve account timestamps, and generate new account IDs.
  Drop NextAuth-only account fields. Import both accounts for dual-login Users.

The e2e harness creates a tiny legacy-shaped schema in the disposable test
Postgres, imports through the real Nest module/compiled command, and verifies
password and mocked Google sign-in through real authentication endpoints.
