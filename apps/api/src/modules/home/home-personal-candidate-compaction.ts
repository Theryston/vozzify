import type { TrackVocalRange } from '@vozzify/contracts';
import { homeArtistKeys } from './home-artist-keys.js';
import { retainUsefulCompositionCandidates } from './home-composition-candidates.js';
import type { PersonalTrackCandidate } from './home-personal.repository.types.js';
import {
  HOME_COMPOSITION_CANDIDATE_POOL_MAX_ITEMS,
  HOME_EXPANDED_ROW_ARTIST_CANDIDATE_LIMIT,
  HOME_TRACK_ROW_MAX_ITEMS,
} from './home-rules.js';
import { challengeOverrun, voiceFitScore } from './home-voice-fit.js';

type CompactionOptions = {
  source: string;
  sourceTargetCount: number;
  neededRows: ReadonlySet<string>;
  selectedTrackIds: ReadonlySet<string>;
  userRange: TrackVocalRange | null;
};

const fillsNeededVoiceRow = (
  track: PersonalTrackCandidate,
  options: CompactionOptions,
): boolean => {
  if (
    options.source !== 'voice' ||
    !options.userRange ||
    track.vocalRangeLowest === null ||
    track.vocalRangeHighest === null
  )
    return false;
  if (options.neededRows.has('recommended-for-you')) return true;
  const range = {
    lowest: track.vocalRangeLowest,
    highest: track.vocalRangeHighest,
  };
  const fits = voiceFitScore(options.userRange, range) > 0;
  return fits
    ? options.neededRows.has('within-your-voice')
    : options.neededRows.has('challenge-your-range') &&
        challengeOverrun(options.userRange, range) !== null;
};

/** A filled voice target must not crowd later candidates of its missing sibling. */
export const compactPersonalCandidates = (
  tracks: PersonalTrackCandidate[],
  options: CompactionOptions,
): PersonalTrackCandidate[] => {
  const unique = [
    ...new Map(tracks.map((track) => [track.id, track])).values(),
  ];
  const selected = unique.filter((track) =>
    options.selectedTrackIds.has(track.id),
  );
  const unused = unique.filter(
    (track) => !options.selectedTrackIds.has(track.id),
  );
  const prioritized = [
    ...unused.filter((track) => fillsNeededVoiceRow(track, options)),
    ...unused
      .filter((track) => !fillsNeededVoiceRow(track, options))
      .slice(
        0,
        options.source === 'voice' && options.userRange
          ? HOME_TRACK_ROW_MAX_ITEMS *
              Math.max(0, options.sourceTargetCount - options.neededRows.size)
          : undefined,
      ),
  ];
  const useful = retainUsefulCompositionCandidates(
    prioritized.map((track) => ({
      ...track,
      artistKey: track.id,
      artistKeys: homeArtistKeys(track.artistCredit, track.id),
    })),
    new Set(),
    HOME_EXPANDED_ROW_ARTIST_CANDIDATE_LIMIT *
      Math.max(1, options.neededRows.size),
  );
  const retainedIds = new Set(
    [...selected, ...useful]
      .slice(0, HOME_COMPOSITION_CANDIDATE_POOL_MAX_ITEMS)
      .map(({ id }) => id),
  );
  return unique.filter(({ id }) => retainedIds.has(id));
};
