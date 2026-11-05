import type { HomeAlbumCandidateRecord } from './home-album-selection.js';
import { selectUsefulAlbums } from './home-album-selection.js';

const album = (
  id: string,
  tracks: [string, number][],
  overrides: Partial<HomeAlbumCandidateRecord> = {},
): HomeAlbumCandidateRecord => ({
  id,
  title: id,
  coverArtUrl: null,
  year: null,
  primaryType: 'Album',
  secondaryTypes: [],
  availableTracks: tracks.map(([trackId, popularity]) => ({
    id: trackId,
    popularity,
  })),
  ...overrides,
});

describe('selectUsefulAlbums', () => {
  it('drops identical Albums and strict subsets after selecting their content', () => {
    const selected = selectUsefulAlbums(
      [
        album('full', [
          ['a', 100],
          ['b', 50],
        ]),
        album('identical', [
          ['a', 100],
          ['b', 50],
        ]),
        album('subset', [['a', 100]]),
      ],
      12,
    );

    expect(selected.map(({ id }) => id)).toEqual(['full']);
  });

  it('recomputes remaining popularity after shared Tracks are claimed', () => {
    const selected = selectUsefulAlbums(
      [
        album('first', [
          ['a', 100],
          ['b', 120],
        ]),
        album('overlap', [
          ['a', 100],
          ['c', 70],
        ]),
        album('independent', [
          ['d', 120],
          ['e', 30],
        ]),
      ],
      12,
    );

    expect(selected.map(({ id }) => id)).toEqual([
      'first',
      'independent',
      'overlap',
    ]);
  });

  it('rejects Albums whose overlap is distributed across prior selections', () => {
    const selected = selectUsefulAlbums(
      [
        album('first', [
          ['a', 100],
          ['b', 60],
        ]),
        album('second', [
          ['c', 90],
          ['d', 50],
        ]),
        album('distributed-subset', [
          ['a', 100],
          ['d', 50],
        ]),
        album('adds-content', [
          ['b', 60],
          ['e', 40],
        ]),
      ],
      12,
    );

    expect(selected.map(({ id }) => id)).toEqual([
      'first',
      'second',
      'adds-content',
    ]);
  });

  it('uses deterministic quality tie-breakers without inferring unknown metadata', () => {
    const selected = selectUsefulAlbums(
      [
        album('compilation', [['d', 10]], {
          secondaryTypes: ['Compilation'],
        }),
        album('unknown-type', [['c', 10]], {
          secondaryTypes: undefined,
          coverArtUrl: 'https://cdn.example/cover.webp',
          year: 1980,
        }),
        album('non-compilation', [['b', 10]], {
          coverArtUrl: 'https://cdn.example/cover.webp',
          year: 1980,
        }),
        album('older', [['a', 10]], {
          coverArtUrl: 'https://cdn.example/cover.webp',
          year: 1970,
        }),
      ],
      4,
    );

    expect(selected.map(({ id }) => id)).toEqual([
      'older',
      'non-compilation',
      'unknown-type',
      'compilation',
    ]);
  });

  it('keeps an Album with new completed Tracks even when their score is zero', () => {
    const selected = selectUsefulAlbums(
      [album('zero-score-new-content', [['a', 0]])],
      12,
    );

    expect(selected.map(({ id }) => id)).toEqual(['zero-score-new-content']);
  });
});
