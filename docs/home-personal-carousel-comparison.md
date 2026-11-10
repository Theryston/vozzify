# Personal carousel composition evidence (#507)

A controlled 220-Track fixture supplies three overlapping recommendation sources
with 30 credited Artists, three protected 12-Track initial selections and a Daily
target. The baseline is `91e2acc`; the candidate uses coordinated expansion.
Timing is the mean of 101 pure compositions on the shared development executor,
including exploration and progressive ordering. It is indicative composition
cost, not whole-generation latency or a production performance claim.

| Measure | Baseline | Candidate |
| --- | ---: | ---: |
| Retained Rows, including Daily target | 4 | 4 |
| Dropped initial Rows | 0 | 0 |
| Distinct selected Tracks | 36 | 144 |
| Duplicate ordinary placements | 0 | 0 |
| Largest credited-Artist count in a 12-item batch | 1 | 1 |
| Serialized complete Rows | 5,659 bytes | 21,373 bytes |
| Mean composition duration | 1.13 ms | 4.97 ms |

The earliest source overlaps the later sources heavily. Initial protection
preserves both later Rows while each source expands to 48. The new behavior tests
also cover a partial initial batch, collaboration credits after exploration,
capacity-excluded Rows releasing Tracks, and live Pins removing selected Tracks
before source-specific replenishment. A 301-Track source needs six 60-item reads,
rather than incorrectly declaring exhaustion at the old four-page cutoff;
source ordering is unchanged and another source cannot fill its empty pool.

The HTTP tests use real Postgres, real repositories, the real personal builder
and the existing cache test boundary. They cover no-history public fallback,
favorite-only confidence, private 48-Track recommendations, wrong-viewer access,
evidence-qualified fit and challenge Rows, and 25 history Tracks delivered as
12, 12 and 1 across a rebuild. Existing personal taste, voice, locale, chart,
mastery, stale-snapshot and retained-version suites remain the regression net.

Additional real-application before/after measurements on a fixed 1,000-Track
fixture accompany parent browser QA and the PR review. Baseline median over
three background builds: public 440.68 ms / 235,965 bytes, personal 600.64 ms /
27,354 bytes. Baseline public composition has 202 distinct Tracks in 203
placements; personal has 104 distinct Tracks in 107 placements. These include
permitted chart overlaps and entity layouts, unlike the pure ordinary-discovery
comparison above. Candidate generation and serialized snapshot costs must be
compared with these same inputs; they must not be interpreted as practice or
retention outcomes.
