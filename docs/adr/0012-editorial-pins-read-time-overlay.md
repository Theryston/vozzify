# 12. Editorial pins are a read-time overlay on the home feed

- Status: accepted
- Date: 2026-10-20

## Context

An admin features a Track, or a whole row, on the home feed: for everyone or
only for visitors who are not signed in, for a time window or until removed,
in one locale or in all of them. A pin must go live and end at its exact time,
and when it ends the algorithm must fill its slot again. A pin marked sponsored
must say so on the hero or row it produces, for every audience that sees it.

The public feed is stored per locale and regenerated hourly (ADR 0011), and
every visitor reads the same rows from the shared caches. Baking a pin into the
stored feed would make a pin wait for the next regeneration, and would need a
rebuild of the feed at each start and end. Baking it into a User's personal
snapshot would be worse: the pin would have to reach every snapshot.

## Decision

**Pins are eligible at read time, and visit positions are frozen.** The first
page reads the stored feed (algorithmic rows only), reads the pins live for the
request's locale and audience, and composes the visible rows. When another
page exists, that composition is stored as a visit snapshot in Redis for a
two-hour cursor retention window. Its deterministic content hash names the
visit, so identical public visits for one locale share the snapshot; personal
visit hashes include the User ID and locale. The HTTP response for a personal visit
remains private and non-storable.

Each cursor page reads its frozen row slots and checks retained Pin IDs against
the current live set. A Pin that ended, changed audience or locale, or whose
Tracks became ineligible is removed from its original slot; remaining slots
do not move. The response omits empty slots but advances the cursor by the
fixed six-slot page boundary. Existing Pins refresh their current Tracks and
sponsored label in place on vertical pages. Pins that become eligible after
the first page wait for a new visit. Feed regeneration and social
recommendation refresh likewise do not repack a visit. For a personal people
Row, current profile visibility is
rechecked and its current content replaces the matching frozen slot; if it no
longer qualifies, that slot is omitted. If an expired public visit's source
feed and Pin composition remain current, the API recreates it only when its
deterministic version matches the cursor; otherwise it returns the existing
`FEED_VERSION_EXPIRED` response so the client starts a new visit. Public cache
headers bound shared response freshness to two minutes, and the longer visit
retention covers that bound.

**The pin model** (`editorial_pins`, `editorial_pin_tracks`, `editorial_pin_history`):

- A pin is a `hero` (the hero slot) or a `row` (a standard row). Its source
  is an ordered list of Tracks, or a genre, artist or album reference: a
  genre or artist pin fills itself with the best Tracks by trending score, an
  album pin follows the album order. A Track Row source can contain up to 48
  Tracks; dynamic sources resolve up to the same capacity when the feed is read
  (with the same eligibility rules), so a newly processed Track shows without
  an edit of the pin.
- This capacity is persisted in `editorial_pin_tracks` and in history states.
  A rollback after a 48-Track Pin is saved must retain a reader that accepts 48
  Track IDs, even if the admin writer is rolled back to a lower limit. Deploying
  a pre-capacity reader against those records is not compatible.
- It has a position (row 0 is the hero slot), a priority, an audience
  (`everyone`, or `visitors` for visitors who are not signed in), an optional
  locale, an optional start and end (no start: live at once; no end:
  indefinite), titles per locale and a `sponsored` flag (off by default).
- The API refuses a pin at creation, and an edit that changes its kind, layout
  or source, when it cannot show: a `tracks` source naming a Track whose
  Processing is not completed, or a hero's Track without a cover; a genre,
  artist or album source naming an entity that does not exist or offers fewer
  eligible Tracks than the pin needs (six for a row, one with a cover for a
  hero). A Track that becomes ineligible later is skipped at read time, so an
  edit of the pin's other fields is never refused for it.
- Every change, the sponsored flag included, is a row of `editorial_pin_history`
  with the admin who made it, the fields that changed and the state after the
  change. The history has no foreign key to the pin: a removed pin keeps it.

**The precedence of the overlay** (`applyEditorialPins`, a pure function):

1. The pinned hero: among the live hero pins with a Track that has a cover,
   the highest priority wins, then the most recent. Its first Track with a cover
   is the hero. Without one, the algorithmic hero stays.
2. The pinned rows, in the same precedence. A pin takes its position; when a
   higher-precedence pin already holds it, it takes the next free position. A
   hero pin that loses the hero slot is shown as a row at its position, with its
   titles.
3. The algorithmic rows, in order, filling the remaining slots. Track Rows omit
   Tracks shown by live pins and are dropped when they fall below their minimum
   size (the same rule as the composer). The ranked weekly chart is the
   exception: it keeps its published membership and order, including overlap
   with a pin. The algorithmic hero is dropped when its Track is pinned, because
   the hero row keeps one Track.

When an eligible album, artist or people row would otherwise fall beyond the
first six visible rows, the overlay reserves an unpinned slot in that page and
places the category there. Hero and daily-target rows keep their positions and
all pins keep their configured positions when a free slot exists. If pins occupy
every eligible slot, the category takes the last slot and only the pin displaced
by that collision moves to the next free position. Generic row-pin validation
still requires six eligible Tracks. The 24-row response cap still applies, so a
displaced pin moved beyond row 23 is omitted from that response.

A Track appears once across the pinned rows: the higher-precedence pin keeps it.
The feed holds at most 24 rows.

**Sponsored content.** A pin that is sponsored produces a hero or row with
`sponsored: true`, for every audience that sees the pin. Algorithmic rows and
plain pins never carry the flag (the key is absent). Changing the flag of a live
pin revalidates the affected home caches at once.

**Audience and locale.** A pin with audience `everyone` is seen by everyone. A
pin with audience `visitors` is seen only by requests without a session. A
pin with a locale is seen only in that locale's feed; a pin with no locale
serves both. A pin without a title in the request's locale is not shown there.

**Cache invalidation.** A create, an update or a removal revalidates the web
home tag (`cacheTags.home(locale)`) of every locale the pin was or is in, right
away. Starting and ending a pin that is still ahead schedules a delayed job at
the exact time (`editorial-pins` queue, `invalidate-home-for-pin`), which
revalidates the same tags when it runs. The job revalidates; it does not rebuild
anything, because the stored feed holds no pin. A stale job (for a time since
changed) only revalidates, which is harmless, so no job is removed on an edit.

**Horizontal continuations retain the Pin's visible promise.** A long pinned
Row can hold up to 48 Tracks in its visit snapshot and is exposed twelve Tracks
at a time. Every item continuation rechecks that Pin's live eligibility,
ordered membership and sponsored state. If any of those change, it returns
`FEED_VERSION_EXPIRED`; the client restarts the full Home visit so the first
page can show the current Pin and its sponsorship notice. This is necessary
because an item page carries Tracks, not a replacement row header. See ADR
0011 for the shared horizontal and vertical visit lifecycle.

**The admin API** is `/v1/admin/home-pins`, restricted to the `ADMIN` role
(`@Roles('ADMIN')`): list, create, read, update, remove and history. Anonymous
callers get `UNAUTHORIZED` and other Users `FORBIDDEN`.

**The row title key.** A pinned row's title is the admin's text, so it is not a
translation of the API. It is sent as the key `home.rows.pinned` with the text
in the `title` parameter, in the feed's locale. The web renders the key with
the message `{title}` in each locale file. This needs no change to the contract.

## Consequences

- A pin changes what visitors see at its start and end without touching the
  stored feeds or any User's snapshot. The stored feeds stay the same for every
  pin, which keeps the hourly revalidation rule of ADR 0011 intact.
- Each feed read loads the live pins with one query and their Tracks with one
  more, when a pin is live. The pin table is a handful of rows, so this is cheap,
  but it is a database read on a request that the stored feed alone would not
  make. If it ever matters, the live pins of a locale can be cached in Redis and
  invalidated by the same admin writes.
- The public response of a signed-in visitor can differ from an anonymous one
  (the `visitors` pins). The response headers are unchanged, so the CDN must
  bypass its cache whenever a session cookie is present, as ADR 0011 already
  requires.
- A CDN can show a pin's start or end up to two minutes late under the current
  public cache bounds, even though the web cache is revalidated at the exact
  time. The overlay itself is immediate.
- A visit snapshot adds one small cached composition per distinct public
  overlay and per personal User/locale visit. Redis keeps these snapshots only
  as long as cursors can refer to them; public versions remain shareable while
  personal snapshots are owner-scoped and served with private headers.
- Pin removals and social visibility changes may leave a short page with fewer
  than six visible Rows. The cursor still advances by its frozen positions,
  so no later Row repeats or moves into that page. Newly eligible content
  appears on the next visit.
- Adding a source (genre, artist, album) added a variant to
  `editorialPinSourceSchema` and a read of its Tracks at feed time; the overlay
  precedence and dedupe itself did not change.

## Alternatives considered

- **Bake pins into the stored public feed.** Rejected: a pin would wait for the
  hourly regeneration unless the feed were rebuilt at each edge, and every
  locale and audience would need its own copy.
- **Bake pins into each User's snapshot.** Rejected: a pin would have to reach
  every snapshot, and an audience rule would be applied when the snapshot is
  written rather than when it is read.
- **Let a pin's end simply expire in a cache.** Rejected: the web cache has no
  per-entry expiry at a given time, so the delayed invalidation is still needed.
