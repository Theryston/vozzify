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
| Concentrated Artist Tracks retained | 0 | 4 total, at most 2 per 12-Track batch |
| Candidate pool stored | none | 300 Tracks (per-source limit: 1,152) |
| Serialized feed snapshot | 95 bytes | 98,324 bytes |
| Builder generation sample | 0.89 ms | 3.86 ms |

Version 5 made one 60-candidate read. Its candidates all credit one Artist;
the per-Row cap admits two, below the public recommendation minimum of three,
so the Row is dropped. Version 6 continues bounded reads through offset 240,
finds later eligible candidates, and stores 300 candidates for visit-time
composition. The larger snapshot preserves those candidates for reflow after
live Pins and visit capacity are known.

The public version hash includes the bounded candidate pools as well as the
selected Rows, so source-order or fallback-candidate changes revalidate the
shared Home cache. Existing visit snapshots remain frozen once created.

The 1,152-item per-source bound is `HOME_MAX_ROWS` (24) multiplied by the
largest algorithmic Track Row (48). When a loaded source is larger, its pool
keeps the earliest candidates and any later candidates needed by its own
48-Track selection, up to that bound. Reads continue until a Row is fulfilled
or its source is exhausted; the pool bound does not declare source exhaustion.

## Initial allocation and visit capacity

| Measure | Baseline v5 | v6 before visit overlay | v6 after visit overlay |
| --- | ---: | ---: | ---: |
| Base Rows | hero 1 + 12 + 12 Tracks | hero 1 + 18 + 12 Tracks | hero 1 + 22 Pins + first Row |
| Retained / capacity-dropped algorithmic Rows | 1 / 1 | 2 / 0 | 1 / 1 |
| Tracks in first algorithmic Row | 12 | 18 | 30 |
| Visit Rows | 24 | 25 before visit clipping | 24 |
| Serialized visit Rows | 9,654 bytes | — | 13,198 bytes |
| Serialized feed snapshot | 5,654 bytes | — | 25,478 bytes |

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
