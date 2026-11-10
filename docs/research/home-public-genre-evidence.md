# Public genre quality and composition evidence

This implements #509 under #504. The collective score keeps the existing
weights: trending 1, weighted singing 12, favorites 6; the activity window is
28 days. A singer's first valid Attempt contributes 1 and up to three repeats
add 0.1 each. Forward skips and suspected bleed do not contribute. The new
top-quarter gate never applies to the existing Home categories.

## Controlled comparison

Measured locally on 2026-11-10 through the production pure visit composer,
using one warmup and 100 timed compositions. The fixture has 141 completed
positive-score Tracks: two distinct 48-Track existing pools at score 100,
25 pop Tracks at score 200, and twenty weaker Tracks at score 1. The collective
reference has 36 Tracks; only the 25 pop Tracks have genre membership. Two
additional provisional genre pools contain eleven of those Tracks each and
fail the initial minimum. The first existing source can also select all pop
Tracks, so naive expansion could remove the genre's useful initial selection.

The baseline supplies only the existing source candidates, matching v6. The
candidate additionally supplies the pre-exclusion genre pools. These measurements
exclude database, service startup and network time; they are composition-cost
evidence, not production latency or engagement claims.

| Measure | Existing composition | With dynamic genre selection |
| --- | ---: | ---: |
| Retained existing Rows / dropped existing Rows | 2 / 0 | 2 / 0 |
| Qualified genre Rows / rejected provisional genres | 0 / not evaluated | 1 / 2 |
| Distinct Tracks / Track placements | 96 / 96 | 121 / 121 |
| Catalog coverage | 68.1% | 85.8% |
| Duplicate Track placements | 0 | 0 |
| Maximum credited-Artist count per batch | 1 | 1 |
| Serialized selected Rows | 15,608 bytes | 20,122 bytes |
| Serialized internal candidate arrays | 30,237 bytes | 43,056 bytes |
| Median pure composition | 0.240 ms | 0.253 ms |

The HTTP boundary fixture uses 304 positive completed Tracks and a genre only
on global positions 65 through 76. Its twelve Tracks qualify even though none
belong to the first sixty candidates. A separate 100-positive-Track fixture
retains exactly 25 strong genre Tracks and delivers pages of 12, 12 and 1;
all 75 weaker Tracks remain excluded. Forty-four tied positives give eleven
strong Tracks and no genre Row; forty-five positives give twelve and a Row,
with stable Track identity resolving the cutoff. Zero/incomplete records do not
increase the positive count. Favorite-only popularity also qualifies correctly.

## Real backend comparison on 1,000 Tracks

An independent parent run compared `origin/main` at `91e2acc` with code head
`0d04dd4` using the same controlled 1,000-Track catalog, actual Postgres/Redis
and the production public/personal builders. Covers used local fixture artwork;
the catalog and practice signals were held constant. Each build was sampled
three times. Existing public Row membership and order remained present, and
established personal composition remained unchanged.

| Measure | Main | Public genre candidate |
| --- | ---: | ---: |
| Public retained Rows | 8 | 12 |
| Existing public Rows dropped | 0 | 0 |
| Qualified genre Rows | 0 | 4 |
| Genre carousel sizes | — | 37, 29, 29, 12 |
| Public distinct Tracks / placements | 202 / 203 | 309 / 310 |
| Public catalog coverage | 20.2% | 30.9% |
| Ordinary cross-Row duplicate Tracks | 0 | 0 |
| Public snapshot bytes | 234,957 | 436,129 |
| Personal distinct Tracks / placements | 104 / 107 | 104 / 107 |
| Personal snapshot bytes | 26,850 | 26,850 |
| Public generation, median of three | 195.79 ms | 654.02 ms |
| Unchanged personal generation, median of three | 231.18 ms | 553.31 ms |

The additional public placement beyond the distinct count is the existing
hero/chart overlap exception; it does not reflect ordinary discovery duplication.
The candidate adds 107 distinct public Tracks and 201,172 snapshot bytes. The
new raw candidate pool accounts for storage beyond the 107 visible additions.
Timing is indicative: both measurements ran on a shared executor while other
tests and builds competed for resources. The large increase in the unchanged
personal builder's time demonstrates that this comparison does not isolate a
causal public-query regression. It must not be treated as production latency or
as evidence of improved practice/retention.

## Query and snapshot cost

One additional SQL statement per background public build aggregates collective
scores, filters positive completed Tracks, computes the complete reference with
window ranking, and returns only the top quarter with stored genre memberships.
It does not run once per genre. New visit overlays use retained candidates and
the existing bounded ordinary-source refill mechanism; horizontal page requests
only read frozen selections. Personal refreshes do not run this aggregate.
No new index or migration is needed for these controlled fixtures.

Raw genre candidates intentionally retain the full quality-qualified pool,
including rejected and public-excluded selections, for #510's independent
personal selection. Storage therefore grows with top-quarter genre memberships,
not only the number of rendered cards; overlapping memberships duplicate the
candidate record across genre arrays. The comparison reports that overhead
separately from selected Rows. Monitor real catalog membership counts and Redis
snapshot size before broader rollout; these small fixtures do not establish a
large-catalog memory bound.

## Regressions and rollout

`home-public-genres.e2e-spec.ts` exercises the HTTP interface, collective admission,
reference bounds, short final page, live Pin rejection and private public fallback
versus established personal snapshots. `home-genre-composition.spec.ts` exercises
iterative overlap priority, rejected-candidate release, initial-allocation
protection, all-credited-Artist diversity, missing credits, per-batch resets,
fallback requalification and all 24 available Row slots. The browser scenario
`home-genres.spec.ts` exercises localized card rendering, real horizontal scroll
geometry and both paging axes on desktop/light and phone/dark viewports.
Same-name canonical Artist regressions also preserve both frozen paging axes
through public regeneration and Pin expiry while keeping canonical identities
and collective scores out of public Track payloads.

No existing tests or quality configurations are changed. The Playwright serial
Home project recognizes the new scenario so it shares the existing fixture
isolation policy. See ADR 0011 for compatible stored readers, rollback and the
algorithm-marker sequencing when #507 and #509 deploy separately.
