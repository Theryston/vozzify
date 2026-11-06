import {
  HOME_RECOMMENDATION_ROW_MIN_ITEMS,
  HOME_ROW_RULES,
  type HomeEntityLayout,
  type HomeLayout,
  type HomeRowRule,
  isHomeRecommendationRow,
  MAX_TRACKS_PER_ARTIST_PER_ROW,
} from './home-rules.js';

/** What the composer needs to know about a Track to place it in a row. */
export type ComposableTrack = {
  id: string;
  /** The artist the per-row cap counts by (the credit's first artist). */
  artistKey: string;
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

const pickRowItems = <T extends ComposableTrack>(options: {
  candidates: readonly T[];
  rule: HomeRowRule;
  used: ReadonlySet<string>;
  reserved: ReadonlySet<string>;
  bypassArtistCap: boolean;
  overlapsExisting: boolean;
  overlapsReserved: boolean;
}): T[] => {
  const {
    candidates,
    rule,
    used,
    reserved,
    bypassArtistCap,
    overlapsExisting,
    overlapsReserved,
  } = options;
  const picked: T[] = [];
  const perArtist = new Map<string, number>();
  for (const track of candidates) {
    if (picked.length >= rule.maxItems) {
      break;
    }
    const taken =
      (!overlapsExisting && used.has(track.id)) ||
      (!overlapsReserved && reserved.has(track.id)) ||
      picked.some((p) => p.id === track.id);
    if (taken || !isEligible(track, rule)) {
      continue;
    }
    const count = perArtist.get(track.artistKey) ?? 0;
    if (!bypassArtistCap && count >= MAX_TRACKS_PER_ARTIST_PER_ROW) {
      continue;
    }
    perArtist.set(track.artistKey, count + 1);
    picked.push(track);
  }
  return picked;
};

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
  const chartCandidate = candidates.find(
    (candidate) => candidate.layout === 'ranked',
  );
  const chartItems = chartCandidate
    ? chartCandidate.items
        .filter((track) => isEligible(track, HOME_ROW_RULES.ranked))
        .slice(0, HOME_ROW_RULES.ranked.maxItems)
    : [];
  const rankedTrackIds = new Set(
    chartItems.length >= HOME_ROW_RULES.ranked.minItems
      ? chartItems.map((track) => track.id)
      : [],
  );
  const used = new Set<string>();
  const rows: (R & { items: T[] })[] = [];
  for (const candidate of candidates) {
    const rule = HOME_ROW_RULES[candidate.layout];
    const items = pickRowItems({
      candidates: candidate.items,
      rule,
      used,
      reserved: rankedTrackIds,
      bypassArtistCap:
        candidate.layout === 'ranked' ||
        candidate.id === 'continue-singing' ||
        candidate.id === 'sing-again',
      overlapsExisting: candidate.layout === 'ranked',
      overlapsReserved:
        candidate.layout === 'ranked' || candidate.layout === 'hero',
    });
    const minimum =
      options.minimumItems?.[candidate.layout] ??
      (candidate.layout === 'standard' && isHomeRecommendationRow(candidate.id)
        ? HOME_RECOMMENDATION_ROW_MIN_ITEMS
        : rule.minItems);
    if (items.length < minimum) {
      continue;
    }
    for (const item of items) {
      used.add(item.id);
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
