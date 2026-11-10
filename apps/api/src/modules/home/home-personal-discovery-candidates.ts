import type { TrackVocalRange } from '@vozzify/contracts';
import { homeArtistKeys } from './home-artist-keys.js';
import { retainUsefulCompositionCandidates } from './home-composition-candidates.js';
import type { PersonalTaste } from './home-personal.js';
import type { PersonalHomeRepository } from './home-personal.repository.js';
import type { PersonalTrackCandidate } from './home-personal.repository.types.js';
import { topGenres } from './home-personal-recommendations.js';
import { PersonalHomeTasteRepository } from './home-personal-taste.repository.js';
import {
  HOME_COMPOSITION_CANDIDATE_POOL_MAX_ITEMS,
  HOME_TRACK_ROW_MAX_ITEMS,
} from './home-rules.js';

const PERSONAL_CANDIDATE_BATCH_SIZE = 60;
const PERSONAL_CANDIDATE_BATCHES = 4;

const loadPersonalCandidateBatches = async <T extends PersonalTrackCandidate>(
  load: (offset: number) => Promise<T[]>,
  expanded = false,
) => {
  let candidates: T[] = [];
  for (
    let batch = 0;
    expanded || batch < PERSONAL_CANDIDATE_BATCHES;
    batch += 1
  ) {
    const page = await load(batch * PERSONAL_CANDIDATE_BATCH_SIZE);
    candidates.push(...page);
    if (expanded)
      candidates = retainUsefulCompositionCandidates(
        candidates.map((candidate) => ({
          ...candidate,
          artistKey: candidate.artistCredit[0]?.mbid ?? candidate.id,
          artistKeys: homeArtistKeys(candidate.artistCredit, candidate.id),
        })),
        new Set(),
        HOME_TRACK_ROW_MAX_ITEMS,
      );
    if (
      page.length < PERSONAL_CANDIDATE_BATCH_SIZE ||
      candidates.length >= HOME_COMPOSITION_CANDIDATE_POOL_MAX_ITEMS
    )
      break;
  }
  return candidates;
};

export const loadGenreTasteCandidates = (
  repository: PersonalHomeTasteRepository,
  genres: string[],
  excludedTrackIds: string[],
  expanded = false,
): Promise<PersonalTrackCandidate[]> =>
  loadPersonalCandidateBatches(
    (offset) =>
      repository.findTracksForGenres(
        genres,
        PERSONAL_CANDIDATE_BATCH_SIZE,
        offset,
        excludedTrackIds,
      ),
    expanded,
  );

type DiscoveryCandidateOptions = {
  personal: PersonalHomeRepository;
  tasteRepository: PersonalHomeTasteRepository;
  taste: PersonalTaste;
  excludedTrackIds: string[];
  userRange?: TrackVocalRange | null;
  expanded?: boolean;
};
type DiscoveryCandidatePools = {
  popular: PersonalTrackCandidate[];
  matched: PersonalTrackCandidate[];
  newest: PersonalTrackCandidate[];
  mostSung: PersonalTrackCandidate[];
  voice: PersonalTrackCandidate[];
};

export const loadPersonalDiscoveryCandidates = async (
  options: DiscoveryCandidateOptions,
): Promise<DiscoveryCandidatePools> => {
  const { personal, tasteRepository, taste, excludedTrackIds, expanded } =
    options;
  const voice = loadVoiceCandidates(options);
  const [popular, matched, newest, mostSung, voiceCandidates] =
    await Promise.all([
      loadPersonalCandidateBatches(
        (offset) =>
          personal.findPopularTasteCandidates(
            PERSONAL_CANDIDATE_BATCH_SIZE,
            offset,
            excludedTrackIds,
          ),
        expanded,
      ),
      loadPersonalCandidateBatches(
        (offset) =>
          tasteRepository.findTracksForGenres(
            topGenres(taste),
            PERSONAL_CANDIDATE_BATCH_SIZE,
            offset,
            excludedTrackIds,
          ),
        expanded,
      ),
      loadPersonalCandidateBatches(
        (offset) =>
          tasteRepository.findNewestTracks(
            PERSONAL_CANDIDATE_BATCH_SIZE,
            offset,
            excludedTrackIds,
          ),
        expanded,
      ),
      loadPersonalCandidateBatches(
        (offset) =>
          tasteRepository.findMostSungTracks(
            PERSONAL_CANDIDATE_BATCH_SIZE,
            new Date(Date.now() - 28 * 24 * 60 * 60 * 1000),
            offset,
            excludedTrackIds,
          ),
        expanded,
      ),
      voice,
    ]);
  return { popular, matched, newest, mostSung, voice: voiceCandidates };
};

const loadVoiceCandidates = (options: DiscoveryCandidateOptions) => {
  const { userRange, tasteRepository, excludedTrackIds, expanded } = options;
  const voice = userRange
    ? loadPersonalCandidateBatches(
        (offset) =>
          tasteRepository.findVoiceCandidates(
            userRange,
            PERSONAL_CANDIDATE_BATCH_SIZE,
            offset,
            excludedTrackIds,
          ),
        expanded,
      )
    : Promise.resolve([]);
  return voice;
};

export const loadExplorationCandidates = (
  personal: PersonalHomeRepository,
  options: {
    taste: PersonalTaste;
    excludedTrackIds: string[];
    expanded: boolean;
  },
) =>
  options.expanded
    ? loadPersonalCandidateBatches(
        (offset) =>
          personal.findTracksOutsideGenres(
            topGenres(options.taste),
            PERSONAL_CANDIDATE_BATCH_SIZE,
            offset,
            options.excludedTrackIds,
          ),
        true,
      )
    : personal.findTracksOutsideGenres(
        topGenres(options.taste),
        PERSONAL_CANDIDATE_BATCH_SIZE * PERSONAL_CANDIDATE_BATCHES,
      );
