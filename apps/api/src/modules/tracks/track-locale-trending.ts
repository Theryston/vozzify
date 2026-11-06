import {
  averageViewsPerTrack,
  type PlatformViewAverages,
  type TrackViewCounts,
  trendingScore,
} from './trending-score.js';

/**
 * The fewest views a locale needs this calendar month before its own trending
 * order is used. A locale with no view this month always falls back to the
 * global figures, whatever this minimum says; the minimum only raises the bar
 * above one view. See docs/adr/0009-trending-score-jobs.md.
 */
export const MIN_LOCALE_VIEWS_FOR_TRENDING = 0;

/** One Track's views in one locale, per trending window. */
export type LocaleTrackViews = TrackViewCounts & { trackId: string };

/** A Track with a positive trending score in one locale. */
export type LocaleTrendingEntry = { trackId: string; score: number };

export const scoreLocaleTrending = (
  rows: LocaleTrackViews[],
  platform: PlatformViewAverages,
): LocaleTrendingEntry[] =>
  rows
    .map((row) => ({
      trackId: row.trackId,
      score: trendingScore(row, platform),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.trackId.localeCompare(b.trackId));

const sumOf = (
  rows: LocaleTrackViews[],
  window: keyof TrackViewCounts,
): number => rows.reduce((total, row) => total + row[window], 0);

/** Views per Track viewed in a window, among the locale's own Tracks. */
const localePlatformAverages = (rows: LocaleTrackViews[]) => ({
  hour: averageViewsPerTrack(
    sumOf(rows, 'hour'),
    rows.filter((row) => row.hour > 0).length,
  ),
  day: averageViewsPerTrack(
    sumOf(rows, 'day'),
    rows.filter((row) => row.day > 0).length,
  ),
});

/**
 * Ranks one locale's Tracks by the trending score, computed from that locale's
 * views and averages only. Returns undefined, so the caller falls back to the
 * global figures, when the locale has no view this month or fewer than
 * `minViews`. Tracks scoring 0 are left out; ties keep Track id order.
 */
export const rankLocaleTrending = (
  rows: LocaleTrackViews[],
  minViews: number = MIN_LOCALE_VIEWS_FOR_TRENDING,
): LocaleTrendingEntry[] | undefined => {
  const monthViews = sumOf(rows, 'month');
  if (monthViews === 0 || monthViews < minViews) {
    return undefined;
  }
  return scoreLocaleTrending(rows, localePlatformAverages(rows));
};
