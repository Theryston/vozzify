# apps/api — NestJS REST API

Read the root `CLAUDE.md` first; this file only adds API-specific rules.

Stack: NestJS 12 (Express, **ESM**), Drizzle ORM + PostgreSQL, Better Auth,
BullMQ + Redis, Zod (via `@vozzify/contracts` + the in-house `src/common/zod/`), Vitest.
Serves the web app today and the mobile app later, so treat every endpoint as a
public, versioned contract.

## Commands

```sh
nub run dev          # nest start --watch (port from PORT, default 3333)
nub run test         # unit tests (*.spec.ts)
nub run test:cov     # unit tests + coverage thresholds (report in coverage/)
nub run test:e2e     # e2e tests (test/*.e2e-spec.ts) against a Testcontainers Postgres
                     # (needs Docker, or E2E_DATABASE_URL — see Testing)
nub run check-types
nub run lint
```

Database scripts (need a valid `apps/api/.env`, i.e. `DATABASE_URL` and
`REDIS_URL`, since they read the same env schema):

```sh
nub run db:generate  # drizzle-kit: schema diff → new SQL migration in drizzle/
nub run db:migrate   # apply migrations (dev); production runs
                     # `node dist/database/migrate.js`, so the image ships drizzle/
nub run db:studio    # Drizzle Studio
nub run db:seed      # deterministic, idempotent dev data; refuses NODE_ENV=production
                     # (sign in as seed@vozzify.dev / vozzify-seed)
```

These scripts run through `tsx`, which does **not** emit decorator metadata:
never bootstrap Nest DI from a `tsx` script (constructor injection by type
resolves to `undefined`). Vitest and `nest build` are not affected.

## Folder structure

```
src/
  main.ts                 bootstrap: versioning, global pipes/filters, swagger, shutdown hooks
  app.module.ts           wires config, database, infra modules and feature modules
  config/
    env.ts                Zod schema for process.env, parsed once at boot
  database/
    database.module.ts    Drizzle client (global) + nestjs-cls transactions
    columns.ts            id() and timestamps helpers used by every table
    schema/               one file per table/aggregate + relations.ts + index.ts
    migrate.ts seed.ts    scripts behind db:migrate / db:seed
  redis/                  shared ioredis client (REDIS_CLIENT), CacheService, redisKey()
  queue/                  BullMQ root config, AppWorker (clean shutdown, Nest logging)
  common/                 cross-cutting Nest pieces only
    errors/               AppException + global exception filter
    zod/                  createZodDto, ZodValidationPipe, @ZodSerializerDto
    rate-limit/           global throttler guard + Redis storage
    guards/ decorators/ interceptors/ pipes/
  integrations/           clients for external services, one module each
    web-revalidation/     enqueue + POST cache tags to the web's /api/revalidate
    email/                EmailService (Resend) + OTP templates (en, pt-BR), sent via a job
    storage/              StorageService (public objects on any S3 API) + its S3 implementation
    ytmusic/ sqs/ elevenlabs/ …
  modules/                one folder per feature (domain)
    tracks/
      tracks.module.ts
      tracks.controller.ts
      tracks.service.ts
      tracks.repository.ts
      tracks.processor.ts     (BullMQ consumer, when the feature has jobs)
      tracks.service.spec.ts
    users/ auth/ artists/ albums/ streaks/ stats/ …
drizzle/                  generated SQL migrations (committed)
test/                     e2e specs + helpers (app factory, Testcontainers setup)
```

- A feature module owns its controller, service, repository, processors and
  tests. Other modules use it only through its **exported service**, never its
  repository or tables directly.
- `common/` holds only framework-level, domain-agnostic code. Domain helpers
  stay inside their module.
- `integrations/` wrap third-party SDKs behind a small typed service, so
  features never import an SDK directly (and tests can mock one provider).
- `integrations/storage/` in production: the bucket's `track-vocals/` prefix
  must be publicly readable by bucket policy. The note detection's worker
  uploads the vocals through a presigned PUT with no ACL (its contract sends
  only `Content-Type`), so public reads depend on that policy, as they do on
  MinIO (`mc anonymous set download`).

## Layers (controller → service → repository)

- **Controller**: HTTP only. Declares route, version, guards, and DTOs;
  validates input; calls one service method; returns a contract-shaped object.
  No business rules, no Drizzle.
- **Service**: business rules and orchestration (repositories, other services,
  integrations, queues). No `Request`/`Response` objects, no Drizzle queries.
  Throws `AppException` for expected failures.
- **Repository**: the only layer that imports Drizzle and the schema. Returns
  plain typed objects (never leaks query builders). One repository per
  aggregate, named `<Feature>Repository`.
- Transactions: use `@nestjs-cls/transactional` with the Drizzle adapter.
  Services mark the unit of work with `@Transactional()`; repositories inject
  `TransactionHost<DatabaseAdapter>` and query through `txHost.tx`, so Drizzle
  stays out of services and repository calls join the current transaction.
- Dependency injection: import injected classes as **values**, not
  `import type` (decorator metadata needs the runtime reference). Biome's
  `useImportType` is disabled for this app for that reason.

## ESM details

- `"type": "module"` + `nodenext`: relative imports **must** end in `.js`
  (`import { TracksService } from './tracks.service.js'`).
- Top-level `await` is fine (see `main.ts`). No `require`, no `__dirname`
  (use `import.meta.dirname`).

## HTTP conventions

- URI versioning: every route lives under `/v1` (`app.enableVersioning` with
  `defaultVersion: '1'`). Breaking changes go to `/v2` for the affected routes;
  old versions keep working until the mobile app has migrated.
- Resources are plural, kebab-case nouns; nesting at most one level:
  `GET /v1/tracks/:trackId/notes`, `POST /v1/tracks`, `DELETE /v1/me/favorites/:trackId`.
  The authenticated user's own resources live under `/v1/me/...`.
- JSON bodies and query params in **camelCase**. Dates as ISO 8601 strings.
- Status codes: `200` read/update, `201` create (return the resource), `204`
  delete/no body, `202` accepted async work (e.g. track import queued).
- **Validation**: request DTOs are `createZodDto(schema)` from
  `src/common/zod/`, with the schema imported from `@vozzify/contracts`.
  The global `ZodValidationPipe` parses and coerces them. Responses are
  serialized through their contract schema (`@ZodSerializerDto`) so no extra
  DB field ever leaks. (`nestjs-zod` is not used: it doesn't support NestJS
  12; `src/common/zod/` mirrors its API. OpenAPI covers request shapes only.)
- Validation failures return **400** `VALIDATION_FAILED` with
  `details: { location: 'body' | 'query' | 'param' | 'custom', issues }`.
- **Multipart forms** (`PATCH /v1/me`: Name and the optional Avatar file): a
  multer interceptor from `@nestjs/platform-express` (`FileInterceptor`,
  `NoFilesInterceptor`) fills `request.body` with the text fields, then the
  same DTO/Zod pipe validates them. Always pass `limits`, so an oversized
  part is refused while it is read (`BAD_REQUEST`) instead of buffered.
  A file goes into the body as a standard `File` (see
  `AvatarUploadInterceptor`), so the contract schema declares it with
  `z.file()` and the one schema validates text and file together (OpenAPI
  shows it as a binary field). A file over its limit is answered as
  `VALIDATION_FAILED`, like any other bad field.
- **Uploaded files** are judged by their content, never by the filename or
  the `Content-Type` the client declares: check the magic bytes, then let the
  image library decode. The Avatar (`modules/users/avatar-image.ts`) is
  re-encoded by `sharp` as a 512×512 center-cropped webp, upright and with
  its metadata (EXIF, GPS) dropped, stored through `StorageService` at the
  fixed key `avatars/{userId}.webp` and saved as
  `<public URL>?cacheBust=<timestamp>`. The file is stored before the row is
  written, so a failed upload changes nothing. Size and accepted types are
  constants in `@vozzify/contracts/avatar-rules`.
- **Lists** use cursor pagination: query `cursorPaginationQuerySchema`,
  response `cursorPageSchema(item)` → `{ items, nextCursor }`. Cursors are
  opaque strings (base64 of the sort key), never raw offsets.
- **Errors**: always the `apiErrorSchema` envelope
  `{ statusCode, code, message, details? }`. Throw
  `new AppException('NOT_FOUND', 'Track not found')`; the global filter maps
  it (and Zod/Nest/unknown errors) to the envelope. `code` comes from
  `ApiErrorCode` in contracts and is what clients translate; `message` is an
  English developer message, never shown as-is to users. Add new codes to the
  contracts enum; never rename existing ones.
- OpenAPI: generated from the Zod DTOs and served at `/docs` (disabled in
  production unless explicitly enabled). The document is committed as
  `openapi.json`: `test/openapi.e2e-spec.ts` fails when it is out of date
  (after an intentional change, run `nub run test:e2e -- -u` and commit it),
  and CI runs `oasdiff breaking` against the base branch's copy, so removing
  a route or a field, or making a param required, fails the PR. Breaking
  changes go to a new version (`/v2`) instead.

## Database (Drizzle + Postgres)

- Schema in `src/database/schema/*.ts`. Tables and columns are **snake_case**
  in SQL (`casing: 'snake_case'`), camelCase in TypeScript; table names plural
  (`tracks`, `track_notes`).
- Every table has `id` (text, cuid2 generated in app; imported users keep
  their legacy cuid, which fits the same column), `createdAt` and
  `updatedAt` (`timestamp with time zone`).
- Tables arrive with the feature that uses them: don't create a table (or
  columns) ahead of the feature that reads and writes it.
- Declare foreign keys with explicit `onDelete`, and add indexes for every
  column used in `where`/`order by` of hot queries.
- Migrations: change the schema → `db:generate` → review the SQL → commit it in
  `drizzle/`. Never edit a migration that was already applied, never use
  `drizzle-kit push` outside a throwaway local database. CI runs
  `drizzle-kit check` + `generate` and fails if a schema change has no
  committed migration.
- Use the relational query API for reads with relations and the SQL-like
  builder for everything else. Select only the columns you need. No raw SQL
  strings with interpolated values; use the `sql` template tag.

### Legacy data import

`nub run legacy:cutover prepare|status|continue` composes the stages below.
For launch readiness versus final completion, source shutdown, backups,
configuration and recovery, read `docs/operations/legacy-cutover.md`.

Development starts with an empty database. The compiled operator command
`nub run import:legacy-users` (after `nub run build`, from this app) imports
legacy Users and their sign-in identities with durable resume progress.
`nub run import:legacy-personal-data` imports legacy Practice days and Profile
section visibility after Users. `nub run plan:legacy-recordings` maps legacy
Tracks to Music catalog Recordings without starting Processing. See
`docs/operations/import-legacy-users.md` for environment variables, stage
order, preflight and recovery. The legacy catalog (tracks, artists, albums,
notes and thumbnails) is reprocessed into the new schema (see
`docs/adr/0001-reprocessed-catalog-with-legacy-id-maps.md`).

**Users** keep their legacy identity, so the schema must always be able to
hold them:

- **Keep the legacy user ID** (cuid) as the primary key, plus username, email
  and password hash. Sessions, accounts and every user-owned row reference
  the user ID, and profile URLs use the username. Users have no ID map.
- Emails and usernames are lowercased; legacy uniqueness was case-sensitive,
  so case-only collisions are listed in the import report, never merged
  silently.
- **Password hashes are bcrypt** in the legacy DB; they are imported as-is
  and rehashed on the next sign-in (see Auth). Google accounts map via
  `provider` + `providerAccountId`.
- User data with no catalog reference (daily practice streaks, section
  visibility, daily practice target, Avatar URL) is imported as-is, or with a
  documented transformation. Legacy `ME_ONLY` choices remain private; unknown
  private sections conservatively hide current Profile sections. Don't add
  `NOT NULL` user columns or
  constraints the legacy data can't satisfy without a clear default.

**Tables with a public URL (tracks, artists, albums)** get new IDs, so old
URLs resolve through a map:

- When you create one of these tables, create its legacy ID map in the same
  PR, e.g. `legacy_track_ids (legacy_id text primary key, track_id text not
  null references tracks(id) on delete cascade)`. Several legacy IDs may
  point to the same record (legacy has duplicates).
- When a read by ID finds nothing, look the ID up in that map. On a hit,
  answer **404 with the code `RESOURCE_MOVED`** and the new ID (add the code
  to `apiErrorSchema` with the first such table); the web turns it into a 308
  redirect. On a miss, a plain `NOT_FOUND`. A 404 with a code, not an HTTP
  redirect, so server-side `fetch` never follows it silently and the mobile
  app handles it the same way. Cover both cases in the endpoint's e2e.
- The import script fills the maps.

The staged cutover accepts explicit Track, Artist and Album identity skips
with source IDs and reasons in the operator report; those URLs may return
plain `NOT_FOUND`. Pending metadata or transient provider failures are not
skips. Launch readiness requires accepted Tracks, maps and User relationships,
but can precede Processing completion. Failed Processings retain their Track,
attribution and maps. See ADR 0001 for this follow-up to URL compatibility.

**User data that points to the catalog** (favorites, views, created tracks)
is translated through the maps at import. A row whose catalog record has no
new equivalent is dropped and listed in the import report.

When a user-related schema change diverges from the legacy model, write the
mapping in the PR description (and in a comment next to the table if it
isn't obvious), so the import script can be written from those notes.

## Auth (Better Auth)

- The Better Auth instance (`modules/auth/auth.ts`: Drizzle adapter,
  email/password, `emailOTP` for email verification and password reset with
  6-digit codes, `username`, Google when `GOOGLE_CLIENT_ID`/`SECRET` are set)
  owns the `users`, `sessions`, `accounts` and `verifications` tables.
  Verification is required before a session exists.
- `/v1/auth/*` is a **raw Express handler** registered in `configureApp`, not
  a Nest route: it uses Better Auth's own response format (the one exception
  to the error envelope, because the Better Auth clients expect it) and its
  own Redis-backed rate limiter, since Nest guards/pipes don't run there.
  Everything else goes through Nest.
- A global `AuthGuard` resolves the session from the cookie. Routes are
  **private by default**: every public route (health, public catalog pages,
  test probe controllers) needs `@Public()`. Read the user with
  `@CurrentUser()` (set on `request.user`). Admin-only routes use
  `@Roles('ADMIN')` (legacy enum values). Guard order: throttler → auth →
  roles. Mobile (bearer/Expo plugin) is not wired yet.
- A signed-in user without a username (Google sign-up) gets
  `USERNAME_REQUIRED` on every private route except those marked
  `@AllowMissingUsername()`. They set it once with `PUT /v1/me/username`
  (stored lowercased; `CONFLICT` if they already have one or it is taken):
  a username never changes afterwards.
- Better Auth's `POST /v1/auth/update-user` is **disabled** for everyone
  (`disabledPaths`, it answers 404), so an existing user's profile fields
  (name, username, image) change only through vozzify's own `/v1/me`
  routes, which enforce the rules Better Auth doesn't know (immutable
  username, avatars we upload ourselves). Don't re-enable it or add a Better
  Auth endpoint that edits those fields.
- Sign-up (`POST /v1/auth/sign-up/email`) goes through the `before` hook in
  `modules/auth/sign-up-rules.ts`: an `image` is **refused**
  (`IMAGE_NOT_ALLOWED`, a hook can't remove a field), so an Avatar only comes
  from the upload or the Google profile (a different path, which keeps the
  provider's picture), and `name` must pass the shared `nameSchema` from
  contracts (`INVALID_NAME`) and is stored trimmed. Sign-up rules live in
  that hook, not in the web form alone.
- Passwords: new ones are scrypt (Better Auth default); legacy bcrypt hashes
  are accepted and rehashed to scrypt on the next successful sign-in
  (`modules/auth/password.ts`). `role` and `dailyPracticeTargetSeconds` can't
  be set by users (`input: false`).
- Emails (OTP codes) go through `EmailService`/the email job with templates
  in en and pt-BR chosen from `Accept-Language`; without `RESEND_API_KEY`
  (outside production) they are logged, so codes show in the dev console.
- The web app calls the API from the server forwarding the incoming `cookie`
  header, and from the browser with `credentials: 'include'`; CORS and
  Better Auth's `trustedOrigins` allow only `WEB_ORIGINS`.
- **Production env**: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
  `RESEND_API_KEY` (required, so codes are never silently lost) and
  `AUTH_COOKIE_DOMAIN=vozzify.com` (the API is on a subdomain; without
  it the web server never receives the session cookie).

## Jobs, queues and cache (Redis)

- Background work uses `@nestjs/bullmq`. Queue name, job name and the Zod
  payload schema live in `<feature>.job.ts` (a separate file avoids an import
  cycle between module and processor); consumers are `<feature>.processor.ts`.
  Jobs must be **idempotent** (they are retried with exponential backoff).
  Throw `UnrecoverableError` for failures that retrying can't fix.
- Every new queue and processor must be added to
  `test/redis-test-overrides.ts`, so e2e tests keep running without Redis.
- Scheduled work (track score recalculation, daily practice reminders) uses
  BullMQ repeatable jobs, not in-process timers.
- A Track's Processing is a BullMQ job in this process. Audio is downloaded
  directly through `youtubei.js` and the configured `PROXY_*` HTTP proxy,
  without a PO Token provider. Use a Brazilian sticky session for downloads.
  The SDK's player decipher evaluator has a bounded execution time.
  `AudioDownloadClient` streams to a unique temporary file, `ffmpeg` converts
  it to WAV on disk, and `StorageService.putPublicFile` streams it to S3.
  Keep media out of whole-file buffers in this path. `TrackAudioService`
  removes the input after conversion and the workspace in `finally`, even
  when conversion, upload or persistence fails. Old queued download waits
  restart the direct download; an existing WAV is reused. The API image
  needs `ffmpeg` (`FFMPEG_PATH` overrides the binary).
  Note detection still starts `apps/note-detector` on RunPod and polls with
  delayed jobs. `RUNPOD_API_KEY` and `RUNPOD_ENDPOINT_ID` are required in
  production. See `docs/adr/0004-processing-pipeline.md` and
  `docs/adr/0014-direct-youtube-audio-downloads.md`.
- The last step, the lyrics, stores the vocals as MP3 and transcribes them
  with ElevenLabs Scribe v2 (`ELEVENLABS_API_KEY`, required in production: the
  transcription factory refuses to boot without it). Its failures are retried;
  on its last attempt the Processing completes without Timed lyrics
  (`OPTIONAL_STEPS` in `track-pipeline-steps.ts`). The music MP3 is a job of
  its own on the `track-mp3` queue, so a failure there never holds the lyrics
  back.
- Redis also backs response caching of expensive reads (`CacheService`, keys
  built with `redisKey(feature, …)`) and rate limiting (`@nestjs/throttler`
  with the in-house `RedisThrottlerStorage`; `@nest-lab/throttler-storage-redis`
  doesn't support NestJS 12). Both fail open: Redis being down degrades to
  cache misses / no limiting instead of errors.
- When data rendered by public web pages changes (a track finished processing,
  score updated, …), call `WebRevalidationService.revalidate(tags)` with tags
  from `cacheTags` in `@vozzify/contracts` (never hard-coded strings). It
  enqueues a job that POSTs them to the web's `/api/revalidate`.

## Config, logging, lifecycle

- Read config only from `src/config/env.ts` (parsed with Zod at boot); inject
  it with `@Inject(ENV) env: Env`. `apps/api/.env` is loaded automatically
  outside test/production. Never read `process.env` elsewhere.
- Global HTTP setup (versioning, CORS, pipes, filters, Swagger) lives in
  `src/setup-app.ts` `configureApp(app)`, shared by `main.ts` and the e2e
  tests. Add global behavior there, never only in `main.ts`.
- Use Nest's `Logger` (structured JSON logs in production). No `console.*`.
  Never log secrets, tokens, passwords or full request bodies.
- `enableShutdownHooks()` so queues and DB connections close cleanly on deploy.
- Health: `GET /v1/health` is liveness (never touches dependencies) and
  `GET /v1/health/ready` is readiness (Postgres + Redis, 503 when one fails).
  Point the container healthcheck at liveness and traffic routing at readiness.
- **Deployment**: behind a CDN/reverse proxy, set `TRUST_PROXY` to the number
  of proxies between the client and the API (e.g. `2` for CDN → Traefik →
  API) or their address ranges. Otherwise `req.ip` is the proxy's address and
  every visitor shares one rate-limit bucket.

## Testing

- Unit: `*.spec.ts` next to the file under test. Test services through
  `Test.createTestingModule`, overriding repositories and integrations with
  mocks. Don't unit-test controllers or repositories in isolation.
- E2E: `test/*.e2e-spec.ts`, one file per feature, hitting real HTTP routes
  (supertest). Cover success, validation error, auth/permission and
  not-found for each endpoint.
  - Database: one Postgres 17 container per run (Testcontainers), migrated
    with the real migrations. Without Docker, set `E2E_DATABASE_URL` to a
    Postgres **dedicated to tests**: it is migrated and every table in it is
    truncated.
  - Boot the app with `createTestApp({ controllers?, env?, override? })` from
    `test/utils/create-test-app.ts` → `{ app, http, db, queues, close }`. It
    applies `configureApp` and replaces Redis-backed providers
    (`test/redis-test-overrides.ts`), so e2e tests don't need Redis;
    `override` runs last, to mock integrations.
  - Specs that write call `resetDatabase(db)` in `beforeEach` and seed with
    the typed factories in `test/utils/factories.ts` (add one per new table).
    DB-only specs can use `connectTestDatabase()`.
  - Files run sequentially against one shared database
    (`fileParallelism: false`); tests must not depend on order.
  - Test-only controllers live in separate non-spec files under `test/` and
    need `@Public()` unless they test auth.
- External services (RunPod, ElevenLabs, YouTube, email) are always mocked at the
  integration-module boundary. `ffmpeg` is a local binary, not a service: e2e
  runs it for real (CI installs it), on the MP3 fixture in `test/fixtures/`.
  File storage is the exception: e2e runs
  against a real S3-compatible server (MinIO), started once per run next to
  Postgres by `test/setup/global-setup.ts` (Testcontainers, or
  `E2E_S3_ENDPOINT` + `E2E_S3_ACCESS_KEY_ID` + `E2E_S3_SECRET_ACCESS_KEY`
  for one dedicated to tests) and reached through the `S3_*` variables, so
  specs assert on the stored objects fetched from their public URL. Unit
  tests of services mock `StorageService`.
