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
});
