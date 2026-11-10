import type { HomeRow, HomeTrack } from '@vozzify/contracts';
import { homeArtistKeys } from './home-artist-keys.js';
import { personalGenreReplacementQualifier } from './home-personal-genre-exploration.js';
import {
  HOME_TRACK_PAGE_SIZE,
  MAX_TRACKS_PER_ARTIST_PER_ROW,
} from './home-rules.js';

export const isNearby = (
  track: HomeTrack,
  tasteByTrack: ReadonlyMap<string, number>,
): boolean => (tasteByTrack.get(track.id) ?? 0) > 0;

type ReplacementPoolOptions = {
  rowId: string;
  tasteByTrack: ReadonlyMap<string, number>;
  sourcePoolsByRow: ReadonlyMap<string, readonly HomeTrack[]>;
  masteredTrackIds: ReadonlySet<string>;
  reservedTrackIds: ReadonlySet<string>;
  usedTrackIds: ReadonlySet<string>;
  availableByRow: Map<string, readonly HomeTrack[]>;
  nearby: boolean;
};

/** One slot examines an unchanged selection until its first successful replacement. */
const availableReplacements = (
  options: ReplacementPoolOptions,
): readonly HomeTrack[] => {
  const cached = options.availableByRow.get(options.rowId);
  if (cached) return cached;
  const pool = (options.sourcePoolsByRow.get(options.rowId) ?? []).filter(
    (candidate) =>
      !options.usedTrackIds.has(candidate.id) &&
      !options.masteredTrackIds.has(candidate.id) &&
      !options.reservedTrackIds.has(candidate.id) &&
      isNearby(candidate, options.tasteByTrack) === options.nearby,
  );
  options.availableByRow.set(options.rowId, pool);
  return pool;
};

const rowArtistCounts = (
  items: readonly HomeTrack[],
  omitIndex: number,
  artistKeysByTrack: ReadonlyMap<string, string[]> = new Map(),
): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const [index, track] of items.entries()) {
    if (
      index === omitIndex ||
      Math.floor(index / HOME_TRACK_PAGE_SIZE) !==
        Math.floor(omitIndex / HOME_TRACK_PAGE_SIZE)
    )
      continue;
    for (const key of artistKeysByTrack.get(track.id) ??
      homeArtistKeys(track.artistCredit, track.id)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
};

export const personalExplorationReplacement = (options: {
  rowId: string;
  currentIndex: number;
  rows: HomeRow[];
  rowItems: { tracks: readonly HomeTrack[] };
  tasteByTrack: ReadonlyMap<string, number>;
  sourcePoolsByRow: ReadonlyMap<string, readonly HomeTrack[]>;
  masteredTrackIds: ReadonlySet<string>;
  reservedTrackIds: ReadonlySet<string>;
  artistKeysByTrack?: ReadonlyMap<string, string[]>;
  nearby: boolean;
  usedTrackIds: ReadonlySet<string>;
  availableByRow: Map<string, readonly HomeTrack[]>;
}): HomeTrack | undefined => {
  const pool = availableReplacements(options);
  if (pool.length === 0) return undefined;
  const artistCounts = rowArtistCounts(
    options.rowItems.tracks,
    options.currentIndex,
    options.artistKeysByTrack,
  );
  const qualifiesGenre = personalGenreReplacementQualifier(options);
  return pool.find((candidate) => {
    return (
      (
        options.artistKeysByTrack?.get(candidate.id) ??
        homeArtistKeys(candidate.artistCredit, candidate.id)
      ).every(
        (key) => (artistCounts.get(key) ?? 0) < MAX_TRACKS_PER_ARTIST_PER_ROW,
      ) && qualifiesGenre(candidate)
    );
  });
};
