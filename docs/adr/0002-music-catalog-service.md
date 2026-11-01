# 2. Music catalog: a separate MusicBrainz + Meilisearch service over WebSocket

- Status: accepted
- Date: 2026-09-30

## Context

vozzify's catalog (Tracks, Artists, Albums) stops depending on YouTube
Music (ADR 0001) and needs its own source of every song in the world to
search and pick from. The data is open: MusicBrainz publishes its database
as dumps plus hourly replication packets, and LRCLIB publishes Lyrics as a
dump. The full design, the spike findings and the search benchmark are in
issue #55 and its comments, and in `docs/research/music-catalog-spike.md`.

## Decision

- **A separate, private service** (`apps/music-catalog`) runs on **its own
  server**, apart from the API.
  - It holds a Postgres restored from the MusicBrainz dumps and kept in sync by
    mbslave, plus Lyrics from LRCLIB and a search index.
  - It is started from a single production compose (`docker compose up -d`) and
    doesn't use Coolify, because its data (about 150-220 GB steady state in
    `full`) doesn't fit the API's stateless, multi-instance model.
- **The API talks to it over one long-lived, authenticated WebSocket.**
  - The protocol is private: a request/response envelope with correlation ids,
    and its own error codes, in `@vozzify/contracts`.
  - Auth is `Authorization: Bearer <key>` on the handshake, with a key list so
    keys can be rotated.
  - It is not part of the public OpenAPI.
- **The unit is the MusicBrainz Recording, never grouped.** A singer may want a
  specific take (e.g. one sung in another key), so a studio take, a live take
  and a remaster are separate results.
- **A Recording is identified by its MBID**, not MusicBrainz's integer id.
  - The integer row disappears on a merge, while `recording_gid_redirect` keeps
    old MBIDs resolvable.
  - A merged MBID answers `RECORDING_MOVED` with the new one, the same pattern
    as ADR 0001.
- **Search uses Meilisearch.** It stores the text used for matching plus the
  compact display fields (Recording MBID, title, printed artist credit and
  primary-release MBID). Search returns those fields in Meilisearch's
  relevance order; cover URLs are derived from the indexed release MBID, and
  Track IDs are read from the Music catalog's Meilisearch documents. Search
  does not hydrate results from either service's Postgres database.
  - Existing documents without the indexed primary-release MBID are handled
    as results without a cover until rebuilt. The established in-place index
    reconstruction resets the bootstrap phase and indexing checkpoints, then
    indexes the existing Postgres rows without reimporting MusicBrainz data;
    searches answer `CATALOG_NOT_READY` until it completes. A blue-green
    reimport rebuilds the index while the serving copy stays available.
  - On the 2.95 M-Recording sample it reached 95.8% recall@10 on title and
    artist, and 91% on title only.
  - It handled typos and prefixes, with p95 latency of 22-97 ms.
  - Tuned Sonic, the first choice, got 84.8% and 49.8%, at an 815 ms p95.
  - The cost is disk: the full index is extrapolated at 79-149 GB.
- **Data licence:** vozzify is non-commercial.
  - It uses MetaBrainz's free non-commercial replication token.
  - Replication packets and the tags/genres dump are CC BY-NC-SA 3.0, so the web
    owes attribution where genres and tags are shown.
- **Sync goes through Postgres triggers into an outbox.** Triggers on the
  MusicBrainz tables feed an outbox that the worker drains into the index, so
  every change (including merges and deletes) survives restarts.
- **The service never goes back to not-ready after the first import.**
  - MusicBrainz's yearly schema change is handled by a CI PR that bumps mbslave.
  - An automatic **blue-green reimport** follows: a parallel copy and new
    indexes are built while the current copy serves, then swapped.

## Considered options

- **Sonic.** Rejected: with defaults, 33% of real queries returned nothing; tuned,
  it was slower and less accurate than Meilisearch.
- **Postgres full-text search.** It is cheaper on disk (about 27 GB for the full
  index), but was measured only in an idealized setup, with no typo or prefix
  matching.
- **Grouping Recordings into songs.** Rejected; see "unit" above.
- **A commercial MetaBrainz account, or CC0 data only.** Not needed while
  vozzify is non-commercial. CC0-only would have meant no replication and no
  genres.

## Consequences

- If vozzify becomes commercial, the MetaBrainz tier and the CC BY-NC-SA data
  (replication and genres) must be revisited first.
- The server needs about 150-220 GB of steady disk in `full`, plus about 260 GB
  temporary per LRCLIB import and about 2x during a blue-green reimport.
  Meilisearch latency depends on RAM.
- Local development and tests use the MusicBrainz sample, a generated fake
  LRCLIB dump and e2e fixtures, never the full data.

## Update (#85)

The official sample dump is dropped: it was too heavy for the local dev
loop. Datasets are now `full` (the official dumps, production) and `tiny`
(300 deterministic Recordings seeded locally in seconds, development). The
recall and latency numbers above were measured on the dropped sample and are
kept as history; `tiny` carries no benchmark. Replication runs only in
`full`, and the Lyrics import keeps only matched Lyrics.

This explicitly supersedes the "Local development and tests use the
MusicBrainz sample, a generated fake LRCLIB dump and e2e fixtures, never
the full data." line above (kept verbatim as history): local development
and tests now use `tiny`, and `full` is verified explicitly before releases
that touch the restore or sizing. The "2.95 M-Recording sample" recall
figures stay as measurements of the dropped dump.

## Update (#311)

The LRCLIB parts of this decision are superseded by
`docs/adr/0010-lyrics-only-from-elevenlabs.md`: the catalog holds no Lyrics
from LRCLIB, so the Lyrics in the Decision, the LRCLIB dump in the Context,
and the temporary disk of its import in the Consequences no longer apply. The
MusicBrainz, Meilisearch, WebSocket and blue-green reimport decisions stand.
The text above is kept as history.

## Update (#384)

Search readiness is loaded from persisted bootstrap state before the WebSocket
server accepts requests, then refreshed in the background every five seconds.
Only one refresh runs at a time. A normal state change is therefore visible to
search within five seconds; this is not an event-to-index latency guarantee.
Refresh failures are logged and retain the last known phase until the next
refresh succeeds, so a database outage does not turn a ready search into a
fabricated empty result. If the initial state cannot be read, the server does
not start accepting requests. Each background read adopts a completed
blue-green cutover before checking the serving database. Search requests consult
the in-memory phase and do not query bootstrap, replication, backlog or reimport
state in Postgres.
Each readiness database read uses a short-lived pool with five-second
connection and query timeouts and a slightly shorter PostgreSQL statement
timeout, leaving time for PostgreSQL to return its cancellation response. A
stalled read releases its connection before process shutdown closes the serving pool; unrelated
catalog queries keep their existing timeout behavior. Stopping readiness also
prevents an in-flight read from adopting a cutover after shutdown begins. Once
the first import reaches `ready`, readiness remains ready while the replacement
copy finishes indexing after cutover, and refreshes continue to observe and
adopt the cutover.

## Update (#385)

Track ownership remains in the API. It sends an exact Recording MBID and
nullable Track ID through the authenticated private protocol; the Music
catalog stores one current association row per MBID and returns its Track ID
from the compact Meilisearch document. The ID is display data only: it is not
searched or indexed for filtering or sorting, and search does no PostgreSQL
association lookup. A coalesced pending flag on that row survives a failed
index task and worker restart.

Metadata reindexing rebuilds complete documents with the current association.
The database-wide advisory write fence serializes those replacements with
association changes, and the same fence closes delivery during cutover. The
parallel copy receives paginated association rows before indexing and mirrors
new deliveries while it is being built. Once switching begins, old-copy
deliveries receive the retryable `REIMPORT_SWITCHING` error; after adoption,
the new copy accepts them. This keeps Track identity API-owned while the
projection survives reimport and retired-database cleanup. MusicBrainz merge
redirects do not move or choose associations between MBIDs.

Pending association indexing scans keyset pages rather than stopping when a
page contains only MBIDs whose Recording rows are not present yet; those rows
stay pending and remain recoverable when a later metadata index pass creates
the complete document. Reimport recovery swaps a private generation-marker
index pair atomically with the Recording pair. The marker carries the
PostgreSQL database OID, so a restart can tell exactly whether the target copy
is active even when old and new catalogs share the same first Recording IDs.

## Update (#386)

When a Track is created, the API inserts its Recording MBID and Track ID into
`track_association_events` inside the same PostgreSQL transaction as the Track,
its first Processing and Contribution. The outbox row is therefore committed
only when Track creation commits. A BullMQ scheduler polls the outbox every
five seconds; Redis schedules delivery but PostgreSQL owns the pending work.

Workers claim bounded batches with a one-minute lease, deliver through the
authenticated `associateTrack` WebSocket operation, and mark rows delivered
only after the catalog acknowledgment. Failed deliveries receive durable
exponential backoff capped at ten minutes. If the worker stops after the
catalog accepted an association but before the API saved its acknowledgment,
the expired lease causes an idempotent resend after restart. Successfully
delivered rows are deleted in batches after 30 days; pending rows are never
eligible for cleanup. This adds no environment variables and keeps Track
creation independent of catalog delivery and search indexing.

## Update (#387)

Public API search now forwards compact catalog results directly, including
their nullable Track IDs. Before switching an environment to this path, an
operator runs `node dist/main.js --sync-track-associations` against the API
image. The command keyset-pages every existing API Track through the
authenticated durable outbox and waits for catalog acknowledgments and
concurrent pending events before succeeding. It can be rerun to restore a lost
projection. Track creation continues to populate the same outbox; no periodic
reconciliation scan is added. See `docs/track-association-sync.md` for the
cutover and recovery steps.

## Update (#427): API search fallback

Sonic is an API-owned reserve index for Tracks with at least one completed
Processing. It stores each Track ID and searchable title/artist text; the API
database remains the source of truth. The public API hydrates Sonic hits
through the Tracks service and drops stale or ineligible IDs while preserving
Sonic's order. The Music catalog remains the preferred complete-catalog search
engine, and Meilisearch remains its internal index. Their coverage and
relevance differ by design.

Production Sonic must run with persistent storage outside the Music catalog's
household network and failure domain. Operators rebuild it from bounded
keyset pages using `node dist/main.js --sync-sonic-index`; the command marks
the index ready only after it has finished. A lost or uninitialized index
returns the existing retryable `SERVICE_UNAVAILABLE` response when used as
fallback. Sonic is not a Processing dependency, and this slice does not add
automatic delivery for later completions; that work is tracked separately.
See `docs/track-search-sonic.md` for local verification and recovery steps.
