import type { ComposableTrack } from './home-composable-track.js';
import {
  HOME_TRACK_PAGE_SIZE,
  type HomeRowRule,
  MAX_TRACKS_PER_ARTIST_PER_ROW,
} from './home-rules.js';

type PickRowOptions<T extends ComposableTrack> = {
  candidates: readonly T[];
  rule: HomeRowRule;
  used: ReadonlySet<string>;
  reserved: ReadonlySet<string>;
  bypassArtistCap: boolean;
  overlapsExisting: boolean;
  overlapsReserved: boolean;
  limit: number;
  batchOffset: number;
  startingItems?: readonly T[];
};

export const isEligible = <T extends ComposableTrack>(
  track: T,
  rule: HomeRowRule,
): boolean =>
  track.isCompleted &&
  (!rule.requiresCover || track.hasCover) &&
  (!rule.requiresVocalRange || track.hasVocalRange === true);

const isTrackTaken = <T extends ComposableTrack>(
  track: T,
  picked: readonly T[],
  options: PickRowOptions<T>,
): boolean =>
  (!options.overlapsExisting && options.used.has(track.id)) ||
  (!options.overlapsReserved && options.reserved.has(track.id)) ||
  picked.some((item) => item.id === track.id);

const addArtists = (
  artistKeys: readonly string[],
  counts: Map<string, number>,
): void => {
  for (const key of artistKeys) counts.set(key, (counts.get(key) ?? 0) + 1);
};

const canSelectTrack = <T extends ComposableTrack>(
  track: T,
  options: PickRowOptions<T>,
  picked: readonly T[],
  perArtist: Map<string, number>,
): boolean => {
  if (
    isTrackTaken(track, picked, options) ||
    !isEligible(track, options.rule)
  ) {
    return false;
  }
  if ((options.batchOffset + picked.length) % HOME_TRACK_PAGE_SIZE === 0) {
    perArtist.clear();
  }
  const artistKeys = [...new Set(track.artistKeys ?? [track.artistKey])];
  const violatesCap = artistKeys.some(
    (key) => (perArtist.get(key) ?? 0) >= MAX_TRACKS_PER_ARTIST_PER_ROW,
  );
  if (!options.bypassArtistCap && violatesCap) return false;
  addArtists(artistKeys, perArtist);
  return true;
};

/** Selects eligible, unique Tracks while resetting diversity at page edges. */
export const pickRowItems = <T extends ComposableTrack>(
  options: PickRowOptions<T>,
): T[] => {
  const { candidates } = options;
  const picked: T[] = [];
  const perArtist = new Map<string, number>();
  const firstPageStart =
    options.batchOffset - (options.batchOffset % HOME_TRACK_PAGE_SIZE);
  for (const item of options.startingItems?.slice(firstPageStart) ?? []) {
    addArtists(item.artistKeys ?? [item.artistKey], perArtist);
  }
  for (const track of candidates) {
    if (picked.length >= options.limit) break;
    if (canSelectTrack(track, options, picked, perArtist)) picked.push(track);
  }
  return picked;
};
