# 13. The signed-in home is a personal blend served from per-User snapshots

- Status: accepted
- Date: 2026-10-21

## Context

The public feed is the same for every visitor (ADR 0011), but a signed-in
visitor also has their own signals: the Tracks they started, the ones they
sing best, their favorites and their taste in genres and artists, and where
today's practice stands. The home should lead with rows to **resume**
practice and blend the rest with that taste, without ever computing a feed
inside a request and without leaking personal data to shared caches.

## Decision

**The personal pipeline blends popularity with taste.** The public feed of the
request's locale is the base; each of its Tracks is re-ranked by
`final = (1 − λ) · popularity + λ · personal`, where `popularity` is the
Track's trending score over the best one and `personal` mixes its genre and
artist affinities (`PERSONAL_GENRE_WEIGHT = 1`, `PERSONAL_ARTIST_WEIGHT = 2`,
the artist weighing more because it names the taste better). λ grows with the
User's amount of data (`personalLambda`: 0 without signals, 1 from
`PERSONAL_LAMBDA_SATURATION_SIGNALS = 50`), so a User with no data gets the
public rows untouched. All three are named constants with unit tests.

**Mastered Tracks leave the discovery rows.** A Track whose best accuracy
reached the hit band (`accuracyBand`, the same 85% as every accuracy band)
has its own "sing again" row, so the discovery rows filter it out.

**Daily target and resume rows lead.** The existing eligible daily-target
strip is placed immediately after the final visible hero (including a pinned
hero), or first when no hero is visible. No resume, social, or editorial row
intervenes. Continue singing contains started, non-mastered Tracks; Sing again
contains mastered Tracks, using the existing mastery definition. These sets
are disjoint, and either resume row may render with one Track. The target copy
and completion state continue to come from the streak status.

**Personal composition preserves useful global rows.** Personal feeds retain
applicable public genre, artist, album and ranked rows alongside their personal
recommendations. The weekly chart keeps its collective membership and order,
may overlap the hero and resume rows, and reserves its Tracks against other
discovery rows. Album, artist, people and musical recommendation rows may render
from three eligible items; each layout still applies its own minimum and
audience eligibility. This also applies to the visitor feed. When an eligible
album, artist or people row exists, composition puts one in the first six rows
after honoring hero and daily-target precedence. Live editorial pins keep their
positions where possible; if they occupy every eligible slot, the category takes
the last first-page slot and displaces only its colliding pin. Other discovery
rows coordinate used Tracks to avoid duplicates.

**Snapshots in Redis, never computed in a request.** Each User's snapshot is
stored per locale (`home:personal:{userId}:{locale}:current`, TTL
`PERSONAL_SNAPSHOT_TTL_SECONDS = 7 days`, plus the build lock and retained
versions for cursors still in flight, like the public feed). A request serves
the snapshot, or the stale one, or — when there is none — the public rows as
the personal answer, and queues a rebuild. A snapshot older than
`PERSONAL_SNAPSHOT_STALE_AFTER_SECONDS = 6 hours` is served stale while its
rebuild runs.

**Rebuilds are debounced jobs plus a nightly batch.** A finished Attempt or a
favorite schedules a rebuild after `PERSONAL_REFRESH_DEBOUNCE_MS` (one job
per User, locale and delay-long time slot, the same slot pattern as the
trending score), so a practice session costs one rebuild. A repeatable job
(`refresh-personal-nightly`, 02:30 UTC) rebuilds every locale of the Users
with an Attempt or a heartbeat in the last
`PERSONAL_NIGHTLY_ACTIVE_WITHIN_DAYS = 14` days (capped at
`PERSONAL_NIGHTLY_MAX_USERS`). Every job is idempotent: rebuilding stores the
same snapshot, and an unchanged feed keeps its version.

**The API answers `audience: personal` with private headers.** A signed-in
first page or cursor page carries `audience: personal` and
`Cache-Control: private, no-store`, so no shared cache can keep it; anonymous
answers are unchanged. Cursors keep working across the two: a personal cursor
resumes its snapshot version, else the public one (relabeled personal).
Pins stay a read-time overlay (ADR 0012): they are applied when the personal
page is served, never stored in the snapshot.

**The web renders the signed-in home without the public one flashing.**
The home page reads the session cookie on the server: a visitor carrying one
gets the feed through a dynamic, cookie-forwarding fetch that is never cached
on the web, inside Suspense with the shared content-free skeleton, so no
public row ever flashes before the personal rows land. The resume carousels
land in the skeleton's carousel slots; cursor paging from the browser
forwards the session the same way.

**Horizontal pages share the owner-scoped visit.** The complete standard and
vocal-range Rows are retained in the personal visit snapshot and exposed to
the client in pages of twelve. The item cursor binds the visit version,
locale, Row and position, and each request verifies the same User owns the
visit. A signed-in fallback built from public rows is still a personal,
owner-scoped visit with private cache headers. Expiry of either axis replaces
the vertical pages and clears horizontal item pages together; it never appends
a fresh personal first page to rows from the expired version. See ADR 0011
for the endpoint and expand-first capacity rollout.

## Consequences

- A signed-in visit costs one snapshot rebuild per User per staleness window
  or practice session, never per request; a burst of visits costs nothing
  extra while the snapshot is fresh.
- The snapshot stores rows, not ids: reads stay free of database work, at the
  cost of re-storing Track cards. A Track edited after the snapshot keeps its
  old card until the next rebuild.
- Triggers schedule every locale because the write requests carry none; the
  nightly batch covers every locale too, so a locale switch never waits for a
  rebuild.
- A one-Track resume row is useful and is retained; exhausted rows are omitted
  according to their own minimum while other eligible categories remain.
- Public ranked and entity categories stay in the personal composition even
  when no personal candidate can replace them. Personal discovery does not
  remove chart membership or order.

Algorithm version 2 identifies newly generated feeds with this composition.
Previously cached snapshots retain their stored marker and are served as-is
until normal expiry; ordinary refreshes write the current marker. Rollback
sets the algorithm marker back to 1 and lets version-2 snapshots expire or
rebuilds them with the standard jobs. If a later writer rollout stores Rows
larger than the old reader accepts, rollback also expires the personal
`current`, `current:retired`, and retained visit keys for those Users before
older readers start, alongside the public keys described in ADR 0011.

## Alternatives considered

- **Compute the personal feed in the request.** Rejected: a burst of
  signed-in visits would fan out to the same expensive queries the public
  feed refuses to run per request (ADR 0011).
- **One snapshot per User across locales.** Rejected: discovery mirrors the
  locale's public feed, whose trending differs per locale; a shared snapshot
  would serve one locale's rows to another's visit.
- **Bake pins into the snapshot.** Rejected already in ADR 0012: a pin would
  have to reach every snapshot and audience rules would apply at write time.

## Expanded personal carousels (algorithm 7, #507)

Personal composition keeps the existing taste, voice, discovery and exploration
initial selections before expanding any recommendation Row. Each retained
standard or Vocal-range carousel may keep 48 distinct logical Tracks, delivered
by the existing owner-scoped visit in pages of at most twelve. Earlier expansion
cannot consume a later retained Row's initial contents. The Daily target and
quality-category placement remain unchanged. Continue singing and Sing again
retain their disjoint history/mastery membership, order and Artist-cap exception;
their retained history is reserved against ordinary discovery. Charts retain
their collective order and overlap exceptions.

Source pools retain their own semantic eligibility and ordering. Personal
refreshes reuse public background source candidates, including source-specific
favorite candidates, and replenish taste, voice, newest, singing and exploration
sources in 60-item queries. A source stops on exhaustion or the existing bounded
useful-candidate budget (24 × 48); no full-catalog popularity aggregation is
introduced in a User refresh or HTTP item request. Final progressive ordering
and exploration preserve the two-per-credited-Artist rule within each logical
12-item batch. Exploration swaps stay within a logical batch and substitutions
count the target batch, rather than the complete expanded Row.

New personal snapshots optionally retain ordered composition candidates using
the existing compatible internal candidate schema. Live Pins recompose retained
Rows against those private pools; capacity-excluded Rows release their claims,
while retained initial contents precede expansion. Older snapshots without this
optional field continue through their existing overlay path. No-history public
fallback keeps expanded contents and the established private, owner-scoped visit
and cache headers. Snapshot TTL, stale-while-rebuild and retained versions are
unchanged.

Deploy the compatible #505 readers before expanded writers. Algorithm 7 queues
normal rebuilds while old shorter snapshots remain readable. Rollback to the
previous compatible composer stops expanded generation and preserves retained
visits until expiry; no cache flush or schema migration is needed. #507 and
#509 are parallel changes using marker 7 independently: whichever merges second
must advance the marker again after rebasing on the first, so snapshots generated
by the first deployment are rebuilt for the combined composition.

Controlled composition evidence and its limits are recorded in
[the personal carousel report](../home-personal-carousel-comparison.md).
