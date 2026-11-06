/**
 * The singing signal of the home feed: how much the community actually sings,
 * next to how much it views. The public rows blend the views-based trending
 * score with valid Attempts and recent favorites; "Most sung" orders by valid
 * Attempts alone, so a Track people sing always outranks one they only viewed.
 * See docs/adr/0009-trending-score-jobs.md ("The singing signal").
 */

/** How far back "Most sung" and "Most favorited" look, in days. */
export const SINGING_SIGNAL_WINDOW_DAYS = 28;

/** How far back the weekly Top 10 looks, in days: the week. */
export const TOP_10_WINDOW_DAYS = 7;

/**
 * What one unit of each signal is worth in the blended popularity. An attempt
 * is a minutes-long sung run, so it outweighs a favorite (one tap), and both
 * outweigh one point of the views-based trending score (which already bundles
 * thousands of views through its log scale). With these weights a Track with a
 * trending score of 120 and no singing scores 120, while one at 10 with ten
 * recent valid Attempts scores 10 + 10 × 12 = 130: singing outranks viewing.
 */
export const POPULARITY_WEIGHTS = {
  trending: 1,
  attempt: 12,
  favorite: 6,
} as const;

/** Whether a run counts as singing: no forward skip, no suspected bleed. */
export const isCountedAttempt = (attempt: {
  forwardSkip: boolean;
  bleedSuspected: boolean;
}): boolean => !attempt.forwardSkip && !attempt.bleedSuspected;

/** One Track's singing signal: its valid Attempts or recent favorites. */
export type TrackSignalCount = {
  trackId: string;
  count: number;
  rawCount?: number;
};

/**
 * Orders Tracks by their signal, most first; ties keep Track id order, so a
 * regeneration with unchanged counts keeps the row order (and the feed
 * version) stable.
 */
export const rankBySignalCount = (
  entries: readonly TrackSignalCount[],
): TrackSignalCount[] =>
  [...entries].sort(
    (a, b) =>
      b.count - a.count ||
      (b.rawCount ?? b.count) - (a.rawCount ?? a.count) ||
      a.trackId.localeCompare(b.trackId),
  );

/**
 * The blended popularity of a Track: its views-based trending score plus its
 * singing signal in the window. The trending score keeps working on its own
 * for the sitemap; only the home blends it.
 */
export const popularityScore = (signals: {
  trendingScore: number;
  attempts: number;
  favorites: number;
}): number =>
  signals.trendingScore * POPULARITY_WEIGHTS.trending +
  signals.attempts * POPULARITY_WEIGHTS.attempt +
  signals.favorites * POPULARITY_WEIGHTS.favorite;
