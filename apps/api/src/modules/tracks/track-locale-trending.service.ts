import { Injectable } from '@nestjs/common';
import type { Locale } from '@vozzify/contracts';
import {
  type LocaleTrendingEntry,
  rankLocaleTrending,
  scoreLocaleTrending,
} from './track-locale-trending.js';
import { TrackViewRepository } from './track-view.repository.js';
import { viewWindowStarts } from './view-windows.js';

/** The trending order of one locale, as the home feed ranks by it. */
@Injectable()
export class TrackLocaleTrendingService {
  constructor(private readonly views: TrackViewRepository) {}

  /**
   * The locale's Tracks by trending score, or undefined when the locale has too
   * few views this month to rank on its own (the global figures apply then).
   */
  async rank(
    locale: Locale,
    now = new Date(),
    trackIds?: readonly string[],
  ): Promise<LocaleTrendingEntry[] | undefined> {
    if (trackIds !== undefined) {
      if (trackIds.length === 0) return [];
      const starts = viewWindowStarts(now);
      const [counts, cohort] = await Promise.all([
        this.views.localeViewCountsForTracks(locale, starts, [...trackIds]),
        this.views.localePlatformAverages(locale, starts),
      ]);
      if (cohort.monthViews === 0) return undefined;
      return scoreLocaleTrending(counts, cohort.averages);
    }
    const counts = await this.views.localeViewCounts(
      locale,
      viewWindowStarts(now),
    );
    return rankLocaleTrending(counts);
  }
}
