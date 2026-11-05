# 1. Reprocessed catalog with legacy ID maps

- Status: accepted
- Date: 2026-09-30

## Context

vozzify replaces the legacy app (<https://github.com/theryston/notefinder>)
on the same domain, so no legacy URL may return 404. The first plan was to
import all legacy data keeping its IDs as primary keys, which made the new
schema follow the legacy Prisma model: nullable columns the legacy rows need,
enums copied 1:1, YouTube Music IDs as the catalog's identity.

The catalog is changing architecture: tracks, artists and albums will come
from vozzify's own database and search instead of YouTube Music, and every
track will be reprocessed. Keeping legacy IDs and shapes for data that is
rebuilt anyway only constrains the new design.

## Decision

- **The legacy catalog is not imported.** Tracks, artists and albums are
  reprocessed into a schema designed for the new app, and get new IDs.
- **Every table with a public URL gets a legacy ID map**, created in the same
  PR as the table, e.g. `legacy_track_ids (legacy_id text primary key,
  track_id text not null references tracks(id) on delete cascade)`.
  Several legacy IDs may map to one record (legacy has duplicates).
- **A legacy ID in a URL resolves through that map.** When a read by ID finds
  nothing, the API looks the ID up in the map and, on a hit, answers 404 with
  the stable code `RESOURCE_MOVED` and the new ID; the web turns it into a
  permanent redirect (308). A 404 with a code (instead of an HTTP redirect)
  keeps server-side `fetch` from following it silently and lets the mobile
  app handle it the same way. The code joins `apiErrorSchema` with the first
  catalog table.
- **Users keep their legacy ID**, username, email and password hash: sessions,
  OAuth accounts and every user-owned row reference the user ID, and profile
  URLs use the username. Users need no map.
- **User-owned data that points to the catalog** (favorites, views, created
  tracks) is translated through the maps at import; rows whose catalog record
  has no new equivalent are dropped and listed in the import report.
- **Tables are created with the feature that uses them.** The schema starts
  with the auth tables only, and migrations restart from a single initial one
  (no database existed yet).

## Consequences

- The schema is free to model the catalog for the new architecture and its
  queries.
- The import script only handles users, their data and the maps, and runs
  once at launch.
- A legacy catalog URL whose record was never reprocessed has no map entry
  and returns a real 404.
- Each new catalog route ships with an e2e case for its legacy redirect.

## Follow-up: staged cutover (#463)

The accepted migration may explicitly skip a Track with no acceptable
Recording match, or an Artist/Album identity without sufficient canonical
metadata evidence. The operator report lists each source ID and reason,
including dependent favorites and views excluded with skipped Tracks.
These Track, Artist and Album URLs may return a real 404. This narrows the
original universal URL promise; pending work and transient provider failures
never become skips. Reprocessing, new catalog IDs, many-to-one maps and
ADR 0003's release-group Album identity remain unchanged.

Launch readiness requires imported Users and independent data, prepared
accepted Tracks and their maps, and imported required User relationships.
It does not require every Processing to finish. Public pages expose normal
queued, running, completed and failed states while the bounded backlog
continues. Full migration completion additionally requires terminal
Processings and resolved metadata/map work, with explicit exclusions in the
report. Failed Processings remain retained outcomes with their Track,
attribution and maps; they are not retroactive catalog skips.
