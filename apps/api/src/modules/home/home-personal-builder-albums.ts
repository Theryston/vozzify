import type { HomeRow, Locale } from '@vozzify/contracts';
import type { AttemptsService } from '../attempts/attempts.service.js';
import type { HomeAlbumCandidateSnapshot } from './home-album-candidates.js';
import type { PersonalHomeRepository } from './home-personal.repository.js';
import { rankPersonalAlbums } from './home-personal-albums.js';
import type { decayedTaste } from './home-personal-recommendations.js';

export const personalizeAlbumRows = async (options: {
  publicRows: HomeRow[];
  albumCandidates?: HomeAlbumCandidateSnapshot[];
  locale: Locale;
  taste: ReturnType<typeof decayedTaste>;
  lambda: number;
  userRange: Awaited<ReturnType<AttemptsService['vocalRange']>>;
  voiceConfidence: number;
  personal: PersonalHomeRepository;
}): Promise<HomeRow[]> => {
  const albumRow = options.publicRows.find((row) => row.layout === 'albums');
  if (albumRow?.layout !== 'albums') return options.publicRows;
  const candidates = options.albumCandidates ?? [];
  if (candidates.length === 0) return options.publicRows;
  const tracks = await options.personal.findAlbumTracks(
    candidates.map((album) => album.id),
  );
  if (tracks.length === 0) return options.publicRows;
  const selected = rankPersonalAlbums({
    albums: candidates.map(({ id, title, coverArtUrl, year }) => ({
      id,
      title,
      coverArtUrl,
      year,
    })),
    tracks,
    popularityByTrack: new Map(
      candidates.flatMap((album) =>
        album.availableTracks.map(
          (track) => [track.id, track.popularity] as const,
        ),
      ),
    ),
    candidateMetadata: new Map(candidates.map((album) => [album.id, album])),
    taste: options.taste,
    lambda: options.lambda,
    voiceRange: options.userRange,
    voiceConfidence: options.voiceConfidence,
    limit: 12,
  });
  return options.publicRows.map((row) =>
    row.id === albumRow.id ? { ...albumRow, items: selected } : row,
  );
};
