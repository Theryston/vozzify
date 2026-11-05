# Home practice measurement and ranking proposals

Status: measurement metadata is implemented additively; all ranking values
below are proposals only and are not active in production.

## Measurement cohort

Use the SQL in `home-practice-outcomes.sql` against one closed UTC date range.
It reports aggregate cohorts by `algorithmVersion`, `audience` and `locale`;
it does not emit visitor identifiers. `visitId` identifies one mounted Home
visit, and `eventId` deduplicates replayed impression events. Clicks use their
stable `clickId` as the event retry key and retain the existing join to
`track_views.clickId`. Practice is joined only through the existing
`track_views.id` referenced by credited `practice_heartbeats.viewId` and
`practice_attempts.viewId`.

The proposed primary outcome is at least 60 credited singing seconds within
24 hours of the attributed Track view, or one saved Attempt with at least 90%
coverage, no forward skip and no suspected bleed. A later practice outcome is
one or more practice days starting after that first outcome and within seven
days. The report counts a visit once even when it has several qualifying rows.
Clicks and views are supporting attribution evidence, not outcomes by
themselves. These thresholds and windows need maintainer validation before
they are used to tune live ranking.

Older events without `eventId`, `visitId`, locale or audience are omitted from
the retry-safe primary cohort and may only be reported separately as legacy
raw counts. Clicks are deduplicated by `clickId` where present. A browser that
clears local storage starts a new visitor identity; failed beacons can be
lost; and attribution joins cannot establish that Home caused the practice.
Heartbeat rows are already server-credited, capped per heartbeat and clocked
against the previous heartbeat. The metric sums `creditedSeconds`, never
`elapsedSeconds` or playback time.

## Pending named parameters

These deterministic candidates are intended for offline comparisons. They
must not be imported by feed generation before the maintainer records which
values are accepted. `#483`'s current-popularity baseline and its bounded
proposal fixtures are comparison inputs, not activation approval.

| Parameter | Candidate | Comparison rule |
| --- | ---: | --- |
| Album variety weight | 0.20 | Logarithmic distinct-Track bonus; use the bounded cases in `#483`'s calibration proposal. |
| Album concentration weight | 0.30 | Linear penalty by the share of available popularity from the top Track. |
| Album overlap weight | 0.25 | Linear penalty by the share of Tracks already selected. |
| Album popularity prior | 25 | Normalize raw popularity as `total / (total + 25)` to keep the score bounded as popularity grows. |
| Album variety units cap | 2 | Cap `log2(1 + distinctTracks)` at two units so compilation size stops adding variety after three Tracks. |
| Distinct-singer repeat penalty | 0.10 | Multiply each repeated singer contribution by `max(0, 1 − 0.10 × repeats)`. |
| Locale sample prior | 20 views | Confidence is `n / (n + 20)`; four local views yield 0.167 confidence. |
| Personal-history prior | 5 valid Attempts | Confidence is `n / (n + 5)`; three valid Attempts yield 0.375. |
| Voice-evidence prior | 5 usable samples | Confidence is `n / (n + 5)`; one weak sample yields 0.167. |
| Exploration share | 0.20 | Preserve the approved approximate one-in-five policy; not a tuning variable here. |
| Progressive Artist exposure penalty | 0.25 | After one exposure, multiply later exposure by `1 / (1 + 0.25 × priorExposures)`; compare capped and uncapped fixtures. |
| Social affinity weight | 0.10 | Apply only at the approved minimum of three shared practice Tracks; below three the contribution is zero. |
| Temporary exposure initial penalty | 0.10 | Subtract `0.10 × 2^(−ageHours / 24)` from normalized relevance, floored at zero. |
| Temporary exposure half-life | 24 hours | The proposed 0.10 penalty decays to 0.05 at 24 hours and 0.025 at 48 hours. |
| Weak ignored-impression penalty | 0.02 | Subtract 0.02 per qualified weak ignored impression, capped at 0.10; clicks never count as practice. |

Every value above is unvalidated. The small locale/history/voice examples are
formula checks, not observations from Users. The Album scores and sparse-feed
cases should be recalculated beside the sibling fixture proposal before any
value is accepted.

`saturatingAlbumScore` is a second offline-only candidate in
`apps/api/src/modules/home/home-ranking-calibration-proposal.ts`. It combines
the first three Album weights with a prior and a capped variety term. Unlike
the `#483` proposal, it bounds the normalized popularity and variety factors;
it still needs review against real score distributions and may distort very
low-popularity Albums.

| Album fixture | Raw baseline | `#483` unbounded candidate | Saturating candidate |
| --- | ---: | ---: | ---: |
| One hit and two quiet Tracks `[100, 0, 0]` | 100 | 98.00 | 0.784 |
| Distributed Album `[40, 35, 25]` | 100 | 123.20 | 0.986 |
| Useful Album `[15, 12, 10, 8, 5]` | 50 | 69.02 | 0.849 |
| Twenty-Track sparse compilation `[1 × 20]` | 20 | 37.01 | 0.613 |
| Partial overlap `[100, 60, 40]`, two shared | 200 | 198.33 | 0.882 |
| Independent `[70, 60, 50]` | 180 | 222.60 | 1.086 |
| After selecting `[100]`, second Album's new `[10, 10]` | 20 incremental | 20 incremental | 0.498 |

| Representative case | Baseline | Proposal calculation | Candidate result |
| --- | ---: | --- | ---: |
| Four locale views | 1.00 | `4 / (4 + 20)` confidence multiplier | 0.167 |
| Three valid personal Attempts | 1.00 | `3 / (3 + 5)` confidence multiplier | 0.375 |
| One weak voice sample | 1.00 | `1 / (1 + 5)` confidence multiplier | 0.167 |
| Three repeated singer exposures | 1.00 | `max(0, 1 − 0.10 × 3)` | 0.700 |
| Three prior progressive Artist exposures | 1.00 | `1 / (1 + 0.25 × 3)` | 0.571 |
| Social affinity with two shared Tracks | 0.00 | Below the fixed three-Track minimum | 0.000 |
| Social affinity with three shared Tracks | 1.00 | `1 × 0.10` proposed affinity contribution | 0.100 |
| Temporary exposure, just now / 24h / 48h old | 0.00 | `0.10 × 2^(−ageHours / 24)` penalty | 0.100 / 0.050 / 0.025 |
| Five weak ignored impressions | 0.00 | `min(0.10, 5 × 0.02)` penalty | 0.100 |
| Five eligible slots with sparse candidates | 0.00 | Keep one slot reserved for the fixed 20% exploration share | 1 of 5 slots |

The existing raw event schema does not record pre-filter candidate IDs, Artist
credits, dropped Rows or selection timings. These four guardrails therefore
belong in bounded Home builder fixtures: candidate coverage is selected
eligible candidates divided by fixture eligible candidates; duplicate
exposure counts repeated Track IDs across emitted Rows; Artist concentration
is the maximum share of selected Tracks credited to one Artist; discarded
Rows and selection latency are recorded per fixed fixture. Do not infer these
values from impression events, which only describe what was rendered.

## Bounded comparison and stage checklist

Run the baseline and proposal on the same deterministic fixtures: one hit
spread over sparse Albums; a useful Album against a large compilation; one
Track repeated versus varied Tracks and days; locale samples at 0, 4 and 20;
weak versus multiple voice samples; a sparse candidate pool; and three versus
fewer than three shared social Tracks. Record candidate coverage, duplicate
exposure, maximum Artist share, Rows discarded below their minimum, and
selection latency for each fixture. Use the existing fixed exploration share
and social minimum in both runs.

1. **Stage 1, baseline:** publish the same report for fixed UTC windows and
   record cohorts with missing metadata separately. Verify event-ID retry
   deduplication, click-to-view joins, credited-second-only outcomes, and
   public/personal plus locale grouping before interpreting rates.
2. **Stage 2, scoring proposals:** compare candidate numbers offline on the
   bounded fixtures above. The maintainer records accepted values and the
   dependent behavior before an algorithm version consumes them.
3. **Stage 3, exposure and feedback:** compare repeat exposure and ignored
   impressions separately from practice outcomes; validate a rollback
   version and cache compatibility before any staged rollout.

Rollback is to the previous `algorithmVersion` and its existing cached feed
snapshot; keep retained feed versions available for active cursors as required
by ADR 0011. Keep this report offline until a separately approved parameter
set and observation window exist. No analytics service, dashboard or data
retention policy is introduced here.
