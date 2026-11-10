import type { HomeRow, HomeTrack } from '@vozzify/contracts';
import { homeArtistKeys } from './home-artist-keys.js';
import { isGenreRow } from './home-genre-rows.js';
import { HOME_TRACK_PAGE_SIZE } from './home-rules.js';

/** Exploration cannot remove the sixth credited Artist from a genre's initial. */
export const personalGenreReplacementQualifies = (
  options: {
    rowId: string;
    rows: HomeRow[];
    rowItems: { tracks: readonly HomeTrack[] };
    currentIndex: number;
    artistKeysByTrack?: ReadonlyMap<string, string[]>;
  },
  candidate: HomeTrack,
): boolean => {
  const row = options.rows.find((row) => row.id === options.rowId);
  if (!row || !isGenreRow(row) || options.currentIndex >= HOME_TRACK_PAGE_SIZE)
    return true;
  const initial = options.rowItems.tracks
    .slice(0, HOME_TRACK_PAGE_SIZE)
    .map((track, index) =>
      index === options.currentIndex ? candidate : track,
    );
  const artists = new Set(
    initial.flatMap((track) =>
      track.artistCredit.length === 0
        ? []
        : (options.artistKeysByTrack?.get(track.id) ??
          homeArtistKeys(track.artistCredit, track.id)),
    ),
  );
  return artists.size >= 6;
};
