import type {
  HomeCompositionCandidateRow,
  HomeCompositionCandidateTrack,
} from './home-composition-candidates.js';
import { composeHomeRows } from './home-feed-composer.js';
import { genreRowId } from './home-genre-rows.js';
import { applyEditorialPins } from './home-pin-overlay.js';
import { composePublicVisitRows } from './home-public-visit-composer.js';

const tracks = (
  prefix: string,
  count = 12,
  score = 100,
): HomeCompositionCandidateTrack[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    title: `${prefix} ${index}`,
    coverUrl: null,
    artistCredit: [{ name: `${prefix}-artist-${index}`, joinPhrase: '' }],
    durationMs: null,
    vocalRange: null,
    artistKey: `${prefix}-artist-${index}`,
    hasCover: false,
    isCompleted: true,
    collectiveScore: score,
  }));

const genre = (
  name: string,
  items: HomeCompositionCandidateTrack[],
): HomeCompositionCandidateRow => ({
  id: genreRowId(name),
  genre: name,
  layout: 'standard',
  title: { key: 'home.rows.popularGenre', params: { genre: name } },
  items,
});

describe('genre composition through the Home composer', () => {
  it('keeps canonically distinct Artists with identical public names through overlay qualification', () => {
    const pool = tracks('homonyms', 25).map((track, index) => ({
      ...track,
      artistCredit: [{ name: 'Same public name', joinPhrase: '' }],
      artistKey: `canonical-${index}`,
      artistKeys: [`canonical-${index}`],
    }));
    const candidate = genre('homonyms', pool);
    const withoutPins = composePublicVisitRows([], [candidate], []);
    const first = withoutPins[0];
    expect(first?.layout).toBe('standard');
    if (first?.layout !== 'standard')
      throw new Error('Expected genre with distinct canonical Artists');
    expect(first.items).toHaveLength(25);
    const pinned = pool[0];
    if (!pinned) throw new Error('Missing homonym fixture');
    const withPin = composePublicVisitRows(
      withoutPins,
      [candidate],
      [
        {
          id: 'homonym',
          kind: 'row',
          position: 0,
          priority: 0,
          createdAt: 0,
          sponsored: false,
          title: { key: 'home.rows.pinned', params: { title: 'Pin' } },
          tracks: [pinned],
        },
      ],
    );
    const retained = withPin.find(({ id }) => id === candidate.id);
    if (retained?.layout !== 'standard')
      throw new Error('Expected retained canonical-Artist genre');
    expect(retained.items).toHaveLength(24);
    expect(retained.items.some(({ id }) => id === pinned.id)).toBe(false);
  });
  it('requalifies public fallback after Pins shift logical batch boundaries', () => {
    const items = tracks('shift', 25).map((track, index) => ({
      ...track,
      artistCredit: [{ name: `Artist ${index % 6}`, joinPhrase: '' }],
    }));
    const row = {
      id: genreRowId('shift'),
      layout: 'standard' as const,
      title: { key: 'home.rows.popularGenre', params: { genre: 'shift' } },
      items,
    };
    const pinned = items[1];
    if (!pinned) throw new Error('Missing pinned fixture');
    const rows = applyEditorialPins(
      [row],
      [
        {
          id: 'shift',
          kind: 'row',
          position: 0,
          priority: 0,
          createdAt: 0,
          sponsored: false,
          title: { key: 'home.rows.pinned', params: { title: 'Pin' } },
          tracks: [pinned],
        },
      ],
      'personal',
    );
    const result = rows.find(({ id }) => id === row.id);
    if (result?.layout !== 'standard')
      throw new Error('Expected valid fallback genre');
    for (let offset = 0; offset < result.items.length; offset += 12) {
      const batch = result.items.slice(offset, offset + 12);
      for (let artist = 0; artist < 6; artist += 1) {
        expect(
          batch.filter(
            (track) => track.artistCredit[0]?.name === `Artist ${artist}`,
          ).length,
        ).toBeLessThanOrEqual(2);
      }
    }
  });
  it('recomputes overlapping genre mean priority after every allocation', () => {
    const shared = tracks('shared', 12, 120);
    const rows = composeHomeRows(
      [
        genre('b', [...shared.slice(0, 6), ...tracks('b', 12, 50)]),
        genre('c', tracks('c', 12, 70)),
        genre('a', shared),
      ],
      { expandRecommendationRows: true },
    );
    expect(rows.map(({ genre: name }) => name)).toEqual(['a', 'c', 'b']);
    expect(rows[2]?.items.map(({ id }) => id)).toEqual(
      tracks('b', 12, 50).map(({ id }) => id),
    );
    const ids = rows.flatMap((row) => row.items.map(({ id }) => id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('releases rejected provisional Tracks and breaks equal means by genre identity', () => {
    const shared = tracks('shared', 11);
    const rows = composeHomeRows([
      genre('thin', shared),
      genre('zeta', tracks('zeta')),
      genre('alpha', [...shared, ...tracks('extra', 1)]),
    ]);
    expect(rows.map(({ genre: name }) => name)).toEqual(['alpha', 'zeta']);
    expect(rows[0]?.items).toHaveLength(12);
  });

  it('protects genre initial contents before any existing Row expands', () => {
    const initial = tracks('initial');
    const strong = tracks('strong');
    const ordinary: HomeCompositionCandidateRow = {
      id: 'trending-today',
      layout: 'standard',
      title: { key: 'home.rows.trendingToday', params: {} },
      items: [...initial, ...strong, ...tracks('remaining', 40)],
    };
    const rows = composeHomeRows([ordinary, genre('pop', strong)], {
      expandRecommendationRows: true,
    });
    expect(rows[0]?.items).toHaveLength(48);
    expect(rows[1]?.items.map(({ id }) => id)).toEqual(
      strong.map(({ id }) => id),
    );
    expect(rows[0]?.items.some((item) => item.id.startsWith('strong-'))).toBe(
      false,
    );
  });

  it('counts collaborators, requires six Artists, and resets counts only between batches', () => {
    expect(
      composeHomeRows([
        genre(
          'uncredited',
          tracks('uncredited').map((item) => ({ ...item, artistCredit: [] })),
        ),
      ]),
    ).toEqual([]);
    const collaboration = tracks('collaboration').map((item) => ({
      ...item,
      artistKeys: [item.artistKey, 'shared-guest'],
    }));
    expect(composeHomeRows([genre('collaboration', collaboration)])).toEqual(
      [],
    );
    const concentrated = tracks('concentrated').map((item, index) => ({
      ...item,
      artistKey: `artist-${index % 5}`,
    }));
    expect(composeHomeRows([genre('five-artists', concentrated)])).toEqual([]);
    const diverse = tracks('diverse', 48).map((item, index) => ({
      ...item,
      artistKey: `artist-${index % 6}`,
    }));
    const [row] = composeHomeRows([genre('diverse', diverse)], {
      expandRecommendationRows: true,
    });
    expect(row?.items).toHaveLength(48);
    for (let offset = 0; offset < 48; offset += 12) {
      const batch = row?.items.slice(offset, offset + 12) ?? [];
      for (let artist = 0; artist < 6; artist += 1) {
        expect(
          batch.filter(({ artistKey }) => artistKey === `artist-${artist}`),
        ).toHaveLength(2);
      }
    }
  });

  it('uses the full 24-Row capacity without an extra genre cap and releases excluded Rows', () => {
    const genres = Array.from({ length: 28 }, (_, index) =>
      genre(
        `genre-${index.toString().padStart(2, '0')}`,
        tracks(`genre-${index}`),
      ),
    );
    const ordinary: HomeCompositionCandidateRow = {
      id: 'trending-today',
      layout: 'standard',
      title: { key: 'home.rows.trendingToday', params: {} },
      items: [...tracks('ordinary'), ...tracks('genre-27')],
    };
    const rows = composePublicVisitRows([], [ordinary, ...genres], []);
    expect(rows).toHaveLength(24);
    expect(
      rows.filter((row) => row.id.startsWith('popular-genre-')),
    ).toHaveLength(23);
    const first = rows[0];
    expect(first?.layout).toBe('standard');
    if (first?.layout !== 'standard') throw new Error('Expected ordinary Row');
    expect(first.items).toHaveLength(24);
    expect(first.items.some(({ id }) => id === 'genre-27-0')).toBe(true);
  });
});
