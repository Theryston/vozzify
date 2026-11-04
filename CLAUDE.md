# vozzify

vozzify shows the exact vocal notes a singer hits in any song, on a timeline
synced with playback, with real-time pitch feedback from the user's mic.

This repo is a **from-scratch rewrite** of the original monolith
(<https://github.com/theryston/notefinder>, live at <https://notefinder.com.br>).
Goal: same features, split into a standalone API and a web client (a mobile app
comes later and will consume the same API), with a better-looking web UI.
When in doubt about a feature's behavior, check how the original does it.

App-specific rules live in `apps/web/CLAUDE.md`, `apps/api/CLAUDE.md` and
`apps/music-catalog/CLAUDE.md`.

## Monorepo layout

```
apps/
  web/          Next.js 16 frontend (SSR, Cache Components, next-intl, shadcn/ui). Port 3000.
  api/          NestJS 12 REST API (Drizzle, Better Auth, BullMQ). Port 3333.
  music-catalog/  Private Music catalog service: Node + ws WebSocket server and worker,
                  no Nest (Drizzle). Port 3334. See apps/music-catalog/CLAUDE.md.
  note-detector/  Python RunPod serverless worker (uv, not Node): replaces the
                  legacy worker with Mel-RoFormer, GAME Vocal notes and a Pitch
                  curve. No port. See
                  apps/note-detector/CLAUDE.md and docs/adr/0007.
packages/
  contracts/    Zod schemas + inferred types shared by api, web and (later) mobile.
```

- Package manager: **nub** (`nub.lock`, pnpm-compatible). Never use npm/pnpm/yarn
  directly and never commit another lockfile. Node version is in `.node-version`.
- Task runner: **Turborepo** (`turbo.json`). Internal packages are referenced as
  `"@vozzify/<name>": "workspace:*"`.
- New shared code goes in `packages/<name>` only when at least two apps need it.

## Commands (from the root)

```sh
nub install                 # install everything
nub run infra:up            # start Postgres + API Redis + MinIO + web cache Redis + Music catalog Postgres and Meilisearch (docker compose)
nub run dev                 # build packages, then run web + api + music-catalog in watch mode
nub run lint                # biome check (lint + format + import order), all packages
nub run knip                # unused files, exports and dependencies (whole repo)
nub run duplication         # jscpd: fails above 3% duplicated code (whole repo)
nub run format              # biome check --write, all packages
nub run check-types         # tsc in every package
nub run test                # unit tests
nub run test:cov            # unit tests + coverage thresholds (what CI runs)
nub run test:mutation --filter=api   # optional local Stryker mutation tests (api | web | music-catalog)
nub run test:e2e            # API + Music catalog e2e (Testcontainers Postgres, MinIO, Meilisearch) + web Playwright
nub run build               # production build of everything
nub run dev --filter=web    # scope any task to one package (web | api | music-catalog | note-detector | @vozzify/contracts)
```

Before considering a change done, run `lint`, `check-types` and `test:cov` for
the packages you touched, plus `knip` and `duplication` (CI runs lint,
check-types, test:cov, build, knip and duplication on every PR).

## Compatibility with the legacy app (hard requirements)

The new app starts with an **empty database**, but it will replace the legacy
app in production. Two things must hold when that happens:

1. **Users and their data must be importable.** A one-off script imports
   every legacy user (keeping their ID, username, email and password hash)
   and their data. Never model users in a way legacy users can't be mapped
   into. The legacy **catalog** (tracks, artists, albums and their notes and
   thumbnails) is **not** imported: it is reprocessed into a schema designed
   for the new app (see "Legacy data import" in `apps/api/CLAUDE.md`).
2. **Legacy routes remain supported.** Every public route of the legacy web app
   must either still exist or redirect to its new equivalent, keeping query
   params (see "Legacy routes" in `apps/web/CLAUDE.md`). Profile URLs keep
   working because usernames are kept. Catalog records get new IDs, so every
   table with a public URL has a **legacy ID map** (legacy ID → new ID),
   created with the table, that turns an old URL into a permanent redirect.
   Explicitly skipped Track, Artist and Album identities may return a real
   404; the cutover report must identify each exclusion and its reason.
   Pending work is not a skip. Launch readiness may precede Processing
   completion; failed Processings retain their Track and maps.

The reasoning is in
`docs/adr/0001-reprocessed-catalog-with-legacy-id-maps.md`.

## Cross-cutting decisions

### Language

- **All code is in English**: identifiers, file names, comments, commit messages,
  PR and issue titles/bodies, log messages, API error messages, DB schema.
  The only non-English text in the repo lives in the locale files themselves;
  API errors cross the wire as stable `code`s that clients translate, never
  as translated strings.
- **No hard-coded user-facing text.** Everything a user can read goes through
  i18n (web: `next-intl`; API returns stable error `code`s that clients
  translate). Locales: `en` and `pt-BR`. `en` is the **source of truth** for
  messages (keys are written there first), not the default for visitors: the
  locale is detected from the user's location/browser and falls back to `en`
  only when there is no match (details in `apps/web/CLAUDE.md`).

### Design

`DESIGN.md` is the design system (direction, color, type, shape, elevation,
motion, icons, the note timeline). Every UI change follows it, and changing a
design token means updating `DESIGN.md` and the tokens in
`apps/web/app/globals.css` together.

### Contracts (`packages/contracts`)

- Single source of truth for every request/response shape crossing the API
  boundary. Define the Zod schema there, export the inferred type next to it.
- The API validates input/output with these schemas; the web uses the same
  schemas for forms and types for fetchers. Never redeclare an API type in an app.
- Naming: `trackSchema` / `Track`, `createTrackBodySchema` / `CreateTrackBody`,
  `listTracksQuerySchema` / `ListTracksQuery`. One file per domain
  (`tracks.ts`, `users.ts`, …) re-exported from `src/index.ts` (the only barrel
  file allowed in the repo).
- Shared primitives already exist: `apiErrorSchema` (error envelope +
  `ApiErrorCode`), `cursorPaginationQuerySchema` and `cursorPageSchema(item)`.
- Write regexes in schemas **without flags** (`[a-zA-Z]`, not `/…/i`): the
  OpenAPI document is generated from these schemas and JSON Schema patterns
  carry no flags, so a flag would silently vanish from what clients see.
- Web cache tag builders (e.g. `cacheTags.track(id)`) also live here, so the
  API invalidates exactly the tags the web caches with.
- `music-catalog.ts` (with `music-catalog-recording.ts`, the `Recording`
  returned by `getRecording`, and `music-catalog-search.ts`, `search` and its
  summaries) is the **private** WebSocket protocol of the
  Music catalog service (envelope, its own error codes, `status`), spoken
  between internal services only. It never goes through the API's DTOs, so
  it stays out of the public OpenAPI document, and its error codes are not
  `ApiErrorCode`s.
- It is a compiled package (`tsc` → `dist/`). Relative imports use the `.js`
  extension (NodeNext). Turbo builds it before `dev`, `check-types` and `test`.
- Changing an existing field is a breaking change for the mobile app: add new
  fields, deprecate old ones, and bump the API version for incompatible changes.

### TypeScript

- `tsconfig.base.json` is extended by every package: `strict`,
  `noUncheckedIndexedAccess`, `noImplicitOverride`. Don't loosen it per package.
- No `any` (lint error). Use `unknown` + narrowing, generics or Zod parsing.
- No non-null assertions (`!`) to silence the compiler; handle the case.
- Prefer `type` over `interface` (use `interface` only when declaration merging
  is needed). No `enum` in TS: use `as const` objects or Zod enums.
- **Named exports only.** Default exports only where a framework requires them
  (Next `page`/`layout`/`loading`/`error`/`not-found`, config files).
- **No barrel files** (`index.ts` that re-exports) except `packages/*/src/index.ts`
  and the Drizzle schema index.
- All of the above are lint errors. The framework files allowed a default
  export (and the allowed barrels) are listed in the `biome.json` overrides:
  add a new framework file there rather than silencing the rule inline.
  Declaration merging (`interface` augmenting a library) takes a
  `biome-ignore` with the reason.
- File and folder names in **kebab-case** (enforced by Biome). Next's special
  files and Nest's `name.kind.ts` suffixes (`tracks.service.ts`) follow the same rule.
- Comments explain *why*, not *what*. No commented-out code.
- Dates cross the wire as ISO 8601 strings; use native `Date`/`Intl`, no moment.

### Lint & format: Biome only

- One `biome.json` at the root for everything (JS/TS/JSON/CSS). No ESLint,
  Prettier or oxlint.
- Style: 2 spaces, single quotes (double quotes in JSX attributes), semicolons,
  trailing commas, 80 columns, imports organized automatically.
- Promise safety rules on: `noFloatingPromises`, `noMisusedPromises`. Web adds
  Next/React domains and Tailwind class sorting (`useSortedClasses`, also inside
  `cn()`/`cva()`).
- Fix with `nub run format` (or `nub exec biome check --write <files>`). Don't
  disable a rule inline without a comment explaining why.

### Environment & infrastructure

- Every app validates `process.env` with a Zod schema at startup and fails fast
  (api and music-catalog: `src/config/env.ts`, web: `lib/env/server.ts` +
  `lib/env/client.ts`). Code reads config from that
  module, never from `process.env` directly (`noProcessEnv`; only the env
  modules, config files and test setup are exempt in `biome.json`).
- Every env var must be listed in the app's `.env.example` (with a safe local
  default when possible). Never commit real `.env` files or secrets.
- `docker-compose.yml` provides Postgres 17, the API's Redis 8 (6379) and
  MinIO (S3 API on 9000, console on 9001; `minio-init` creates the public
  `vozzify` bucket, so uploads use the same code as production's S3) for
  local development, and includes `apps/web/docker-compose.yml` (`web-redis`
  on 6380, the web's shared cache) and `apps/music-catalog/docker-compose.yml`
  (`music-catalog-postgres` on 5433, the Music catalog's own database, and
  `music-catalog-meilisearch` on 7700, its search engine, with a job that
  creates the two API keys it uses);
  `nub run infra:up` / `infra:down` start and stop all of them. E2E tests
  spin up their own throwaway containers (Testcontainers: Postgres, MinIO and,
  for the Music catalog, Meilisearch) instead of using the dev ones.
- Production is self-hosted: one Docker image per app, published to GHCR by
  GitHub Actions and run on Coolify behind a CDN. Keep apps stateless so they
  can run with multiple instances (shared state lives in Postgres/Redis).
  The exception is the Music catalog: it runs on its own server from a
  single production compose (`docker compose up -d`, no Coolify); see
  `docs/adr/0002-music-catalog-service.md`.
- **Large data needs the maintainer's go-ahead.** Never download a large
  dataset (e.g. the full MusicBrainz dumps) or build
  data or indexes that grow the disk by more than a few GB (e.g. multiplying
  fixtures for a scale test) without asking the maintainer first, with the
  expected size. Use the MusicBrainz **tiny** seed and the e2e fixtures instead.
  Clean up every container, volume and file you create outside
  Testcontainers.

### Testing philosophy

- Pragmatic: test behavior that can break, not framework glue.
- API: unit tests for services (repositories mocked) + e2e tests per endpoint
  against a real Postgres.
- Music catalog: e2e tests over the real WebSocket protocol (a `ws` client
  against the real server and a Testcontainers Postgres) + unit tests for pure
  logic.
- Web: Vitest for pure logic (timeline math, pitch detection, formatters) +
  Playwright for critical flows (search, track page, auth).
- **Every bug fix comes with a test that reproduces it.**

### Code quality metrics

**The quality configs are the source of truth. Never edit them.** That
covers coverage thresholds (`vitest.config*.ts`), Stryker `thresholds`,
`biome.json`, `.jscpd.json`, `.dependency-cruiser.cjs` and `knip.config.ts`.
You may not lower **or raise** a value, add an exception or silence a rule,
not even to adapt them to your change. When your code doesn't meet a gate,
change your code (add tests, split functions, extract duplicates). If a
config really seems wrong, stop and ask the user, with the evidence. Only
the maintainer changes these files.

- **Unit test coverage**: each app's `vitest.config.ts` sets
  `coverage.thresholds` (lines, branches, functions, statements) and
  `nub run test:cov` fails below them. They are a ratchet that only the
  maintainer moves: **never change a threshold** in a PR. When your PR
  raises coverage, report the new numbers in the PR description and leave
  the config alone. Code covered by e2e instead of unit tests (API
  controllers, repositories, modules and schema; web `.tsx` components) is
  excluded from the measurement in the config, so add new unit-testable code
  under a measured path. The API e2e suite has its own thresholds (in
  `apps/api/vitest.config.e2e.ts`, report in `coverage-e2e/`), which cover
  those controllers and repositories; same rule (never change them).
- **Mutation score (optional, local only)**: mutation testing is not a CI
  check or a required PR gate. Stryker (`nub run test:mutation`,
  `stryker.config.json` per app) changes the unit-tested code (flips
  conditions, removes calls, …) and fails when fewer mutants than
  `thresholds.break` are killed (api 58%, web 66%, music-catalog 58%). Same
  rule as coverage: never change it; report an improved score in the PR. A
  surviving mutant
  in code you touched usually means a missing assertion; the HTML report is
  in `reports/mutation/`.
- **Cognitive complexity**: at most 15 per function
  (`noExcessiveCognitiveComplexity` in `biome.json`). Over the limit, split the
  function (extract helpers, return early, name compound conditions); never
  silence the rule with `biome-ignore` or change the limit.
- **Size**: at most 300 lines per file (500 in test files), 50 lines per
  function and 4 parameters per function, blank lines not counted
  (`noExcessiveLinesPerFile`, `noExcessiveLinesPerFunction`, `useMaxParams`;
  test files are exempt from the function limit, since `describe` blocks
  are long by nature). Over a limit, split by responsibility (a module per
  concern, a helper per step, an options object instead of positional
  params). A `biome-ignore` is only for what the code can't change (a
  signature imposed by a library interface, a fixture file) and says why.
- **Architecture**: `nub run lint` also runs dependency-cruiser with each
  app's `.dependency-cruiser.cjs`, which encodes the layer and module rules
  of that app's CLAUDE.md (no import cycles; API and music-catalog: only
  repositories touch Drizzle, handlers/controllers go through services; API:
  modules talk through their service; web: shared code never imports
  features, features use each other only through `components/`). Change the
  code, not the rule. A new rule or exception is the maintainer's call:
  ask first, and if approved it goes in that file with a `comment` saying
  why.

### Dead code (enforced by CI)

- `nub run knip` fails on unused files, exports and dependencies. Delete dead
  code rather than exporting "for later"; export only what another module
  imports. Files the framework loads by convention and documented entry points
  not used yet are listed in `knip.config.ts` with the reason. Adding an
  entry needs the maintainer's approval; removing one as soon as its code
  is used is always fine.

### Duplication (enforced by CI)

- `nub run duplication` (jscpd, `.jscpd.json`) fails when duplicated code
  (clones of 50+ tokens) exceeds 3% of the codebase; today it is ~0.2%. It
  lists every clone: extract the shared part (a helper, a factory, a table
  of cases) instead of copying it. Never change the threshold.

### Tests are the safety net (rules for everyone, including AI agents)

- **Everything new ships with tests in the same PR.** A new endpoint, service
  method, job, component logic, route, migration-dependent behavior or legacy
  route is not done until tests cover it (unit and/or e2e, per the app's
  CLAUDE.md). A PR that adds behavior without tests is incomplete.
- **When a test fails, fix the code, not the test.** A failing test means
  something that used to work broke. Find the root cause in the code and fix
  it. Never make CI green by editing, weakening, skipping (`.skip`,
  `.fixme`, `.todo`), deleting or loosening the assertions of an
  existing test, or by adding retries/timeouts to hide a real failure.
  `.skip`/`.only` are lint errors (`noSkippedTests`, `noFocusedTests`).
- **Never change an existing test without the user's explicit
  authorization**, not even to make it pass after a behavior change the
  user asked for. Ask first; once authorized, change the test in the same PR
  as the behavior and say in the PR description which test changed and why.
- **Always raise tests you left untouched that may now be a problem**: a
  test that still passes but for the wrong reason (e.g. a new guard answers
  first, so the assertion no longer checks what it was written for), one
  that got weaker or redundant, or one that looks wrong (flaky, testing the
  wrong thing). Stop, present the issue with the evidence (which test, what
  it checks now vs. what it was meant to check) and ask the user whether the
  test may be changed. Don't silently "fix" it and don't silently leave it.

### Git workflow

- Branch from `main`, keep branches short-lived, merge via PR with green CI
  (lint, check-types, test, build). Squash merge.
- **Conventional Commits**, scoped by package:
  `<type>(<scope>): <subject>` with types `feat fix refactor perf test docs
  build ci chore style revert` and scopes `web api music-catalog contracts
  repo note-detector` (e.g. `feat(api): add track search
  endpoint`). Enforced by lefthook on commits and by CI on the PR title (it
  becomes the squash commit).
- lefthook `pre-commit` runs Biome on staged files and re-stages the fixes.
  Don't bypass hooks with `--no-verify`.
- One logical change per PR; tooling/refactors separated from features.

## Agent guidance

### Issue tracker

Issues live in GitHub Issues for `Theryston/vozzify` (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root, shared by `apps/web`, `apps/api` and `packages/contracts`. See `docs/agents/domain.md`.

### Asking the maintainer

Put decisions to the maintainer through the AskUserQuestion tool (Claude Code)
or the `question` tool (OpenCode) (clickable
options, recommended one first, at most 4 per call), or one question at a
time. Never a long numbered list of questions in plain text.

### Subagents

`ticket-implementer` (`.claude/agents/ticket-implementer.md` in Claude Code,
`.opencode/agents/ticket-implementer.md` in OpenCode) implements one
`ready-for-agent` issue end to end in its own worktree and opens a PR.
`/subagents-implement <issue numbers>` runs one per issue in parallel, then
reviews each PR, sends fixes back to its implementer and has it drive CI to
green before reporting the PR links.
