# 16. Calibrated Stage 2 Home ranking uses bounded evidence and retains global fallback

- Status: accepted
- Date: 2026-11-06
- Supersedes in part: ADR 0011 and ADR 0013 ranking weights; their feed, cache,
  privacy and composition boundaries remain in force.

## Context

The existing Home ranking can mistake repeated practice for broad preference,
uses only rendered public cards for some personal Rows, and ranks community
co-occurrence by raw overlap. Issue #486 approved the complete
`stage2-calibration-candidate-1` parameter set after the calibration review in
[`home-stage2-calibration-review.md`](../home-stage2-calibration-review.md).
The review records arithmetic examples and outcome definitions; they are not
evidence of increased practice or retention.

## Decision

**Keep a global signal in every personal blend.** Count distinct Tracks with
valid practice or favorite evidence (`T`) and distinct User-local active days
(`D`). Repeated events and Attempt volume do not increase either breadth axis.
Favorites contribute their own activity date, so favorite-only history has
nonzero evidence. Personal taste groups valid Attempts by Track and local
Practice day, weights each group `1 + 0.1 × min(repeats, 3)`, then applies the
existing 30-day half-life. Each favorite counts once. Confidence is
`c = sqrt(T/(T+5) × D/(D+5))`; `lambda = 0.8c`, preserving at least 20% global
popularity.

**Treat voice as evidence-weighted soft fit.** Count unique Track and
transposition groups that satisfy Profile-chip rules: accuracy at least 0.85,
no forward skip, no suspected bleed and a derived range. Repeated samples in
one group do not increase the count. `q = n/(n+5)` and each Track's personal
score is `(taste + q×fit)/(1+q)`; without voice evidence, use taste alone.
General discovery stays soft; explicit voice Rows retain their fit and
challenge criteria and Transposition semantics.

**Rank Albums by new Tracks.** Greedily score only Tracks not already claimed
by selected Albums. For residual popularity values `R`, compute
`Q(R)=totalR/(totalR+25) × (1+0.4×nR/(nR+3)) ×
(1-0.3×topShareR)/1.4`, defining zero for no positive residual. The division by
1.4 bounds the score. The personal Album component is the mean of per-Track
confidence-aware taste and voice scores. Blend it with the same `lambda` as
Track discovery. Do not add a second overlap penalty.
The background public feed stores a versioned, bounded Album candidate pool
with locale-aware Track popularity. Personal refreshes rank that shared pool
and read only its Track metadata; they do not aggregate the whole catalog.

**Use locale ranking only with independent local practice evidence.** In the
current ranking window, count distinct Users with valid practice (`U`) and
distinct UTC activity days (`D`) attributed to that locale. Use locale
collective Track and Album signals at
`sqrt(U/(U+20) × D/(D+5)) >= 0.5`; otherwise use global ranking. Locale remains
request context, not a Recording-language filter. Weekly charts use their
seven-day window; most-sung and locale trend use their existing 28-day window.
Favorites without locale attribution do not contribute to a local cohort.
Locale Album ranking uses locale-trend scores and locale-attributed singer
contributions, with the same global favorite prior weighted by six; favorite
counts are not attributed to a locale because they carry no locale metadata.

**Value singer breadth and normalize co-occurrence.** For each User and Track,
one valid Attempt contributes 1; each additional valid Attempt adds 0.1 up to
three. Most-sung ties use raw valid Attempt volume, then stable Track ID. The
existing public blend retains its trend, singer-contribution and favorite
weights of 1, 12 and 6; collective chart order never uses the requesting
User's taste. Community co-occurrence is `C/sqrt(A×B)` for distinct Users,
with the existing two-User minimum and practice-or-favorite signals.

The shared co-occurrence table keeps integer `singer_count` for rollback and
adds a bounded batch-computed `score`. Existing rows default to score zero and
sort by their preserved raw counts until the next background refresh replaces
them. The existing nightly refresh remains the idempotent roll-forward; no
per-User request scans the full practice history.

**Balance discovery and concentration.** Reserve approximately 20% of musical
recommendation placements for exploration, split evenly between nearby and
surprising candidates. Place exploration in a catalog-wide For-you Row so a
short feed can receive a slot without requiring a separate three-item Row.
For odd quotas, choose the first source from a stable User/UTC-day seed so the
feed stays deterministic while the extra slot balances across Users and days.
Use bounded popularity and taste candidate batches; apply mastered, chart,
resume, deduplication and completed-processing eligibility before filling.
Every credited Artist counts toward a cap of two per logical 12-Track
recommendation batch. Reset the counts at each batch boundary; later batches
may reuse an Artist but a Track appears only once in its Row. Apply the
progressive factor `1/(1+0.25×priorExposures)` to Artist and people exposure;
chart and resume Rows keep their exceptions. Initial recommendation batches
are allocated to every retained Row before any Row expands, preserving useful
contents lower in the feed. Editorial Pins keep their explicit selection and
order outside this algorithmic rule.

People ranking uses visible Track sets only:
`0.5×S/(S+3) + 0.5×S/sqrt(M×N)`, requiring at least three shared visible
Tracks. Apply current live privacy checks and recent activity as a tie-break.
Keep voice-distance ranking in the similar-voices Row.

## Cache versions and rollback

Issue #506 increments the composition marker from 5 to 6. Public standard and
vocal-range Rows store up to 48 Tracks, selected in four logical batches of
twelve. The HTTP Row and item-page response still exposes at most twelve. The
composer allocates initial batches before expansion and replenishes each source
in bounded pages (60 candidates for ranked sources and 200 for voice sources)
until retained Rows are full or their sources are exhausted, preserving each
source's order and eligibility rules.

The 48-item reader and visit snapshot support shipped with #505 precede this
writer change. Roll out by deploying that reader everywhere first, then deploy
the v6 composer. To roll back composition, stop v6 writers and restore v5; v5
readers accept 48-item snapshots, while newly generated feeds return to the
12-item composition. Expire only incompatible active visits through the
existing cache maintenance path if a rollback also changes the horizontal
protocol. The v6 hash distinguishes new composition snapshots from v5.

The calibrated-ranking rollout previously incremented the marker from 4 to 5;
issue #506 increments it from 5 to 6. The version remains part of public and
personal feed hashes. Public refresh retires replaced versions for active
cursors. A personal snapshot marked with an older algorithm is served while
its rebuild is queued; retired snapshots remain addressable by their content
hash for existing cursors. The bounded community batch stores both normalized
score and the original integer singer count. Old rows with a default score of
zero use raw count ordering until the next batch completes.

For rollback from v6 to v5, deploy v5 after stopping v6 writers; the #505
reader already accepts complete Rows through 48, and v5 composition generates
its prior 12-item Rows. Keep the `recommended-for-you` web title key during API
rollback so clients can render active v6 cursors. The earlier rollback from v5
to v4 still requires the co-occurrence refresh described in the v5 rollout
record. No public contract or legacy route changes.

## Outcome checks

Measure an attributed Track view followed within 24 hours by at least 60
credited singing seconds, or by one valid Attempt with at least 90% coverage,
no forward skip and no suspected bleed. Return-to-practice is the first valid
credited Heartbeat or valid Attempt on a later local Practice day within seven
days. Compare current and candidate feed coverage, order, duplicate exposure,
Artist concentration, dropped Rows and latency on the controlled 100-Track
fixtures and the existing outcome report. These event associations do not
establish causation.
