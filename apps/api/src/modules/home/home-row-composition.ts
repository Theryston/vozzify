import type { Locale } from '@vozzify/contracts';
import {
  type HomeCompositionCandidateRow,
  toHomeCompositionCandidateTrack,
} from './home-composition-candidates.js';
import { composeHomeRows } from './home-feed-composer.js';
import { CANDIDATE_LIMIT } from './home-row-source-ranking.js';
import type { HomeCandidate, HomeRowSource } from './home-row-sources.js';
import {
  HOME_COMPOSITION_CANDIDATE_POOL_MAX_ITEMS,
  HOME_TRACK_PAGE_SIZE,
  HOME_TRACK_ROW_MAX_ITEMS,
} from './home-rules.js';

type LoadedCandidateSource = {
  source: HomeRowSource;
  items: HomeCandidate[];
  offset: number;
  pageSize: number;
  hasMore: boolean;
};

const readCandidatePage = async (
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

const composeLoadedRows = (
  loaded: LoadedCandidateSource[],
  expandRecommendationRows = false,
) =>
  composeHomeRows(
    loaded.map(({ source, items }) => ({ ...source, items })),
    { expandRecommendationRows },
  );

const findComposedRow = (
  loaded: LoadedCandidateSource,
  rows: ReturnType<typeof composeLoadedRows>,
) => rows.find((row) => row.id === loaded.source.id);

const loadNextCandidatePage = async (
  loaded: LoadedCandidateSource,
  locale: Locale,
): Promise<void> => {
  loaded.offset += loaded.pageSize;
  const page = await readCandidatePage(loaded.source, locale, loaded.offset);
  loaded.items.push(...page.items);
  loaded.hasMore = page.hasMore;
};

const isCarouselSource = (source: HomeRowSource): boolean =>
  source.layout === 'standard' || source.layout === 'vocal-range';

const fillInitialCandidatePages = async (
  loadedSources: LoadedCandidateSource[],
  locale: Locale,
): Promise<void> => {
  for (const loaded of loadedSources) {
    if (!isCarouselSource(loaded.source)) continue;
    let rows = composeLoadedRows(loadedSources);
    let row = findComposedRow(loaded, rows);
    while (loaded.hasMore && (row?.items.length ?? 0) < HOME_TRACK_PAGE_SIZE) {
      await loadNextCandidatePage(loaded, locale);
      rows = composeLoadedRows(loadedSources);
      row = findComposedRow(loaded, rows);
    }
  }
};

const expandCandidatePages = async (
  loadedSources: LoadedCandidateSource[],
  locale: Locale,
): Promise<ReturnType<typeof composeLoadedRows>> => {
  let rows = composeLoadedRows(loadedSources, true);
  for (const loaded of loadedSources) {
    if (!isCarouselSource(loaded.source)) continue;
    let row = findComposedRow(loaded, rows);
    while (
      loaded.hasMore &&
      (row?.items.length ?? 0) < HOME_TRACK_ROW_MAX_ITEMS
    ) {
      await loadNextCandidatePage(loaded, locale);
      rows = composeLoadedRows(loadedSources, true);
      row = findComposedRow(loaded, rows);
    }
  }
  return rows;
};

const isCompositionCandidateLayout = (
  layout: HomeRowSource['layout'],
): layout is HomeCompositionCandidateRow['layout'] =>
  layout === 'hero' ||
  layout === 'standard' ||
  layout === 'vocal-range' ||
  layout === 'ranked';

const boundedCandidatePool = (
  loaded: LoadedCandidateSource,
): HomeCompositionCandidateRow | undefined => {
  const layout = loaded.source.layout;
  if (!isCompositionCandidateLayout(layout)) return undefined;
  const [composed] = composeHomeRows(
    [{ ...loaded.source, items: loaded.items }],
    { expandRecommendationRows: true },
  );
  if (!composed) return undefined;
  const items = loaded.items;
  const itemIndex = new Map(items.map((item, index) => [item.id, index]));
  const selectedOutsidePool = composed.items.filter(
    (item) =>
      (itemIndex.get(item.id) ?? 0) >=
      HOME_COMPOSITION_CANDIDATE_POOL_MAX_ITEMS,
  );
  const firstItemsLimit =
    HOME_COMPOSITION_CANDIDATE_POOL_MAX_ITEMS - selectedOutsidePool.length;
  const includedIds = new Set([
    ...items.slice(0, firstItemsLimit).map(({ id }) => id),
    ...selectedOutsidePool.map(({ id }) => id),
  ]);
  return {
    id: loaded.source.id,
    layout,
    ...(loaded.source.title ? { title: loaded.source.title } : {}),
    items: items
      .filter(({ id }) => includedIds.has(id))
      .slice(0, HOME_COMPOSITION_CANDIDATE_POOL_MAX_ITEMS)
      .map(toHomeCompositionCandidateTrack),
  };
};

const compositionCandidatePools = (
  loaded: LoadedCandidateSource[],
): HomeCompositionCandidateRow[] =>
  loaded.flatMap((source) => {
    if (!isCompositionCandidateLayout(source.source.layout)) return [];
    const pool = boundedCandidatePool(source);
    return pool ? [pool] : [];
  });

/** Allocates all initial carousel pages before ranked source expansion. */
export const composePublicRows = async (
  sources: HomeRowSource[],
  locale: Locale,
): Promise<{
  rows: ReturnType<typeof composeLoadedRows>;
  compositionCandidates: HomeCompositionCandidateRow[];
}> => {
  const loadedSources = await Promise.all(
    sources.map(async (source): Promise<LoadedCandidateSource> => {
      const pageSize = source.candidatePageSize ?? CANDIDATE_LIMIT;
      const page = await readCandidatePage(source, locale, 0);
      return {
        source,
        items: page.items,
        offset: 0,
        pageSize,
        hasMore: page.hasMore,
      };
    }),
  );
  await fillInitialCandidatePages(loadedSources, locale);
  return {
    rows: await expandCandidatePages(loadedSources, locale),
    compositionCandidates: compositionCandidatePools(loadedSources),
  };
};
