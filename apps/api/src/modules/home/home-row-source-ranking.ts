import type { Locale } from '@vozzify/contracts';
import type { TrackLocaleTrendingService } from '../tracks/track-locale-trending.service.js';
import type { HomeRepository, HomeTrackRecord } from './home.repository.js';
import {
  popularityScore,
  rankBySignalCount,
  SINGING_SIGNAL_WINDOW_DAYS,
  TOP_10_WINDOW_DAYS,
} from './home-popularity.js';
import { hasSufficientLocaleEvidence } from './home-stage2-scoring.js';

/** How many candidates a source offers the composer, best first. */
export const CANDIDATE_LIMIT = 60;

/** The repository reads the row sources need; narrowed so tests can fake them. */
export type HomeRecords = Pick<
  HomeRepository,
  | 'findTrendingTracks'
  | 'findNewestTracks'
  | 'findCompletedTracksByIds'
  | 'findMostSungTrackIds'
  | 'findMostFavoritedTrackIds'
  | 'countRecentAttempts'
  | 'countRecentFavorites'
  | 'localePracticeEvidence'
>;
type TrendingRecords = Pick<
  HomeRepository,
  'findTrendingTracks' | 'findCompletedTracksByIds' | 'localePracticeEvidence'
>;
export type TrendingRanking = Pick<TrackLocaleTrendingService, 'rank'>;

/**
 * Orders the records as the ranked `ids` name them; an id with no record (a
 * Track that is no longer completed) is skipped.
 */
export const rankedHomeRecords = (
  records: HomeTrackRecord[],
  ids: readonly string[],
): HomeTrackRecord[] => {
  const byId = new Map(records.map((record) => [record.id, record]));
  return ids.flatMap((id) => {
    const record = byId.get(id);
    return record ? [record] : [];
  });
};

/**
 * The trending candidates of one locale. A locale with enough views this month
 * is ranked by its own views; otherwise the global trending score applies.
 */
export const localeTrending = async (
  repository: TrendingRecords,
  ranking: TrendingRanking,
  locale: Locale,
  activityWindowDays = SINGING_SIGNAL_WINDOW_DAYS,
): Promise<HomeTrackRecord[]> => {
  const evidence = await repository.localePracticeEvidence(
    locale,
    windowSince(activityWindowDays),
  );
  if (
    !hasSufficientLocaleEvidence(evidence.distinctUsers, evidence.activeDays)
  ) {
    return repository.findTrendingTracks(CANDIDATE_LIMIT);
  }
  const entries = await ranking.rank(locale);
  if (entries === undefined) {
    return repository.findTrendingTracks(CANDIDATE_LIMIT);
  }
  const ids = entries.slice(0, CANDIDATE_LIMIT).map((entry) => entry.trackId);
  return rankedHomeRecords(await repository.findCompletedTracksByIds(ids), ids);
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** The start of the rolling window `days` long that ends now. */
export const windowSince = (days: number, now: number = Date.now()): Date =>
  new Date(now - days * DAY_MS);

/**
 * The completed Tracks behind a signal count (valid Attempts, recent
 * favorites), best first. The repository reads them in signal order already;
 * `inRankOrder` keeps that order and skips Tracks that stopped being completed.
 */
export const rankedBySignal = async (
  repository: Pick<HomeRepository, 'findCompletedTracksByIds'>,
  count: () => Promise<{ trackId: string; count: number }[]>,
): Promise<HomeTrackRecord[]> => {
  const ids = rankBySignalCount(await count()).map((entry) => entry.trackId);
  return rankedHomeRecords(await repository.findCompletedTracksByIds(ids), ids);
};

const scoreWeeklyRecords = (options: {
  records: HomeTrackRecord[];
  sung: { trackId: string; count: number }[];
  favorites: { trackId: string; count: number }[];
  trendingScoreById: ReadonlyMap<string, number>;
}) => {
  const { records, sung, favorites, trendingScoreById } = options;
  const singersOf = new Map(sung.map((entry) => [entry.trackId, entry.count]));
  const favoritesOf = new Map(
    favorites.map((entry) => [entry.trackId, entry.count]),
  );
  const scored = records
    .map((record) => {
      const singers = singersOf.get(record.id) ?? 0;
      const favorites = favoritesOf.get(record.id) ?? 0;
      return {
        id: record.id,
        // Views alone do not place a Track in the collective weekly chart.
        signal: singers + favorites,
        score: popularityScore({
          trendingScore: trendingScoreById.get(record.id) ?? 0,
          attempts: singers,
          favorites,
        }),
      };
    })
    .filter((entry) => entry.signal > 0 && entry.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return scored.map((entry) => entry.id);
};

/** The weekly Top 10: the blended popularity of the week, best first. */
export const weeklyTop10 = async (
  repository: HomeRecords,
  ranking: TrendingRanking,
  locale: Locale,
): Promise<HomeTrackRecord[]> => {
  const since = windowSince(TOP_10_WINDOW_DAYS);
  const localeEvidence = await repository.localePracticeEvidence(locale, since);
  const useLocale =
    localeEvidence !== undefined &&
    hasSufficientLocaleEvidence(
      localeEvidence.distinctUsers,
      localeEvidence.activeDays,
    );
  const trendingRecords = await localeTrending(
    repository,
    ranking,
    locale,
    TOP_10_WINDOW_DAYS,
  );
  const localeEntries = useLocale ? await ranking.rank(locale) : undefined;
  const trendingScoreById = new Map(
    localeEntries?.map((entry) => [entry.trackId, entry.score]) ??
      trendingRecords.map((record) => [record.id, record.trendingScore ?? 0]),
  );
  const [sung, favorited] = await Promise.all([
    repository.findMostSungTrackIds(
      CANDIDATE_LIMIT,
      since,
      useLocale ? locale : undefined,
    ),
    useLocale
      ? Promise.resolve([])
      : repository.findMostFavoritedTrackIds(CANDIDATE_LIMIT, since),
  ]);
  const pool = [
    ...new Set([
      ...trendingRecords.map((record) => record.id),
      ...sung.map((entry) => entry.trackId),
      ...favorited.map((entry) => entry.trackId),
    ]),
  ];
  const records = await repository.findCompletedTracksByIds(pool);
  const favorites = useLocale
    ? []
    : await repository.countRecentFavorites(pool, since);
  const scoredIds = scoreWeeklyRecords({
    records,
    sung,
    favorites,
    trendingScoreById,
  });
  // No slice here: the composer keeps the first unused Tracks up to the
  // layout's own maximum, so earlier rows never starve the chart.
  return rankedHomeRecords(records, scoredIds);
};
