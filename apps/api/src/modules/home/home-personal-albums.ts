import type { HomeAlbum, TrackVocalRange } from '@vozzify/contracts';
import type { HomeAlbumCandidateRecord } from './home-album-selection.js';
import { compareAlbumCandidates } from './home-album-selection.js';
import type { PersonalTaste } from './home-personal.js';
import { blendScore, personalScore } from './home-personal.js';
import type { PersonalAlbumTrack } from './home-personal.repository.types.js';
import {
  normalizedAlbumResidualScore,
  personalScoreWithConfidenceAwareVoice,
} from './home-stage2-scoring.js';
import { voiceFitScore } from './home-voice-fit.js';

/** Greedily personalizes Albums while scoring only newly available Tracks. */
export const rankPersonalAlbums = (options: {
  albums: readonly HomeAlbum[];
  tracks: readonly PersonalAlbumTrack[];
  popularityByTrack: ReadonlyMap<string, number>;
  candidateMetadata?: ReadonlyMap<string, HomeAlbumCandidateRecord>;
  taste: PersonalTaste;
  lambda: number;
  voiceRange: TrackVocalRange | null;
  voiceConfidence: number;
  limit?: number;
}): HomeAlbum[] => {
  const tracksByAlbum = new Map<string, PersonalAlbumTrack[]>();
  for (const track of options.tracks) {
    const rows = tracksByAlbum.get(track.albumId) ?? [];
    rows.push(track);
    tracksByAlbum.set(track.albumId, rows);
  }
  const remaining = options.albums.map((album, order) => ({ album, order }));
  const selectedTrackIds = new Set<string>();
  const selected: HomeAlbum[] = [];
  while (remaining.length > 0 && selected.length < (options.limit ?? 12)) {
    const ranked = remaining
      .map(({ album, order }) => {
        const tracks = (tracksByAlbum.get(album.id) ?? []).filter(
          (track) => !selectedTrackIds.has(track.id),
        );
        const globalScore = normalizedAlbumResidualScore(
          tracks.map((track) => options.popularityByTrack.get(track.id) ?? 0),
        );
        const personalScoreForAlbum = average(
          tracks.map((track) => personalTrackScore(track, options)),
        );
        return {
          album,
          order,
          tracks,
          score: blendScore(globalScore, personalScoreForAlbum, options.lambda),
        };
      })
      .filter((candidate) => candidate.tracks.length > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          compareAlbumCandidates(
            options.candidateMetadata?.get(left.album.id) ?? left.album,
            options.candidateMetadata?.get(right.album.id) ?? right.album,
          ) ||
          left.order - right.order,
      );
    const next = ranked[0];
    if (!next) break;
    selected.push(next.album);
    for (const track of next.tracks) selectedTrackIds.add(track.id);
    remaining.splice(
      remaining.findIndex(({ album }) => album.id === next.album.id),
      1,
    );
  }
  return selected;
};

const personalTrackScore = (
  track: PersonalAlbumTrack,
  options: {
    taste: PersonalTaste;
    voiceRange: TrackVocalRange | null;
    voiceConfidence: number;
  },
): number => {
  const artistKey =
    track.artistCredit[0]?.mbid ?? track.artistCredit[0]?.name ?? track.id;
  const taste = personalScore(track.genres, artistKey, options.taste);
  const vocalRange =
    track.vocalRangeLowest === null || track.vocalRangeHighest === null
      ? null
      : {
          lowest: track.vocalRangeLowest,
          highest: track.vocalRangeHighest,
        };
  const voiceFit =
    options.voiceRange && vocalRange
      ? voiceFitScore(options.voiceRange, vocalRange)
      : null;
  return personalScoreWithConfidenceAwareVoice(
    taste,
    voiceFit,
    options.voiceConfidence,
  );
};

const average = (values: number[]): number =>
  values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;
