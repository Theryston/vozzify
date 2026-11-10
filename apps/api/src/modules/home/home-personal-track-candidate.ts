import type { HomeTrack } from '@vozzify/contracts';
import { homeArtistKeys } from './home-artist-keys.js';
import type { HomeCompositionCandidateTrack } from './home-composition-candidates.js';

export const personalTrackCandidate = (
  track: HomeTrack,
  artistKeysByTrack: ReadonlyMap<string, string[]>,
  personalTasteScore?: number,
): HomeCompositionCandidateTrack => {
  const keys =
    artistKeysByTrack.get(track.id) ??
    homeArtistKeys(track.artistCredit, track.id);
  return {
    ...track,
    artistKey: keys[0] ?? track.id,
    artistKeys: keys,
    hasCover: track.coverUrl !== null,
    hasVocalRange: track.vocalRange !== null,
    isCompleted: true,
    ...(personalTasteScore === undefined ? {} : { personalTasteScore }),
  };
};
