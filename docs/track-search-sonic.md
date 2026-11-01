# Sonic fallback search

Sonic is a small reserve index for API Tracks whose Processing has completed.
The Music catalog remains the preferred search source. Sonic indexes only the
Track ID, title and artist credit; PostgreSQL provides public result fields.

## Local setup and rebuild

`nub run infra:up` starts the local Sonic service on TCP port 1491 with its
persistent `sonic-data` volume. Set `SONIC_HOST`, `SONIC_PORT` and
`SONIC_AUTH_PASSWORD` from `apps/api/.env.example`. The local password is only
for development.

After completing at least one Processing for a small test Track, rebuild from
the API database:

```sh
nub run --filter=api build
nub run --filter=api sync:sonic-index
```

The command reads eligible Tracks in keyset pages of 200 and logs each page.
It is safe to rerun after interruption or index loss. Search stays unavailable
through Sonic until the command writes its readiness marker at the end. Check
the API logs for the final indexed page before exercising fallback. With no
override, each Sonic command has a 5-second deadline; the tiny nine-Track seed
index completed with that default.

## Verify outage and recovery

Start the API and the Music catalog with a Track that has completed Processing,
then confirm its ordinary search returns `source: "music-catalog"`:

```sh
curl 'http://localhost:3333/v1/search?query=your%20track'
```

Stop the local Music catalog process while leaving Sonic and the API running.
Repeat the same request. It should return the same API Track with
`source: "sonic"` and its existing `trackId`. Further requests should continue
using Sonic while the catalog is disconnected. Restart the Music catalog; the
API verifies search in the background, and subsequent requests return to
`source: "music-catalog"` after that probe succeeds. The probe result is never
returned to the visitor.

If Sonic is empty or unreachable, it does not count as an empty successful
fallback: the endpoint returns the existing `503 SERVICE_UNAVAILABLE` envelope
when the Music catalog is also unavailable.

## Browser fallback check

The `search-real-sonic.spec.ts` browser test starts with a catalog-ranked page,
then forwards the next page and the pagination restart to a real API on port
4336. The API must have the seeded completed Tracks indexed in Sonic and the
Music catalog unavailable. In separate terminals, migrate and seed the local
API database, then rebuild Sonic:

```sh
nub run --filter=api db:migrate
nub run --filter=api db:seed
nub run --filter=api sync:sonic-index
```

Start the API with a deliberately unreachable catalog and the local Sonic
settings from `apps/api/.env.example`:

```sh
PORT=4336 MUSIC_CATALOG_URL=ws://127.0.0.1:1 \
MUSIC_CATALOG_API_KEY=local-placeholder-key-at-least-32-characters \
nub run --filter=api dev
```

Then run the dedicated browser spec from the web app directory:

```sh
nub run --filter=web test:e2e:real-search
```

It asserts that the page discards the old catalog ranking, restarts at offset
zero on the real Sonic response, and links the completed result to its existing
Track. The ordinary `search-source.spec.ts` still covers source changes in
both directions in the mocked browser suite.

## Production placement

Run Sonic as its own service near the API and PostgreSQL, with a persistent
volume backed up independently. Place it outside the Music catalog's home
server and Internet connection. Configure the service host, port, and channel
password in the API environment. Before directing production search traffic
through fallback, run the rebuild command against the production API database
and verify a known completed Track through the public endpoint. The Music
catalog's Meilisearch remains unchanged.
