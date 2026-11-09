import type { HomeRow, HomeTrack } from '@vozzify/contracts';
import { storedHomeFeedSchema } from './home-feed.js';
import { HomeFeedBuilder } from './home-feed-builder.service.js';
import type { OverlayPin } from './home-pin-overlay.js';
import { applyEditorialPins } from './home-pin-overlay.js';
import { composePublicVisitRows } from './home-public-visit-composer.js';
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
    expect(Buffer.byteLength(JSON.stringify(feed))).toBe(25_478);
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
    expect(Buffer.byteLength(JSON.stringify(visited))).toBe(13_198);
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
