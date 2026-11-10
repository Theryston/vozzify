import type { HomeRow, HomeTrack } from '@vozzify/contracts';
import { spreadPersonalExploration } from './home-personal-exploration.js';

const track = (id: string): HomeTrack => ({
  id,
  title: id,
  coverUrl: null,
  artistCredit: [{ name: id, joinPhrase: '' }],
  durationMs: null,
  vocalRange: null,
});

describe('personal exploration replacement lifecycle', () => {
  it('refreshes availability after each successful slot and never repeats shared replacements across Rows', () => {
    const shared = ['reserved', 'mastered', 'far-one', 'far-two'].map(track);
    const initial = Array.from({ length: 36 }, (_, index) =>
      track(`nearby-${index}`),
    );
    const rows: HomeRow[] = ['first', 'second'].map((id, index) => ({
      id,
      layout: 'standard',
      title: { key: 'home.rows.forYou', params: {} },
      items: initial.slice(index * 18, index * 18 + 18),
    }));
    const sourcePoolsByRow = new Map(
      rows.map((row) => [
        row.id,
        [...(row.layout === 'standard' ? row.items : []), ...shared],
      ]),
    );
    const result = spreadPersonalExploration({
      rows,
      sourcePoolsByRow,
      tasteByTrack: new Map(initial.map((item) => [item.id, 1])),
      masteredTrackIds: new Set(['mastered']),
      reservedTrackIds: new Set(['reserved']),
      seed: 'a',
    });
    const ids = result.flatMap((row) =>
      row.layout === 'standard' ? row.items.map((item) => item.id) : [],
    );
    expect(ids).toHaveLength(36);
    expect(new Set(ids).size).toBe(36);
    expect(ids.filter((id) => id === 'far-one')).toHaveLength(1);
    expect(ids.filter((id) => id === 'far-two')).toHaveLength(1);
    expect(ids).not.toContain('reserved');
    expect(ids).not.toContain('mastered');
  });
});
