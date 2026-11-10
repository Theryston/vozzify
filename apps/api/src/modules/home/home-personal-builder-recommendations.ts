import type { HomeRow, HomeTrack, Locale } from '@vozzify/contracts';
import type { AttemptsService } from '../attempts/attempts.service.js';
import type { HomeCompositionCandidateRow } from './home-composition-candidates.js';
import type { UserTrackSignal } from './home-personal.repository.js';
import type {
  PersonalBuilderDependencies,
  PersonalRecommendation,
} from './home-personal-builder-support.js';
import { buildPersonalVoiceAndDiscoveryRows } from './home-personal-candidate-rows.js';
import type { PersonalCandidateSession } from './home-personal-candidate-session.js';
import {
  buildPersonalExplorationRow,
  requirePersonalTasteRows,
  reservedChartTrackIds,
} from './home-personal-composition.js';
import type {
  decayedTaste,
  TasteSignal,
} from './home-personal-recommendations.js';
import { trackIdsOfRow } from './home-personal-resume-rows.js';
import { SINGING_SIGNAL_WINDOW_DAYS } from './home-popularity.js';
import { hasSufficientLocaleEvidence } from './home-stage2-scoring.js';

type VoiceAndDiscoveryOptions = {
  publicRows: HomeRow[];
  compositionCandidates?: HomeCompositionCandidateRow[];
  candidateSession?: PersonalCandidateSession;
  locale: Locale;
  taste: ReturnType<typeof decayedTaste>;
  lambda: number;
  mastered: ReadonlySet<string>;
  userRange: Awaited<ReturnType<AttemptsService['vocalRange']>>;
  voiceConfidence: number;
  usedTrackIds: Set<string>;
};

type RecommendationOptions = {
  userId: string;
  publicRows: HomeRow[];
  compositionCandidates?: HomeCompositionCandidateRow[];
  candidateSession?: PersonalCandidateSession;
  locale: Locale;
  signals: UserTrackSignal[];
  tasteSignals: TasteSignal[];
  taste: ReturnType<typeof decayedTaste>;
  lambda: number;
  mastered: ReadonlySet<string>;
  leadingRows: HomeRow[];
  userRange: Awaited<ReturnType<AttemptsService['vocalRange']>>;
  voiceConfidence: number;
};

const withRows = (trackIds: ReadonlySet<string>, rows: HomeRow[]) =>
  new Set([...trackIds, ...rows.flatMap(trackIdsOfRow)]);

const discoveryCollectiveScores = async (
  deps: PersonalBuilderDependencies,
  locale: Locale,
  candidateIds: string[],
  session?: PersonalCandidateSession,
): Promise<Map<string, number>> => {
  if (session)
    return session.discoveryScores(candidateIds, (ids) =>
      discoveryCollectiveScores(deps, locale, ids),
    );
  const since = new Date(
    Date.now() - SINGING_SIGNAL_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  const localeEvidence = await deps.homeRepository.localePracticeEvidence(
    locale,
    since,
  );
  const useLocale = hasSufficientLocaleEvidence(
    localeEvidence.distinctUsers,
    localeEvidence.activeDays,
  );
  const localeScores = useLocale
    ? await deps.localeTrending.rank(locale, new Date(), candidateIds)
    : undefined;
  const effectiveLocaleScores =
    localeScores && localeScores.length > 0 ? localeScores : undefined;
  const scoresByTrack = new Map(
    (effectiveLocaleScores ?? []).map(({ trackId, score }) => [trackId, score]),
  );
  const collectiveScores = await deps.homeRepository.popularityScoresForTracks(
    candidateIds,
    since,
    effectiveLocaleScores ? locale : undefined,
    scoresByTrack,
  );
  const collectiveByTrack = new Map(
    collectiveScores.map((item) => [item.trackId, item.score]),
  );
  return collectiveByTrack;
};

const voiceAndDiscoveryRows = async (
  deps: PersonalBuilderDependencies,
  options: VoiceAndDiscoveryOptions,
) => {
  const candidates = await requirePersonalTasteRows(
    deps.tasteRows,
  ).findDiscoveryCandidates(options.taste, {
    excludedTrackIds: options.mastered,
    userRange: options.userRange,
    expandRecommendationRows: true,
    candidateSession: options.candidateSession,
  });
  const sourcePools = mergePersonalSourcePools(
    candidates.byRow,
    options.compositionCandidates,
  );
  const sourceTracks = Object.values(sourcePools).flat();
  const ids = [
    ...new Set([
      ...options.publicRows.flatMap(trackIdsOfRow),
      ...candidates.tracks.map((track) => track.id),
      ...sourceTracks.map((track) => track.id),
    ]),
  ];
  const discovery = await (options.candidateSession
    ? options.candidateSession.discoveryMetadata(ids, (ids) =>
        deps.personal.findDiscoveryTracks(ids),
      )
    : deps.personal.findDiscoveryTracks(ids));
  const collectiveByTrack = await discoveryCollectiveScores(
    deps,
    options.locale,
    [...discovery.keys()],
    options.candidateSession,
  );
  const rankedDiscovery = new Map(
    [...discovery].map(([id, item]) => [
      id,
      {
        ...item,
        trendingScore: collectiveByTrack.get(id) ?? item.trendingScore,
      },
    ]),
  );
  return buildPersonalVoiceAndDiscoveryRows({
    publicRows: options.publicRows,
    candidateTracks: [...candidates.tracks, ...sourceTracks],
    candidatesByRow: sourcePools,
    discovery: rankedDiscovery,
    taste: options.taste,
    lambda: options.lambda,
    mastered: options.mastered,
    userRange: options.userRange,
    voiceConfidence: options.voiceConfidence,
    usedTrackIds: options.usedTrackIds,
    reservedTrackIds: reservedChartTrackIds(options.publicRows),
  });
};

const usedRecommendationTrackIds = (options: RecommendationOptions) => {
  const reservedTrackIds = reservedChartTrackIds(options.publicRows);
  const inheritedVoiceTrackIds = options.userRange
    ? []
    : options.publicRows.flatMap((row) =>
        row.layout === 'vocal-range'
          ? row.items.slice(0, 12).map((track) => track.id)
          : [],
      );
  return new Set([
    ...options.leadingRows.flatMap(trackIdsOfRow),
    ...reservedTrackIds,
    ...inheritedVoiceTrackIds,
  ]);
};

const recommendationSourcePools = (
  rows: HomeRow[],
  sourcePoolsByRow: Record<string, HomeTrack[]>,
) =>
  Object.fromEntries(
    rows.map((row) => {
      const sourcePool = sourcePoolsByRow[row.id];
      if (sourcePool) return [row.id, sourcePool];
      if (row.layout === 'hero') return [row.id, [row.track]];
      if (row.layout === 'standard' || row.layout === 'vocal-range') {
        return [row.id, row.items];
      }
      return [row.id, []];
    }),
  );

export const recommendationRows = async (
  deps: PersonalBuilderDependencies,
  options: RecommendationOptions,
): Promise<PersonalRecommendation> => {
  const { tasteRows } = deps;
  const usedTrackIds = usedRecommendationTrackIds(options);
  const tasteSourcePools: Record<string, HomeTrack[]> = {};
  const personalTasteRows = await requirePersonalTasteRows(tasteRows).build({
    userId: options.userId,
    signals: options.signals,
    tasteSignals: options.tasteSignals,
    taste: options.taste,
    mastered: options.mastered,
    usedTrackIds,
    publicRows: options.publicRows,
    sourcePoolsByRow: tasteSourcePools,
    candidateSession: options.candidateSession,
  });
  const { voiceRows, discoveryRows, sourcePoolsByRow } =
    await voiceAndDiscoveryRows(deps, {
      publicRows: options.publicRows,
      compositionCandidates: options.compositionCandidates,
      candidateSession: options.candidateSession,
      locale: options.locale,
      taste: options.taste,
      lambda: options.lambda,
      mastered: options.mastered,
      userRange: options.userRange,
      voiceConfidence: options.voiceConfidence,
      usedTrackIds,
    });
  const finalUsedTrackIds = withRows(usedTrackIds, discoveryRows);
  const exploration = await buildPersonalExplorationRow(tasteRows, {
    taste: options.taste,
    tasteSignals: options.tasteSignals,
    mastered: options.mastered,
    usedTrackIds: finalUsedTrackIds,
    sourcePoolsByRow: tasteSourcePools,
    candidateSession: options.candidateSession,
    visibleTrackSlots: [
      ...options.leadingRows,
      ...personalTasteRows,
      ...voiceRows,
      ...discoveryRows,
    ].flatMap(trackIdsOfRow).length,
  });
  const rows = [
    ...personalTasteRows,
    ...voiceRows,
    ...(exploration ? [exploration] : []),
    ...discoveryRows,
  ];
  return {
    rows,
    sourcePoolsByRow: recommendationSourcePools(rows, {
      ...sourcePoolsByRow,
      ...tasteSourcePools,
    }),
  };
};

const mergePersonalSourcePools = (
  pools: Record<string, HomeTrack[]>,
  publicCandidates: HomeCompositionCandidateRow[] = [],
): Record<string, HomeTrack[]> => {
  const merged = { ...pools };
  for (const row of publicCandidates) {
    merged[row.id] = [
      ...new Map(
        [...(merged[row.id] ?? []), ...row.items].map((track) => [
          track.id,
          track,
        ]),
      ).values(),
    ];
  }
  return merged;
};
