import type { TrackVocalRange } from '@vozzify/contracts';
import type { PersonalTaste } from './home-personal.js';
import type { PersonalHomeRepository } from './home-personal.repository.js';
import type { PersonalTrackCandidate } from './home-personal.repository.types.js';
import { topGenres } from './home-personal-recommendations.js';
import { PersonalHomeTasteRepository } from './home-personal-taste.repository.js';

export const PERSONAL_CANDIDATE_BATCH_SIZE = 60;
export const PERSONAL_CANDIDATE_BATCHES = 4;

const loadPersonalCandidateBatches = async <T>(
  load: (offset: number) => Promise<T[]>,
) => {
  const candidates: T[] = [];
  for (let batch = 0; batch < PERSONAL_CANDIDATE_BATCHES; batch += 1) {
    const page = await load(batch * PERSONAL_CANDIDATE_BATCH_SIZE);
    candidates.push(...page);
    if (page.length < PERSONAL_CANDIDATE_BATCH_SIZE) break;
  }
  return candidates;
};

export const loadGenreTasteCandidates = (
  repository: PersonalHomeTasteRepository,
  genres: string[],
  excludedTrackIds: string[],
): Promise<PersonalTrackCandidate[]> =>
  loadPersonalCandidateBatches((offset) =>
    repository.findTracksForGenres(
      genres,
      PERSONAL_CANDIDATE_BATCH_SIZE,
      offset,
      excludedTrackIds,
    ),
  );

export const loadPersonalDiscoveryCandidates = async (options: {
  personal: PersonalHomeRepository;
  tasteRepository: PersonalHomeTasteRepository;
  taste: PersonalTaste;
  excludedTrackIds: string[];
  userRange?: TrackVocalRange | null;
}): Promise<{
  popular: PersonalTrackCandidate[];
  matched: PersonalTrackCandidate[];
  newest: PersonalTrackCandidate[];
  mostSung: PersonalTrackCandidate[];
  voice: PersonalTrackCandidate[];
}> => {
  const { personal, tasteRepository, taste, excludedTrackIds, userRange } =
    options;
  const voice = userRange
    ? loadPersonalCandidateBatches((offset) =>
        tasteRepository.findVoiceCandidates(
          userRange,
          PERSONAL_CANDIDATE_BATCH_SIZE,
          offset,
          excludedTrackIds,
        ),
      )
    : Promise.resolve([]);
  const [popular, matched, newest, mostSung, voiceCandidates] =
    await Promise.all([
      loadPersonalCandidateBatches((offset) =>
        personal.findPopularTasteCandidates(
          PERSONAL_CANDIDATE_BATCH_SIZE,
          offset,
          excludedTrackIds,
        ),
      ),
      loadPersonalCandidateBatches((offset) =>
        tasteRepository.findTracksForGenres(
          topGenres(taste),
          PERSONAL_CANDIDATE_BATCH_SIZE,
          offset,
          excludedTrackIds,
        ),
      ),
      loadPersonalCandidateBatches((offset) =>
        tasteRepository.findNewestTracks(
          PERSONAL_CANDIDATE_BATCH_SIZE,
          offset,
          excludedTrackIds,
        ),
      ),
      loadPersonalCandidateBatches((offset) =>
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
