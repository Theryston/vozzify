import { HomeRepository } from './home.repository.js';
import { selectUsefulAlbums } from './home-album-selection.js';

type HomeAlbumCard = {
  id: string;
  title: string;
  coverArtUrl: string | null;
  year: number | null;
};

type AlbumCandidateRepository = Pick<HomeRepository, 'findPopularAlbums'> &
  Partial<Pick<HomeRepository, 'findAlbumTrackSignals'>>;

const ALBUM_CANDIDATE_BATCH_SIZE = 60;
const MAX_ALBUM_CANDIDATE_BATCHES = 4;
const MAX_FEATURED_ALBUMS = 12;

/**
 * Replenishes a bounded popularity-ordered pool and selects Albums by new
 * Track content, avoiding one query per Album.
 */
export const loadUsefulAlbums = async (
  repository: AlbumCandidateRepository,
): Promise<HomeAlbumCard[]> => {
  if (!repository.findAlbumTrackSignals) {
    return (await repository.findPopularAlbums(60)).map(
      ({ id, title, coverArtUrl, year }) => ({
        id,
        title,
        coverArtUrl,
        year,
      }),
    );
  }
  const candidates = [];
  for (let batch = 0; batch < MAX_ALBUM_CANDIDATE_BATCHES; batch += 1) {
    const records = await repository.findPopularAlbums(
      ALBUM_CANDIDATE_BATCH_SIZE,
      batch * ALBUM_CANDIDATE_BATCH_SIZE,
    );
    if (records.length === 0) break;
    const trackSignals = await repository.findAlbumTrackSignals(
      records.map((record) => record.id),
    );
    const byAlbum = new Map<string, { id: string; popularity: number }[]>();
    for (const signal of trackSignals) {
      const tracks = byAlbum.get(signal.albumId) ?? [];
      tracks.push({ id: signal.trackId, popularity: signal.popularity });
      byAlbum.set(signal.albumId, tracks);
    }
    candidates.push(
      ...records.map((record) => ({
        ...record,
        availableTracks: byAlbum.get(record.id) ?? [],
      })),
    );
  }
  return selectUsefulAlbums(candidates, MAX_FEATURED_ALBUMS).map(
    ({ id, title, coverArtUrl, year }) => ({
      id,
      title,
      coverArtUrl,
      year,
    }),
  );
};
