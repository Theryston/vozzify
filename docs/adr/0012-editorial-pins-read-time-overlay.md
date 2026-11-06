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

**Pins are applied at read time, never stored in a feed.** `GET /v1/home`
reads the stored feed (algorithmic rows only), reads the pins live for the
request's locale and audience, and overlays them before it cuts the page. A
pin starting or ending takes effect on the next read, with no regeneration.

**The pin model** (`editorial_pins`, `editorial_pin_tracks`, `editorial_pin_history`):

- A pin is a `hero` (the hero slot) or a `row` (a standard row). Its source
  is an ordered list of Tracks, or a genre, artist or album reference: a
  genre or artist pin fills itself with the best Tracks by trending score, an
  album pin follows the album order. The dynamic sources are resolved when the
  feed is read (with the same eligibility rules), so a newly processed Track
  shows without an edit of the pin.
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
- A CDN that caches the public response for `s-maxage=600` shows a pin's start
  or end up to ten minutes late, even though the web cache is revalidated at the
  exact time. The overlay itself is immediate.
- Cursors name the stored feed version and a row position. A pin that starts or
  ends between two pages of a visit shifts the rows after it, so a visit can
  repeat or skip a row across that moment. The window is short and rare.
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
