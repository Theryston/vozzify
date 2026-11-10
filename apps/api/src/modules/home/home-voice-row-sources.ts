import type { HomeRowTitle, Locale } from '@vozzify/contracts';
import type { HomeRepository } from './home.repository.js';
import {
  type HomeCandidate,
  type HomeRowSource,
  toHomeCandidate,
} from './home-row-sources.js';
import {
  VOICE_ROW_KINDS,
  type VoiceRowKind,
  voiceRowMatches,
} from './home-voice-rows.js';

/** How many ranged Tracks one by-voice row may choose from, best first. */
const VOICE_CANDIDATE_LIMIT = 200;

/** The repository read the by-voice rows need; narrowed so tests can fake it. */
type VoiceRecords = Pick<HomeRepository, 'findTracksWithVocalRange'>;

const VOICE_ROW_TITLES: Record<VoiceRowKind, HomeRowTitle> = {
  'easy-start': { key: 'home.rows.easyToStart', params: {} },
  'higher-voices': { key: 'home.rows.higherVoices', params: {} },
  'lower-voices': { key: 'home.rows.lowerVoices', params: {} },
};

const withVocalRange = (
  candidate: HomeCandidate,
): candidate is HomeCandidate & {
  vocalRange: { lowest: number; highest: number };
} => candidate.vocalRange !== null;

/**
 * The feed's by-voice rows, after the catalog rows: easy to start, higher
 * voices, lower voices. A Track's stored Vocal range decides each row, so a
 * Track without notes (no stored range) never qualifies; the composer drops
 * any row with fewer than six Tracks.
 */
export const createVoiceRowSources = (
  repository: VoiceRecords,
): HomeRowSource[] =>
  VOICE_ROW_KINDS.map((kind) => {
    const loadPage = async (_locale?: Locale, offset = 0) => {
      const records = await (offset === 0
        ? repository.findTracksWithVocalRange(VOICE_CANDIDATE_LIMIT)
        : repository.findTracksWithVocalRange(VOICE_CANDIDATE_LIMIT, offset));
      return {
        items: records
          .map(toHomeCandidate)
          .filter(withVocalRange)
          .filter((candidate) => voiceRowMatches(kind, candidate.vocalRange)),
        hasMore: records.length === VOICE_CANDIDATE_LIMIT,
      };
    };
    return {
      id: `by-voice-${kind}`,
      layout: 'vocal-range' as const,
      title: VOICE_ROW_TITLES[kind],
      candidatePageSize: VOICE_CANDIDATE_LIMIT,
      loadPage,
      load: async (locale, offset) => (await loadPage(locale, offset)).items,
    };
  });
