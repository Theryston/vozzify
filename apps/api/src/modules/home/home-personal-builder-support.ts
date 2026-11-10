import type { HomeRow, HomeTrack, Locale } from '@vozzify/contracts';
import type { AttemptsService } from '../attempts/attempts.service.js';
import type { StreaksService } from '../streaks/streaks.service.js';
import type { TrackLocaleTrendingService } from '../tracks/track-locale-trending.service.js';
import type { HomeRepository } from './home.repository.js';
import type { HomeAlbumCandidateSnapshot } from './home-album-candidates.js';
import type { HomeCompositionCandidateRow } from './home-composition-candidates.js';
import { personalScore } from './home-personal.js';
import type {
  PersonalHomeRepository,
  UserTrackSignal,
} from './home-personal.repository.js';
import type { UserTasteActivity } from './home-personal.repository.types.js';
import { personalBreadth, tasteSignalsOf } from './home-personal-activity.js';
import type { PersonalCandidateSession } from './home-personal-candidate-session.js';
import { decayedTaste } from './home-personal-recommendations.js';
import { trackIdsOfRow } from './home-personal-resume-rows.js';
import type { PersonalHomeTasteRowsService } from './home-personal-taste-rows.service.js';
import {
  personalConfidenceLambda,
  voiceEvidenceConfidence,
} from './home-stage2-scoring.js';

export type PersonalBuilderDependencies = {
  personal: PersonalHomeRepository;
  streaks: StreaksService;
  homeRepository: HomeRepository;
  localeTrending: TrackLocaleTrendingService;
  tasteRows?: PersonalHomeTasteRowsService;
};

export type PersonalBuilderOptions = {
  userId: string;
  locale: Locale;
  publicRows: HomeRow[];
  compositionCandidates?: HomeCompositionCandidateRow[];
  albumCandidates?: HomeAlbumCandidateSnapshot[];
  signals: UserTrackSignal[];
  favorites: Awaited<
    ReturnType<PersonalHomeRepository['findUserFavoriteSignals']>
  >;
  activities: UserTasteActivity[];
  socialRows: HomeRow[];
  timeZone: string | null;
  userRange: Awaited<ReturnType<AttemptsService['vocalRange']>>;
  voiceEvidenceCount: number | null;
};

export type PersonalRecommendation = {
  rows: HomeRow[];
  sourcePoolsByRow: Record<string, HomeTrack[]>;
};

export const personalBuilderScores = (
  deps: PersonalBuilderDependencies,
  options: PersonalBuilderOptions,
) => {
  const tasteSignals = tasteSignalsOf(
    options.activities,
    options.favorites,
    deps.streaks.practiceDayOf.bind(deps.streaks),
    options.timeZone,
  );
  const taste = decayedTaste(tasteSignals);
  const breadth = personalBreadth({
    activities: options.activities,
    favorites: options.favorites,
    timeZone: options.timeZone,
    dayKeyOf: deps.streaks.practiceDayOf.bind(deps.streaks),
  });
  const lambda = personalConfidenceLambda(
    breadth.distinctTracks,
    breadth.activeDays,
  );
  const voiceConfidence =
    options.voiceEvidenceCount === null
      ? 0
      : voiceEvidenceConfidence(options.voiceEvidenceCount);
  return { tasteSignals, taste, lambda, voiceConfidence };
};

export const personalCompositionScores = async (
  personal: PersonalHomeRepository,
  options: {
    rows: HomeRow[];
    recommendation: PersonalRecommendation;
    candidateSession?: PersonalCandidateSession;
    taste: ReturnType<typeof decayedTaste>;
  },
) => {
  const sourcePoolIds = Object.values(
    options.recommendation.sourcePoolsByRow,
  ).flatMap((tracks) => tracks.map((track) => track.id));
  const ids = [
    ...new Set(options.rows.flatMap(trackIdsOfRow).concat(sourcePoolIds)),
  ];
  const metadata = await (options.candidateSession
    ? options.candidateSession.discoveryMetadata(ids, (ids) =>
        personal.findDiscoveryTracks(ids),
      )
    : personal.findDiscoveryTracks(ids));
  const artistKeys = new Map(
    [...metadata].flatMap(([id, track]) =>
      track.artistKeys.length ? [[id, track.artistKeys] as const] : [],
    ),
  );
  const tasteByTrack = new Map(
    [...metadata].map(([id, track]) => [
      id,
      personalScore(track.genres, track.artistKey, options.taste),
    ]),
  );
  return { artistKeys, tasteByTrack };
};
