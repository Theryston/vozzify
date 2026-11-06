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
Use bounded popularity and taste candidate batches; apply mastered, chart,
resume, deduplication and completed-processing eligibility before filling.
Every credited Artist counts toward the per-Row cap of two. Apply the
progressive factor `1/(1+0.25×priorExposures)` to Artist and people exposure;
chart and resume Rows keep their exceptions.

People ranking uses visible Track sets only:
`0.5×S/(S+3) + 0.5×S/sqrt(M×N)`, requiring at least three shared visible
Tracks. Apply current live privacy checks and recent activity as a tie-break.
Keep voice-distance ranking in the similar-voices Row.

## Cache versions and rollback

The inspected base `main` had `HOME_ALGORITHM_VERSION = 4`; this decision
increments it to 5. The version remains part of public and personal feed
hashes. Public refresh retires replaced versions for active cursors. A personal
snapshot marked with an older algorithm is served while its rebuild is queued;
retired snapshots remain addressable by their content hash for existing
cursors. The bounded community batch stores both normalized score and the
original integer singer count. Old rows with a default score of zero use raw
count ordering until the next batch completes.

For rollback from v5 to v4, deploy v4 and run its co-occurrence refresh before
refreshing personal feeds; this rebuilds the legacy raw top-12 pair set because
the normalized top-48 set is not guaranteed to contain every old pair. Keep
the `recommended-for-you` web title key during API rollback so clients can
render active v5 cursors. For roll-forward to v5, deploy v5 and run the
co-occurrence refresh again before relying on normalized ordering. Completed
warm-up jobs are removed so a later v5 deployment cannot mistake a prior
completed marker for current data. No public contract or legacy route changes.

## Outcome checks

Measure an attributed Track view followed within 24 hours by at least 60
credited singing seconds, or by one valid Attempt with at least 90% coverage,
no forward skip and no suspected bleed. Return-to-practice is the first valid
credited Heartbeat or valid Attempt on a later local Practice day within seven
days. Compare current and candidate feed coverage, order, duplicate exposure,
Artist concentration, dropped Rows and latency on the controlled 100-Track
fixtures and the existing outcome report. These event associations do not
establish causation.
