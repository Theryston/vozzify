import type { TrackVocalRange } from '@vozzify/contracts';
import { homeArtistKeys } from './home-artist-keys.js';
import { retainUsefulCompositionCandidates } from './home-composition-candidates.js';
import type { PersonalTaste } from './home-personal.js';
import type { PersonalHomeRepository } from './home-personal.repository.js';
import type { PersonalTrackCandidate } from './home-personal.repository.types.js';
import type { PersonalCandidateSession } from './home-personal-candidate-session.js';
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
  expanded: boolean | PersonalCandidateSession = false,
): Promise<PersonalTrackCandidate[]> => {
  if (typeof expanded !== 'boolean') {
    expanded.target('genres', 'more-of-your-genres');
    return expanded.load('genres', (offset) =>
      repository.findTracksForGenres(
        genres,
        PERSONAL_CANDIDATE_BATCH_SIZE,
        offset,
        excludedTrackIds,
      ),
    );
  }
  return loadPersonalCandidateBatches(
    (offset) =>
      repository.findTracksForGenres(
        genres,
        PERSONAL_CANDIDATE_BATCH_SIZE,
        offset,
        excludedTrackIds,
      ),
    expanded,
  );
};

type DiscoveryCandidateOptions = {
  personal: PersonalHomeRepository;
  tasteRepository: PersonalHomeTasteRepository;
  taste: PersonalTaste;
  excludedTrackIds: string[];
  userRange?: TrackVocalRange | null;
  expanded?: boolean;
  candidateSession?: PersonalCandidateSession;
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
  const load = (
    source: string,
    read: (offset: number) => Promise<PersonalTrackCandidate[]>,
  ) =>
    options.candidateSession
      ? options.candidateSession.load(source, read)
      : loadPersonalCandidateBatches(read, expanded);
  const [popular, matched, newest, mostSung, voiceCandidates] =
    await Promise.all([
      load('popular', (offset) =>
        personal.findPopularTasteCandidates(
          PERSONAL_CANDIDATE_BATCH_SIZE,
          offset,
          excludedTrackIds,
        ),
      ),
      load('genres', (offset) =>
        tasteRepository.findTracksForGenres(
          topGenres(taste),
          PERSONAL_CANDIDATE_BATCH_SIZE,
          offset,
          excludedTrackIds,
        ),
      ),
      load('newest', (offset) =>
        tasteRepository.findNewestTracks(
          PERSONAL_CANDIDATE_BATCH_SIZE,
          offset,
          excludedTrackIds,
        ),
      ),
      load('singing', (offset) =>
        tasteRepository.findMostSungTracks(
          PERSONAL_CANDIDATE_BATCH_SIZE,
          new Date(Date.now() - 28 * 24 * 60 * 60 * 1000),
          offset,
          excludedTrackIds,
        ),
      ),
      voice,
    ]);
  return { popular, matched, newest, mostSung, voice: voiceCandidates };
};

const loadVoiceCandidates = (options: DiscoveryCandidateOptions) => {
  const { userRange, tasteRepository, excludedTrackIds, expanded } = options;
  const load = (read: (offset: number) => Promise<PersonalTrackCandidate[]>) =>
    options.candidateSession
      ? options.candidateSession.load('voice', read)
      : loadPersonalCandidateBatches(read, expanded);
  const voice = userRange
    ? load((offset) =>
        tasteRepository.findVoiceCandidates(
          userRange,
          PERSONAL_CANDIDATE_BATCH_SIZE,
          offset,
          excludedTrackIds,
        ),
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
    candidateSession?: PersonalCandidateSession;
  },
) =>
  options.candidateSession
    ? options.candidateSession.load('exploration', (offset) =>
        personal.findTracksOutsideGenres(
          topGenres(options.taste),
          PERSONAL_CANDIDATE_BATCH_SIZE,
          offset,
          options.excludedTrackIds,
        ),
      )
    : options.expanded
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
