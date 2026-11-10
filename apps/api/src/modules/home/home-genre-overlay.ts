import type { HomeTrack } from '@vozzify/contracts';
import { homeArtistKeys } from './home-artist-keys.js';
import {
  HOME_ROW_RULES,
  HOME_TRACK_PAGE_SIZE,
  HOME_TRACK_ROW_MAX_ITEMS,
} from './home-rules.js';
import { pickRowItems } from './home-track-row-picker.js';

/** Legacy snapshots and public fallback also requalify after live exclusions. */
export const genreOverlayItems = (tracks: HomeTrack[]): HomeTrack[] => {
  const candidates = tracks.map((track) => ({
    ...track,
    artistKey: track.artistCredit[0]?.name ?? track.id,
    artistKeys:
      track.artistCredit.length === 0
        ? []
        : homeArtistKeys(track.artistCredit, track.id),
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
