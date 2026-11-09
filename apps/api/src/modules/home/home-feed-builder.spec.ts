import { Test } from '@nestjs/testing';
import { HomeFeedBuilder } from './home-feed-builder.service.js';
import {
  HOME_ROW_SOURCES,
  type HomeCandidate,
  type HomeRowSource,
} from './home-row-sources.js';
import { HOME_ALGORITHM_VERSION } from './home-rules.js';

const candidate = (
  id: string,
  overrides: Partial<HomeCandidate> = {},
): HomeCandidate => ({
  id,
  title: `Track ${id}`,
  coverUrl: `https://cdn.example/${id}.webp`,
  artistCredit: [{ name: `Artist ${id}`, joinPhrase: '' }],
  durationMs: 180_000,
  vocalRange: { lowest: 60, highest: 72 },
  artistKey: `artist-${id}`,
  hasCover: true,
  isCompleted: true,
  ...overrides,
});

const candidates = (count: number, prefix = 't'): HomeCandidate[] =>
  Array.from({ length: count }, (_, i) => candidate(`${prefix}${i}`));

const trendingSource = (items: HomeCandidate[]): HomeRowSource => ({
  id: 'trending-today',
  layout: 'standard',
  title: { key: 'home.rows.trendingToday', params: {} },
  load: async () => items,
});

const heroSource = (items: HomeCandidate[]): HomeRowSource => ({
  id: 'hero',
  layout: 'hero',
  load: async () => items,
});

const buildWith = async (sources: HomeRowSource[]) => {
  const moduleRef = await Test.createTestingModule({
    providers: [
      HomeFeedBuilder,
      { provide: HOME_ROW_SOURCES, useValue: sources },
    ],
  }).compile();
  return moduleRef.get(HomeFeedBuilder).build();
};

describe('HomeFeedBuilder', () => {
  it('builds a public feed with a hero first, then the standard rows', async () => {
    const feed = await buildWith([
      heroSource(candidates(1, 'h')),
      trendingSource(candidates(6)),
    ]);

    expect(feed).toMatchObject({
      audience: 'public',
      algorithmVersion: HOME_ALGORITHM_VERSION,
      rows: [
        { id: 'hero', layout: 'hero' },
        { id: 'trending-today', layout: 'standard' },
      ],
    });
  });

  it('serves three eligible public recommendation Tracks', async () => {
    const feed = await buildWith([trendingSource(candidates(3))]);
    expect(feed.rows).toHaveLength(1);
    expect(feed.rows[0]).toMatchObject({
      id: 'trending-today',
      layout: 'standard',
      items: [{ id: 't0' }, { id: 't1' }, { id: 't2' }],
    });
  });

  it('answers a 16-character version', async () => {
    const feed = await buildWith([trendingSource(candidates(6))]);
    expect(feed.version).toMatch(/^[0-9a-f]{16}$/);
  });

  it('keeps the version while the content is the same', async () => {
    const first = await buildWith([trendingSource(candidates(6))]);
    const second = await buildWith([trendingSource(candidates(6))]);
    expect(second.version).toBe(first.version);
  });

  it('changes the version when a row changes', async () => {
    const first = await buildWith([trendingSource(candidates(6))]);
    const second = await buildWith([trendingSource(candidates(6, 'x'))]);
    expect(second.version).not.toBe(first.version);
  });

  it('maps a Track to the public card, without the composer fields or the artist MBID', async () => {
    const withMbid = candidate('t0', {
      artistCredit: [{ name: 'Artist', joinPhrase: ' & ', mbid: 'mbid-1' }],
    });
    const feed = await buildWith([
      trendingSource([withMbid, ...candidates(5, 'r')]),
    ]);
    const [row] = feed.rows;
    expect(row).toMatchObject({ layout: 'standard' });
    const [item] = row?.layout === 'standard' ? row.items : [];
    expect(item).toEqual({
      id: 't0',
      title: 'Track t0',
      coverUrl: 'https://cdn.example/t0.webp',
      artistCredit: [{ name: 'Artist', joinPhrase: ' & ' }],
      durationMs: 180_000,
      vocalRange: { lowest: 60, highest: 72 },
    });
  });

  it('never marks a row sponsored', async () => {
    const feed = await buildWith([
      heroSource(candidates(1, 'h')),
      trendingSource(candidates(6)),
    ]);
    for (const row of feed.rows) {
      expect(row).not.toHaveProperty('sponsored');
    }
  });

  it('leaves out a row that is below its minimum size', async () => {
    const feed = await buildWith([trendingSource(candidates(2))]);
    expect(feed.rows).toEqual([]);
  });

  it('builds a vocal-range row whose items all carry their range', async () => {
    const ranged = candidates(6).map((item) => ({
      ...item,
      hasVocalRange: true,
    }));
    const feed = await buildWith([
      {
        id: 'by-voice-easy-start',
        layout: 'vocal-range',
        title: { key: 'home.rows.easyToStart', params: {} },
        load: async () => ranged,
      },
    ]);

    expect(feed.rows).toHaveLength(1);
    const [row] = feed.rows;
    expect(row).toMatchObject({
      id: 'by-voice-easy-start',
      layout: 'vocal-range',
      title: { key: 'home.rows.easyToStart', params: {} },
    });
    expect(row).not.toHaveProperty('sponsored');
    if (row?.layout !== 'vocal-range') {
      throw new Error('expected a vocal-range row');
    }
    expect(row.items).toHaveLength(6);
    for (const item of row.items) {
      expect(item.vocalRange).toEqual({ lowest: 60, highest: 72 });
    }
  });

  it('replenishes bounded source pages when a public Row needs more candidates', async () => {
    const offsets: (number | undefined)[] = [];
    const source: HomeRowSource = {
      ...trendingSource([]),
      candidatePageSize: 60,
      load: async (_locale, offset) => {
        offsets.push(offset);
        if ((offset ?? 0) >= 120) return [];
        const start = offset ?? 0;
        return Array.from({ length: 60 }, (_, index) =>
          candidate(`page-${start + index}`),
        );
      },
    };
    const feed = await buildWith([source]);

    expect(offsets).toEqual([0]);
    expect(feed.rows[0]?.layout).toBe('standard');
    if (feed.rows[0]?.layout !== 'standard') {
      throw new Error('expected a standard Row');
    }
    expect(feed.rows[0].items).toHaveLength(48);
    expect(new Set(feed.rows[0].items.map(({ id }) => id)).size).toBe(48);
  });

  it('continues bounded queries past the initial 240 candidates when the cap excludes them', async () => {
    const offsets: number[] = [];
    const source: HomeRowSource = {
      ...trendingSource([]),
      candidatePageSize: 60,
      load: async (_locale, offset = 0) =>
        (await source.loadPage?.('en', offset))?.items ?? [],
      loadPage: async (_locale, offset = 0) => {
        offsets.push(offset);
        const items = Array.from({ length: 60 }, (_, index) => {
          const id = `page-${offset + index}`;
          return candidate(id, {
            artistKey: offset < 240 ? 'dominant-artist' : id,
            hasVocalRange: true,
          });
        });
        return { items, hasMore: offset < 240 };
      },
    };
    const feed = await buildWith([source]);

    expect(offsets).toEqual([0, 60, 120, 180, 240]);
    expect(feed.rows[0]?.layout).toBe('standard');
    if (feed.rows[0]?.layout !== 'standard') {
      throw new Error('expected a standard Row');
    }
    expect(feed.rows[0].items).toHaveLength(48);
    const selectedIds = feed.rows[0].items.map(({ id }) => id);
    expect(selectedIds).toContain('page-240');
    expect(selectedIds).toContain('page-2');
    expect(new Set(selectedIds).size).toBe(48);
    expect(selectedIds.filter((id) => Number(id.slice(5)) < 240)).toHaveLength(
      4,
    );
    for (let offset = 0; offset < 48; offset += 12) {
      const batch = selectedIds.slice(offset, offset + 12);
      expect(batch.filter((id) => Number(id.slice(5)) < 240)).toHaveLength(
        offset < 24 ? 2 : 0,
      );
    }
    expect(Buffer.byteLength(JSON.stringify(feed.rows))).toBe(10_157);
    expect(Buffer.byteLength(JSON.stringify(feed))).toBe(98_324);
  });

  it('leaves a range-less Track out of a vocal-range row', async () => {
    const ranged = candidates(6).map((item) => ({
      ...item,
      hasVocalRange: true,
    }));
    const feed = await buildWith([
      {
        id: 'by-voice-easy-start',
        layout: 'vocal-range',
        title: { key: 'home.rows.easyToStart', params: {} },
        load: async () => [
          ...ranged,
          candidate('no-range', {
            vocalRange: null,
            hasVocalRange: false,
          }),
        ],
      },
    ]);

    const [row] = feed.rows;
    if (row?.layout !== 'vocal-range') {
      throw new Error('expected a vocal-range row');
    }
    expect(row.items).toHaveLength(6);
    expect(row.items.map((item) => item.id)).not.toContain('no-range');
  });
});
