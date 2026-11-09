import type { HomeRow, HomeTrack } from '@vozzify/contracts';
import { toHomeCompositionCandidateTrack } from './home-composition-candidates.js';
import { storedHomeFeedSchema } from './home-feed.js';
import { HomeFeedBuilder, toHomeTrack } from './home-feed-builder.service.js';
import type { OverlayPin } from './home-pin-overlay.js';
import { applyEditorialPins } from './home-pin-overlay.js';
import { composePublicVisitRows } from './home-public-visit-composer.js';
import { composePublicVisitRowsWithRefill } from './home-public-visit-refill.js';
import type { HomeCandidate, HomeRowSource } from './home-row-sources.js';

const candidate = (id: string): HomeCandidate => ({
  id,
  title: `Track ${id}`,
  coverUrl: `https://cdn.example/${id}.webp`,
  artistCredit: [{ name: `Artist ${id}`, joinPhrase: '' }],
  durationMs: 180_000,
  vocalRange: { lowest: 60, highest: 72 },
  artistKey: `artist-${id}`,
  hasCover: true,
  isCompleted: true,
  hasVocalRange: true,
});

const source = (
  id: string,
  items: HomeCandidate[],
  layout: 'standard' | 'hero' = 'standard',
): HomeRowSource => ({
  id,
  layout,
  ...(layout === 'standard'
    ? { title: { key: `home.rows.${id}`, params: {} } }
    : {}),
  load: async () => items,
});

const pin = (index: number, trackIds = [`pinned-${index}`]): OverlayPin => ({
  id: `pin-${index}`,
  kind: 'row',
  position: 0,
  priority: 0,
  createdAt: index,
  sponsored: false,
  title: { key: 'home.rows.pinned', params: { title: `Pin ${index}` } },
  tracks: trackIds.map((id) => ({
    id,
    title: `Pinned ${index}`,
    coverUrl: `https://cdn.example/${id}.webp`,
    artistCredit: [{ name: `Pin artist ${index}`, joinPhrase: '' }],
    durationMs: 180_000,
    vocalRange: null,
  })),
});

describe('public visit composition', () => {
  it('releases a capacity-excluded Row’s Tracks to the retained Row', async () => {
    const overlapping = Array.from({ length: 30 }, (_, index) =>
      candidate(`shared-${index}`),
    );
    const feed = await new HomeFeedBuilder([
      source('hero', [candidate('hero-track')], 'hero'),
      source('trending-today', overlapping),
      source('most-sung', overlapping),
    ]).build();
    expect(storedHomeFeedSchema.parse(feed)).toEqual(feed);
    expect(Buffer.byteLength(JSON.stringify(feed))).toBe(26_677);
    const standardRows = feed.rows.filter(
      (row): row is Extract<HomeRow, { layout: 'standard' }> =>
        row.layout === 'standard',
    );
    const [first, second] = standardRows;
    expect(first?.items).toHaveLength(18);
    expect(second?.items).toHaveLength(12);

    const visited = composePublicVisitRows(
      feed.rows,
      feed.compositionCandidates,
      Array.from({ length: 22 }, (_, index) => pin(index)),
    );
    const retained = visited.find((row) => row.id === 'trending-today');
    expect(visited).toHaveLength(24);
    expect(Buffer.byteLength(JSON.stringify(visited))).toBe(13_807);
    expect(retained?.layout).toBe('standard');
    if (retained?.layout !== 'standard') {
      throw new Error('expected retained trending Row');
    }
    expect(retained.items).toHaveLength(30);
    expect(visited.map(({ id }) => id)).not.toContain('most-sung');
    expect(
      new Set(visited.flatMap((row) => tracksInRow(row).map(({ id }) => id)))
        .size,
    ).toBe(visited.flatMap((row) => tracksInRow(row)).length);
  });

  it('lets a later retained Row use Tracks from a failed minimum Row', async () => {
    const shared = Array.from({ length: 6 }, (_, index) =>
      candidate(`shared-${index}`),
    );
    const feed = await new HomeFeedBuilder([
      source('short', shared.slice(0, 5)),
      source('later', shared),
    ]).build();

    const rows = composePublicVisitRows(
      feed.rows,
      feed.compositionCandidates,
      [],
    );
    expect(rows.map(({ id }) => id)).toEqual(['later']);
    expect(rows[0]?.layout).toBe('standard');
    if (rows[0]?.layout !== 'standard') {
      throw new Error('expected a standard Row');
    }
    expect(rows[0].items).toHaveLength(6);
  });

  it('refills an overlapping later Row after the earlier Row consumes its candidates', async () => {
    const items = Array.from({ length: 120 }, (_, index) => ({
      ...candidate(`overlap-${index}`),
      artistKey: `artist-${Math.floor(index / 20)}`,
    }));
    const sourcePage = (id: string): HomeRowSource => ({
      id,
      layout: 'standard',
      title: { key: 'home.rows.newTracks', params: {} },
      candidatePageSize: 60,
      load: async (_locale, offset = 0) => items.slice(offset, offset + 60),
      loadPage: async (_locale, offset = 0) => ({
        items: items.slice(offset, offset + 60),
        hasMore: offset + 60 < items.length,
      }),
    });
    const sources = [sourcePage('first'), sourcePage('second')];
    const feed = await new HomeFeedBuilder(sources).build();
    expect(feed.rows.map((row) => tracksInRow(row).length)).toEqual([48, 48]);

    const rows = await composePublicVisitRowsWithRefill({
      rows: feed.rows,
      candidateRows: feed.compositionCandidates,
      pins: [],
      sources,
      locale: 'en',
    });
    expect(rows.map((row) => tracksInRow(row).length)).toEqual([48, 48]);
    expect(
      new Set(rows.flatMap((row) => tracksInRow(row).map(({ id }) => id))).size,
    ).toBe(96);
  });

  it('refills every initial page before expanding an earlier Row', async () => {
    const shared = Array.from({ length: 12 }, (_, index) =>
      candidate(`shared-${index}`),
    );
    const claimed = Array.from({ length: 12 }, (_, index) =>
      candidate(`claimed-${index}`),
    );
    const laterInitial = Array.from({ length: 12 }, (_, index) =>
      candidate(`later-initial-${index}`),
    );
    const firstExpansion = Array.from({ length: 12 }, (_, index) =>
      candidate(`first-expansion-${index}`),
    );
    const firstFurther = Array.from({ length: 24 }, (_, index) =>
      candidate(`first-further-${index}`),
    );
    const firstSource: HomeRowSource = {
      id: 'first',
      layout: 'standard',
      title: { key: 'home.rows.first', params: {} },
      candidatePageSize: 12,
      load: async (_locale, offset = 0) =>
        offset === 12
          ? laterInitial
          : offset === 24
            ? firstExpansion
            : firstFurther,
      loadPage: async (_locale, offset = 0) => ({
        items:
          offset === 12
            ? laterInitial
            : offset === 24
              ? firstExpansion
              : firstFurther,
        hasMore: offset < 36,
      }),
    };
    const secondSource: HomeRowSource = {
      id: 'second',
      layout: 'standard',
      title: { key: 'home.rows.second', params: {} },
      candidatePageSize: 12,
      load: async () => laterInitial,
      loadPage: async (_locale, offset = 0) => ({
        items: offset === 12 ? laterInitial : [],
        hasMore: false,
      }),
    };
    const rows: HomeRow[] = [
      {
        id: 'first',
        layout: 'standard',
        title: { key: 'home.rows.first', params: {} },
        items: shared.map(toHomeTrack),
      },
      {
        id: 'second',
        layout: 'standard',
        title: { key: 'home.rows.second', params: {} },
        items: claimed.map(toHomeTrack),
      },
    ];
    const candidateRows = [
      {
        id: 'first',
        layout: 'standard' as const,
        title: { key: 'home.rows.first', params: {} },
        items: shared.map(toHomeCompositionCandidateTrack),
        nextOffset: 12,
        hasMore: true,
      },
      {
        id: 'second',
        layout: 'standard' as const,
        title: { key: 'home.rows.second', params: {} },
        items: claimed.map(toHomeCompositionCandidateTrack),
        nextOffset: 12,
        hasMore: true,
      },
    ];
    const rowsAfterPins = await composePublicVisitRowsWithRefill({
      rows,
      candidateRows,
      pins: [
        pin(
          0,
          claimed.map(({ id }) => id),
        ),
      ],
      sources: [firstSource, secondSource],
      locale: 'en',
    });
    const first = rowsAfterPins.find((row) => row.id === 'first');
    const second = rowsAfterPins.find((row) => row.id === 'second');

    expect(first?.layout).toBe('standard');
    expect(second?.layout).toBe('standard');
    if (first?.layout !== 'standard' || second?.layout !== 'standard') {
      throw new Error('expected both initial Rows to be retained');
    }
    expect(first.items).toHaveLength(48);
    expect(second.items).toHaveLength(12);
    expect(second.items.map(({ id }) => id)).toEqual(
      laterInitial.map(({ id }) => id),
    );
    expect(
      first.items.filter(({ id }) =>
        second.items.some((item) => item.id === id),
      ),
    ).toEqual([]);
  });

  it('replenishes a Row after live Pins remove its selected Tracks', async () => {
    const items = Array.from({ length: 70 }, (_, index) =>
      candidate(`track-${index}`),
    );
    const feed = await new HomeFeedBuilder([
      source('trending-today', items),
    ]).build();
    const compositionCandidates = feed.compositionCandidates ?? [];
    const [pool] = compositionCandidates;
    expect(pool?.items.map(({ id }) => id)).toEqual(items.map(({ id }) => id));

    const pins = [
      pin(
        0,
        items.slice(0, 22).map(({ id }) => id),
      ),
      pin(
        1,
        items.slice(22, 44).map(({ id }) => id),
      ),
    ];
    const rows = composePublicVisitRows(feed.rows, compositionCandidates, pins);
    const algorithmic = rows.find((row) => row.id === 'trending-today');
    expect(algorithmic?.layout).toBe('standard');
    if (algorithmic?.layout !== 'standard') {
      throw new Error('expected a standard Row');
    }
    expect(algorithmic.items).toHaveLength(26);
    expect(
      algorithmic.items.some(({ id }) =>
        pins.some((livePin) => livePin.tracks.some((track) => track.id === id)),
      ),
    ).toBe(false);
  });

  it('keeps later Artist-diverse candidates when a crowded source pool is bounded', async () => {
    const crowded = Array.from({ length: 1170 }, (_, index) => ({
      ...candidate(`crowded-${index}`),
      artistKey: 'artist-crowded',
    }));
    const diverse = Array.from({ length: 60 }, (_, index) =>
      candidate(`diverse-${index}`),
    );
    const items = [...crowded, ...diverse];
    const offsets: number[] = [];
    const source: HomeRowSource = {
      id: 'trending-today',
      layout: 'standard',
      title: { key: 'home.rows.trendingToday', params: {} },
      load: async (_locale, offset = 0) => items.slice(offset, offset + 60),
      loadPage: async (_locale, offset = 0) => {
        offsets.push(offset);
        return {
          items: items.slice(offset, offset + 60),
          hasMore: offset + 60 < items.length,
        };
      },
    };
    const feed = await new HomeFeedBuilder([source]).build();
    const pool = feed.compositionCandidates?.[0];
    expect(pool?.items).toHaveLength(1152);
    expect(pool?.items.slice(0, 1112).map(({ id }) => id)).toEqual(
      crowded.slice(0, 1112).map(({ id }) => id),
    );
    expect(pool?.items.slice(1112).map(({ id }) => id)).toEqual(
      diverse.slice(0, 40).map(({ id }) => id),
    );
    expect(pool?.items.map(({ sourcePosition }) => sourcePosition)).toEqual([
      ...Array.from({ length: 1112 }, (_, index) => index),
      ...Array.from({ length: 40 }, (_, index) => index + 1170),
    ]);
    expect(pool).toMatchObject({ nextOffset: 1112, hasMore: true });
    const selected = feed.rows.find((row) => row.id === 'trending-today');
    expect(selected?.layout).toBe('standard');
    if (selected?.layout !== 'standard') {
      throw new Error('expected a standard Row');
    }
    const selectedIds = selected.items.map(({ id }) => id);
    const pins = [
      pin(0, selectedIds.slice(0, 24)),
      pin(1, selectedIds.slice(24)),
    ];

    const visited = await composePublicVisitRowsWithRefill({
      rows: feed.rows,
      candidateRows: feed.compositionCandidates,
      pins,
      sources: [source],
      locale: 'en',
    });
    const replenished = visited.find((row) => row.id === 'trending-today');
    expect(replenished?.layout).toBe('standard');
    if (replenished?.layout !== 'standard') {
      throw new Error('expected a replenished standard Row');
    }
    expect(replenished.items).toHaveLength(26);
    expect(
      replenished.items.filter(({ id }) => id.startsWith('crowded-')),
    ).toHaveLength(6);
    expect(
      replenished.items.filter(({ id }) => id.startsWith('diverse-')),
    ).toHaveLength(20);
    expect(offsets).toContain(1112);
    expect(offsets).toContain(1172);
  });

  it('uses legacy overlay behavior when an old feed has no candidate metadata', async () => {
    const feed = await new HomeFeedBuilder([
      source(
        'trending-today',
        Array.from({ length: 6 }, (_, index) => candidate(`track-${index}`)),
      ),
    ]).build();
    const pins = [pin(0)];

    expect(composePublicVisitRows(feed.rows, undefined, pins)).toEqual(
      applyEditorialPins(feed.rows, pins),
    );
  });
});

const tracksInRow = (row: HomeRow): HomeTrack[] => {
  if (row.layout === 'hero') return [row.track];
  if (
    row.layout === 'standard' ||
    row.layout === 'vocal-range' ||
    row.layout === 'ranked'
  ) {
    return row.items;
  }
  return [];
};
