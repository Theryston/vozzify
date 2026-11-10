import type { ComposableTrack } from './home-composable-track.js';
import {
  HOME_RECOMMENDATION_ROW_MIN_ITEMS,
  HOME_ROW_RULES,
  HOME_TRACK_PAGE_SIZE,
  type HomeEntityLayout,
  type HomeLayout,
  isHomeRecommendationRow,
} from './home-rules.js';
import { progressiveExposureFactor } from './home-stage2-scoring.js';
import { isEligible, pickRowItems } from './home-track-row-picker.js';

export type { ComposableTrack } from './home-composable-track.js';

type HomeTrackRowCandidate<T extends ComposableTrack> = {
  id: string;
  layout: HomeLayout;
  /** Best first: the composer keeps the first eligible ones. */
  items: readonly T[];
};

type RowCandidate<T extends ComposableTrack> = HomeTrackRowCandidate<T>;

const reweightByExposure = <T extends ComposableTrack>(
  candidates: readonly T[],
  exposures: ReadonlyMap<string, number>,
): T[] =>
  progressiveOrderItems(
    candidates,
    (track) => track.artistKeys ?? [track.artistKey],
    exposures,
  );

export const progressiveOrderItems = <T>(
  candidates: readonly T[],
  artistKeysOf: (item: T) => readonly string[],
  exposures: ReadonlyMap<string, number>,
): T[] =>
  candidates
    .map((item, index) => {
      const keys = artistKeysOf(item);
      const exposure =
        keys.reduce(
          (sum, key) =>
            sum + progressiveExposureFactor(exposures.get(key) ?? 0),
          0,
        ) / keys.length;
      const baseScore = (candidates.length - index) / candidates.length;
      return { item, index, score: baseScore * exposure };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ item }) => item);

const addArtistExposures = (
  items: readonly ComposableTrack[],
  exposures: Map<string, number>,
): void => {
  for (const track of items) {
    for (const artistKey of track.artistKeys ?? [track.artistKey]) {
      exposures.set(artistKey, (exposures.get(artistKey) ?? 0) + 1);
    }
  }
};

/** What the composer needs to place an entity (a genre, Artist or Album). */
export type ComposableEntity = { id: string };

type EntityRowCandidate<T extends ComposableEntity> = {
  layout: HomeEntityLayout;
  items: readonly T[];
};

/** Preserves first occurrences and releases entities from dropped Rows. */
export const composeEntityRows = <
  T extends ComposableEntity,
  R extends EntityRowCandidate<T>,
>(
  candidates: readonly R[],
): (R & { items: T[] })[] => {
  const used = new Set<string>();
  const rows: (R & { items: T[] })[] = [];
  for (const candidate of candidates) {
    const rule = HOME_ROW_RULES[candidate.layout];
    const items = candidate.items
      .filter((item) => !used.has(item.id))
      .slice(0, rule.maxItems);
    if (items.length < rule.minItems) continue;
    for (const item of items) used.add(item.id);
    rows.push({ ...candidate, items });
  }
  return rows;
};

const reserveRankedTracks = <T extends ComposableTrack>(
  candidates: readonly RowCandidate<T>[],
): Set<string> => {
  const chartCandidate = candidates.find(
    (candidate) => candidate.layout === 'ranked',
  );
  const chartItems = chartCandidate
    ? chartCandidate.items
        .filter((track) => isEligible(track, HOME_ROW_RULES.ranked))
        .slice(0, HOME_ROW_RULES.ranked.maxItems)
    : [];
  return new Set(
    chartItems.length >= HOME_ROW_RULES.ranked.minItems
      ? chartItems.map((track) => track.id)
      : [],
  );
};

const bypassesArtistCap = (candidate: RowCandidate<ComposableTrack>): boolean =>
  candidate.layout === 'ranked' ||
  candidate.id === 'continue-singing' ||
  candidate.id === 'sing-again';

const minimumRowItems = (
  candidate: RowCandidate<ComposableTrack>,
  minimumItems: Partial<Record<HomeLayout, number>> | undefined,
): number =>
  minimumItems?.[candidate.layout] ??
  (candidate.layout === 'standard' && isHomeRecommendationRow(candidate.id)
    ? HOME_RECOMMENDATION_ROW_MIN_ITEMS
    : HOME_ROW_RULES[candidate.layout].minItems);

/**
 * Turns candidates into feed rows. Ordinary discovery Tracks appear once and
 * are capped per artist; the weekly chart and resume rows keep their full
 * eligible contents. The chart may overlap earlier rows and reserves only its
 * published positions from later discovery. Rows below their minimum are
 * dropped without using their Tracks. Each layout decides eligibility (a hero
 * needs a cover). Row metadata is kept as is.
 */
export const composeHomeRows = <
  T extends ComposableTrack,
  R extends RowCandidate<T>,
>(
  candidates: readonly R[],
  options: {
    minimumItems?: Partial<Record<HomeLayout, number>>;
    minimumItemsByRow?: Readonly<Record<string, number>>;
    expandRecommendationRows?: boolean;
  } = {},
): (R & { items: T[] })[] => {
  const rankedTrackIds = reserveRankedTracks(candidates);
  const used = new Set<string>();
  const artistExposures = new Map<string, number>();
  const rows: (R & { items: T[] })[] = [];
  const expansionContexts: {
    candidate: R;
    exposures: Map<string, number>;
  }[] = [];
  for (const candidate of candidates) {
    const composed = composeInitialRow<T, R>({
      candidate,
      exposures: artistExposures,
      used,
      reserved: rankedTrackIds,
      options,
    });
    if (!composed) continue;
    const { row, priorExposures } = composed;
    const { items } = row;
    for (const item of items) {
      used.add(item.id);
    }
    if (candidate.id !== 'continue-singing' && candidate.id !== 'sing-again') {
      addArtistExposures(items, artistExposures);
    }
    rows.push(row);
    if (options.expandRecommendationRows && isTrackCarousel(candidate.layout)) {
      expansionContexts.push({
        candidate,
        exposures: priorExposures,
      });
    }
  }
  if (options.expandRecommendationRows) {
    expandRows(rows, expansionContexts, used, rankedTrackIds);
  }
  return rows;
};

const isTrackCarousel = (layout: HomeLayout): boolean =>
  layout === 'standard' || layout === 'vocal-range';

const composeInitialRow = <
  T extends ComposableTrack,
  R extends RowCandidate<T>,
>(input: {
  candidate: R;
  exposures: Map<string, number>;
  used: ReadonlySet<string>;
  reserved: ReadonlySet<string>;
  options: {
    minimumItems?: Partial<Record<HomeLayout, number>>;
    minimumItemsByRow?: Readonly<Record<string, number>>;
    expandRecommendationRows?: boolean;
  };
}):
  | { row: R & { items: T[] }; priorExposures: Map<string, number> }
  | undefined => {
  const { candidate, exposures, used, reserved, options } = input;
  const rule = HOME_ROW_RULES[candidate.layout];
  const exception = bypassesArtistCap(candidate);
  const priorExposures = new Map(exposures);
  const rankedCandidates = exception
    ? candidate.items
    : reweightByExposure(candidate.items, exposures);
  const limit =
    options.expandRecommendationRows && isTrackCarousel(candidate.layout)
      ? HOME_TRACK_PAGE_SIZE
      : Math.min(rule.maxItems, HOME_TRACK_PAGE_SIZE);
  const items = pickRowItems({
    candidates: rankedCandidates,
    rule,
    used,
    reserved,
    bypassArtistCap: exception,
    overlapsExisting: candidate.layout === 'ranked',
    overlapsReserved:
      bypassesArtistCap(candidate) || candidate.layout === 'hero',
    limit,
    batchOffset: 0,
  });
  if (
    items.length <
    (options.minimumItemsByRow?.[candidate.id] ??
      minimumRowItems(candidate, options.minimumItems))
  ) {
    return undefined;
  }
  return { row: { ...candidate, items }, priorExposures };
};

const expandRows = <T extends ComposableTrack, R extends RowCandidate<T>>(
  rows: (R & { items: T[] })[],
  contexts: { candidate: R; exposures: Map<string, number> }[],
  used: Set<string>,
  reserved: Set<string>,
): void => {
  const priorExpansionExposures = new Map<string, number>();
  for (const { candidate, exposures } of contexts) {
    const row = rows.find((entry) => entry.id === candidate.id);
    if (!row || row.items.length >= HOME_ROW_RULES[candidate.layout].maxItems) {
      continue;
    }
    const ownIds = new Set(row.items.map((item) => item.id));
    const otherUsed = new Set([...used].filter((id) => !ownIds.has(id)));
    const currentExposures = new Map(exposures);
    for (const [artistKey, count] of priorExpansionExposures) {
      currentExposures.set(
        artistKey,
        (currentExposures.get(artistKey) ?? 0) + count,
      );
    }
    const additions = pickRowItems({
      candidates: bypassesArtistCap(candidate)
        ? candidate.items.filter((item) => !ownIds.has(item.id))
        : reweightByExposure(
            candidate.items.filter((item) => !ownIds.has(item.id)),
            currentExposures,
          ),
      rule: HOME_ROW_RULES[candidate.layout],
      used: otherUsed,
      reserved,
      bypassArtistCap: bypassesArtistCap(candidate),
      overlapsExisting: false,
      overlapsReserved: bypassesArtistCap(candidate),
      limit: HOME_ROW_RULES[candidate.layout].maxItems - row.items.length,
      batchOffset: row.items.length,
      startingItems: row.items,
    });
    row.items.push(...additions);
    for (const item of additions) used.add(item.id);
    addArtistExposures(additions, priorExpansionExposures);
  }
};
