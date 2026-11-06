# 11. The home feed is generated off the request path and cached in three layers

- Status: accepted
- Date: 2026-10-20

## Context

The home page is a feed of rows (a hero, carousels, lists) that the visitor
pages through. Visitors arrive in bursts (paid traffic), and the feed reads
every completed Track. Computing it inside a request would make every burst a
burst of database work, and a feed regenerated while a visitor pages would
repeat or skip rows.

The public feed is the same for every visitor, so it can be computed once and
served from shared caches. A signed-in visitor gets the same public feed for
now; the personal feed (a later slice) will need the session to be kept out of
shared caches.

## Decision

**One endpoint.** `GET /v1/home?cursor=` is public and optional-auth. It
answers one page of at most six rows. The response carries `audience`
(`public`), the feed `version`, the `algorithmVersion` and `nextCursor` (null on
the last page). The response contract lives in `packages/contracts/src/home.ts`;
clients ignore layouts they do not know.

**The feed is computed by a background job, never by a request.**

- A repeatable job (`refresh-public-home-feed`, `0 * * * *` UTC) rebuilds the
  public feed every hour.
- The processor also rebuilds it once at boot, awaited in `onModuleInit`, so
  the feed is in Redis before the app reports ready. A failure there is logged,
  not fatal.
- The builder loads candidate rows (`home-row-sources.ts`), the pure composer
  (`home-feed-composer.ts`) turns them into rows, and the builder maps them to
  the contract. The composer enforces: ordinary discovery Tracks appear once
  per feed; the ranked weekly chart retains its collective order and may
  overlap the hero; chart Tracks are reserved from other discovery rows; at
  most two Tracks of one artist appear per row; a row below its layout minimum
  is dropped and leaves its Tracks free; only Tracks whose Processing
  completed; a hero needs a cover. The weekly chart and standard musical
  recommendation rows may render with three eligible Tracks; generic standard
  layouts keep their six-Track minimum. The chart holds at most ten positions.

Featured Albums are selected by the completed Tracks they add to the Albums
already chosen. Shared Track popularity contributes only once; an Album with no
additional available Track is omitted, and partial overlap is ranked by the
popularity of its additional Tracks. Equal scores prefer a known
non-compilation, available cover, oldest known year, then stable ID. Candidate
retrieval uses at most four pages of 60 candidates, and the Album Row needs
three items (up to twelve). Calibrated variety, concentration and overlap
coefficients remain inactive until validated; see the
[unvalidated bounded comparison](../home-album-calibration-proposal.md).

**The version is a content hash.** `version` is a SHA-256 of the algorithm
version and the rows, truncated to 16 hex characters. An unchanged feed keeps
its version, so its cursors stay valid and the web is not revalidated for
nothing.

**Redis holds three things** (through `CacheService`, which fails open):

| Key | Holds | Lifetime |
| --- | --- | --- |
| `home:public:current` | the current feed | 2 hours, rewritten by every run |
| `home:public:version:<version>` | a feed replaced by a newer version | 30 minutes |
| `home:public:lock` | the build lock | 30 seconds |

**Paging is pinned to a version.** The cursor is an opaque tuple of the feed
version and the index of the next row. A page resumes the version it names: if
that version is the current one, or was replaced in the last 30 minutes, the
rows are the same as the visit started with, so a regeneration never repeats or
skips rows. A version that is gone answers `404` with `NOT_FOUND` and
`details.reason = FEED_VERSION_EXPIRED`; the client restarts from the first
page. A cursor whose version is not a feed hash is refused as
`VALIDATION_FAILED` before it is used as a key.

**A missing feed is built once.** When a request finds no current feed, it takes
the lock and builds the feed; the others get the minimal home (an empty feed,
version `minimal`) with `Cache-Control: no-store`, so no cache keeps it. Requests
never fan out to the database. When Redis cannot answer, the lock fails open
(the caller builds), which matches the rest of the cache: an outage costs
database load, never an error.

**The web is revalidated only on change.** `refreshPublic` compares the new
version with the current one. When they differ it enqueues one revalidation of
`cacheTags.home` through `WebRevalidationService` and only then commits the new
feed (retiring the old one). If the enqueue fails, nothing is committed, so the
job's retry still sees a change and revalidates.
The request path also revalidates after it builds a missing feed, but a failure
there is logged and the request still answers, since the next change revalidates
anyway.

**Cache headers and the CDN.** The public response sends
`Cache-Control: public, max-age=60, s-maxage=600, stale-while-revalidate=3600`.
The minimal fallback sends `no-store`. Errors send no `Cache-Control`, so a
shared cache does not keep them. Because the same body goes to signed-in and
anonymous visitors, the feed itself carries no personal data. The CDN must
bypass its cache whenever a session cookie is present: that is the rule for
the personal feed, which this slice does not ship yet, and the rule is
configured at the CDN, not in the API.

## Consequences

- A visit reads its rows from Redis; a burst of visitors costs one build per
  hour (plus one per content change), never one per request.
- The hero is the hottest Track with a cover. It may share a Track with the
  collective weekly chart, whose membership and order are independent of
  earlier rows; the chart's Tracks remain available for resume rows in personal
  feeds.
- Adding a row source or a layout is a change to the sources and the layout
  rules, not to the endpoint.
- There is one public feed per locale (`en`, `pt-BR`). Each has its own version,
  Redis entries, build lock, hourly refresh and web cache tag (`home:<locale>`),
  so regenerating one locale never drops the other's cache. A feed's version
  hashes its locale, so a cursor names one locale's feed by its version alone.
- `GET /v1/home` takes an optional `locale`: omitted, it is `en`; an unsupported
  value is refused with `VALIDATION_FAILED`. A cursor ignores it, since the
  version it carries already names the feed.
- The trending row ranks by each locale's own views once that locale has enough
  of them this month; see ADR 0009, "Locale trending".
- The "trending today" row ranks by the existing trending score, which already
  weighs the calendar windows of the day, the week and the month. It is not a
  pure day count.

**Composition rollout and cached versions.** Algorithm version 4 marks the
combined composition and Album-selection change: a short ranked chart can
survive, the weekly chart is truthful and reserved against discovery
duplication, daily-target ordering is handled in the personal overlay, and
Featured Albums are selected by useful Track content. Existing snapshots keep
their stored algorithm marker and remain readable until their normal cache
expiry; a first-page read queues a refresh when the marker differs. Reverting
the composition while keeping Album selection requires restoring version 3
and allowing version-4 cached feeds to expire or rebuilding them through the
regular refresh jobs.

## Alternatives considered

- **Compute in the request, cache the response.** Rejected: a cold cache under a
  burst still runs the queries once per concurrent request, and paging across a
  regeneration could not be made consistent.
- **A dedicated error code `CURSOR_EXPIRED` with 410.** Rejected for now: every
  error code needs a translation in each client, and the web's locale files are
  not part of this slice. The 404 with a reason keeps the envelope and the
  translations as they are. Adding the code later is additive.
