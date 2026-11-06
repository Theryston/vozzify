import type { HomeAlbumRecord } from './home.repository.js';
import { normalizedAlbumResidualScore } from './home-stage2-scoring.js';

export type HomeAlbumCandidateRecord = HomeAlbumRecord & {
  availableTracks: { id: string; popularity: number }[];
};

const compilationRank = (album: HomeAlbumRecord): number => {
  if (album.secondaryTypes === undefined) return 1;
  return album.secondaryTypes.includes('Compilation') ? 2 : 0;
};

export const compareAlbumCandidates = (
  left: HomeAlbumRecord,
  right: HomeAlbumRecord,
): number => {
  const compilation = compilationRank(left) - compilationRank(right);
  if (compilation !== 0) return compilation;
  const cover =
    Number(right.coverArtUrl !== null) - Number(left.coverArtUrl !== null);
  if (cover !== 0) return cover;
  if (left.year !== right.year) {
    if (left.year === null) return 1;
    if (right.year === null) return -1;
    return left.year - right.year;
  }
  return left.id.localeCompare(right.id);
};

/**
 * Selects useful Albums by the popularity of Tracks they add to the feed.
 * Shared Tracks contribute only once, so an equivalent or smaller Album has
 * no incremental value and a partial overlap loses the shared popularity.
 */
export const selectUsefulAlbums = (
  candidates: readonly HomeAlbumCandidateRecord[],
  limit: number,
): HomeAlbumCandidateRecord[] => {
  const remaining = [...candidates];
  const selected: HomeAlbumCandidateRecord[] = [];
  const availableTrackIds = new Set<string>();

  while (remaining.length > 0 && selected.length < limit) {
    const ranked = remaining
      .map((album) => {
        const addedTracks = album.availableTracks.filter(
          (track) => !availableTrackIds.has(track.id),
        );
        return {
          album,
          addedTracks,
          incrementalQuality: normalizedAlbumResidualScore(
            addedTracks.map((track) => track.popularity),
          ),
        };
      })
      .filter((entry) => entry.addedTracks.length > 0)
      .sort(
        (left, right) =>
          right.incrementalQuality - left.incrementalQuality ||
          compareAlbumCandidates(left.album, right.album),
      );
    const next = ranked[0];
    if (!next) break;
    selected.push(next.album);
    for (const track of next.addedTracks) {
      availableTrackIds.add(track.id);
    }
    remaining.splice(
      remaining.findIndex((album) => album.id === next.album.id),
      1,
    );
  }
  return selected;
};
