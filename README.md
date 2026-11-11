# vozzify

Rewrite of [notefinder](https://github.com/theryston/notefinder) with a
standalone API and web frontend. Monorepo managed with
[Turborepo](https://turborepo.dev) and [nub](https://nubjs.com).

For an existing installation, follow the
[brand and domain cutover](docs/vozzify-brand-cutover.md) before deploying
the renamed services.

## Structure

- `apps/web`: [Next.js](https://nextjs.org) frontend with
  [shadcn/ui](https://ui.shadcn.com). Port 3000.
- `apps/mobile`: Expo Router native client for Android and iOS.
- `apps/api`: [NestJS](https://nestjs.com) API. Port 3333 (`PORT`).
- `apps/music-catalog`: private Music catalog service (Node + [`ws`](https://github.com/websockets/ws),
  no Nest), reached over an authenticated WebSocket. Port 3334 (`PORT`).
- `packages/contracts`: Zod schemas and types shared by the API, the web app
  and (later) the mobile app.

Code standards, architecture and tooling are documented in `CLAUDE.md` (root)
and `apps/*/CLAUDE.md`.

## Commands

```sh
nub install          # install dependencies (and lefthook git hooks)
nub run infra:up     # start Postgres, Redis, MinIO (S3) and the Music catalog's Postgres and Meilisearch with docker compose
nub run dev          # run web and api
nub run build        # build everything
nub run lint         # Biome (lint + format + imports)
nub run format       # Biome with --write
nub run check-types
nub run test
nub run test:cov     # unit tests + coverage thresholds (what CI runs)
```

To run a single app: `nub run dev --filter=web` (or `api`, `music-catalog`).

For local native runs, use `cd apps/mobile && nub run android` or
`nub run ios`. See `apps/mobile/CLAUDE.md` for mobile setup and checks.

Copy `apps/api/.env.example`, `apps/web/.env.example` and
`apps/music-catalog/.env.example` to `.env` in each app.

## Editor setup

Biome is the only formatter/linter. Project settings are included for
VS Code (`.vscode/`) and Zed (`.zed/`); install the Biome extension in your
editor.
