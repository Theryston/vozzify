import { isMasteredTrack } from './home-personal.js';
import { personalizeAlbumRows } from './home-personal-builder-albums.js';
import { recommendationRows } from './home-personal-builder-recommendations.js';
import {
  type PersonalBuilderDependencies,
  type PersonalBuilderOptions,
  personalBuilderScores,
  personalCompositionScores,
} from './home-personal-builder-support.js';
import { PersonalCandidateSession } from './home-personal-candidate-session.js';
import { composePersonalHomeRows } from './home-personal-composition.js';
import { personalCompositionCandidates } from './home-personal-composition-candidates.js';
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
  const resumeCandidates = resumeRows(options.signals, mastered, true);
  const dailyTarget = await dailyTargetRow(
    deps.streaks,
    options.userId,
    options.timeZone,
  );
  return { mastered, resumes, resumeCandidates, dailyTarget };
};

const buildPersonalRowsPass = async (
  deps: PersonalBuilderDependencies,
  options: PersonalBuilderOptions,
  candidateSession: PersonalCandidateSession,
  context: Awaited<ReturnType<typeof personalBuildContext>>,
) => {
  const { publicRows, mastered, resumes, dailyTarget } = context;
  const recommendation = await recommendationRows(deps, {
    ...options,
    ...context,
    candidateSession,
    leadingRows: [...resumes, ...options.socialRows],
  });
  Object.assign(
    recommendation.sourcePoolsByRow,
    Object.fromEntries(
      context.resumeCandidates.flatMap((row) =>
        row.layout === 'standard' ? [[row.id, row.items]] : [],
      ),
    ),
  );
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
      candidateSession,
      taste: context.taste,
    },
  );
  const rows = composePersonalHomeRows({
    expandRecommendationRows: true,
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
  return {
    rows,
    compositionCandidates: personalCompositionCandidates({
      rows,
      sourcePoolsByRow: recommendation.sourcePoolsByRow,
      artistKeysByTrack: artistKeys,
      mastered,
      tasteByTrack,
      explorationSeed: `${options.userId}:${new Date().toISOString().slice(0, 10)}`,
    }),
  };
};

const personalPublicRows = (
  deps: PersonalBuilderDependencies,
  options: PersonalBuilderOptions,
  scores: Pick<
    ReturnType<typeof personalBuilderScores>,
    'taste' | 'lambda' | 'voiceConfidence'
  >,
) =>
  personalizeAlbumRows({
    publicRows: options.publicRows,
    locale: options.locale,
    taste: scores.taste,
    lambda: scores.lambda,
    userRange: options.userRange,
    voiceConfidence: scores.voiceConfidence,
    albumCandidates: options.albumCandidates,
    personal: deps.personal,
  });

const personalBuildContext = async (
  deps: PersonalBuilderDependencies,
  options: PersonalBuilderOptions,
) => {
  const { tasteSignals, taste, lambda, voiceConfidence } =
    personalBuilderScores(deps, options);
  const publicRows = await personalPublicRows(deps, options, {
    taste,
    lambda,
    voiceConfidence,
  });
  const { mastered, resumes, resumeCandidates, dailyTarget } =
    await leadingRows(deps, options);
  return {
    tasteSignals,
    taste,
    lambda,
    voiceConfidence,
    publicRows,
    mastered,
    resumes,
    resumeCandidates,
    dailyTarget,
  };
};

export const buildPersonalRows = async (
  deps: PersonalBuilderDependencies,
  options: PersonalBuilderOptions,
) => {
  const session = new PersonalCandidateSession(
    new Set(options.publicRows.map(({ id }) => id)),
    options.userRange,
  );
  const context = await personalBuildContext(deps, options);
  let result = await buildPersonalRowsPass(deps, options, session, context);
  while (session.needsMore(result.rows))
    result = await buildPersonalRowsPass(deps, options, session, context);
  return result;
};
