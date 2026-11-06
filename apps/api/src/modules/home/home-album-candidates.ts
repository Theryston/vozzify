import type { Locale } from '@vozzify/contracts';
import type { TrackLocaleTrendingService } from '../tracks/track-locale-trending.service.js';
import { HomeRepository } from './home.repository.js';
import {
  type HomeAlbumCandidateRecord,
  selectUsefulAlbums,
} from './home-album-selection.js';
import { SINGING_SIGNAL_WINDOW_DAYS } from './home-popularity.js';
import { DEFAULT_HOME_LOCALE } from './home-rules.js';
import { hasSufficientLocaleEvidence } from './home-stage2-scoring.js';

type HomeAlbumCard = {
  id: string;
  title: string;
  coverArtUrl: string | null;
  year: number | null;
};

type AlbumCandidateRepository = Pick<
  HomeRepository,
  'findPopularAlbums' | 'localePracticeEvidence'
> &
  Partial<Pick<HomeRepository, 'findAlbumTrackSignals'>>;
type CompleteAlbumCandidateRepository = Pick<
  HomeRepository,
  'findPopularAlbums' | 'findAlbumTrackSignals' | 'localePracticeEvidence'
>;

export type HomeAlbumCandidateSnapshot = {
  id: string;
  title: string;
  coverArtUrl: string | null;
  year: number | null;
  primaryType?: string | null;
  secondaryTypes?: string[];
  availableTracks: { id: string; popularity: number }[];
};

const ALBUM_CANDIDATE_BATCH_SIZE = 240;
const MAX_ALBUM_CANDIDATE_BATCHES = 1;
const MAX_FEATURED_ALBUMS = 12;

const loadAlbumBatches = async (
  repository: Pick<HomeRepository, 'findPopularAlbums'>,
): Promise<HomeAlbumCandidateRecord[]> => {
  const records: HomeAlbumCandidateRecord[] = [];
  for (let batch = 0; batch < MAX_ALBUM_CANDIDATE_BATCHES; batch += 1) {
    const page = await repository.findPopularAlbums(
      ALBUM_CANDIDATE_BATCH_SIZE,
      batch * ALBUM_CANDIDATE_BATCH_SIZE,
    );
    if (page.length === 0) break;
    records.push(...page.map((record) => ({ ...record, availableTracks: [] })));
  }
  return records;
};

/**
 * Replenishes a bounded popularity-ordered pool and selects Albums by new
 * Track content, avoiding one query per Album.
 */
export const loadUsefulAlbums = async (
  repository: AlbumCandidateRepository,
  ranking: Pick<TrackLocaleTrendingService, 'rank'>,
  locale: Locale = DEFAULT_HOME_LOCALE,
): Promise<HomeAlbumCard[]> =>
  (await loadUsefulAlbumSnapshot(repository, ranking, locale)).items;

export const loadUsefulAlbumSnapshot = async (
  repository: AlbumCandidateRepository,
  ranking: Pick<TrackLocaleTrendingService, 'rank'>,
  locale: Locale = DEFAULT_HOME_LOCALE,
): Promise<{
  items: HomeAlbumCard[];
  candidates: HomeAlbumCandidateSnapshot[];
}> => {
  if (!repository.findAlbumTrackSignals) {
    const items = (await repository.findPopularAlbums(60)).map(
      ({ id, title, coverArtUrl, year }) => ({ id, title, coverArtUrl, year }),
    );
    return { items, candidates: [] };
  }
  const candidates = await loadAlbumCandidates(
    {
      findPopularAlbums: repository.findPopularAlbums.bind(repository),
      findAlbumTrackSignals: repository.findAlbumTrackSignals.bind(repository),
      localePracticeEvidence:
        repository.localePracticeEvidence.bind(repository),
    },
    ranking,
    locale,
  );
  return {
    items: selectUsefulAlbums(candidates, MAX_FEATURED_ALBUMS).map(
      ({ id, title, coverArtUrl, year }) => ({ id, title, coverArtUrl, year }),
    ),
    candidates,
  };
};

/** Loads the same bounded candidate pool and locale-aware Track scores as the public Album shelf. */
export const loadAlbumCandidates = async (
  repository: CompleteAlbumCandidateRepository,
  ranking: Pick<TrackLocaleTrendingService, 'rank'>,
  locale: Locale = DEFAULT_HOME_LOCALE,
): Promise<HomeAlbumCandidateRecord[]> => {
  const evidence = await repository.localePracticeEvidence(
    locale,
    new Date(Date.now() - SINGING_SIGNAL_WINDOW_DAYS * 24 * 60 * 60 * 1000),
  );
  const enoughLocaleEvidence =
    evidence !== undefined &&
    hasSufficientLocaleEvidence(evidence.distinctUsers, evidence.activeDays);
  const candidates = await loadAlbumBatches(repository);
  if (candidates.length === 0) return [];
  const trackSignals = await repository.findAlbumTrackSignals(
    candidates.map((record) => record.id),
    enoughLocaleEvidence ? locale : undefined,
  );
  const trackIds = [...new Set(trackSignals.map((signal) => signal.trackId))];
  const localeViewScores =
    enoughLocaleEvidence && trackIds.length > 0
      ? await ranking.rank(locale, new Date(), trackIds)
      : undefined;
  const scoresByTrack = new Map(
    (localeViewScores ?? []).map(({ trackId, score }) => [trackId, score]),
  );
  const byAlbum = new Map<string, { id: string; popularity: number }[]>();
  for (const signal of trackSignals) {
    const tracks = byAlbum.get(signal.albumId) ?? [];
    tracks.push({
      id: signal.trackId,
      popularity: signal.popularity + (scoresByTrack.get(signal.trackId) ?? 0),
    });
    byAlbum.set(signal.albumId, tracks);
  }
  return candidates.map((candidate) => ({
    ...candidate,
    availableTracks: byAlbum.get(candidate.id) ?? [],
  }));
};
