# vozzify API

NestJS REST API behind vozzify: tracks, vocal notes, artists, albums,
users and practice stats. It serves the web app and, later, the mobile app.
Every route lives under `/v1`.

## Running locally

From the repository root:

```sh
nub install
nub run infra:up             # Postgres, Redis and MinIO (S3) via docker compose
cp apps/api/.env.example apps/api/.env
(cd apps/api && nub run db:migrate && nub run db:seed)
nub run dev --filter=api     # http://localhost:3333
```

The API needs `ffmpeg` installed: a Processing converts the audio it downloads
with it (install it with your package manager, e.g. `apt install ffmpeg` or
`brew install ffmpeg`, or point `FFMPEG_PATH` at the binary). The download
itself goes through RapidAPI and needs `RAPIDAPI_API_KEY`, required in
production (the API refuses to boot without it there).

## Database

Drizzle ORM on Postgres. Run these from `apps/api`:

- `nub run db:generate` creates a migration in `drizzle/` from changes in
  `src/database/schema/` (review the SQL and commit it).
- `nub run db:migrate` applies pending migrations. It is an explicit step,
  never run on boot; production runs `node dist/database/migrate.js` (the
  image needs the `drizzle/` folder).
- `nub run db:seed` upserts the development user you can sign in as
  (`seed@vozzify.dev` / `vozzify-seed`). Development only: safe to
  re-run, refuses `NODE_ENV=production`. Seed data grows with the features
  that add tables.
- `nub run db:studio` opens Drizzle Studio.

Other tasks, scoped with `--filter=api`: `build`, `lint`, `check-types`,
`test`. E2E tests run from this folder with `nub run test:e2e` (needs Docker).

Environment variables are listed in [`.env.example`](./.env.example) and
validated at startup; the API refuses to boot with an invalid config.

## File storage

Uploads (Avatars) go to an S3-compatible bucket through `StorageService`
(`src/integrations/storage`): `putPublicObject({ key, body, contentType })`
stores a publicly readable object and `publicUrl(key)` gives the URL it is
served from. Locally that is the MinIO started by `nub run infra:up` (bucket
created on start; console at <http://localhost:9001>, user `vozzify`,
password `vozzify-local`); production uses R2 behind the public `assets.vozzify.com/storage` Worker route. The `S3_*` variables in [`.env.example`](./.env.example) go together:
the API refuses to boot when they are incomplete or missing. E2E tests start
their own MinIO; without Docker, point them at a server dedicated to tests
with `E2E_S3_ENDPOINT`, `E2E_S3_ACCESS_KEY_ID` and `E2E_S3_SECRET_ACCESS_KEY`.

## Auth

[Better Auth](https://better-auth.com) serves `/v1/auth/*` (sign up/in/out,
Google, email verification and password reset with 6-digit codes,
usernames); its responses use Better Auth's own format, which the Better
Auth client expects. Every other route is private unless marked
`@Public()`, and `GET /v1/me` returns the signed-in user. Without
`RESEND_API_KEY`, emails (and their codes) are printed to the API logs.

## Contributing

Read the root [`CLAUDE.md`](../../CLAUDE.md) and this app's
[`CLAUDE.md`](./CLAUDE.md) for the architecture and coding standards.
