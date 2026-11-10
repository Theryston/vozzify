import type { HomeRow, HomeTrack } from '@vozzify/contracts';
import { homeArtistKeys } from './home-artist-keys.js';
import { progressiveOrderItems } from './home-feed-composer.js';
import { explorationSlotCount } from './home-personal-recommendations.js';
import { trackIdsOfRow } from './home-personal-resume-rows.js';
import { personalTrackCandidate } from './home-personal-track-candidate.js';
import { HOME_ROW_RULES, HOME_TRACK_ROW_MAX_ITEMS } from './home-rules.js';
import { pickRowItems } from './home-track-row-picker.js';

type ExpansionOptions = {
  rows: HomeRow[];
  sourcePoolsByRow: ReadonlyMap<string, readonly HomeTrack[]>;
  artistKeysByTrack: ReadonlyMap<string, string[]>;
  masteredTrackIds: ReadonlySet<string>;
  reservedTrackIds: ReadonlySet<string>;
};
type ExpansionState = ExpansionOptions & {
  used: Set<string>;
  exposures: Map<string, number>;
  nonRankedInitialIds: ReadonlySet<string>;
};
const isResume = (row: HomeRow) =>
  row.id === 'continue-singing' || row.id === 'sing-again';
const keysOf = (track: HomeTrack, state: ExpansionState) =>
  state.artistKeysByTrack.get(track.id) ??
  homeArtistKeys(track.artistCredit, track.id);
const candidateOf = (track: HomeTrack, state: ExpansionState) => ({
  ...personalTrackCandidate(track, state.artistKeysByTrack),
  track,
});
const addExposures = (tracks: readonly HomeTrack[], state: ExpansionState) => {
  for (const track of tracks)
    for (const key of keysOf(track, state)) {
      state.exposures.set(key, (state.exposures.get(key) ?? 0) + 1);
    }
};
const expandedRow = (
  row: Extract<HomeRow, { layout: 'standard' | 'vocal-range' }>,
  state: ExpansionState,
): HomeRow => {
  const resume = isResume(row);
  const ownIds = new Set(row.items.map(({ id }) => id));
  const pool = state.sourcePoolsByRow.get(row.id) ?? row.items;
  const ranked = resume
    ? pool
    : progressiveOrderItems(
        pool,
        (track) => keysOf(track, state),
        state.exposures,
      );
  const candidates = ranked.filter(
    (track) =>
      !ownIds.has(track.id) &&
      (resume || !state.masteredTrackIds.has(track.id)),
  );
  const additions = pickRowItems({
    candidates: candidates.map((track) => candidateOf(track, state)),
    rule: HOME_ROW_RULES[row.layout],
    used: resume
      ? new Set(
          [...state.used].filter(
            (id) =>
              !state.reservedTrackIds.has(id) ||
              state.nonRankedInitialIds.has(id),
          ),
        )
      : state.used,
    reserved: state.reservedTrackIds,
    bypassArtistCap: resume,
    overlapsExisting: false,
    overlapsReserved: resume,
    limit: HOME_TRACK_ROW_MAX_ITEMS - row.items.length,
    batchOffset: row.items.length,
    startingItems: row.items.map((track) => candidateOf(track, state)),
  }).map(({ track }) => track);
  const items = [...row.items, ...additions];
  for (const track of additions) state.used.add(track.id);
  if (!resume) addExposures(items, state);
  return row.layout === 'standard'
    ? { ...row, items }
    : {
        ...row,
        items: items.flatMap((track) =>
          track.vocalRange ? [{ ...track, vocalRange: track.vocalRange }] : [],
        ),
      };
};

/** All initials are already allocated. Expansion may only claim unused Tracks. */
export const expandPersonalRows = (options: ExpansionOptions): HomeRow[] => {
  const state: ExpansionState = {
    ...options,
    used: new Set(options.rows.flatMap(trackIdsOfRow)),
    exposures: new Map(),
    nonRankedInitialIds: new Set(
      options.rows
        .filter((row) => row.layout !== 'ranked')
        .flatMap(trackIdsOfRow),
    ),
  };
  const rows = options.rows.map((row) => {
    if (row.layout === 'hero') addExposures([row.track], state);
    return row.layout === 'standard' || row.layout === 'vocal-range'
      ? expandedRow(row, state)
      : row;
  });
  const ordinarySlots = rows
    .filter((row) => row.id !== 'explore')
    .flatMap(trackIdsOfRow).length;
  return rows.map((row) =>
    row.id === 'explore' && row.layout === 'standard'
      ? {
          ...row,
          items: row.items.slice(0, explorationSlotCount(ordinarySlots)),
        }
      : row,
  );
};
