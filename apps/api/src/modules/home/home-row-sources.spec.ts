import type { HomeTrackRecord } from './home.repository.js';
import { createHomeRowSources, inRankOrder } from './home-row-sources.js';

const record = (id: string): HomeTrackRecord => ({
  id,
  title: `Track ${id}`,
  coverUrl: `https://cdn.example/${id}.webp`,
  artistCredit: [{ name: `Artist ${id}`, joinPhrase: '' }],
  lengthMs: 180_000,
  vocalRangeLowest: 60,
  vocalRangeHighest: 72,
});

describe('inRankOrder', () => {
  it('orders the records as the ranked ids name them', () => {
    const records = [record('a'), record('b'), record('c')];

    expect(inRankOrder(records, ['c', 'a', 'b']).map((r) => r.id)).toEqual([
      'c',
      'a',
      'b',
    ]);
  });

  it('skips an id with no record, a Track that is no longer completed', () => {
    expect(inRankOrder([record('a')], ['gone', 'a']).map((r) => r.id)).toEqual([
      'a',
    ]);
  });
});

describe('the trending row sources', () => {
  const repository = {
    findTrendingTracks: vi.fn(),
    findNewestTracks: vi.fn(),
    findCompletedTracksByIds: vi.fn(),
    findMostSungTrackIds: vi.fn(),
    findMostFavoritedTrackIds: vi.fn(),
    countRecentAttempts: vi.fn(),
    countRecentFavorites: vi.fn(),
    localePracticeEvidence: vi.fn(),
  };
  const ranking = { rank: vi.fn() };

  const trendingLoad = async (locale: 'en' | 'pt-BR') => {
    const source = createHomeRowSources(repository, ranking).find(
      (row) => row.id === 'trending-today',
    );
    return source?.load(locale);
  };

  beforeEach(() => {
    vi.resetAllMocks();
    repository.findTrendingTracks.mockResolvedValue([record('global')]);
    repository.findNewestTracks.mockResolvedValue([]);
    repository.findMostSungTrackIds.mockResolvedValue([]);
    repository.findMostFavoritedTrackIds.mockResolvedValue([]);
    repository.countRecentAttempts.mockResolvedValue([]);
    repository.countRecentFavorites.mockResolvedValue([]);
    repository.localePracticeEvidence.mockResolvedValue({
      distinctUsers: 0,
      activeDays: 0,
    });
  });

  it('falls back to the global trending figures when the locale has no ranking', async () => {
    ranking.rank.mockResolvedValue(undefined);
    repository.localePracticeEvidence.mockResolvedValue({
      distinctUsers: 20,
      activeDays: 5,
    });

    const items = await trendingLoad('pt-BR');

    expect(ranking.rank).toHaveBeenCalledWith('pt-BR');
    expect(repository.findTrendingTracks).toHaveBeenCalledWith(60);
    expect(repository.findCompletedTracksByIds).not.toHaveBeenCalled();
    expect(items?.map((item) => item.id)).toEqual(['global']);
  });

  it('loads the locale ranking in its own order', async () => {
    repository.localePracticeEvidence.mockResolvedValue({
      distinctUsers: 20,
      activeDays: 5,
    });
    ranking.rank.mockResolvedValue([
      { trackId: 'b', score: 9 },
      { trackId: 'a', score: 5 },
    ]);
    repository.findCompletedTracksByIds.mockResolvedValue([
      record('a'),
      record('b'),
    ]);

    const items = await trendingLoad('en');

    expect(repository.findCompletedTracksByIds).toHaveBeenCalledWith([
      'b',
      'a',
    ]);
    expect(repository.findTrendingTracks).not.toHaveBeenCalled();
    expect(items?.map((item) => item.id)).toEqual(['b', 'a']);
  });

  it('loads later bounded global ranking pages by offset', async () => {
    const source = createHomeRowSources(repository, ranking).find(
      (row) => row.id === 'trending-today',
    );

    await source?.load('en', 60);

    expect(repository.findTrendingTracks).toHaveBeenCalledWith(60, 60);
  });
});

describe('the singing row sources', () => {
  const repository = {
    findTrendingTracks: vi.fn(),
    findNewestTracks: vi.fn(),
    findCompletedTracksByIds: vi.fn(),
    findMostSungTrackIds: vi.fn(),
    findMostFavoritedTrackIds: vi.fn(),
    countRecentAttempts: vi.fn(),
    countRecentFavorites: vi.fn(),
    localePracticeEvidence: vi.fn(),
  };
  const ranking = { rank: vi.fn() };

  const sourceLoad = async (id: string, locale: 'en' | 'pt-BR' = 'en') => {
    const source = createHomeRowSources(repository, ranking).find(
      (row) => row.id === id,
    );
    return source?.load(locale);
  };

  beforeEach(() => {
    vi.resetAllMocks();
    repository.findTrendingTracks.mockResolvedValue([]);
    repository.findCompletedTracksByIds.mockImplementation(
      async (ids: string[]) => ids.map((id) => record(id)),
    );
    repository.findMostSungTrackIds.mockResolvedValue([]);
    repository.findMostFavoritedTrackIds.mockResolvedValue([]);
    repository.countRecentAttempts.mockResolvedValue([]);
    repository.countRecentFavorites.mockResolvedValue([]);
    repository.localePracticeEvidence.mockResolvedValue({
      distinctUsers: 0,
      activeDays: 0,
    });
  });

  it('orders "Most sung" by valid Attempts, best first', async () => {
    repository.findMostSungTrackIds.mockResolvedValue([
      { trackId: 'sung-a', count: 25 },
      { trackId: 'sung-b', count: 4 },
      { trackId: 'viewed-only', count: 0 },
    ]);

    const items = await sourceLoad('most-sung');

    expect(items?.map((item) => item.id)).toEqual([
      'sung-a',
      'sung-b',
      'viewed-only',
    ]);
  });

  it('skips a most-sung Track that is no longer completed', async () => {
    repository.findMostSungTrackIds.mockResolvedValue([
      { trackId: 'gone', count: 30 },
      { trackId: 'kept', count: 2 },
    ]);
    repository.findCompletedTracksByIds.mockResolvedValue([record('kept')]);

    const items = await sourceLoad('most-sung');

    expect(items?.map((item) => item.id)).toEqual(['kept']);
  });

  it('orders "Most favorited" by recent favorites, best first', async () => {
    repository.findMostFavoritedTrackIds.mockResolvedValue([
      { trackId: 'loved', count: 9 },
      { trackId: 'liked', count: 2 },
    ]);

    const items = await sourceLoad('most-favorited');

    expect(items?.map((item) => item.id)).toEqual(['loved', 'liked']);
  });

  it('blends the weekly Top 10 from the trending score and the singing signal', async () => {
    ranking.rank.mockResolvedValue(undefined);
    repository.findTrendingTracks.mockResolvedValue([
      { ...record('viewed'), trendingScore: 120 },
      { ...record('quiet'), trendingScore: 0 },
      { ...record('sung'), trendingScore: 10 },
    ]);
    repository.findMostSungTrackIds.mockResolvedValue([
      { trackId: 'sung', count: 10 },
    ]);
    repository.findMostFavoritedTrackIds.mockResolvedValue([
      { trackId: 'viewed', count: 1 },
    ]);
    repository.findCompletedTracksByIds.mockImplementation(async () => [
      { ...record('viewed'), trendingScore: 120 },
      { ...record('quiet'), trendingScore: 0 },
      { ...record('sung'), trendingScore: 10 },
    ]);
    repository.countRecentAttempts.mockResolvedValue([
      { trackId: 'sung', count: 10 },
    ]);
    repository.countRecentFavorites.mockResolvedValue([
      { trackId: 'viewed', count: 1 },
    ]);

    const items = await sourceLoad('top-10-week');

    // 10 + 10 × 12 = 130 beats the viewed-only 120 + 6 = 126; the signal-less
    // Track stays out of the chart.
    expect(items?.map((item) => item.id)).toEqual(['sung', 'viewed']);
  });

  it('leaves Tracks with no signal at all out of the weekly Top 10', async () => {
    ranking.rank.mockResolvedValue(undefined);
    repository.findTrendingTracks.mockResolvedValue([
      { ...record('silent'), trendingScore: 0 },
    ]);
    repository.findCompletedTracksByIds.mockImplementation(async () => [
      { ...record('silent'), trendingScore: 0 },
    ]);

    const items = await sourceLoad('top-10-week');

    expect(items).toEqual([]);
  });

  it('leaves a viewed-only Track out of the weekly Top 10', async () => {
    ranking.rank.mockResolvedValue(undefined);
    repository.findTrendingTracks.mockResolvedValue([
      { ...record('viewed'), trendingScore: 120 },
      { ...record('sung'), trendingScore: 10 },
    ]);
    repository.findCompletedTracksByIds.mockImplementation(async () => [
      { ...record('viewed'), trendingScore: 120 },
      { ...record('sung'), trendingScore: 10 },
    ]);
    repository.findMostSungTrackIds.mockResolvedValue([
      { trackId: 'sung', count: 1 },
    ]);
    repository.countRecentAttempts.mockResolvedValue([
      { trackId: 'sung', count: 1 },
    ]);
    repository.countRecentFavorites.mockResolvedValue([]);

    const items = await sourceLoad('top-10-week');

    // The viewed-only Track would outscore the sung one (120 against 22),
    // but the chart only ranks Tracks the community sang or favorited.
    expect(items?.map((item) => item.id)).toEqual(['sung']);
  });

  it('counts singers across the whole chart pool beyond the top-singer shortlist', async () => {
    const singerShortlist = Array.from(
      { length: 60 },
      (_, index) => `singer-${index + 1}`,
    );
    const outsideShortlist = 'singer-61';
    repository.findTrendingTracks.mockResolvedValue([
      { ...record(outsideShortlist), trendingScore: 0 },
    ]);
    repository.findMostSungTrackIds.mockResolvedValue(
      singerShortlist.map((trackId) => ({ trackId, count: 1 })),
    );
    repository.findMostFavoritedTrackIds.mockResolvedValue([
      { trackId: outsideShortlist, count: 1 },
    ]);
    repository.findCompletedTracksByIds.mockImplementation(
      async (ids: string[]) =>
        ids.map((id) => ({ ...record(id), trendingScore: 0 })),
    );
    repository.countRecentAttempts.mockImplementation(async (ids: string[]) =>
      ids.map((trackId) => ({
        trackId,
        count: trackId === outsideShortlist ? 100 : 1,
      })),
    );
    repository.countRecentFavorites.mockResolvedValue([]);

    const items = await sourceLoad('top-10-week');

    expect(repository.countRecentAttempts.mock.calls[0]?.[0]).toContain(
      outsideShortlist,
    );
    expect(items?.[0]?.id).toBe(outsideShortlist);
  });
});
