# Personal genre composition evidence

Issue #510 reuses the background complete-catalog collective strongest-quarter
pool from #509. Global popularity weights, 28-day evidence, personal confidence,
voice confidence, progressive exposure and exploration coefficients are unchanged.
The eligibility universe is independent of the genre cards rendered publicly.

## Behavioral evidence

New personal Home HTTP coverage proves private horizontal pages of at most 12,
collective-gate retention, owner rejection, no-history fallback, mastered
residual rejection and live Pin requalification. A controlled public-source
fixture distinguishes public selection from personal selection while ensuring
personal generation never invokes the collective genre aggregate.

Focused pure composition coverage enumerates zero-evidence global ordering,
established taste and voice priority, recomputed residual means, chart/resume
reservations, overlapping genres, eleven-versus-twelve rejection, complete pool
storage, internal-score stripping, every-genre capacity and canonical same-name
Artists. Exploration's initial six-credited-Artist minimum has an explicit
regression case with uncredited Tracks.

Rendered signed-in Home browser coverage uses the existing serialized Home
fixture seam, localized titles, desktop/light and mobile/dark viewports, both
paging axes, logical positions and outgoing click attribution. This seam tests
rendering/delivery; the API cases test actual selection.

## Cost and rollout

The personal genre ranker performs no database query. It reconstructs stored
genre membership and uses stored collective scores plus existing taste/voice
inputs in memory. It does not aggregate the full catalog or issue a query per
genre. Item pages read the frozen owner-scoped visit. Complete saved personal
genre pools increase snapshot size in proportion to the shared strong candidate
memberships; Pins can reuse them without database score work. Public and personal
candidates may qualify different genres and may legitimately qualify none.

## Real-backend controlled comparison

The independent parent review compared algorithm 8 (`f371ded`) with algorithm 9
on one unchanged local Postgres/Redis fixture: 249 completed Tracks, including
240 positive-score Tracks added to the nine-Track development seed. The shared
collective reference contains 60 strong Tracks: 30 rock and 30 pop. One
favorite-only User has no voice evidence. Both snapshots come from the production
personal builder and real database/cache integrations, without query overrides.

| Measure | Algorithm8 | Personal genres |
| --- | ---: | ---: |
| Retained Rows / existing Rows dropped | 6 / 0 | 8 / 0 |
| Selected qualified genre Rows | 0 | 2 |
| Genre sizes | — | 12 pop, 12 rock |
| Distinct Tracks / placements | 144 / 144 | 168 / 168 |
| Completed-catalog coverage | 57.8% | 67.5% |
| Duplicate Track placements | 0 | 0 |
| Maximum credited-Artist placements across the feed | 8 | 8 |
| Maximum credited-Artist placements per recommendation batch | 2 | 2 |
| Serialized UTF8 snapshot, excluding file newline | 143,715 bytes | 171,567 bytes |

Every existing Row identity survives in its existing order. The feature adds 24
distinct Tracks and 27,852 snapshot bytes while preserving concentration and
ordinary deduplication. This is a small controlled coverage comparison; it does
not claim that every catalog will qualify genres.

The measurement pair resets fixture covers to null to isolate external artwork
fetching, rebuilds both snapshots and samples five warm production-builder
generations after boot. Baseline generation took 168.708, 98.196, 125.150, 71.741
and 84.943 ms (median 98.196 ms). Candidate generation took 90.229, 63.532, 60.505,
42.360 and 62.972 ms (median 62.972 ms). The table uses these rebuilt snapshots;
an earlier Redis capture with external cover metadata is not mixed into this
storage comparison. The snapshot increase is 19.38%.

The five-sample ranges are 71.741–168.708 ms and 42.360–90.229 ms, respectively.
Other validation ran concurrently, so these timings are noisy regression evidence,
not evidence of a performance improvement.
Database/cache initialization and HTTP rendering are outside these timings;
shared executor activity and cache warmth limit latency comparisons.

Measurements describe coverage and generation/storage cost, not practice or
retention improvements. Algorithm 9 uses the existing compatible optional pool;
ADRs 0011/0013 retain the background lifecycle and rollback behavior.
