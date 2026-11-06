import type { HomeRow } from '@vozzify/contracts';
import { isMasteredTrack } from './home-personal.js';
import { personalizeAlbumRows } from './home-personal-builder-albums.js';
import { recommendationRows } from './home-personal-builder-recommendations.js';
import {
  type PersonalBuilderDependencies,
  type PersonalBuilderOptions,
  personalBuilderScores,
  personalCompositionScores,
} from './home-personal-builder-support.js';
import { composePersonalHomeRows } from './home-personal-composition.js';
import { dailyTargetRow } from './home-personal-daily-target.js';
import { resumeRows } from './home-personal-resume-rows.js';

const leadingRows = async (
  deps: PersonalBuilderDependencies,
  options: PersonalBuilderOptions,
) => {
  const mastered = new Set(
    options.signals
      .filter((signal) => isMasteredTrack(signal.bestAccuracy))
      .map((signal) => signal.trackId),
  );
  const resumes = resumeRows(options.signals, mastered);
  const dailyTarget = await dailyTargetRow(
    deps.streaks,
    options.userId,
    options.timeZone,
  );
  return { mastered, resumes, dailyTarget };
};

export const buildPersonalRows = async (
  deps: PersonalBuilderDependencies,
  options: PersonalBuilderOptions,
): Promise<HomeRow[]> => {
  const { tasteSignals, taste, lambda, voiceConfidence } =
    personalBuilderScores(deps, options);
  const publicRows = await personalizeAlbumRows({
    publicRows: options.publicRows,
    locale: options.locale,
    taste,
    lambda,
    userRange: options.userRange,
    voiceConfidence,
    albumCandidates: options.albumCandidates,
    personal: deps.personal,
  });
  const { mastered, resumes, dailyTarget } = await leadingRows(deps, options);
  const recommendation = await recommendationRows(deps, {
    userId: options.userId,
    publicRows,
    locale: options.locale,
    signals: options.signals,
    tasteSignals,
    taste,
    lambda,
    mastered,
    leadingRows: [...resumes, ...options.socialRows],
    userRange: options.userRange,
    voiceConfidence,
  });
  const { artistKeys, tasteByTrack } = await personalCompositionScores(
    deps.personal,
    {
      rows: [
        ...resumes,
        ...options.socialRows,
        ...publicRows,
        ...recommendation.rows,
      ],
      recommendation,
      taste,
    },
  );
  return composePersonalHomeRows({
    hero: recommendation.rows.find((row) => row.layout === 'hero'),
    dailyTarget,
    resumes,
    socialRows: options.socialRows,
    publicRows,
    recommendations: recommendation.rows,
    masteredTrackIds: mastered,
    artistKeysByTrack: artistKeys,
    tasteByTrack,
    explorationPoolsByRow: new Map(
      Object.entries(recommendation.sourcePoolsByRow),
    ),
    explorationSeed: `${options.userId}:${new Date().toISOString().slice(0, 10)}`,
  });
};
