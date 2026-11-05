# Home Album score proposal

Status: unvalidated; for bounded comparison only. Production stays on the
current Track-popularity baseline with shared Track popularity counted once.
Do not enable these candidate weights until the maintainer records approval
through #485.

The baseline is the sum of available completed-Track popularity. Content
selection recomputes that sum using only Tracks added beyond the already
selected Albums, and discards an Album that adds none.

The candidate proposal uses three named parameters:

| Parameter | Proposal | Meaning |
| --- | ---: | --- |
| `varietyWeight` | 0.20 | Adds a logarithmic benefit for distinct available Tracks. |
| `concentrationWeight` | 0.30 | Reduces score when one Track supplies most popularity. |
| `overlapWeight` | 0.25 | Reduces score in proportion to Tracks shared with earlier selections. |

Candidate formula:

```text
max(0, availablePopularity)
× (1 + varietyWeight × log2(1 + distinctTrackCount))
× (1 − concentrationWeight × topTrackShare)
× (1 − overlapWeight × sharedTrackShare)
```

The offline helper is `apps/api/src/modules/home/home-album-score-proposal.ts`.
It is not called by production feed generation. Its fixed weights make the
cases below reproducible; they are examples for review, not chosen production
coefficients.

| Bounded fixture | Current baseline | Proposed score | Comparison |
| --- | ---: | ---: | --- |
| One hit plus two quiet Tracks `[100, 0, 0]` | 100 | 98.00 | |
| Distributed Album `[40, 35, 25]` | 100 | 123.20 | Distributed popularity rises over one-hit concentration. |
| Useful Album `[15, 12, 10, 8, 5]` | 50 | 69.02 | |
| Sparse 20-Track compilation `[1 × 20]` | 20 | 37.01 | Useful Album remains ahead despite the compilation's size. |
| Partial overlap `[100, 60, 40]`, two shared Tracks | 200 | 198.33 | New Tracks remain eligible while overlap loses priority. |
| Independent `[70, 60, 50]` | 180 | 222.60 | Independent content ranks above the partial overlap case. |
| One-hit Album `[100]`, then `[100, 10, 10]` sharing the hit | 120 raw total | 20 incremental | The second Album adds only its two quiet Tracks after the hit is selected. |

The fixtures are deliberately small and synthetic. They do not establish
causal practice outcomes, locale confidence, personal relevance or production
thresholds. #485 owns the measurement and maintainer-validation gate.
