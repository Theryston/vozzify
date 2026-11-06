import type { HomeAlbumRecord } from './home.repository.js';
import { loadUsefulAlbums } from './home-album-candidates.js';

const candidatePage = (ids: string[]): HomeAlbumRecord[] =>
  ids.map((id) => ({
    id,
    title: id,
    coverArtUrl: null,
    year: null,
  }));

describe('loadUsefulAlbums', () => {
  it('re-ranks a full page after replenishing overlapping candidates', async () => {
    const firstPageIds = Array.from(
      { length: 60 },
      (_, index) => `album-${String(index).padStart(2, '0')}`,
    );
    const independentId = 'independent';
    const pages = new Map<number, HomeAlbumRecord[]>([
      [0, candidatePage(firstPageIds)],
      [60, candidatePage([independentId])],
      [120, []],
    ]);
    const signals = new Map(
      firstPageIds.map((albumId, index) => [
        albumId,
        [
          { albumId, trackId: 'shared-hit', popularity: 1000 },
          ...(index >= 48
            ? [
                {
                  albumId,
                  trackId: `quiet-track-${index}`,
                  popularity: 0,
                },
              ]
            : []),
        ],
      ]),
    );
    signals.set(independentId, [
      {
        albumId: independentId,
        trackId: 'independent-track',
        popularity: 900,
      },
    ]);
    const findPopularAlbums = vi.fn(
      async (_limit: number, offset = 0) => pages.get(offset) ?? [],
    );
    const findAlbumTrackSignals = vi.fn(async (ids: string[]) =>
      ids.flatMap((id) => signals.get(id) ?? []),
    );
    const localePracticeEvidence = vi.fn().mockResolvedValue({
      distinctUsers: 0,
      activeDays: 0,
    });
    const ranking = { rank: vi.fn().mockResolvedValue(undefined) };

    const selected = await loadUsefulAlbums(
      {
        findPopularAlbums,
        findAlbumTrackSignals,
        localePracticeEvidence,
      },
      ranking,
    );

    expect(findPopularAlbums.mock.calls.map(([, offset]) => offset)).toEqual([
      0, 60, 120,
    ]);
    expect(selected[0]?.id).toBe('album-48');
    expect(selected[1]?.id).toBe(independentId);
    expect(selected).toHaveLength(12);
  });
});
