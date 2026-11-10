import type {
  HomeRow,
  HomeTrack,
  HomeVocalRangeTrack,
} from '@vozzify/contracts';
import { EXPLORATION_SLOT_SHARE } from './home-personal.js';
import {
  isNearby,
  personalExplorationReplacement,
} from './home-personal-exploration-replacements.js';
import { trackIdsOfRow } from './home-personal-resume-rows.js';
import { HOME_TRACK_PAGE_SIZE } from './home-rules.js';

type ExplorationOptions = {
  rows: HomeRow[];
  tasteByTrack: ReadonlyMap<string, number>;
  sourcePoolsByRow: ReadonlyMap<string, readonly HomeTrack[]>;
  masteredTrackIds: ReadonlySet<string>;
  reservedTrackIds: ReadonlySet<string>;
  artistKeysByTrack?: ReadonlyMap<string, string[]>;
  seed?: string;
};

type TrackItems = {
  tracks: HomeTrack[];
  replace: (tracks: HomeTrack[]) => HomeRow;
};

const trackItems = (row: HomeRow): TrackItems | null => {
  if (row.layout === 'hero') {
    return {
      tracks: [row.track],
      replace: ([track]) => (track ? { ...row, track } : row),
    };
  }
  if (row.layout === 'standard') {
    return {
      tracks: row.items,
      replace: (tracks) => ({ ...row, items: tracks }),
    };
  }
  if (row.layout === 'vocal-range') {
    return {
      tracks: row.items,
      replace: (tracks) => ({
        ...row,
        items: tracks.filter(
          (track): track is HomeVocalRangeTrack => track.vocalRange !== null,
        ),
      }),
    };
  }
  return null;
};

const isResume = (row: HomeRow): boolean =>
  row.id === 'continue-singing' || row.id === 'sing-again';

const trackPlacements = (rows: HomeRow[]) =>
  rows.flatMap((row, rowIndex) => {
    if (row.layout === 'ranked' || isResume(row)) return [];
    const items = trackItems(row);
    return items?.tracks.map((_, itemIndex) => ({ rowIndex, itemIndex })) ?? [];
  });

const desiredTrack = (options: {
  rowItems: TrackItems;
  targetIndex: number;
  nearby: boolean;
  tasteByTrack: ReadonlyMap<string, number>;
  protectedIndices: ReadonlySet<number>;
}): HomeTrack | undefined => {
  const { rowItems, targetIndex, nearby, tasteByTrack, protectedIndices } =
    options;
  const current = rowItems.tracks[targetIndex];
  if (!current || isNearby(current, tasteByTrack) === nearby) return current;
  return rowItems.tracks.find(
    (track, index) =>
      Math.floor(index / HOME_TRACK_PAGE_SIZE) ===
        Math.floor(targetIndex / HOME_TRACK_PAGE_SIZE) &&
      index !== targetIndex &&
      !protectedIndices.has(index) &&
      isNearby(track, tasteByTrack) === nearby,
  );
};

const setExplorationSlot = (
  options: ExplorationOptions & {
    rows: HomeRow[];
    rowIndex: number;
    itemIndex: number;
    nearby: boolean;
    usedTrackIds: ReadonlySet<string>;
    availableByRow: Map<string, readonly HomeTrack[]>;
  },
  protectedIndices: Set<number>,
): { rows: HomeRow[]; reservedIndices: number[] } | undefined => {
  const row = options.rows[options.rowIndex];
  const items = row ? trackItems(row) : null;
  const current = items?.tracks[options.itemIndex];
  if (!row || !items || !current) return undefined;
  const inRow = desiredTrack({
    rowItems: items,
    targetIndex: options.itemIndex,
    nearby: options.nearby,
    tasteByTrack: options.tasteByTrack,
    protectedIndices,
  });
  const next = [...items.tracks];
  if (inRow?.id === current.id) {
    return { rows: options.rows, reservedIndices: [options.itemIndex] };
  }
  if (inRow) {
    const index = next.findIndex((track) => track.id === inRow.id);
    next[index] = current;
    next[options.itemIndex] = inRow;
  } else if (isNearby(current, options.tasteByTrack) !== options.nearby) {
    const replacement = personalExplorationReplacement({
      ...options,
      rowId: row.id,
      currentIndex: options.itemIndex,
      rowItems: items,
    });
    if (!replacement) return undefined;
    next[options.itemIndex] = replacement;
  } else {
    return { rows: options.rows, reservedIndices: [options.itemIndex] };
  }
  const result = [...options.rows];
  result[options.rowIndex] = items.replace(next);
  const reservedIndices = [options.itemIndex];
  if (inRow) reservedIndices.push(next.indexOf(current));
  return { rows: result, reservedIndices };
};

export const personalExplorationQuota = (trackCount: number): number =>
  Math.round(Math.max(0, trackCount) * EXPLORATION_SLOT_SHARE);

const explorationSlots = (count: number, quota: number, nearbyFirst: boolean) =>
  Array.from({ length: quota }, (_, slot) => ({
    targetIndex: Math.floor(((slot + 0.5) * count) / quota),
    nearby: nearbyFirst ? slot % 2 === 0 : slot % 2 !== 0,
  }));

type ExplorationAllocationState = {
  rows: HomeRow[];
  protectedByRow: Map<number, Set<number>>;
};

const allocateExplorationSlot = (
  options: ExplorationOptions,
  state: ExplorationAllocationState,
  slot: { targetIndex: number; nearby: boolean },
  placements: ReturnType<typeof trackPlacements>,
): ExplorationAllocationState => {
  const usedTrackIds = new Set(state.rows.flatMap(trackIdsOfRow));
  const availableByRow = new Map<string, readonly HomeTrack[]>();
  const candidates = placements
    .map((placement, index) => ({
      placement,
      distance: Math.abs(index - slot.targetIndex),
    }))
    .sort((left, right) => left.distance - right.distance);
  for (const { placement } of candidates) {
    const protectedIndices =
      state.protectedByRow.get(placement.rowIndex) ?? new Set<number>();
    if (protectedIndices.has(placement.itemIndex)) continue;
    const allocation = setExplorationSlot(
      {
        ...options,
        rows: state.rows,
        ...placement,
        nearby: slot.nearby,
        usedTrackIds,
        availableByRow,
      },
      protectedIndices,
    );
    if (!allocation) continue;
    for (const index of allocation.reservedIndices) {
      protectedIndices.add(index);
    }
    const protectedByRow = new Map(state.protectedByRow);
    protectedByRow.set(placement.rowIndex, protectedIndices);
    return { rows: allocation.rows, protectedByRow };
  }
  return state;
};

/** Spreads nearby and surprising candidates across emitted discovery Rows. */
export const spreadPersonalExploration = (
  options: ExplorationOptions,
): HomeRow[] => {
  const { rows, tasteByTrack } = options;
  if (![...tasteByTrack.values()].some((score) => score > 0)) return rows;
  const placements = trackPlacements(rows);
  const quota = personalExplorationQuota(placements.length);
  if (quota === 0) return rows;
  let state: ExplorationAllocationState = {
    rows,
    protectedByRow: new Map(),
  };
  const nearbyFirst =
    options.seed === undefined
      ? (placements.length + quota) % 2 === 0
      : stableSeedParity(options.seed) === 0;
  for (const slot of explorationSlots(placements.length, quota, nearbyFirst)) {
    state = allocateExplorationSlot(options, state, slot, placements);
  }
  return state.rows;
};

const stableSeedParity = (seed: string): number => {
  let hash = 0;
  for (const character of seed) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash % 2;
};
