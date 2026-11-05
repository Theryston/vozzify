<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# apps/web — Next.js frontend

Read the root `CLAUDE.md` first; this file only adds web-specific rules.

Stack: Next.js 16 (App Router, **Cache Components** enabled), React 19,
Tailwind CSS v4, shadcn/ui (`base-nova` style on **Base UI**, not Radix),
next-intl, TanStack Query, react-hook-form + Zod, nuqs, Zustand, lucide-react.

**Top priority: speed.** Every page should feel instant. Prefer a prerendered
static shell + streamed dynamic holes over anything that blocks on a request.
If a change makes a page slower or grows the client bundle, justify it.

This Next.js version differs from your training data (`proxy.ts` instead of
`middleware.ts`, `'use cache'`, `cacheLife`/`cacheTag`/`updateTag`,
two-argument `revalidateTag`, `next/root-params`, …). Check
`node_modules/next/dist/docs/` before using a Next API.

## Commands

```sh
nub run dev          # next dev on port 3000
nub run build        # production build (also validates prerendering)
nub run check-types  # next typegen + tsc
nub run lint
nub run test         # Vitest unit tests (*.test.ts)
nub run test:cov     # unit tests + coverage thresholds (report in coverage/)
nub run test:watch
nub run test:e2e     # Playwright against `next start` (see Testing)
nub run bundle:check # first-load JS per page vs the budget (after build)
nub run lighthouse   # Lighthouse CI on the production build (after build)
```

## Folder structure

```
app/
  [locale]/                 every user-facing route is under the locale segment
    layout.tsx              root layout (html lang, providers, fonts)
    (site)/                 pages with the site header (auth pages stay outside)
      layout.tsx            site header + <main id="main">
      page.tsx              home
      tracks/[trackId]/page.tsx
      search/page.tsx
      ...
  api/revalidate/route.ts   secret-protected endpoint the API calls to invalidate tags
features/                   domain code, one folder per feature
  tracks/
    components/             feature components (server by default)
    queries.ts              server-side cached fetchers ('use cache')
    actions.ts              server actions (when needed)
    hooks/                  TanStack Query hooks (use-*.ts), client only
    query-keys.ts           TanStack query key factory
    stores/                 Zustand stores, only for complex client state
  timeline/ auth/ search/ users/ streaks/ ...
components/
  ui/                       shadcn/ui components (generated)
  *.tsx                     generic, domain-agnostic shared components (header, container…)
hooks/                      generic shared hooks
lib/
  api/                      typed API client (server + browser)
  i18n/                     next-intl routing/request config
  env/                      Zod-validated env: server.ts (server-only), client.ts (NEXT_PUBLIC_*)
  query-client.ts           TanStack Query client factory
  utils.ts                  cn() and tiny helpers
messages/
  en.json                   source of truth
  pt-BR.json
proxy.ts                    custom locale detection + redirect (not next-intl's middleware)
instrumentation.ts          validates env when the server starts
cache-handlers/             Redis-backed handler for 'use cache' (loaded by Next outside the bundle)
scripts/                    build checks run with Node (bundle budget)
docker-compose.yml          web-redis for local dev (included by the root compose file)
```

- Route files (`page.tsx`, `layout.tsx`, `loading.tsx`) stay **thin**: read
  params, call feature fetchers, compose feature components. No business logic
  or big JSX trees in `app/`.
- A feature may import from `components/`, `hooks/`, `lib/` and other
  features' public components; avoid circular feature dependencies.
- `features/<f>/queries.ts` and anything touching secrets import
  `'server-only'`; client hooks/stores start with `'use client'` where needed.

## Legacy routes

This app replaces the legacy notefinder web app at `notefinder.com.br` with
Vozzify at `vozzify.com`. **Every
legacy URL must keep working**: either the route still exists or it
redirects to the new one. Redirects keep dynamic segments (IDs, usernames)
and query params as they are, except the legacy catalog ID redirect below,
which swaps the ID for the new one. Usernames are kept by the data import, so
`/users/<username>` lands on the same profile. Catalog records (tracks,
artists, albums) get new IDs: when the API answers a read with
`RESOURCE_MOVED` (the ID is a legacy one, found in the entity's legacy ID
map), the page issues a **permanent (308)** redirect to the same route with
the new ID, keeping the query params (see "Legacy data import" in
`apps/api/CLAUDE.md`). When a catalog route ships, its e2e covers that case
too: a legacy ID redirects with 308 to the new one.

Explicitly skipped Track, Artist and Album identities are the accepted
exception: their URLs return a real 404 and the migration report identifies
each source ID and reason (ADR 0001). Pending identities remain pending,
and accepted Tracks keep their URLs through queued, running and failed
Processing states; launch does not wait for the whole backlog to complete.

Because every new route is under `[locale]`, a bare legacy path like
`/tracks/abc` is redirected by `proxy.ts` to `/<detected-locale>/tracks/abc`
(see i18n below). That redirect depends on the visitor, so it is a temporary
**307** and must not be cached as a shared response by the CDN. When a route
is renamed, add an explicit **permanent (308)** redirect from the old path to
the new one (in `next.config.ts` `redirects()`, or in `proxy.ts` if it needs
logic) and list it below.

Legacy public routes (source: `app/` in
<https://github.com/theryston/notefinder>) and their current status:

| Legacy route | Query params | New route |
| --- | --- | --- |
| `/` | | `/[locale]` |
| `/search` | `q` | `/[locale]/search` |
| `/tracks/[id]` | `time`, `timeline-focus` | `/[locale]/tracks/[trackId]` |
| `/artists/[id]` | | `/[locale]/artists/[artistId]` |
| `/albums/[id]` | | `/[locale]/albums/[albumId]` |
| `/users/[username]` | | `/[locale]/users/[username]` |
| `/me/edit` | | `/[locale]/me/edit` |
| `/sign-in` | `redirectTo` | `/[locale]/sign-in` |
| `/sign-up` | `redirectTo` | `/[locale]/sign-up` |
| `/verify-email` | | `/[locale]/verify-email` |
| `/forgot-password` | | `/[locale]/forgot-password` |
| `/forgot-password/reset` | `email` | `/[locale]/forgot-password/reset` |
| `/setup-username` | `redirectTo` | `/[locale]/setup-username` |
| `/terms` | | `/[locale]/terms` |
| `/sitemap.xml` | | `/sitemap.xml` |
| `/tracks/sitemap/[...path]` | | kept: same URL, `app/tracks/sitemap/[...path]/route.ts` |
| `/artists/sitemap/[...path]` | | kept: same URL, `app/artists/sitemap/[...path]/route.ts` |
| `/albums/sitemap/[...path]` | | kept: same URL, `app/albums/sitemap/[...path]/route.ts` |

Keep this table up to date whenever a route is added, renamed or removed,
and mirror it in `e2e/legacy-routes.ts`: every legacy URL is checked to
redirect to its locale-prefixed equivalent (path and query kept). When a
route ships, flip its `implemented` flag (with a sample ID that resolves) so
the test also asserts the final page is not a 404.

## Rendering, data fetching and cache

**Server first.** Components are Server Components unless they need state,
effects, browser APIs or event handlers. Put `'use client'` on the smallest
leaf possible and pass server-fetched data down as props.

### Server (initial render)

- All server reads go through `lib/api` (typed fetch wrapper around `API_URL`)
  and are parsed with the `@vozzify/contracts` schemas. Errors surface as a
  typed `ApiError` (envelope `{ statusCode, code, message }`).
- Feature fetchers in `features/<f>/queries.ts` use `'use cache'` +
  `cacheTag(...)` + `cacheLife(...)`. Tag names come from the shared tag
  builders in `@vozzify/contracts` (the API invalidates the same tags).
- Public data (tracks, notes, artists, home sections): `'use cache'` (use
  `'use cache: remote'` for data that must be shared across instances in
  production). Pick the longest `cacheLife` that is still correct; freshness
  comes from tag invalidation, not short lifetimes.
- User-specific data: never read `cookies()`/`headers()` inside a shared cache.
  Either extract the user id and pass it into a cached function, or use
  `'use cache: private'`. Anything that reads the request sits behind
  `<Suspense>` so the rest of the page stays in the static shell.
- Every `<Suspense>` fallback is a skeleton with the **same dimensions** as the
  final content (zero layout shift).
- Use `generateStaticParams` for locales and for the most popular tracks so
  hot pages are prerendered at build time.
- Invalidation: after a mutation made from the web, use `updateTag` (in a
  server action) for read-your-own-writes; changes made elsewhere are
  invalidated by the API calling `app/api/revalidate` (`revalidateTag(tag,
  'max')`).

### Client (interactions)

- Client-side server state uses **TanStack Query** only (never `useEffect` +
  `fetch`). Hooks in `features/<f>/hooks/use-*.ts`, keys from
  `features/<f>/query-keys.ts`. The browser calls the API directly via the
  `lib/api` browser client (`credentials: 'include'`).
- Use it for things that change after load: favorite toggle, track processing
  status polling, search-as-you-type, streak heartbeat. Prefer optimistic
  updates for toggles.
- When a client component needs data the server already has, prefetch on the
  server and pass it via `HydrationBoundary` (or as `initialData`) so there is
  no loading flash.

### Performance checklist

- `next/image` with correct `sizes` for all images; `next/font` for fonts.
- Heavy client-only libraries (YouTube player, Tone.js, pitch detection,
  Lottie) are loaded with dynamic `import()` only on the pages that need them.
- Keep client components small; check the bundle impact of new dependencies.
  **Bundle budget**: `nub run bundle:check` (after `nub run build`, also in
  CI) fails when a prerendered page's first-load JS exceeds
  `MAX_FIRST_LOAD_KIB` (gzipped) in `scripts/bundle-budget.ts`. Fix it with
  dynamic `import()`, a smaller dependency or moving work to the server;
  raising the budget needs the reason in the PR.
- **Lighthouse** (`nub run lighthouse`, in CI after the e2e tests): every
  page in `lighthouserc.cjs` must score ≥ 90 performance and ≥ 95
  accessibility, best practices and SEO, with LCP ≤ 2.5 s, TBT ≤ 200 ms and
  CLS ≤ 0.1 (desktop, median of 3 runs). Add each new public page to its
  `url` list (with a sample ID that resolves). Locally, point `CHROME_PATH`
  at a Chrome/Chromium binary if none is installed.
- No request waterfalls: start independent fetches in parallel
  (`Promise.all`) or in sibling Suspense boundaries.
- **Shared cache**: `cache-handlers/redis.ts` backs both `'use cache'` and
  `'use cache: remote'` (in-process LRU in front of Redis). With
  `CACHE_REDIS_URL` set, every instance shares entries and tag invalidations
  reach all instances within ~1 s (prerendered pages included); without it
  (local dev, CI, `next build`) Next's default in-memory cache is used. Redis
  being down degrades to the local tier, never to errors. So plain
  `'use cache'` is already shared; no need to reach for `remote`.
- `cache-handlers/*.ts` is imported by Next natively (Node type stripping,
  not bundled): relative imports with the `.ts` extension, only erasable
  TypeScript syntax, no `@/` aliases and no `server-only`. It relies on Next
  internals (`createDefaultCacheHandler`, the tags manifest): **re-check it
  (and its tests) whenever Next is upgraded** (`next` is pinned exactly).

## i18n (next-intl)

- Locales: `en` and `pt-BR`, always in the URL (`/en/...`, `/pt-BR/...`).
  Routing config in `lib/i18n/`, locale detection/redirect in `proxy.ts`.
- `proxy.ts` is **custom** (next-intl's middleware can't detect by country and
  sets cookies on prefixed paths). It must never set cookies or redirect on
  paths that already have a locale, so static pages stay CDN-cacheable.
  Detection logic lives in plain functions in `lib/i18n/detect-locale.ts`.
- The locale is read from `next/root-params` in `lib/i18n/request.ts` (don't
  use `setRequestLocale`). Route Handlers and Server Actions can't read root
  params: pass `{ locale }` explicitly to next-intl there.
- `en` is the **source of truth** for messages, not the locale everyone gets.
  A request without a locale prefix is redirected to the visitor's locale,
  resolved in this order:
  1. the locale the user picked before (next-intl locale cookie);
  2. the user's location: the country header set by the CDN/proxy (e.g.
     `cf-ipcountry`), mapped to a supported locale (`BR`, `PT`, `AO`, `MZ` →
     `pt-BR`, …);
  3. the browser's `Accept-Language`;
  4. `en` when none of the above matches a supported locale.
- The locale switcher lets users override it and stores the choice in the
  cookie. Once a URL has a locale prefix, that locale is always respected (no
  auto-redirect away from it), so shared links and crawlers get stable pages.
- **No hard-coded user-visible strings** — including `alt`, `aria-label`,
  `title`, placeholders, toasts, metadata and validation messages.
- Messages are namespaced by feature (`tracks.overview.title`,
  `common.actions.save`). Add every key to **both** `en.json` and `pt-BR.json`
  in the same change. Keys are typed (next-intl `AppConfig` augmentation), so a
  missing/typo key fails `check-types`; `lib/i18n/messages.test.ts` fails when
  a locale's keys differ from `en`, a message is empty, or an API error code
  has no `errors.<CODE>` message.
- Use ICU placeholders and plurals; never concatenate translated fragments.
  Format dates, numbers and durations with next-intl's formatter, not manually.
- API errors are translated by their `code` (`errors.NOT_FOUND`, …), never by
  showing the API `message`.
- Metadata is translated. The locale layout sets title template and
  description and `metadataBase` (from `getSiteUrl()`), so the relative
  URLs each page sets become absolute; **each page** sets hreflang/canonical
  with `localeAlternates(locale, path)` from `lib/i18n/metadata.ts` (a layout
  doesn't know the current path).
- Only the message namespaces client components need are passed to
  `NextIntlClientProvider`: `errors` (root layout), `header` (the `(site)`
  layout), and `home` plus `tracks.card` (the home feed's rows, in
  `features/home/components/home-feed.tsx`). Add namespaces deliberately to
  keep the RSC payload small.

## UI and styling

- shadcn/ui components are added with `nub exec shadcn add <component>` and
  then formatted with `nub run format`. Customize via variants/`className` or
  wrap them in `components/`; avoid rewriting their internals.
- Follow the design system in the root `DESIGN.md` (pill controls,
  `rounded-2xl` surfaces, `glass` floating layers, Figtree, Lucide at 1.75
  stroke, spring motion). `components/ui/button.tsx` is already adapted to it.
- Tailwind v4 with the design tokens in `app/globals.css`. Use theme tokens
  (`bg-background`, `text-muted-foreground`, …), not raw hex colors or
  arbitrary values, unless there is no token for it. Dark mode via
  `next-themes` (class strategy) must work on every screen.
- Merge classes with `cn()`; component variants with `cva`.
- Accessible by default: semantic HTML, keyboard navigable, visible focus,
  labels for inputs, `alt` for images.
- Mobile-first: every screen must work on small screens (the timeline in
  landscape/fullscreen, as in the original app).

## Forms and client state

- Forms: react-hook-form + `zodResolver` using the **contracts schema** of the
  endpoint being called. Validation messages are i18n keys mapped from the
  Zod issue, not hard-coded text. Show API error codes translated.
- State placement:
  - server data → TanStack Query (client) or props (server);
  - URL state (search query, filters, tabs, pagination) → `nuqs`;
  - local UI state → `useState`/`useReducer`;
  - complex shared client state (player/timeline: playback time, transpose,
    speed, mic on/off, detected pitch) → a Zustand store in
    `features/<f>/stores/`, read through selectors.
- High-frequency values (current playback time, pitch at 60 fps) must not
  re-render React trees: keep them in refs/store subscriptions and draw with
  `requestAnimationFrame`/canvas.
- No React Context for frequently changing state.

## Auth

- Better Auth lives in the API. The client is `getAuthClient()` in
  `lib/auth/client.ts` (`better-auth/react` with the `emailOTP` and
  `username` plugins) for sign up/in/out, OTP verification, password reset
  and setting the username. Its responses use Better Auth's format, not
  `ApiError`: translate its error codes through i18n too
  (`features/auth/auth-error.ts`, `authErrors.<CODE>`).
- Keep auth pages inside the bundle budget: load the client on demand with
  `loadAuthClient()` (`features/auth/auth-client.ts`) instead of importing
  it, wrap calls in `authRequest()` (a thrown network error becomes a
  returned one), validate forms with `lazyResolver()` (Zod loads on the first
  validation) and import plain constants from
  `@vozzify/contracts/auth-rules`, which has no Zod.
- The session on the client is a TanStack query (`sessionUserOptions()` in
  `features/auth/session.ts`: a plain `GET /v1/auth/get-session`, `null` when
  signed out), not Better Auth's `useSession()`. Update it after anything
  that changes the session (verify email, set username, sign out), or
  screens reading it act on stale data.
- **Onboarding gate**: `AuthGate` (in the locale layout) sends a signed-in
  user with an unverified email to `/verify-email`, then one without a
  username to `/setup-username`, from any page, keeping where they were
  going in `redirectTo`. It runs in the browser so pages stay static;
  signed-out visitors are never redirected. Those steps always offer "Sign
  out", and changing the email signs out first. The rule is
  `requiredAuthStep()` in `features/auth/auth-gate.ts`.
- On the server, `getCurrentUser()` from `lib/auth/session.ts` calls
  `GET /v1/me` forwarding the request cookies (deduplicated per request) and
  returns `null` when signed out.
- Session-dependent UI (avatar in the header, "favorite" state) is rendered
  inside `<Suspense>` so it never blocks the static shell.
- **Private pages** follow `/me/edit` (`EditProfile` in
  `features/auth/components/`): the page and its heading stay static, the
  session is read in the browser, a skeleton shows meanwhile, signed-out
  visitors go to sign in with `redirectTo` and the username step is
  `AuthGate`'s. Saving calls the API from the browser (`PATCH /v1/me` as
  `FormData` through `browserApi`, loaded on the first save) and writes the
  answer into the session query, so the header shows it at once. The Avatar
  is picked with `AvatarPicker` (local preview through an object URL) and
  sent as the `avatar` file part of that same request; the file is checked
  before the upload with `avatarFileProblem()`
  (`features/auth/avatar-file.ts`), which reads the limits from
  `@vozzify/contracts/avatar-rules` (no Zod). The API still decides from
  the file's content. Toasts use `components/ui/sonner` (`Toaster` mounted by
  the page that toasts).
- **Zod stays out of first-load JS.** `lib/api/api-error.ts` (the
  `ApiError` class, imported by the query client on every page) must not
  import a contracts value: the first client use of `browserApi` once pulled
  Zod (~89 KiB gzipped) into every page through it. Parsing lives in
  `lib/api/error-response.ts`; forms load their schema with `lazyResolver()`.

## Env

- `lib/env/server.ts` (`server-only`: `API_URL`, `REVALIDATE_SECRET`) and
  `lib/env/client.ts` (`NEXT_PUBLIC_API_URL`) validate env with Zod. They are
  read on demand and checked at server start by `instrumentation.ts`, so
  `next build` needs no secrets. Server-only values never get the
  `NEXT_PUBLIC_` prefix.
- `CACHE_REDIS_URL` (optional, server-only) enables the shared Redis cache;
  it's read by `cache-handlers/redis.ts` and also validated in
  `lib/env/server.ts`. Production: set it on **every** web instance, use a
  Redis with `maxmemory-policy volatile-lru` (so tag keys are never evicted)
  and persistence, and ship `cache-handlers/` next to `.next/` in the image.
- `E2E_FAKE_PLAYER` (`true` | `false`, server-only, default `false`) makes the
  practice page play through a fake clock instead of YouTube (the player
  port's fake implementation). Only `e2e/web-server-env.ts` sets it.
- `NEXT_PUBLIC_*` values are inlined at build time: the Docker build must
  receive them as build args. That includes `NEXT_PUBLIC_SITE_URL`
  (`getSiteUrl()`, default `http://localhost:3000`), which static pages bake
  into canonical/hreflang URLs; a production build without it logs a warning.

## Testing

- Vitest for pure logic: `*.test.ts` next to the file (timeline math, note
  conversion, pitch detection, formatters, API client parsing).
- Playwright for critical flows in `e2e/`: search → open track, track page
  playback/timeline, sign up/in, favorite. It runs against a **production
  build** with `next start` on port 3000, using the dummy env in
  `e2e/web-server-env.ts`. From the repo root, `nub run test:e2e` builds web
  first (Turbo); running it inside `apps/web` uses whatever `.next` is on disk,
  so rebuild (or delete `.next`) after switching branches.
- Chromium: CI runs `playwright install`. Machines with a preinstalled
  Chromium that doesn't match the pinned `@playwright/test` set
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` (Claude Code cloud sessions get it
  from `.claude/hooks/session-start.sh`).
