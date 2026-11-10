import type { HomeRow, HomeTrack } from '@vozzify/contracts';
import { homeArtistKeys } from './home-artist-keys.js';
import { isGenreRow } from './home-genre-rows.js';
import { HOME_TRACK_PAGE_SIZE } from './home-rules.js';

type GenreReplacementOptions = {
  rowId: string;
  rows: HomeRow[];
  rowItems: { tracks: readonly HomeTrack[] };
  currentIndex: number;
  artistKeysByTrack?: ReadonlyMap<string, string[]>;
};

const creditedKeys = (track: HomeTrack, options: GenreReplacementOptions) =>
  track.artistCredit.length === 0
    ? []
    : (options.artistKeysByTrack?.get(track.id) ??
      homeArtistKeys(track.artistCredit, track.id));

/** Resolve invariant membership once, after which only eligible replacements test it. */
export const personalGenreReplacementQualifier = (
  options: GenreReplacementOptions,
): ((candidate: HomeTrack) => boolean) => {
  const row = options.rows.find((row) => row.id === options.rowId);
  if (!row || !isGenreRow(row) || options.currentIndex >= HOME_TRACK_PAGE_SIZE)
    return () => true;
  const initial = options.rowItems.tracks
    .slice(0, HOME_TRACK_PAGE_SIZE)
    .filter((_, index) => index !== options.currentIndex);
  const artists = new Set(
    initial.flatMap((track) => creditedKeys(track, options)),
  );
  return (candidate) =>
    new Set([...artists, ...creditedKeys(candidate, options)]).size >= 6;
};
