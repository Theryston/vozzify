import type { HomeRow, HomeTrack } from '@vozzify/contracts';
import {
  personalExplorationQuota,
  spreadPersonalExploration,
} from './home-personal-exploration.js';

const track = (id: string): HomeTrack => ({
  id,
  title: id,
  coverUrl: null,
  artistCredit: [{ name: id, joinPhrase: '' }],
  durationMs: null,
  vocalRange: null,
});

const row = (id: string, ids: string[]): HomeRow => ({
  id,
  layout: 'standard',
  title: { key: 'home.rows.forYou', params: {} },
  items: ids.map(track),
});

describe('personal exploration allocation', () => {
  it('allocates one of six placements across two short Rows', () => {
    const rows = [
      row('first', ['a', 'b', 'c']),
      row('second', ['d', 'e', 'f']),
    ];
    const taste = new Map(['a', 'b', 'c', 'd', 'f'].map((id) => [id, 1]));

    const allocated = spreadPersonalExploration({
      rows,
      tasteByTrack: taste,
      sourcePoolsByRow: new Map(),
      masteredTrackIds: new Set(),
      reservedTrackIds: new Set(),
    });

    expect(personalExplorationQuota(6)).toBe(1);
    expect(allocated[1]).toMatchObject({
      layout: 'standard',
      items: [
        expect.objectContaining({ id: 'e' }),
        expect.anything(),
        expect.anything(),
      ],
    });
    expect(
      allocated.flatMap((item) =>
        item.layout === 'standard' ? item.items.map(({ id }) => id) : [],
      ),
    ).toHaveLength(6);
  });

  it('fills a quota slot from the same Row source pool', () => {
    const rows = [
      row('first', ['a', 'b', 'c']),
      row('second', ['d', 'e', 'f']),
    ];
    const taste = new Map(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => [id, 1]));
    const sourcePoolsByRow = new Map([['second', [track('outside-taste')]]]);

    const allocated = spreadPersonalExploration({
      rows,
      tasteByTrack: taste,
      sourcePoolsByRow,
      masteredTrackIds: new Set(),
      reservedTrackIds: new Set(),
    });

    expect(allocated[1]).toMatchObject({
      layout: 'standard',
      items: expect.arrayContaining([
        expect.objectContaining({ id: 'outside-taste' }),
      ]),
    });
  });

  it('excludes chart and resume placements from the quota', () => {
    const rows: HomeRow[] = [
      row('continue-singing', ['resume']),
      {
        id: 'top-10-week',
        layout: 'ranked',
        title: { key: 'home.rows.top10Week', params: {} },
        items: [track('chart')],
      },
      row('discovery', ['near', 'far']),
    ];
    const allocated = spreadPersonalExploration({
      rows,
      tasteByTrack: new Map([['near', 1]]),
      sourcePoolsByRow: new Map(),
      masteredTrackIds: new Set(),
      reservedTrackIds: new Set(),
    });

    expect(personalExplorationQuota(2)).toBe(0);
    expect(allocated).toEqual(rows);
  });

  it('keeps earlier quota placements when a later slot swaps within its Row', () => {
    const rows = Array.from({ length: 6 }, (_, rowIndex) =>
      row(
        `row-${rowIndex}`,
        Array.from(
          { length: 12 },
          (_, itemIndex) => `r${rowIndex}-t${itemIndex}`,
        ),
      ),
    );
    const flat = rows.flatMap((entry) =>
      entry.layout === 'standard' ? entry.items : [],
    );
    const taste = new Map(flat.map((item) => [item.id, 1]));
    const quota = personalExplorationQuota(flat.length);
    const slots = Array.from({ length: quota }, (_, slot) => ({
      index: Math.floor(((slot + 0.5) * flat.length) / quota),
      nearby: slot % 2 === 0,
    }));
    for (const slot of slots) {
      if (!slot.nearby) taste.set(flat[slot.index]?.id ?? '', 0);
    }
    for (let item = 1; item < 12; item += 1) taste.set(`r1-t${item}`, 0);
    taste.set('replacement-near', 1);

    const allocated = spreadPersonalExploration({
      rows,
      tasteByTrack: taste,
      sourcePoolsByRow: new Map([['row-1', [track('replacement-near')]]]),
      masteredTrackIds: new Set(),
      reservedTrackIds: new Set(),
    });
    const emitted = allocated.flatMap((entry) =>
      entry.layout === 'standard' ? entry.items : [],
    );

    expect(
      slots.every(
        ({ index, nearby }) =>
          (taste.get(emitted[index]?.id ?? '') ?? 0) > 0 === nearby,
      ),
    ).toBe(true);
    expect(new Set(emitted.map(({ id }) => id)).size).toBe(72);
    expect(emitted.some(({ id }) => id === 'replacement-near')).toBe(true);
  });

  it('balances odd quota direction by a stable per-feed seed', () => {
    const rows = [row('one', ['a', 'b', 'c', 'd', 'e', 'f'])];
    const taste = new Map<string, number>(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => [id, 1] as const),
    );
    taste.set('d', 0);
    const allocate = (seed: string) =>
      spreadPersonalExploration({
        rows,
        tasteByTrack: taste,
        sourcePoolsByRow: new Map([['one', [track('outside-near')]]]),
        masteredTrackIds: new Set(),
        reservedTrackIds: new Set(),
        seed,
      });

    const nearbyFeed = allocate('b');
    const surprisingFeed = allocate('a');
    const centerId = (feed: HomeRow[]) => {
      const center = feed[0];
      return center?.layout === 'standard' ? center.items[3]?.id : undefined;
    };
    expect((taste.get(centerId(nearbyFeed) ?? '') ?? 0) > 0).toBe(true);
    expect((taste.get(centerId(surprisingFeed) ?? '') ?? 0) > 0).toBe(false);
  });

  it('redistributes a far slot without replacing a protected nearby placement', () => {
    const rows = [
      row('first', ['a', 'b', 'c']),
      row('second', ['d', 'e', 'f']),
      row('third', ['g', 'h', 'i', 'j']),
    ];
    const taste = new Map<string, number>(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((id) => [id, 1]),
    );

    const allocated = spreadPersonalExploration({
      rows,
      tasteByTrack: taste,
      sourcePoolsByRow: new Map([['first', [track('far-alternative')]]]),
      masteredTrackIds: new Set(),
      reservedTrackIds: new Set(),
    });
    const first = allocated[0];

    expect(first?.layout === 'standard' ? first.items[2]?.id : undefined).toBe(
      'c',
    );
    expect(
      allocated.some(
        (entry) =>
          entry.layout === 'standard' &&
          entry.items.some(({ id }) => id === 'far-alternative'),
      ),
    ).toBe(true);
  });
});
