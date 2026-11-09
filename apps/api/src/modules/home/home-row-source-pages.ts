import type { Locale } from '@vozzify/contracts';
import { CANDIDATE_LIMIT } from './home-row-source-ranking.js';
import type { HomeCandidate, HomeRowSource } from './home-row-sources.js';

export const readHomeRowSourcePage = async (
  source: HomeRowSource,
  locale: Locale,
  offset: number,
): Promise<{ items: HomeCandidate[]; hasMore: boolean }> =>
  source.loadPage
    ? source.loadPage(locale, offset)
    : source.load(locale, offset).then((items) => ({
        items,
        hasMore: items.length >= (source.candidatePageSize ?? CANDIDATE_LIMIT),
      }));
