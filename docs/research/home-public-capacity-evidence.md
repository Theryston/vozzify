# Public Home carousel capacity evidence

## Method

The before values were measured with the compiled parent baseline at
`e0f959c` (`/tmp/vozzify-wave2-qa`). The after values were measured against the
current implementation. Both use in-memory sources and the public feed
builder; timings exclude Nest module setup, database queries and network I/O.
They are single local samples, not performance guarantees.

The public composition regression is reproducible with:

```sh
nub run test --filter=api -- src/modules/home/home-feed-builder.spec.ts -t "continues bounded queries past the initial 240 candidates"
```

That fixture has 300 ordered Tracks, with the first 240 sharing one Artist and
the next 60 having distinct Artists. Queries return at most 60 candidates.
The capacity regression is reproducible with:

```sh
nub run test --filter=api -- src/modules/home/home-public-visit-composer.spec.ts -t "capacity-excluded"
```

It builds a hero and two sources that each contain the same 30 eligible
Tracks, then places 22 Pins before the algorithmic Rows. The visit keeps the
hero, all 22 Pins and the first algorithmic Row; the second algorithmic Row is
outside the 24-Row visit capacity.

## Concentrated source

| Measure | Baseline v5 | v6 |
| --- | ---: | ---: |
| Source queries | 1 | 5 |
| Candidates examined | 60 | 300 |
| Retained / dropped standard Rows | 0 / 1 | 1 / 0 |
| Tracks in retained Row | 0 | 48 |
| Unique Track IDs | 0 | 48 |
| Concentrated Artist Tracks retained | 0 | 8 total, at most 2 per 12-Track batch |
| Candidate pool stored | none | 300 Tracks (per-source limit: 1,152) |
| Serialized feed snapshot | 95 bytes | 104,482 bytes |
| Builder generation sample | 0.89 ms | 2.0 ms |

Version 5 made one 60-candidate read. Its candidates all credit one Artist;
the per-batch cap admits two, below the public recommendation minimum of
three, so the Row is dropped. Version 6 continues bounded reads through offset
240, finds later eligible candidates, and stores the 300 candidates for
visit-time composition. The revised picker resets Artist counts per logical
12-Track batch, so eight concentrated Tracks remain in the completed Row (two
per batch).

The public version hash includes the bounded candidate pools as well as the
selected Rows, so source-order or fallback-candidate changes revalidate the
shared Home cache. Existing visit snapshots remain frozen once created.

The 1,152-item per-source bound is `HOME_MAX_ROWS` (24) multiplied by the
largest algorithmic Track Row (48). A pool records the earliest omitted
source offset, each retained candidate's source position, and whether more
source pages exist. The source position keeps refilled pages in source order
when a selected candidate beyond the stored prefix is retained. At new-visit
creation only, bounded source pages refill candidates omitted by this storage
bound. The builder's pool limit does not declare source exhaustion, and
item-page reads do not query the catalog. Visit selection is frozen after
creation.

## Bounded-pool exclusion and replenishment

The adversarial regression is reproducible with:

```sh
nub run test --filter=api -- src/modules/home/home-public-visit-composer.spec.ts -t "keeps later Artist-diverse candidates when a crowded source pool is bounded"
```

The controlled source has 1,170 Tracks from one Artist followed by 60
single-Artist candidates, queried in pages of 60. The public builder stores a
1,152-candidate bounded pool and the earliest omitted offset; after two live
Pins claim the originally selected candidates, visit creation reloads pages
from offsets 1,112 and 1,172. The completed Row retains 26 unique Tracks: six
from the crowded Artist and 20 diverse Tracks, rather than treating the
truncated pool as source exhaustion.

| Measure | v6 builder | v6 visit refill |
| --- | ---: | ---: |
| Source page queries | 21 | 2 |
| Page offsets | 0 through 1,200 by 60 | 1,112; 1,172 |
| Distinct source candidates available | 1,230 | 1,230 |
| Candidates retained in internal pool | 1,152 | 1,152 before refill |
| Final Row retained / source candidates omitted | 26 / 1,204 | 26 / 1,204 |
| Artist concentration | 6 crowded + 20 diverse | 6 crowded + 20 diverse |
| Serialized feed snapshot | 388,577 bytes | unchanged |
| Serialized visit Rows | — | 15,369 bytes |
| Builder / visit refill sample | 19.8 ms | 10.7 ms |

The timings are one local in-memory sample and exclude service setup, database
and network costs; they are not production latency claims. The page counts and
serialized byte counts are measured by the deterministic regression fixture.
The source has 1,230 total candidates, so 1,204 are not in the final Row; this
does not mean those candidates are all unusable under other Pin or Row
arrangements.

## Initial allocation and visit capacity

| Measure | Baseline v5 | v6 before visit overlay | v6 after visit overlay |
| --- | ---: | ---: | ---: |
| Base Rows | hero 1 + 12 + 12 Tracks | hero 1 + 18 + 12 Tracks | hero 1 + 22 Pins + first Row |
| Retained / capacity-dropped algorithmic Rows | 1 / 1 | 2 / 0 | 1 / 1 |
| Tracks in first algorithmic Row | 12 | 18 | 30 |
| Visit Rows | 24 | 25 before visit clipping | 24 |
| Serialized visit Rows | 9,654 bytes | — | 13,807 bytes |
| Serialized feed snapshot | 5,654 bytes | — | 26,677 bytes |

The capacity regression verifies that the 12 Tracks assigned to the second
source do not reserve shared Tracks after that Row falls beyond the visit
capacity. The first Row is recomposed from its source pool and grows from 18 to
all 30 eligible Tracks. Initial 12-Track pages are still protected before any
Row expands; this is covered by
`preserves each retained Row initial page before expanding an earlier Row` in
`home-feed-composer.spec.ts`.

Failed-minimum release is covered by
`does not count a dropped row as having used its Tracks` in
`home-feed-composer.spec.ts` and by
`lets a later retained Row use Tracks from a failed minimum Row` in
`home-public-visit-composer.spec.ts`. Live Pin exclusion and replenishment
below a Row's minimum, source ordering, and old snapshots without candidate
metadata are covered there; old snapshots continue through the existing
overlay path without rebuilding.
