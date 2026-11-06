import {
  HOME_RECOMMENDATION_ROW_MIN_ITEMS,
  HOME_ROW_RULES,
  type HomeEntityLayout,
  type HomeLayout,
  type HomeRowRule,
  isHomeRecommendationRow,
  MAX_TRACKS_PER_ARTIST_PER_ROW,
} from './home-rules.js';
import { progressiveExposureFactor } from './home-stage2-scoring.js';

/** What the composer needs to know about a Track to place it in a row. */
export type ComposableTrack = {
  id: string;
  /** The artist the per-row cap counts by (the credit's first artist). */
  artistKey: string;
  /** Every credited Artist participates in the same per-row limit. */
  artistKeys?: string[];
  hasCover: boolean;
  /** Only Tracks whose Processing completed may appear in the feed. */
  isCompleted: boolean;
  /** Absent means no stored Vocal range: only the by-voice rows ask for one. */
  hasVocalRange?: boolean;
};

type RowCandidate<T extends ComposableTrack> = {
  id: string;
  layout: HomeLayout;
  /** Best first: the composer keeps the first eligible ones. */
  items: readonly T[];
};

const isEligible = <T extends ComposableTrack>(
  track: T,
  rule: HomeRowRule,
): boolean =>
  track.isCompleted &&
  (!rule.requiresCover || track.hasCover) &&
  (!rule.requiresVocalRange || track.hasVocalRange === true);

type PickRowOptions<T extends ComposableTrack> = {
  candidates: readonly T[];
  rule: HomeRowRule;
  used: ReadonlySet<string>;
  reserved: ReadonlySet<string>;
  bypassArtistCap: boolean;
  overlapsExisting: boolean;
  overlapsReserved: boolean;
};

const isTrackTaken = <T extends ComposableTrack>(
  track: T,
  picked: readonly T[],
  options: PickRowOptions<T>,
): boolean =>
  (!options.overlapsExisting && options.used.has(track.id)) ||
  (!options.overlapsReserved && options.reserved.has(track.id)) ||
  picked.some((p) => p.id === track.id);

const pickRowItems = <T extends ComposableTrack>(
  options: PickRowOptions<T>,
): T[] => {
  const { candidates, rule, bypassArtistCap } = options;
  const picked: T[] = [];
  const perArtist = new Map<string, number>();
  for (const track of candidates) {
    if (picked.length >= rule.maxItems) {
      break;
    }
    const taken = isTrackTaken(track, picked, options);
    if (taken || !isEligible(track, rule)) {
      continue;
    }
    const artistKeys = [...new Set(track.artistKeys ?? [track.artistKey])];
    if (
      !bypassArtistCap &&
      artistKeys.some(
        (artistKey) =>
          (perArtist.get(artistKey) ?? 0) >= MAX_TRACKS_PER_ARTIST_PER_ROW,
      )
    ) {
      continue;
    }
    for (const artistKey of artistKeys) {
      perArtist.set(artistKey, (perArtist.get(artistKey) ?? 0) + 1);
    }
    picked.push(track);
  }
  return picked;
};

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
  options: { minimumItems?: Partial<Record<HomeLayout, number>> } = {},
): (R & { items: T[] })[] => {
  const rankedTrackIds = reserveRankedTracks(candidates);
  const used = new Set<string>();
  const artistExposures = new Map<string, number>();
  const rows: (R & { items: T[] })[] = [];
  for (const candidate of candidates) {
    const rule = HOME_ROW_RULES[candidate.layout];
    const isException = bypassesArtistCap(candidate);
    const rankedCandidates = isException
      ? candidate.items
      : reweightByExposure(candidate.items, artistExposures);
    const items = pickRowItems({
      candidates: rankedCandidates,
      rule,
      used,
      reserved: rankedTrackIds,
      bypassArtistCap: isException,
      overlapsExisting: candidate.layout === 'ranked',
      overlapsReserved:
        candidate.layout === 'ranked' || candidate.layout === 'hero',
    });
    const minimum = minimumRowItems(candidate, options.minimumItems);
    if (items.length < minimum) {
      continue;
    }
    for (const item of items) {
      used.add(item.id);
    }
    if (candidate.id !== 'continue-singing' && candidate.id !== 'sing-again') {
      addArtistExposures(items, artistExposures);
    }
    rows.push({ ...candidate, items });
  }
  return rows;
};

/** What the composer needs to place an entity (a genre, artist or album). */
export type ComposableEntity = {
  /** Stable across rows, so an entity appears once per feed. */
  id: string;
};

type EntityRowCandidate<T extends ComposableEntity> = {
  layout: HomeEntityLayout;
  items: readonly T[];
};

/**
 * Turns candidate entity rows, in feed order, into the rows of the feed. An
 * entity appears once per feed (the earlier row keeps it), a row below its
 * minimum size is dropped (and its entities stay free for the rows after
 * it), and a row keeps at most its maximum. Pure: the caller loads the
 * candidates and maps the rows it gets back.
 */
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
    if (items.length < rule.minItems) {
      continue;
    }
    for (const item of items) {
      used.add(item.id);
    }
    rows.push({ ...candidate, items });
  }
  return rows;
};
