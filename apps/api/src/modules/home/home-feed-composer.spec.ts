import { type ComposableTrack, composeHomeRows } from './home-feed-composer.js';

type Track = ComposableTrack & { title: string };

const track = (
  id: string,
  overrides: Partial<ComposableTrack> = {},
): Track => ({
  id,
  title: `Track ${id}`,
  artistKey: `artist-${id}`,
  hasCover: true,
  isCompleted: true,
  ...overrides,
});

const tracks = (count: number, prefix = 't'): Track[] =>
  Array.from({ length: count }, (_, i) => track(`${prefix}${i}`));

const idsOf = (rows: { items: readonly Track[] }[]) =>
  rows.map((row) => row.items.map((item) => item.id));

describe('composeHomeRows', () => {
  it('keeps the order and metadata of the candidate rows', () => {
    const rows = composeHomeRows([
      { id: 'trending', layout: 'standard' as const, items: tracks(6) },
      { id: 'new', layout: 'standard' as const, items: tracks(6, 'n') },
    ]);
    expect(rows.map((row) => row.id)).toEqual(['trending', 'new']);
    expect(rows[0]?.items[0]).toEqual(track('t0'));
  });

  it('shows a Track once per feed: the earlier row keeps it', () => {
    const shared = tracks(6);
    const rows = composeHomeRows([
      { id: 'first', layout: 'standard' as const, items: shared },
      { id: 'second', layout: 'standard' as const, items: shared },
    ]);
    expect(idsOf(rows)).toEqual([['t0', 't1', 't2', 't3', 't4', 't5']]);
  });

  it('answers at most two Tracks of the same artist in one row', () => {
    const sameArtist = (id: string) => track(id, { artistKey: 'hot-artist' });
    const items = [
      sameArtist('a'),
      sameArtist('b'),
      sameArtist('c'),
      track('d'),
      track('e'),
      track('f'),
      track('g'),
    ];
    const [row] = composeHomeRows([
      { id: 'row', layout: 'standard' as const, items },
    ]);
    expect(row?.items.map((item) => item.id)).toEqual([
      'a',
      'b',
      'd',
      'e',
      'f',
      'g',
    ]);
  });

  it('drops a row with fewer than 6 items', () => {
    expect(
      composeHomeRows([
        { id: 'short', layout: 'standard' as const, items: tracks(5) },
      ]),
    ).toEqual([]);
  });

  it('keeps public recommendation rows at three items and drops two', () => {
    const recommendations = [
      'trending-today',
      'most-sung',
      'most-favorited',
      'new-tracks',
    ];
    for (const id of recommendations) {
      expect(
        composeHomeRows([
          { id, layout: 'standard' as const, items: tracks(3, `${id}-`) },
        ]).map((row) => row.items),
      ).toHaveLength(1);
      expect(
        composeHomeRows([
          { id, layout: 'standard' as const, items: tracks(2, `${id}-`) },
        ]),
      ).toEqual([]);
    }
  });

  it('does not count a dropped row as having used its Tracks', () => {
    const shared = tracks(6);
    const rows = composeHomeRows([
      { id: 'short', layout: 'standard' as const, items: shared.slice(0, 5) },
      { id: 'later', layout: 'standard' as const, items: shared },
    ]);
    expect(rows.map((row) => row.id)).toEqual(['later']);
    expect(rows[0]?.items).toHaveLength(6);
  });

  it('never uses a Track whose Processing is not completed', () => {
    const items = [track('pending', { isCompleted: false }), ...tracks(6)];
    const [row] = composeHomeRows([
      { id: 'row', layout: 'standard' as const, items },
    ]);
    expect(row?.items.map((item) => item.id)).not.toContain('pending');
    expect(row?.items).toHaveLength(6);
  });

  it('gives a hero only one Track that has a cover', () => {
    const [hero] = composeHomeRows([
      {
        id: 'hero',
        layout: 'hero' as const,
        items: [track('no-cover', { hasCover: false }), track('covered')],
      },
    ]);
    expect(hero?.items.map((item) => item.id)).toEqual(['covered']);
    expect(hero?.items).toHaveLength(1);
  });

  it('drops a hero when no candidate has a cover', () => {
    expect(
      composeHomeRows([
        {
          id: 'hero',
          layout: 'hero' as const,
          items: [track('no-cover', { hasCover: false })],
        },
      ]),
    ).toEqual([]);
  });

  it('does not require a cover for a standard carousel', () => {
    const items = tracks(6).map((item) => ({ ...item, hasCover: false }));
    expect(
      composeHomeRows([{ id: 'row', layout: 'standard' as const, items }]),
    ).toHaveLength(1);
  });

  it('caps a standard carousel at 12 items', () => {
    const [row] = composeHomeRows([
      { id: 'row', layout: 'standard' as const, items: tracks(20) },
    ]);
    expect(row?.items).toHaveLength(12);
  });

  it('keeps a Track out of a later hero once the first row used it', () => {
    const items = tracks(6);
    const rows = composeHomeRows([
      { id: 'row', layout: 'standard' as const, items },
      { id: 'hero', layout: 'hero' as const, items: items.slice(0, 1) },
    ]);
    expect(rows.map((row) => row.id)).toEqual(['row']);
  });

  describe('the by-voice rows', () => {
    const ranged = (id: string) => track(id, { hasVocalRange: true });

    it('drops a Track without a stored Vocal range', () => {
      const items = [...tracks(5), track('no-range', { hasVocalRange: false })];
      const rows = composeHomeRows([
        { id: 'easy', layout: 'vocal-range' as const, items },
      ]);
      expect(rows).toEqual([]);
    });

    it('keeps the Tracks that have a range, and drops the others', () => {
      const ranges = Array.from({ length: 6 }, (_, i) => ranged(`r${i}`));
      const [row] = composeHomeRows([
        {
          id: 'easy',
          layout: 'vocal-range' as const,
          items: [track('no-range'), ...ranges],
        },
      ]);
      expect(row?.items.map((item) => item.id)).toEqual([
        'r0',
        'r1',
        'r2',
        'r3',
        'r4',
        'r5',
      ]);
    });

    it('drops a by-voice row below six Tracks, like a standard row', () => {
      const ranges = Array.from({ length: 5 }, (_, i) => ranged(`r${i}`));
      expect(
        composeHomeRows([
          { id: 'easy', layout: 'vocal-range' as const, items: ranges },
        ]),
      ).toEqual([]);
    });

    it('does not need a range from the standard rows', () => {
      const [row] = composeHomeRows([
        { id: 'row', layout: 'standard' as const, items: tracks(6) },
      ]);
      expect(row?.items).toHaveLength(6);
    });
  });
});
