import type { HomeTrack } from '@vozzify/contracts';
import { homeArtistKeys } from './home-artist-keys.js';
import type { HomeCompositionCandidateRow } from './home-composition-candidates.js';
import {
  HOME_ROW_RULES,
  HOME_TRACK_PAGE_SIZE,
  HOME_TRACK_ROW_MAX_ITEMS,
} from './home-rules.js';
import { pickRowItems } from './home-track-row-picker.js';

/** Legacy snapshots and public fallback also requalify after live exclusions. */
export const genreArtistKeys = (
  candidates: readonly HomeCompositionCandidateRow[] | undefined,
): ReadonlyMap<string, readonly string[]> =>
  new Map(
    (candidates ?? [])
      .filter((row) => row.genre !== undefined)
      .flatMap((row) =>
        row.items.map(
          (track) =>
            [
              track.id,
              track.artistCredit.length === 0
                ? []
                : (track.artistKeys ?? [track.artistKey]),
            ] as const,
        ),
      ),
  );

export const genreOverlayItems = (
  tracks: HomeTrack[],
  artistKeysByTrack?: ReadonlyMap<string, readonly string[]>,
): HomeTrack[] => {
  const candidates = tracks.map((track) => ({
    ...track,
    artistKey: track.artistCredit[0]?.name ?? track.id,
    artistKeys: [
      ...(artistKeysByTrack?.get(track.id) ??
        (track.artistCredit.length === 0
          ? []
          : homeArtistKeys(
              track.artistCredit.map((credit) => ({
                ...credit,
                mbid: credit.artistId ?? undefined,
              })),
              track.id,
            ))),
    ],
    hasCover: track.coverUrl !== null,
    isCompleted: true,
  }));
  const selected = pickRowItems({
    candidates,
    rule: HOME_ROW_RULES.standard,
    used: new Set(),
    reserved: new Set(),
    bypassArtistCap: false,
    overlapsExisting: false,
    overlapsReserved: false,
    limit: HOME_TRACK_ROW_MAX_ITEMS,
    batchOffset: 0,
  });
  const artists = new Set(
    selected
      .slice(0, HOME_TRACK_PAGE_SIZE)
      .flatMap((track) => track.artistKeys),
  );
  if (selected.length < HOME_TRACK_PAGE_SIZE || artists.size < 6) return [];
  const original = new Map(tracks.map((track) => [track.id, track]));
  return selected.flatMap(({ id }) => {
    const track = original.get(id);
    return track ? [track] : [];
  });
};
